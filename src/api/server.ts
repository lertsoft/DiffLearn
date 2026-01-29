import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/bun';
import { GitExtractor, DiffFormatter } from '../git';
import { loadConfig, isLLMAvailable } from '../config';
import { LLMClient, SYSTEM_PROMPT, createExplainPrompt, createReviewPrompt, createQuestionPrompt, createSummaryPrompt } from '../llm';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const git = new GitExtractor(process.cwd());
const formatter = new DiffFormatter();

// Get the directory of this file for serving static files
// This needs to work both in development and when installed globally
const __dirname = dirname(fileURLToPath(import.meta.url));

// Try multiple possible locations for web files
function findWebDir(): string {
    const possiblePaths = [
        join(__dirname, '../web'),           // Development: src/api -> src/web
        join(__dirname, '../../src/web'),    // Built: dist/cli -> src/web
        join(__dirname, '../src/web'),       // Linked: from project root
        resolve(__dirname, '../../web'),     // Alternative built location
    ];

    for (const p of possiblePaths) {
        if (existsSync(join(p, 'index.html'))) {
            return p;
        }
    }

    // Fallback to first option (will error with helpful message)
    console.warn('Warning: Could not find web directory. Tried:', possiblePaths);
    return possiblePaths[0];
}

const webDir = findWebDir();

export async function startAPIServer(port: number = 3000) {
    const app = new Hono();

    // Enable CORS
    app.use('/*', cors());

    // Serve static files from web directory
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

    // Health check / status endpoint
    app.get('/', async (c) => {
        // Check if this is an API request or browser request
        const accept = c.req.header('Accept') || '';

        if (accept.includes('text/html')) {
            // Serve the web UI
            const filePath = join(webDir, 'index.html');
            if (!existsSync(filePath)) {
                return c.text(`Web UI not found. Looking in: ${webDir}\n\nMake sure you're running from the DiffLearn project directory, or the web files exist.`, 404);
            }
            const file = Bun.file(filePath);
            return new Response(file, {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        // Return API status
        const config = loadConfig();
        return c.json({
            name: 'difflearn',
            version: '0.1.0',
            status: 'running',
            llmAvailable: isLLMAvailable(config),
            llmProvider: config.provider,
        });
    });

    // Get local diff
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
                        data: JSON.parse(formatter.toJSON(diffs)),
                    });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    // Get commit diff
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
                        data: JSON.parse(formatter.toJSON(diffs)),
                    });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    // Get branch diff
    app.get('/diff/branch/:branch1/:branch2', async (c) => {
        const branch1 = c.req.param('branch1');
        const branch2 = c.req.param('branch2');
        const format = c.req.query('format') || 'json';

        try {
            const diffs = await git.getBranchDiff(branch1, branch2);

            switch (format) {
                case 'markdown':
                    return c.text(formatter.toMarkdown(diffs));
                default:
                    return c.json({
                        success: true,
                        data: JSON.parse(formatter.toJSON(diffs)),
                    });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ success: false, error: message }, 500);
        }
    });

    // Get commit history
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

    // Explain diff
    app.post('/explain', async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const staged = body.staged || false;

        try {
            const config = loadConfig();
            const diffs = await git.getLocalDiff({ staged });

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

    // Review diff
    app.post('/review', async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const staged = body.staged || false;

        try {
            const config = loadConfig();
            const diffs = await git.getLocalDiff({ staged });

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

    // Ask about diff
    app.post('/ask', async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const { question, staged } = body;

        if (!question) {
            return c.json({ success: false, error: 'Question is required' }, 400);
        }

        try {
            const config = loadConfig();
            const diffs = await git.getLocalDiff({ staged });

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

    // Summary
    app.post('/summary', async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const staged = body.staged || false;

        try {
            const config = loadConfig();
            const diffs = await git.getLocalDiff({ staged });

            if (diffs.length === 0) {
                return c.json({ success: true, data: { summary: 'No changes to summarize.' } });
            }

            // Basic summary always available
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

    console.log(`\n🔍 DiffLearn Web UI running at http://localhost:${port}`);
    console.log(`   API available at http://localhost:${port}/diff/local\n`);

    // Start server with Bun
    Bun.serve({
        port,
        fetch: app.fetch,
    });
}

// Run if called directly
if (import.meta.main) {
    const port = parseInt(process.env.PORT || '3000', 10);
    startAPIServer(port).catch(console.error);
}
