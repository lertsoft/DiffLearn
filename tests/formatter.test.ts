/**
 * Tests for the DiffFormatter module
 */
import { describe, test, expect } from 'bun:test';
import { DiffFormatter } from '../src/git/formatter';
import { ParsedDiff } from '../src/git/parser';

const mockDiff: ParsedDiff = {
    oldFile: 'src/example.ts',
    newFile: 'src/example.ts',
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    isBinary: false,
    additions: 2,
    deletions: 1,
    hunks: [
        {
            header: '@@ -1,5 +1,6 @@',
            oldStart: 1,
            oldLines: 5,
            newStart: 1,
            newLines: 6,
            lines: [
                { type: 'context', content: "import { foo } from 'bar';", oldLineNumber: 1, newLineNumber: 1 },
                { type: 'context', content: '', oldLineNumber: 2, newLineNumber: 2 },
                { type: 'delete', content: 'const oldValue = 42;', oldLineNumber: 3 },
                { type: 'add', content: 'const newValue = 100;', newLineNumber: 3 },
                { type: 'add', content: 'const anotherValue = 200;', newLineNumber: 4 },
            ],
        },
    ],
};

const newFileDiff: ParsedDiff = {
    oldFile: '/dev/null',
    newFile: 'src/new-file.ts',
    isNew: true,
    isDeleted: false,
    isRenamed: false,
    isBinary: false,
    additions: 3,
    deletions: 0,
    hunks: [
        {
            header: '@@ -0,0 +1,3 @@',
            oldStart: 0,
            oldLines: 0,
            newStart: 1,
            newLines: 3,
            lines: [
                { type: 'add', content: 'export function newFunction() {', newLineNumber: 1 },
                { type: 'add', content: "  return 'hello';", newLineNumber: 2 },
                { type: 'add', content: '}', newLineNumber: 3 },
            ],
        },
    ],
};

const renamedDiff: ParsedDiff = {
    oldFile: 'src/old-name.ts',
    newFile: 'src/new-name.ts',
    isNew: false,
    isDeleted: false,
    isRenamed: true,
    isBinary: false,
    additions: 1,
    deletions: 1,
    hunks: [
        {
            header: '@@ -1,1 +1,1 @@',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
                { type: 'delete', content: 'export const name = "old";', oldLineNumber: 1 },
                { type: 'add', content: 'export const name = "new";', newLineNumber: 1 },
            ],
        },
    ],
};

describe('DiffFormatter', () => {
    const formatter = new DiffFormatter();

    describe('toTerminal()', () => {
        test('should format diff for terminal output', () => {
            const result = formatter.toTerminal([mockDiff]);

            expect(result).toBeString();
            expect(result).toContain('src/example.ts');
            expect(result.length).toBeGreaterThan(0);
        });

        test('should include stats when enabled', () => {
            const result = formatter.toTerminal([mockDiff], { showStats: true });

            expect(result).toContain('+2');
            expect(result).toContain('-1');
        });

        test('should handle empty diff array', () => {
            const result = formatter.toTerminal([]);
            expect(result).toBe('');
        });

        test('should omit stats when disabled', () => {
            const result = formatter.toTerminal([mockDiff], { showStats: false });

            expect(result).not.toContain('  +2');
            expect(result).not.toContain('  -1');
        });

        test('should omit line numbers when disabled', () => {
            const result = formatter.toTerminal([mockDiff], { showLineNumbers: false });

            expect(result).toContain('+const newValue = 100;');
            expect(result).not.toContain('│');
        });

        test('should label renamed files', () => {
            const result = formatter.toTerminal([renamedDiff]);

            expect(result).toContain('Renamed');
            expect(result).toContain('old-name.ts');
            expect(result).toContain('new-name.ts');
        });
    });

    describe('toMarkdown()', () => {
        test('should format diff as markdown', () => {
            const result = formatter.toMarkdown([mockDiff]);

            expect(result).toContain('# Git Diff Summary');
            expect(result).toContain('src/example.ts');
            expect(result).toContain('```diff');
            expect(result).toContain('```');
        });

        test('should include file statistics', () => {
            const result = formatter.toMarkdown([mockDiff]);

            expect(result).toContain('+2');
            expect(result).toContain('-1');
        });

        test('should mark new files', () => {
            const result = formatter.toMarkdown([newFileDiff]);

            expect(result).toContain('new-file.ts');
        });

        test('should include renamed file status', () => {
            const result = formatter.toMarkdown([renamedDiff]);

            expect(result).toContain('(renamed)');
            expect(result).toContain('new-name.ts');
        });
    });

    describe('toJSON()', () => {
        test('should return valid JSON', () => {
            const result = formatter.toJSON([mockDiff]);

            expect(() => JSON.parse(result)).not.toThrow();
        });

        test('should include summary and files', () => {
            const result = JSON.parse(formatter.toJSON([mockDiff]));

            expect(result).toHaveProperty('summary');
            expect(result).toHaveProperty('files');
            expect(result.files).toBeArray();
        });

        test('should calculate correct totals in summary', () => {
            const result = JSON.parse(formatter.toJSON([mockDiff, newFileDiff]));

            expect(result.summary.files).toBe(2);
            expect(result.summary.additions).toBe(5); // 2 + 3
            expect(result.summary.deletions).toBe(1);
        });
    });

    describe('toSummary()', () => {
        test('should produce a compact summary', () => {
            const result = formatter.toSummary([mockDiff]);

            expect(result).toBeString();
            expect(result.length).toBeLessThan(500);
            expect(result).toContain('file');
        });

        test('should handle multiple files', () => {
            const result = formatter.toSummary([mockDiff, newFileDiff]);

            expect(result).toContain('2');
        });
    });
});
