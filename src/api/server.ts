import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GitExtractor, DiffFormatter, type BranchDiffMode } from '../git';
import { loadConfig, isLLMAvailable } from '../config';
import { LLMClient, SYSTEM_PROMPT, createExplainPrompt, createReviewPrompt, createQuestionPrompt, createSummaryPrompt } from '../llm';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const git = new GitExtractor(process.cwd());
const formatter = new DiffFormatter();

interface DiffRequestBody {
    staged?: boolean;
    commit?: string;
    branchBase?: string;
    branchTarget?: string;
    branchMode?: BranchDiffMode;
}

interface BranchComparisonMetadata {
    baseResolved: string;
    targetResolved: string;
    mode: BranchDiffMode;
    localizedBranches: string[];
    messages: string[];
}

// Get the directory of this file for serving static files
// This needs to work both in development and when installed globally
const __dirname = dirname(fileURLToPath(import.meta.url));

// Try multiple possible locations for web files
function findWebDir(): string {
    const possiblePaths = [
        join(__dirname, '../web'),
        join(__dirname, '../../src/web'),
        join(__dirname, '../src/web'),
        resolve(__dirname, '../../web'),
    ];

    for (const p of possiblePaths) {
        if (existsSync(join(p, 'index.html'))) {
            return p;
        }
    }

    console.warn('Warning: Could not find web directory. Tried:', possiblePaths);
    return possiblePaths[0];
}

const webDir = findWebDir();

function normalizeBranchMode(mode?: string): BranchDiffMode {
    return mode === 'double' ? 'double' : 'triple';
}

function parseFormattedDiff(diffs: Awaited<ReturnType<GitExtractor['getLocalDiff']>>, comparison?: BranchComparisonMetadata) {
    const data = JSON.parse(formatter.toJSON(diffs));
    if (comparison) {
        return {
            ...data,
            comparison,
        };
    }

    return data;
}

// Helper function to get commit diff, handling comparison format (sha1..sha2)
async function getCommitDiffWithCompare(commit: string) {
    if (commit.includes('..')) {
        const [sha1, sha2] = commit.split('..');
        if (sha1 && sha2) {
            return await git.getCommitDiff(sha1, sha2);
        }
    }

    return await git.getCommitDiff(commit);
}

async function resolveBranchComparison(base: string, target: string, mode: BranchDiffMode) {
    const baseResolution = await git.ensureLocalBranch(base);
    const targetResolution = await git.ensureLocalBranch(target);

    const diffs = await git.getBranchDiff(
        baseResolution.resolvedLocalBranch,
        targetResolution.resolvedLocalBranch,
        mode,
    );

    const localizedBranches: string[] = [];
    if (baseResolution.localized) {
        localizedBranches.push(baseResolution.resolvedLocalBranch);
    }
    if (targetResolution.localized && !localizedBranches.includes(targetResolution.resolvedLocalBranch)) {
        localizedBranches.push(targetResolution.resolvedLocalBranch);
    }

    const messages: string[] = [];
    if (baseResolution.message) {
        messages.push(baseResolution.message);
    }
    if (targetResolution.message && targetResolution.message !== baseResolution.message) {
        messages.push(targetResolution.message);
    }

    const comparison: BranchComparisonMetadata = {
        baseResolved: baseResolution.resolvedLocalBranch,
        targetResolved: targetResolution.resolvedLocalBranch,
        mode,
        localizedBranches,
        messages,
    };

    return { diffs, comparison };
}

async function getDiffForRequest(body: DiffRequestBody) {
    const staged = body.staged || false;
    const commit = body.commit;

    if (body.branchBase && body.branchTarget) {
        const mode = normalizeBranchMode(body.branchMode);
        const comparison = await resolveBranchComparison(body.branchBase, body.branchTarget, mode);
        return comparison.diffs;
    }

    if (commit) {
        return await getCommitDiffWithCompare(commit);
    }

    return await git.getLocalDiff({ staged });
}

