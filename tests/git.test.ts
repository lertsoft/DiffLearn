/**
 * Tests for the GitExtractor module
 */
import { describe, test, expect } from 'bun:test';
import { GitExtractor } from '../src/git/extractor';

describe('GitExtractor', () => {
    const git = new GitExtractor(process.cwd());

    describe('constructor', () => {
        test('should create instance with default path', () => {
            const extractor = new GitExtractor();
            expect(extractor).toBeDefined();
        });

        test('should create instance with custom path', () => {
            const extractor = new GitExtractor(process.cwd());
            expect(extractor).toBeDefined();
        });
    });

    describe('getLocalDiff()', () => {
        test('should return array of parsed diffs', async () => {
            const diffs = await git.getLocalDiff();

            expect(diffs).toBeArray();
        });

        test('should handle staged option', async () => {
            const diffs = await git.getLocalDiff({ staged: true });

            expect(diffs).toBeArray();
        });

        test('should handle context option', async () => {
            const diffs = await git.getLocalDiff({ context: 5 });

            expect(diffs).toBeArray();
        });
    });

    describe('getAllLocalChanges()', () => {
        test('should return staged and unstaged arrays', async () => {
            const result = await git.getAllLocalChanges();

            expect(result).toHaveProperty('staged');
            expect(result).toHaveProperty('unstaged');
            expect(result.staged).toBeArray();
            expect(result.unstaged).toBeArray();
        });
    });

    describe('getCommitHistory()', () => {
        test('should return array of commits', async () => {
            const commits = await git.getCommitHistory(5);

            expect(commits).toBeArray();
        });

        test('should respect limit parameter', async () => {
            const commits = await git.getCommitHistory(3);

            expect(commits.length).toBeLessThanOrEqual(3);
        });

        test('should return commit objects with required fields', async () => {
            const commits = await git.getCommitHistory(1);

            if (commits.length > 0) {
                const commit = commits[0];
                expect(commit).toHaveProperty('hash');
                expect(commit).toHaveProperty('message');
                expect(commit).toHaveProperty('author');
                expect(commit).toHaveProperty('date');

                expect(commit.hash).toMatch(/^[0-9a-f]+$/);
                expect(commit.message).toBeString();
            }
        });
    });

    describe('getCommitDiff()', () => {
        test('should get diff for a commit', async () => {
            const commits = await git.getCommitHistory(1);

            if (commits.length > 0) {
                const diffs = await git.getCommitDiff(commits[0].hash);

                expect(diffs).toBeArray();
            }
        });
    });

    describe('getFileDiff()', () => {
        test('should return array for file diff', async () => {
            const diffs = await git.getFileDiff('README.md');
            expect(diffs).toBeArray();
        });
    });

    describe('getRawDiff()', () => {
        test('should return raw diff string for local changes', async () => {
            const raw = await git.getRawDiff('local');

            expect(typeof raw).toBe('string');
        });

        test('should return raw diff string for staged changes', async () => {
            const raw = await git.getRawDiff('staged');

            expect(typeof raw).toBe('string');
        });
    });

    describe('getBranches()', () => {
        test('should return array of branch info objects', async () => {
            const branches = await git.getBranches();

            expect(branches).toBeArray();
            // At least one branch should exist
            expect(branches.length).toBeGreaterThan(0);
        });

        test('should include current branch', async () => {
            const branches = await git.getBranches();

            // Each branch should have name, current, and commit
            const first = branches[0];
            expect(first).toHaveProperty('name');
            expect(first).toHaveProperty('current');
            expect(first).toHaveProperty('commit');
        });

        test('should have one current branch', async () => {
            const branches = await git.getBranches();
            const currentBranches = branches.filter(b => b.current === true);

            expect(currentBranches.length).toBe(1);
        });
    });

    describe('getCurrentBranch()', () => {
        test('should return current branch name', async () => {
            const current = await git.getCurrentBranch();

            expect(typeof current).toBe('string');
            expect(current.length).toBeGreaterThan(0);
        });
    });

    describe('isRepo()', () => {
        test('should return true for valid git repo', async () => {
            const result = await git.isRepo();

            expect(result).toBe(true);
        });
    });
});
