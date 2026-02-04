import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

let fileContent = '';

void mock.module('fs', () => ({
    existsSync: (path: string) => path.includes('.difflearn'),
    readFileSync: () => fileContent,
}));

void mock.module('os', () => ({
    homedir: () => '/mock/home',
}));

import { loadConfig } from '../src/config';

describe('Config file loading', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        delete process.env.DIFFLEARN_LLM_PROVIDER;
        delete process.env.OPENAI_API_KEY;
        delete process.env.DIFFLEARN_MODEL;
        delete process.env.DIFFLEARN_BASE_URL;
        delete process.env.DIFFLEARN_TEMPERATURE;
        delete process.env.DIFFLEARN_MAX_TOKENS;
        fileContent = '';
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        fileContent = '';
    });

    test('loads values from ~/.difflearn', () => {
        fileContent = [
            '# DiffLearn config',
            'DIFFLEARN_LLM_PROVIDER=ollama',
            'DIFFLEARN_MODEL=llama3.2',
            'DIFFLEARN_BASE_URL=http://localhost:11434/v1',
            'DIFFLEARN_TEMPERATURE=0.6',
            'DIFFLEARN_MAX_TOKENS=8000',
            '',
        ].join('\n');

        const config = loadConfig();

        expect(config.provider).toBe('ollama');
        expect(config.model).toBe('llama3.2');
        expect(config.baseUrl).toBe('http://localhost:11434/v1');
        expect(config.temperature).toBe(0.6);
        expect(config.maxTokens).toBe(8000);
        expect(config.apiKey).toBe('local');
        expect(config.useCLI).toBe(false);
    });

    test('environment variables override file config', () => {
        fileContent = 'DIFFLEARN_LLM_PROVIDER=ollama\nDIFFLEARN_MODEL=llama3.2\n';
        process.env.DIFFLEARN_LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.DIFFLEARN_MODEL = 'gpt-4o-mini';

        const config = loadConfig();

        expect(config.provider).toBe('openai');
        expect(config.apiKey).toBe('test-key');
        expect(config.model).toBe('gpt-4o-mini');
    });
});
