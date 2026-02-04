import { describe, test, expect } from 'bun:test';
import { createMCPHandlers } from '../src/mcp/server';
import { ParsedDiff } from '../src/git/parser';

const sampleDiff: ParsedDiff = {
    oldFile: 'src/example.ts',
    newFile: 'src/example.ts',
    hunks: [],
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    additions: 0,
    deletions: 0,
};

describe('MCP handlers', () => {
    test('listTools returns tool definitions', async () => {
        const handlers = createMCPHandlers({
            git: {} as any,
            formatter: {} as any,
        });

        const result = await handlers.listTools();
        expect(result.tools.length).toBeGreaterThan(0);
        expect(result.tools.some(t => t.name === 'get_local_diff')).toBe(true);
    });

    test('get_local_diff returns json format when requested', async () => {
        const git = {
            getLocalDiff: async () => [sampleDiff],
            getRawDiff: async () => 'raw',
        } as any;
        const formatter = {
            toJSON: () => '{"ok":true}',
            toMarkdown: () => 'md',
        } as any;

        const handlers = createMCPHandlers({ git, formatter });
        const result = await handlers.callTool('get_local_diff', { format: 'json' });

        expect(result.content[0].text).toContain('"ok"');
    });

    test('explain_diff returns prompt when LLM unavailable', async () => {
        const git = {
            getLocalDiff: async () => [sampleDiff],
        } as any;

        const handlers = createMCPHandlers({
            git,
            formatter: {} as any,
            loadConfigFn: () => ({ provider: 'openai', model: 'gpt-4o', apiKey: '', useCLI: false }),
            isLLMAvailableFn: () => false,
            createExplainPromptFn: () => 'PROMPT',
        });

        const result = await handlers.callTool('explain_diff', {});
        expect(result.content[0].text).toContain('PROMPT');
    });

    test('ask_about_diff handles no changes', async () => {
        const git = {
            getLocalDiff: async () => [],
        } as any;

        const handlers = createMCPHandlers({
            git,
            formatter: {} as any,
        });

        const result = await handlers.callTool('ask_about_diff', { question: 'What changed?' });
        expect(result.content[0].text).toContain('No changes to ask about.');
    });

    test('readResource returns markdown for local', async () => {
        const git = {
            getLocalDiff: async () => [sampleDiff],
        } as any;
        const formatter = {
            toMarkdown: () => '# Git Diff Summary',
        } as any;

        const handlers = createMCPHandlers({ git, formatter });
        const result = await handlers.readResource('diff://local');

        expect(result.contents[0].text).toContain('# Git Diff Summary');
    });

    test('readResource throws for unknown uri', async () => {
        const handlers = createMCPHandlers({
            git: {} as any,
            formatter: {} as any,
        });

        await expect(handlers.readResource('diff://unknown')).rejects.toThrow('Unknown resource');
    });
});
