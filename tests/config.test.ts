/**
 * Tests for the Config module
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { loadConfig, isLLMAvailable, detectProvider, isCLIAvailable, getCLICommand, getCLIAuthCommand } from '../src/config';

describe('Config', () => {
    const originalEnv = { ...process.env };

    // Mock fs for loadConfigFromFile
    void mock.module('fs', () => ({
        existsSync: () => false, // Default: config file doesn't exist
        readFileSync: () => '',
    }));

    // Also mock os.homedir to be safe
    void mock.module('os', () => ({
        homedir: () => '/mock/home',
    }));

    beforeEach(() => {
        // Clear all LLM-related env vars before each test
        delete process.env.DIFFLEARN_LLM_PROVIDER;
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GOOGLE_AI_API_KEY;
        delete process.env.DIFFLEARN_MODEL;
        delete process.env.DIFFLEARN_TEMPERATURE;
        delete process.env.DIFFLEARN_MAX_TOKENS;
        delete process.env.DIFFLEARN_BASE_URL;
    });

    afterEach(() => {
        // Restore original env
        process.env = { ...originalEnv };
    });

    describe('loadConfig()', () => {
        test('should return config object with required fields', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            const config = loadConfig();

            expect(config).toHaveProperty('provider');
            expect(config).toHaveProperty('model');
            expect(config).toHaveProperty('apiKey');
            expect(config).toHaveProperty('useCLI');
        });

        test('should use OpenAI as default when API key is set', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            const config = loadConfig();

            expect(config.provider).toBe('openai');
            expect(config.apiKey).toBe('test-key');
        });

        test('should respect DIFFLEARN_LLM_PROVIDER env var', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'anthropic';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            const config = loadConfig();

            expect(config.provider).toBe('anthropic');
        });

        test('should use CLI provider without API key', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'gemini-cli';
            const config = loadConfig();

            expect(config.provider).toBe('gemini-cli');
            expect(config.useCLI).toBe(true);
            expect(config.apiKey).toBe('local');
        });

        test('should use Ollama provider with default base URL', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'ollama';
            const config = loadConfig();

            expect(config.provider).toBe('ollama');
            expect(config.useCLI).toBe(false);
            expect(config.baseUrl).toBe('http://localhost:11434/v1');
            expect(config.model).toBe('llama3.2');
        });

        test('should use LM Studio provider with default base URL', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'lmstudio';
            const config = loadConfig();

            expect(config.provider).toBe('lmstudio');
            expect(config.useCLI).toBe(false);
            expect(config.baseUrl).toBe('http://localhost:1234/v1');
        });

        test('should use custom base URL for local providers', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'ollama';
            process.env.DIFFLEARN_BASE_URL = 'http://localhost:8080/v1';
            const config = loadConfig();

            expect(config.baseUrl).toBe('http://localhost:8080/v1');
        });

        test('should use custom model for Ollama', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'ollama';
            process.env.DIFFLEARN_MODEL = 'codellama';
            const config = loadConfig();

            expect(config.model).toBe('codellama');
        });

        test('should use custom model when specified', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.DIFFLEARN_MODEL = 'gpt-4-turbo';
            const config = loadConfig();

            expect(config.model).toBe('gpt-4-turbo');
        });

        test('should parse temperature as float', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.DIFFLEARN_TEMPERATURE = '0.7';
            const config = loadConfig();

            expect(config.temperature).toBe(0.7);
        });

        test('should parse maxTokens as integer', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.DIFFLEARN_MAX_TOKENS = '8192';
            const config = loadConfig();

            expect(config.maxTokens).toBe(8192);
        });

        test('should throw for unknown provider', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'unknown-provider';

            expect(() => loadConfig()).toThrow('Unknown LLM provider');
        });
    });

    describe('isLLMAvailable()', () => {
        test('should return true when API key is set', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            const config = loadConfig();

            expect(isLLMAvailable(config)).toBe(true);
        });

        test('should return true for CLI providers', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'gemini-cli';
            const config = loadConfig();

            expect(isLLMAvailable(config)).toBe(true);
        });

        test('should return false when no API key and not CLI', () => {
            const config = {
                provider: 'openai' as const,
                model: 'gpt-4',
                apiKey: '',
                useCLI: false,
            };

            expect(isLLMAvailable(config)).toBe(false);
        });

        test('should return true for Ollama provider', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'ollama';
            const config = loadConfig();

            expect(isLLMAvailable(config)).toBe(true);
        });

        test('should return true for LM Studio provider', () => {
            process.env.DIFFLEARN_LLM_PROVIDER = 'lmstudio';
            const config = loadConfig();

            expect(isLLMAvailable(config)).toBe(true);
        });
    });

    describe('detectProvider()', () => {
        test('should detect OpenAI when OPENAI_API_KEY is set', () => {
            process.env.OPENAI_API_KEY = 'test-key';

            expect(detectProvider()).toBe('openai');
        });

        test('should detect Anthropic when ANTHROPIC_API_KEY is set', () => {
            process.env.ANTHROPIC_API_KEY = 'test-key';

            expect(detectProvider()).toBe('anthropic');
        });

        test('should detect Google when GOOGLE_AI_API_KEY is set', () => {
            process.env.GOOGLE_AI_API_KEY = 'test-key';

            expect(detectProvider()).toBe('google');
        });

        test('should return null when no keys are set', () => {
            expect(detectProvider()).toBe(null);
        });

        test('should prioritize OpenAI when multiple keys are set', () => {
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.ANTHROPIC_API_KEY = 'test-key';

            expect(detectProvider()).toBe('openai');
        });
    });

    describe('getCLICommand()', () => {
        test('should return correct command for gemini-cli', () => {
            expect(getCLICommand('gemini-cli')).toBe('gemini');
        });

        test('should return correct command for claude-code', () => {
            expect(getCLICommand('claude-code')).toBe('claude');
        });

        test('should return correct command for cursor-cli', () => {
            expect(getCLICommand('cursor-cli')).toBe('agent');
        });

        test('should return undefined for non-CLI providers', () => {
            expect(getCLICommand('openai')).toBeUndefined();
        });
    });

    describe('getCLIAuthCommand()', () => {
        test('should return correct auth command for gemini-cli', () => {
            expect(getCLIAuthCommand('gemini-cli')).toEqual(['gemini']);
        });

        test('should return correct auth command for claude-code', () => {
            expect(getCLIAuthCommand('claude-code')).toEqual(['claude']);
        });

        test('should return correct auth command for cursor-cli', () => {
            expect(getCLIAuthCommand('cursor-cli')).toEqual(['agent', 'login']);
        });

        test('should return correct auth command for codex', () => {
            expect(getCLIAuthCommand('codex')).toEqual(['codex', 'login']);
        });

        test('should return undefined for non-CLI providers', () => {
            expect(getCLIAuthCommand('openai')).toBeUndefined();
        });
    });

    describe('isCLIAvailable()', () => {
        test('should return boolean for common commands', async () => {
            // 'which' should always be available
            const result = await isCLIAvailable('which');
            expect(typeof result).toBe('boolean');
        });

        test('should return false for non-existent command', async () => {
            const result = await isCLIAvailable('definitely-not-a-real-command-12345');
            expect(result).toBe(false);
        });
    });
});
