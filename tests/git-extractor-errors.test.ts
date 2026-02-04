import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitExtractor } from '../src/git/extractor';

describe('GitExtractor error handling', () => {
    let tempDir = '';

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'difflearn-'));
    });

    afterEach(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('isRepo returns false when not a git repository', async () => {
        const git = new GitExtractor(tempDir);
        const result = await git.isRepo();
        expect(result).toBe(false);
    });

    test('getRawDiff throws when commit1 is missing', async () => {
        const git = new GitExtractor(process.cwd());
        await expect(git.getRawDiff('commit')).rejects.toThrow('commit1 is required');
    });

    test('getRawDiff throws when branch params are missing', async () => {
        const git = new GitExtractor(process.cwd());
        await expect(git.getRawDiff('branch')).rejects.toThrow('branch1 and branch2 are required');
    });
});
