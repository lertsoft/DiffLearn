/**
 * Tests for the DiffParser module
 */
import { describe, test, expect } from 'bun:test';
import { DiffParser, ParsedDiff, ParsedHunk } from '../src/git/parser';

const sampleDiff = `diff --git a/src/example.ts b/src/example.ts
index abc123..def456 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,5 +1,6 @@
 import { foo } from 'bar';
 
-const oldValue = 42;
+const newValue = 100;
+const anotherValue = 200;
 
 export function example() {
`;

const newFileDiff = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export function newFunction() {
+  return 'hello';
+}
`;

const deletedFileDiff = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index abc123..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function oldFunction() {
-  return 'goodbye';
-}
`;

const binaryDiff = `diff --git a/assets/logo.png b/assets/logo.png
index 1111111..2222222 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

const renameDiff = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 98%
rename from src/old-name.ts
rename to src/new-name.ts
index abc123..def456 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,2 +1,2 @@
-export const name = 'old';
+export const name = 'new';
`;

const multiHunkDiff = `diff --git a/src/multi.ts b/src/multi.ts
index abc123..def456 100644
--- a/src/multi.ts
+++ b/src/multi.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
@@ -10,3 +10,4 @@
 function demo() {
   return 1;
+  // extra
 }
`;

const noCountHunkDiff = `diff --git a/src/nocount.ts b/src/nocount.ts
index abc123..def456 100644
--- a/src/nocount.ts
+++ b/src/nocount.ts
@@ -1 +1 @@
-const value = 1;
+const value = 2;
`;

describe('DiffParser', () => {
    const parser = new DiffParser();

    describe('parse()', () => {
        test('should parse a simple diff with additions and deletions', () => {
            const result = parser.parse(sampleDiff);

            expect(result).toBeArray();
            expect(result.length).toBe(1);

            const file = result[0];
            expect(file.oldFile).toBe('src/example.ts');
            expect(file.newFile).toBe('src/example.ts');
            expect(file.isNew).toBe(false);
            expect(file.isDeleted).toBe(false);
        });

        test('should correctly count additions and deletions', () => {
            const result = parser.parse(sampleDiff);
            const file = result[0];

            expect(file.additions).toBe(2);
            expect(file.deletions).toBe(1);
        });

        test('should parse hunks correctly', () => {
            const result = parser.parse(sampleDiff);
            const file = result[0];

            expect(file.hunks.length).toBe(1);
            expect(file.hunks[0].header).toContain('@@ -1,5 +1,6 @@');
        });

        test('should identify line types correctly', () => {
            const result = parser.parse(sampleDiff);
            const lines = result[0].hunks[0].lines;

            const contextLines = lines.filter(l => l.type === 'context');
            const addLines = lines.filter(l => l.type === 'add');
            const deleteLines = lines.filter(l => l.type === 'delete');

            expect(contextLines.length).toBeGreaterThan(0);
            expect(addLines.length).toBe(2);
            expect(deleteLines.length).toBe(1);
        });

        test('should parse new file diffs', () => {
            const result = parser.parse(newFileDiff);

            expect(result.length).toBe(1);
            expect(result[0].isNew).toBe(true);
            expect(result[0].isDeleted).toBe(false);
            expect(result[0].additions).toBe(3);
            expect(result[0].deletions).toBe(0);
        });

        test('should parse deleted file diffs', () => {
            const result = parser.parse(deletedFileDiff);

            expect(result.length).toBe(1);
            expect(result[0].isNew).toBe(false);
            expect(result[0].isDeleted).toBe(true);
            expect(result[0].additions).toBe(0);
            expect(result[0].deletions).toBe(3);
        });

        test('should handle empty diff', () => {
            const result = parser.parse('');
            expect(result).toBeArray();
            expect(result.length).toBe(0);
        });

        test('should parse multiple files in one diff', () => {
            const multiFileDiff = sampleDiff + '\n' + newFileDiff;
            const result = parser.parse(multiFileDiff);

            expect(result.length).toBe(2);
        });

        test('should detect binary diffs', () => {
            const result = parser.parse(binaryDiff);

            expect(result.length).toBe(1);
            expect(result[0].isBinary).toBe(true);
        });

        test('should detect renamed files', () => {
            const result = parser.parse(renameDiff);

            expect(result.length).toBe(1);
            expect(result[0].isRenamed).toBe(true);
            expect(result[0].oldFile).toBe('src/old-name.ts');
            expect(result[0].newFile).toBe('src/new-name.ts');
        });

        test('should parse multiple hunks in one file', () => {
            const result = parser.parse(multiHunkDiff);

            expect(result.length).toBe(1);
            expect(result[0].hunks.length).toBe(2);
        });

        test('should parse hunks without explicit line counts', () => {
            const result = parser.parse(noCountHunkDiff);

            expect(result.length).toBe(1);
            expect(result[0].hunks.length).toBe(1);
            expect(result[0].hunks[0].oldLines).toBe(1);
            expect(result[0].hunks[0].newLines).toBe(1);
        });
    });

    describe('line numbers', () => {
        test('should track old and new line numbers', () => {
            const result = parser.parse(sampleDiff);
            const lines = result[0].hunks[0].lines;

            // Context and delete lines should have old line numbers
            const deleteLines = lines.filter(l => l.type === 'delete');
            expect(deleteLines.every(l => l.oldLineNumber !== undefined)).toBe(true);

            // Context and add lines should have new line numbers
            const addLines = lines.filter(l => l.type === 'add');
            expect(addLines.every(l => l.newLineNumber !== undefined)).toBe(true);
        });
    });

    describe('toUnifiedFormat()', () => {
        test('should round-trip a parsed diff to unified format', () => {
            const parsed = parser.parse(sampleDiff);
            const unified = parser.toUnifiedFormat(parsed[0]);

            expect(unified).toContain('diff --git a/src/example.ts b/src/example.ts');
            expect(unified).toContain('@@ -1,5 +1,6 @@');
            expect(unified).toContain('+const newValue = 100;');
        });

        test('should include new file headers', () => {
            const parsed = parser.parse(newFileDiff);
            const unified = parser.toUnifiedFormat(parsed[0]);

            expect(unified).toContain('new file mode');
            expect(unified).toContain('--- /dev/null');
            expect(unified).toContain('+++ b/src/new-file.ts');
        });

        test('should include deleted file headers', () => {
            const parsed = parser.parse(deletedFileDiff);
            const unified = parser.toUnifiedFormat(parsed[0]);

            expect(unified).toContain('deleted file mode');
            expect(unified).toContain('+++ /dev/null');
        });
    });
});
