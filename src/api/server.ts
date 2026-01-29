import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GitExtractor, DiffFormatter } from '../git';
import { loadConfig, isLLMAvailable } from '../config';
import { LLMClient, SYSTEM_PROMPT, createExplainPrompt, createReviewPrompt, createQuestionPrompt, createSummaryPrompt } from '../llm';

const git = new GitExtractor(process.cwd());
const formatter = new DiffFormatter();

export async function startAPIServer(port: number = 3000) {
    const app = new Hono();

    // Enable CORS
    app.use('/*', cors());

    // Health check
    app.get('/', (c) => {
        return c.json({
            name: 'difflearn',
            version: '0.1.0',
            status: 'running',
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

    console.log(`DiffLearn API server running on http://localhost:${port}`);

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
