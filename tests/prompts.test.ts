/**
 * Tests for the LLM prompts module
 */
import { describe, test, expect } from 'bun:test';
import {
    SYSTEM_PROMPT,
    createExplainPrompt,
    createReviewPrompt,
    createSummaryPrompt,
    createQuestionPrompt,
    createLineQuestionPrompt,
} from '../src/llm/prompts';
import { ParsedDiff } from '../src/git/parser';

const mockDiff: ParsedDiff = {
    oldFile: 'src/example.ts',
    newFile: 'src/example.ts',
    isNew: false,
    isDeleted: false,
    isRenamed: false,
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
                { type: 'delete', content: 'const oldValue = 42;', oldLineNumber: 3 },
                { type: 'add', content: 'const newValue = 100;', newLineNumber: 3 },
                { type: 'add', content: 'const anotherValue = 200;', newLineNumber: 4 },
            ],
        },
    ],
};

describe('LLM Prompts', () => {
    describe('SYSTEM_PROMPT', () => {
        test('should be a non-empty string', () => {
            expect(SYSTEM_PROMPT).toBeString();
            expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
        });

        test('should mention code review or diff analysis', () => {
            const prompt = SYSTEM_PROMPT.toLowerCase();
            expect(prompt.includes('code') || prompt.includes('diff')).toBe(true);
        });
    });

    describe('createExplainPrompt()', () => {
        test('should include diff content', () => {
            const prompt = createExplainPrompt([mockDiff]);

            expect(prompt).toContain('example.ts');
            expect(prompt).toContain('oldValue');
            expect(prompt).toContain('newValue');
        });

        test('should ask for explanation', () => {
            const prompt = createExplainPrompt([mockDiff]).toLowerCase();

            expect(prompt.includes('explain') || prompt.includes('what')).toBe(true);
        });

        test('should handle multiple files', () => {
            const prompt = createExplainPrompt([mockDiff, mockDiff]);

            expect(prompt.length).toBeGreaterThan(createExplainPrompt([mockDiff]).length);
        });

        test('should handle empty diff array', () => {
            const prompt = createExplainPrompt([]);

            expect(prompt).toBeString();
        });
    });

    describe('createReviewPrompt()', () => {
        test('should include diff content', () => {
            const prompt = createReviewPrompt([mockDiff]);

            expect(prompt).toContain('example.ts');
        });

        test('should ask for code review', () => {
            const prompt = createReviewPrompt([mockDiff]).toLowerCase();

            expect(prompt.includes('review') || prompt.includes('issue') || prompt.includes('bug')).toBe(true);
        });
    });

    describe('createSummaryPrompt()', () => {
        test('should include diff content', () => {
            const prompt = createSummaryPrompt([mockDiff]);

            expect(prompt).toContain('example.ts');
        });

        test('should ask for summary', () => {
            const prompt = createSummaryPrompt([mockDiff]).toLowerCase();

            expect(prompt.includes('summary') || prompt.includes('summarize') || prompt.includes('brief')).toBe(true);
        });
    });

    describe('createQuestionPrompt()', () => {
        test('should include diff content and question', () => {
            const question = 'Is this change safe?';
            const prompt = createQuestionPrompt([mockDiff], question);

            expect(prompt).toContain('example.ts');
            expect(prompt).toContain(question);
        });

        test('should work with complex questions', () => {
            const question = 'What are the performance implications of changing from 42 to 100?';
            const prompt = createQuestionPrompt([mockDiff], question);

            expect(prompt).toContain(question);
        });
    });

    describe('createLineQuestionPrompt()', () => {
        test('should include file name and question', () => {
            const question = 'Why was this line changed?';
            const prompt = createLineQuestionPrompt(mockDiff, 0, question);

            expect(prompt).toContain('example.ts');
            expect(prompt).toContain(question);
        });

        test('should include hunk header', () => {
            const question = 'What does this change?';
            const prompt = createLineQuestionPrompt(mockDiff, 0, question);

            expect(prompt).toContain('@@ -1,5 +1,6 @@');
        });

        test('should fallback to full diff for invalid hunk index', () => {
            const question = 'What changed?';
            const prompt = createLineQuestionPrompt(mockDiff, 999, question);

            // Should still work, fallback to full diff context
            expect(prompt).toContain(question);
        });
    });
});
