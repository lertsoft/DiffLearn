/**
 * Tests for the CLI commands
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { GitExtractor } from '../src/git/extractor';

describe('CLI', () => {
    let commitHash = '';
    let branch1 = '';
    let branch2 = '';

    beforeAll(async () => {
        const git = new GitExtractor(process.cwd());
        const commits = await git.getCommitHistory(2);
        commitHash = commits[0]?.hash || '';

        const branches = await git.getBranches();
        branch1 = branches[0]?.name || '';
        branch2 = branches[1]?.name || branches[0]?.name || '';
    });
    const runCLI = async (args: string[], envOverrides: Record<string, string> = {}) => {
        const proc = Bun.spawn(['bun', 'run', 'src/cli/index.tsx', ...args], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                DIFFLEARN_LLM_PROVIDER: 'openai',
                OPENAI_API_KEY: '',
                ANTHROPIC_API_KEY: '',
                GOOGLE_AI_API_KEY: '',
                ...envOverrides
            },
            stdout: 'pipe',
            stderr: 'pipe',
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        return { stdout, stderr, exitCode };
    };

    describe('--help', () => {
        test('should display help message', async () => {
            const { stdout, exitCode } = await runCLI(['--help']);

            expect(exitCode).toBe(0);
            expect(stdout).toContain('Usage:');
            expect(stdout).toContain('difflearn');
            expect(stdout).toContain('Commands:');
        });

        test('should list all commands', async () => {
            const { stdout } = await runCLI(['--help']);

            expect(stdout).toContain('local');
            expect(stdout).toContain('commit');
            expect(stdout).toContain('branch');
            expect(stdout).toContain('explain');
            expect(stdout).toContain('review');
            expect(stdout).toContain('summary');
            expect(stdout).toContain('export');
            expect(stdout).toContain('history');
            expect(stdout).toContain('web');
            expect(stdout).toContain('serve');
        });
    });

    describe('--version', () => {
        test('should display version', async () => {
            const { stdout, exitCode } = await runCLI(['--version']);

            expect(exitCode).toBe(0);
            expect(stdout).toMatch(/\d+\.\d+\.\d+/);
        });
    });

    describe('history command', () => {
        test('should list commits', async () => {
            const { stdout, exitCode } = await runCLI(['history', '-n', '3']);

            expect(exitCode).toBe(0);
            // Should contain commit hashes (7 char hex)
            expect(stdout).toMatch(/[0-9a-f]{7}/);
        });

        test('should respect -n flag', async () => {
            const { stdout: result1 } = await runCLI(['history', '-n', '1']);
            const { stdout: result3 } = await runCLI(['history', '-n', '3']);

            const lines1 = result1.trim().split('\n').filter(l => l.length > 0);
            const lines3 = result3.trim().split('\n').filter(l => l.length > 0);

            expect(lines1.length).toBeLessThanOrEqual(lines3.length);
        });
    });

    describe('export command', () => {
        test('should export in markdown format', async () => {
            const { stdout, exitCode } = await runCLI(['export', '--format', 'markdown']);

            expect(exitCode).toBe(0);
            expect(stdout).toContain('Git Diff');
        });

        test('should export in json format', async () => {
            const { stdout, exitCode } = await runCLI(['export', '--format', 'json']);

            expect(exitCode).toBe(0);
            // Should be valid JSON
            expect(() => JSON.parse(stdout)).not.toThrow();
        });

        test('should contain summary in JSON export', async () => {
            const { stdout } = await runCLI(['export', '--format', 'json']);
            const data = JSON.parse(stdout);

            expect(data).toHaveProperty('summary');
            expect(data).toHaveProperty('files');
        });
    });

    describe('local command', () => {
        test('should work with --no-interactive flag', async () => {
            const { exitCode, stdout } = await runCLI(['local', '--no-interactive']);

            expect(exitCode).toBe(0);
            // Should return something (or empty if no changes)
            expect(typeof stdout).toBe('string');
        });

        test('should accept --staged flag', async () => {
            const { exitCode } = await runCLI(['local', '--staged', '--no-interactive']);

            expect(exitCode).toBe(0);
        });
    });

    describe('commit command', () => {
        test('should print commit diff in non-interactive mode', async () => {
            if (!commitHash) return;
            const { exitCode, stdout } = await runCLI(['commit', commitHash, '--no-interactive']);

            expect(exitCode).toBe(0);
            expect(typeof stdout).toBe('string');
        });
    });

    describe('branch command', () => {
        test('should print branch diff in non-interactive mode', async () => {
            if (!branch1 || !branch2) return;
            const { exitCode, stdout } = await runCLI(['branch', branch1, branch2, '--no-interactive']);

            expect(exitCode).toBe(0);
            expect(typeof stdout).toBe('string');
        });
    });

    describe('explain command', () => {
        test('should run without error', async () => {
            const { exitCode } = await runCLI(['explain']);

            expect(exitCode).toBe(0);
        });
    });

    describe('summary command', () => {
        test('should return summary text', async () => {
            const { stdout, exitCode } = await runCLI(['summary']);

            expect(exitCode).toBe(0);
            expect(typeof stdout).toBe('string');
        });
    });

    describe('serve command', () => {
        test('should show usage without flags', async () => {
            const { stdout, exitCode } = await runCLI(['serve']);

            expect(exitCode).toBe(0);
            expect(stdout).toContain('--mcp');
            expect(stdout).toContain('--api');
        });
    });

    describe('help for subcommands', () => {
        test('local --help should show options', async () => {
            const { stdout, exitCode } = await runCLI(['local', '--help']);

            expect(exitCode).toBe(0);
            expect(stdout).toContain('--staged');
            expect(stdout).toContain('--no-interactive');
        });

        test('export --help should show format option', async () => {
            const { stdout, exitCode } = await runCLI(['export', '--help']);

            expect(exitCode).toBe(0);
            expect(stdout).toContain('--format');
        });
    });
});
