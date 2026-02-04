import { describe, test, expect, mock } from 'bun:test';

let lastOpenAIPayload: any = null;
let lastAnthropicPayload: any = null;

mock.module('openai', () => ({
    default: class OpenAI {
        chat = {
            completions: {
                create: async (payload: any) => {
                    lastOpenAIPayload = payload;
                    if (payload.stream) {
                        async function* stream() {
                            yield { choices: [{ delta: { content: 'hello' } }] };
                            yield { choices: [{ delta: { content: ' world' } }] };
                        }
                        return stream();
                    }
                    return {
                        choices: [{ message: { content: 'openai ok' } }],
                        usage: { prompt_tokens: 3, completion_tokens: 5 },
                    };
                },
            },
        };
    },
}));

mock.module('@anthropic-ai/sdk', () => ({
    default: class Anthropic {
        messages = {
            create: async (payload: any) => {
                lastAnthropicPayload = payload;
                if (payload.stream) {
                    async function* stream() {
                        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } };
                        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' there' } };
                    }
                    return stream();
                }
                return {
                    content: [{ type: 'text', text: 'anthropic ok' }],
                    usage: { input_tokens: 10, output_tokens: 12 },
                };
            },
        };
    },
}));

mock.module('@google/generative-ai', () => ({
    GoogleGenerativeAI: class GoogleGenerativeAI {
        getGenerativeModel() {
            return {
                generateContent: async () => ({
                    response: { text: () => 'google ok' },
                }),
            };
        }
    },
}));

import { LLMClient } from '../src/llm/client';
import { Config } from '../src/config';

describe('LLMClient SDK paths', () => {
    test('chatOpenAI returns content and usage', async () => {
        const config: Config = {
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'test-key',
            useCLI: false,
            temperature: 0.2,
            maxTokens: 1234,
        };

        const client = new LLMClient(config);
        const response = await client.chat([{ role: 'user', content: 'Hello' }]);

        expect(response.content).toBe('openai ok');
        expect(response.usage?.inputTokens).toBe(3);
        expect(response.usage?.outputTokens).toBe(5);
        expect(lastOpenAIPayload.model).toBe('gpt-4o');
        expect(lastOpenAIPayload.max_tokens).toBe(1234);
    });

    test('streamChat yields chunks for OpenAI', async () => {
        const config: Config = {
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: 'test-key',
            useCLI: false,
        };

        const client = new LLMClient(config);
        let result = '';
        for await (const chunk of client.streamChat([{ role: 'user', content: 'Stream' }])) {
            result += chunk;
        }

        expect(result).toBe('hello world');
    });

    test('chatAnthropic returns content and usage', async () => {
        const config: Config = {
            provider: 'anthropic',
            model: 'claude',
            apiKey: 'test-key',
            useCLI: false,
            temperature: 0.1,
        };

        const client = new LLMClient(config);
        const response = await client.chat([{ role: 'user', content: 'Hello' }]);

        expect(response.content).toBe('anthropic ok');
        expect(response.usage?.inputTokens).toBe(10);
        expect(response.usage?.outputTokens).toBe(12);
        expect(lastAnthropicPayload.model).toBe('claude');
    });

    test('streamChat yields chunks for Anthropic', async () => {
        const config: Config = {
            provider: 'anthropic',
            model: 'claude',
            apiKey: 'test-key',
            useCLI: false,
        };

        const client = new LLMClient(config);
        let result = '';
        for await (const chunk of client.streamChat([{ role: 'user', content: 'Stream' }])) {
            result += chunk;
        }

        expect(result).toBe('hi there');
    });

    test('chatGoogle returns content', async () => {
        const config: Config = {
            provider: 'google',
            model: 'gemini',
            apiKey: 'test-key',
            useCLI: false,
        };

        const client = new LLMClient(config);
        const response = await client.chat([{ role: 'user', content: 'Hello' }]);

        expect(response.content).toBe('google ok');
    });
});
