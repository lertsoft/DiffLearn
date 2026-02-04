/**
 * Tests for the API Server endpoints
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { GitExtractor } from '../src/git/extractor';

const API_BASE = 'http://localhost:3333';
let serverProcess: any;
let commitHash = '';
let branch1 = '';
let branch2 = '';

describe('API Server', () => {
    beforeAll(async () => {
        // Start the API server on a test port
        serverProcess = Bun.spawn(['bun', 'run', 'src/api/server.ts'], {
            env: {
                ...process.env,
                PORT: '3333',
                DIFFLEARN_LLM_PROVIDER: 'openai',
                OPENAI_API_KEY: '',
                ANTHROPIC_API_KEY: '',
                GOOGLE_AI_API_KEY: '',
            },
            stdout: 'pipe',
            stderr: 'pipe',
        });

        // Wait for server to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        const git = new GitExtractor(process.cwd());
        const commits = await git.getCommitHistory(2);
        commitHash = commits[0]?.hash || '';

        const branches = await git.getBranches();
        branch1 = branches[0]?.name || '';
        branch2 = branches[1]?.name || branches[0]?.name || '';
    });

    afterAll(() => {
        // Kill the server process
        serverProcess?.kill();
    });

    describe('GET /', () => {
        test('should return API status', async () => {
            const response = await fetch(`${API_BASE}/`, {
                headers: { 'Accept': 'application/json' },
            });

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data).toHaveProperty('name', 'difflearn');
            expect(data).toHaveProperty('version');
            expect(data).toHaveProperty('status', 'running');
        });

        test('should include LLM availability info', async () => {
            const response = await fetch(`${API_BASE}/`, {
                headers: { 'Accept': 'application/json' },
            });

            const data = await response.json();
            expect(data).toHaveProperty('llmAvailable');
            expect(data).toHaveProperty('llmProvider');
        });
    });

    describe('GET /diff/local', () => {
        test('should return diff data', async () => {
            const response = await fetch(`${API_BASE}/diff/local`);

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data).toHaveProperty('success');
            expect(data).toHaveProperty('data');
        });

        test('should return JSON format by default', async () => {
            const response = await fetch(`${API_BASE}/diff/local`);
            const data = await response.json();

            expect(data.data).toHaveProperty('summary');
            expect(data.data).toHaveProperty('files');
        });

        test('should return markdown format when requested', async () => {
            const response = await fetch(`${API_BASE}/diff/local?format=markdown`);
            const text = await response.text();

            expect(text).toContain('Git Diff');
        });

        test('should handle staged parameter', async () => {
            const response = await fetch(`${API_BASE}/diff/local?staged=true`);

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data.success).toBe(true);
        });

        test('should return raw format when requested', async () => {
            const response = await fetch(`${API_BASE}/diff/local?format=raw`);

            expect(response.ok).toBe(true);
            const text = await response.text();
            expect(typeof text).toBe('string');
        });
    });

    describe('GET /diff/commit/:sha', () => {
        test('should return commit diff in JSON format', async () => {
            if (!commitHash) return;
            const response = await fetch(`${API_BASE}/diff/commit/${commitHash}`);

            expect(response.ok).toBe(true);
            const data = await response.json();
            expect(data.success).toBe(true);
        });

        test('should return commit diff in markdown format', async () => {
            if (!commitHash) return;
            const response = await fetch(`${API_BASE}/diff/commit/${commitHash}?format=markdown`);

            expect(response.ok).toBe(true);
            const text = await response.text();
            expect(text).toContain('# Git Diff Summary');
        });
    });

    describe('GET /diff/branch/:branch1/:branch2', () => {
        test('should return branch diff in JSON format', async () => {
            if (!branch1 || !branch2) return;
            const encodedBranch1 = encodeURIComponent(branch1);
            const encodedBranch2 = encodeURIComponent(branch2);
            const response = await fetch(`${API_BASE}/diff/branch/${encodedBranch1}/${encodedBranch2}`);

            expect(response.ok).toBe(true);
            const data = await response.json();
            expect(data.success).toBe(true);
        });
    });

    describe('GET /history', () => {
        test('should return commit history', async () => {
            const response = await fetch(`${API_BASE}/history`);

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data.success).toBe(true);
            expect(data.data).toBeArray();
        });

        test('should respect limit parameter', async () => {
            const response = await fetch(`${API_BASE}/history?limit=5`);
            const data = await response.json();

            expect(data.data.length).toBeLessThanOrEqual(5);
        });

        test('should return commit details', async () => {
            const response = await fetch(`${API_BASE}/history?limit=1`);
            const data = await response.json();

            if (data.data.length > 0) {
                const commit = data.data[0];
                expect(commit).toHaveProperty('hash');
                expect(commit).toHaveProperty('message');
                expect(commit).toHaveProperty('author');
                expect(commit).toHaveProperty('date');
            }
        });
    });

    describe('POST /ask', () => {
        test('should require question parameter', async () => {
            const response = await fetch(`${API_BASE}/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            expect(response.status).toBe(400);

            const data = await response.json();
            expect(data.success).toBe(false);
            expect(data.error).toContain('Question');
        });

        test('should accept question and return response', async () => {
            const response = await fetch(`${API_BASE}/ask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: 'What changed?' }),
            });

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data.success).toBe(true);
        });
    });

    describe('POST /explain', () => {
        test('should return explanation or prompt', async () => {
            const response = await fetch(`${API_BASE}/explain`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data.success).toBe(true);
            expect(data.data).toBeDefined();
        });
    });

    describe('POST /review', () => {
        test('should return review or prompt', async () => {
            const response = await fetch(`${API_BASE}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data.success).toBe(true);
        });
    });

    describe('POST /summary', () => {
        test('should return summary', async () => {
            const response = await fetch(`${API_BASE}/summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });

            expect(response.ok).toBe(true);

            const data = await response.json();
            expect(data.success).toBe(true);
            expect(data.data).toHaveProperty('summary');
        });
    });

    describe('Static file serving', () => {
        test('should serve CSS file', async () => {
            const response = await fetch(`${API_BASE}/styles.css`);

            expect(response.ok).toBe(true);
            expect(response.headers.get('Content-Type')).toContain('text/css');
        });

        test('should serve JS file', async () => {
            const response = await fetch(`${API_BASE}/app.js`);

            expect(response.ok).toBe(true);
            expect(response.headers.get('Content-Type')).toContain('javascript');
        });

        test('should serve HTML for browser requests', async () => {
            const response = await fetch(`${API_BASE}/`, {
                headers: { 'Accept': 'text/html' },
            });

            expect(response.ok).toBe(true);
            expect(response.headers.get('Content-Type')).toContain('text/html');

            const html = await response.text();
            expect(html).toContain('DiffLearn');
        });
    });
});