export async function startAPIServer(port: number = 3000) {
    const app = new Hono();

    app.use('/*', cors());

    app.get('/styles.css', async (c) => {
        const filePath = join(webDir, 'styles.css');
        if (!existsSync(filePath)) {
            return c.text('File not found: ' + filePath, 404);
        }
        const file = Bun.file(filePath);
        return new Response(file, {
            headers: { 'Content-Type': 'text/css' },
        });
    });

    app.get('/app.js', async (c) => {
        const filePath = join(webDir, 'app.js');
        if (!existsSync(filePath)) {
            return c.text('File not found: ' + filePath, 404);
        }
        const file = Bun.file(filePath);
        return new Response(file, {
            headers: { 'Content-Type': 'application/javascript' },
        });
    });

    app.get('/', async (c) => {
        const accept = c.req.header('Accept') || '';

        if (accept.includes('text/html')) {
            const filePath = join(webDir, 'index.html');
            if (!existsSync(filePath)) {
                return c.text(`Web UI not found. Looking in: ${webDir}\n\nMake sure you're running from the DiffLearn project directory, or the web files exist.`, 404);
            }
            const file = Bun.file(filePath);
            return new Response(file, {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        const config = loadConfig();
        return c.json({
            name: 'difflearn',
            version: '0.1.0',
            status: 'running',
            llmAvailable: isLLMAvailable(config),
            llmProvider: config.provider,
            cwd: process.cwd(),
        });
    });

    app.get('/branches', async (c) => {
        try {
            const [branches, currentBranch] = await Promise.all([
                git.getBranchesDetailed(),
                git.getCurrentBranch(),
            ]);

            return c.json({
                success: true,
                data: {
                    currentBranch,
                    branches,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.get('/diff/local', async (c) => {
        const staged = c.req.query('staged') === 'true';
        const format = c.req.query('format') || 'json';

        try {
            const diffs = await git.getLocalDiff({ staged });

            switch (format) {
                case 'markdown':
                    return c.text(formatter.toMarkdown(diffs));
                case 'raw':
                    const raw = await git.getRawDiff(staged ? 'staged' : 'local');
                    return c.text(raw);
                default:
                    return c.json({
                        success: true,
                        data: parseFormattedDiff(diffs),
                    });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.get('/diff/commit/:sha', async (c) => {
        const sha = c.req.param('sha');
        const sha2 = c.req.query('compare');
        const format = c.req.query('format') || 'json';

        try {
            const diffs = await git.getCommitDiff(sha, sha2);

            switch (format) {
                case 'markdown':
                    return c.text(formatter.toMarkdown(diffs));
                default:
                    return c.json({
                        success: true,
                        data: parseFormattedDiff(diffs),
                    });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.get('/diff/branch', async (c) => {
        const base = c.req.query('base');
        const target = c.req.query('target');
        const mode = normalizeBranchMode(c.req.query('mode'));
        const format = c.req.query('format') || 'json';

        if (!base || !target) {
            return c.json({ success: false, error: 'base and target are required' }, 400);
        }

        try {
            const { diffs, comparison } = await resolveBranchComparison(base, target, mode);

            switch (format) {
                case 'markdown':
                    return c.text(formatter.toMarkdown(diffs));
                default:
                    return c.json({
                        success: true,
                        data: parseFormattedDiff(diffs, comparison),
                    });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    // Backward compatibility route.
    app.get('/diff/branch/:branch1/:branch2', async (c) => {
        const branch1 = c.req.param('branch1');
        const branch2 = c.req.param('branch2');
        const mode = normalizeBranchMode(c.req.query('mode'));
        const format = c.req.query('format') || 'json';

        try {
            const { diffs, comparison } = await resolveBranchComparison(branch1, branch2, mode);

            switch (format) {
                case 'markdown':
                    return c.text(formatter.toMarkdown(diffs));
                default:
                    return c.json({
                        success: true,
                        data: parseFormattedDiff(diffs, comparison),
                    });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.post('/branch/switch', async (c) => {
        const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
        const branch = typeof body.branch === 'string' ? body.branch : '';
        const autoStash = body.autoStash !== false;

        if (!branch) {
            return c.json({ success: false, error: 'branch is required' }, 400);
        }

        try {
            const result = await git.switchBranch(branch, { autoStash });
            return c.json({
                success: true,
                data: result,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.get('/history', async (c) => {
        const limit = parseInt(c.req.query('limit') || '10', 10);

        try {
            const commits = await git.getCommitHistory(limit);
            return c.json({
                success: true,
                data: commits,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.post('/explain', async (c) => {
        const body = await c.req.json().catch(() => ({} as DiffRequestBody));

        try {
            const config = loadConfig();
            const diffs = await getDiffForRequest(body);

            if (diffs.length === 0) {
                return c.json({ success: true, data: { explanation: 'No changes to explain.' } });
            }

            if (!isLLMAvailable(config)) {
                return c.json({
                    success: true,
                    data: {
                        llmAvailable: false,
                        prompt: createExplainPrompt(diffs),
                        message: 'No LLM API key configured. Use the prompt with your own LLM.',
                    },
                });
            }

            const llm = new LLMClient(config);
            const response = await llm.chat([
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: createExplainPrompt(diffs) }
            ]);

            return c.json({
                success: true,
                data: {
                    explanation: response.content,
                    usage: response.usage,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.post('/review', async (c) => {
        const body = await c.req.json().catch(() => ({} as DiffRequestBody));

        try {
            const config = loadConfig();
            const diffs = await getDiffForRequest(body);

            if (diffs.length === 0) {
                return c.json({ success: true, data: { review: 'No changes to review.' } });
            }

            if (!isLLMAvailable(config)) {
                return c.json({
                    success: true,
                    data: {
                        llmAvailable: false,
                        prompt: createReviewPrompt(diffs),
                        message: 'No LLM API key configured. Use the prompt with your own LLM.',
                    },
                });
            }

            const llm = new LLMClient(config);
            const response = await llm.chat([
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: createReviewPrompt(diffs) }
            ]);

            return c.json({
                success: true,
                data: {
                    review: response.content,
                    usage: response.usage,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.post('/ask', async (c) => {
        const body = await c.req.json().catch(() => ({} as DiffRequestBody & { question?: string }));
        const question = body.question;

        if (!question) {
            return c.json({ success: false, error: 'Question is required' }, 400);
        }

        try {
            const config = loadConfig();
            const diffs = await getDiffForRequest(body);

            if (diffs.length === 0) {
                return c.json({ success: true, data: { answer: 'No changes to ask about.' } });
            }

            if (!isLLMAvailable(config)) {
                return c.json({
                    success: true,
                    data: {
                        llmAvailable: false,
                        prompt: createQuestionPrompt(diffs, question),
                        message: 'No LLM API key configured. Use the prompt with your own LLM.',
                    },
                });
            }

            const llm = new LLMClient(config);
            const response = await llm.chat([
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: createQuestionPrompt(diffs, question) }
            ]);

            return c.json({
                success: true,
                data: {
                    answer: response.content,
                    usage: response.usage,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    app.post('/summary', async (c) => {
        const body = await c.req.json().catch(() => ({} as DiffRequestBody));

        try {
            const config = loadConfig();
            const diffs = await getDiffForRequest(body);

            if (diffs.length === 0) {
                return c.json({ success: true, data: { summary: 'No changes to summarize.' } });
            }

            const basicSummary = formatter.toSummary(diffs);

            if (!isLLMAvailable(config)) {
                return c.json({
                    success: true,
                    data: {
                        summary: basicSummary,
                        llmAvailable: false,
                    },
                });
            }

            const llm = new LLMClient(config);
            const response = await llm.chat([
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: createSummaryPrompt(diffs) }
            ]);

            return c.json({
                success: true,
                data: {
                    summary: response.content,
                    basicSummary,
                    usage: response.usage,
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    let server;
    let currentPort = port;
    const maxRetries = 10;

    for (let i = 0; i < maxRetries; i++) {
        try {
            server = Bun.serve({
                port: currentPort,
                fetch: app.fetch,
            });
            break;
        } catch (error) {
            const err = error as { code?: string; message?: string };
            if (err.code === 'EADDRINUSE' || err.message?.includes('Address already in use')) {
                console.log(`Port ${currentPort} is in use, trying ${currentPort + 1}...`);
                currentPort++;
            } else {
                throw error;
            }
        }
    }

    if (!server) {
        throw new Error(`Could not find an open port after ${maxRetries} attempts.`);
    }

    console.log(`\n🔍 DiffLearn Web UI running at http://localhost:${currentPort}`);
    console.log(`   API available at http://localhost:${currentPort}/diff/local\n`);
}

if (import.meta.main) {
    const port = parseInt(process.env.PORT || '3000', 10);
    startAPIServer(port).catch(console.error);
}
