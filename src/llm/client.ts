import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Config, LLMProvider, getCLICommand } from '../config';
import { spawn } from 'child_process';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface LLMResponse {
    content: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export class LLMClient {
    private config: Config;
    private openaiClient?: OpenAI;
    private anthropicClient?: Anthropic;
    private googleClient?: GoogleGenerativeAI;

    constructor(config: Config) {
        this.config = config;
        this.initializeClient();
    }

    private initializeClient() {
        // Skip SDK initialization for CLI-based providers
        if (this.config.useCLI) return;

        switch (this.config.provider) {
            case 'openai':
                this.openaiClient = new OpenAI({ apiKey: this.config.apiKey });
                break;
            case 'anthropic':
                this.anthropicClient = new Anthropic({ apiKey: this.config.apiKey });
                break;
            case 'google':
                this.googleClient = new GoogleGenerativeAI(this.config.apiKey);
                break;
        }
    }

    /**
     * Send a chat request to the LLM
     */
    async chat(messages: ChatMessage[]): Promise<LLMResponse> {
        // Use CLI-based providers
        if (this.config.useCLI) {
            return this.chatCLI(messages);
        }

        switch (this.config.provider) {
            case 'openai':
                return this.chatOpenAI(messages);
            case 'anthropic':
                return this.chatAnthropic(messages);
            case 'google':
                return this.chatGoogle(messages);
            default:
                throw new Error(`Unknown provider: ${this.config.provider}`);
        }
    }

    /**
     * Chat using CLI tools (gemini, claude, cursor-agent)
     */
    private async chatCLI(messages: ChatMessage[]): Promise<LLMResponse> {
        // Combine messages into a single prompt
        const systemMessage = messages.find(m => m.role === 'system')?.content || '';
        const userMessages = messages.filter(m => m.role !== 'system');

        const prompt = userMessages.map(m =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n\n');

        const fullPrompt = systemMessage ? `${systemMessage}\n\n${prompt}` : prompt;

        // Execute appropriate CLI
        let result: string;
        switch (this.config.provider) {
            case 'gemini-cli':
                result = await this.execGeminiCLI(fullPrompt);
                break;
            case 'claude-code':
                result = await this.execClaudeCLI(fullPrompt);
                break;
            case 'cursor-cli':
                result = await this.execCursorCLI(fullPrompt);
                break;
            case 'codex':
                result = await this.execCodexCLI(fullPrompt);
                break;
            default:
                throw new Error(`Unknown CLI provider: ${this.config.provider}`);
        }

        return { content: result };
    }

    /**
     * Execute Gemini CLI: gemini prompt (via stdin)
     */
    private async execGeminiCLI(prompt: string): Promise<string> {
        return this.execCLIWithStdin('gemini', [], prompt);
    }

    /**
     * Execute Claude Code CLI: claude -p "prompt"
     */
    private async execClaudeCLI(prompt: string): Promise<string> {
        return this.execCLIWithStdin('claude', ['-p', prompt], '');
    }

    /**
     * Execute Cursor CLI: cursor-agent chat "prompt"
     */
    private async execCursorCLI(prompt: string): Promise<string> {
        return this.execCLIWithStdin('cursor-agent', ['chat', prompt], '');
    }

    /**
     * Execute Codex CLI
     */
    private async execCodexCLI(prompt: string): Promise<string> {
        return this.execCLIWithStdin('codex', [], prompt);
    }

    /**
     * Helper to execute CLI command with stdin
     */
    private async execCLIWithStdin(command: string, args: string[], input: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const spawnFn = this.config.spawner || spawn;
            const proc = spawnFn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer | string) => { stdout += data.toString(); });
            proc.stderr.on('data', (data: Buffer | string) => { stderr += data.toString(); });

            proc.on('close', (code: number | null) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`${command} failed (code ${code}): ${stderr || stdout}`));
                }
            });

            proc.on('error', (err: Error) => {
                reject(new Error(`Failed to run ${command}: ${err.message}`));
            });

            if (input) {
                proc.stdin.write(input);
                proc.stdin.end();
            }
        });
    }

    private async chatOpenAI(messages: ChatMessage[]): Promise<LLMResponse> {
        if (!this.openaiClient) throw new Error('OpenAI client not initialized');

        const response = await this.openaiClient.chat.completions.create({
            model: this.config.model,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content,
            })),
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
        });

        return {
            content: response.choices[0]?.message?.content || '',
            usage: response.usage ? {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
            } : undefined,
        };
    }

    private async chatAnthropic(messages: ChatMessage[]): Promise<LLMResponse> {
        if (!this.anthropicClient) throw new Error('Anthropic client not initialized');

        // Extract system message if present
        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages.filter(m => m.role !== 'system');

        const response = await this.anthropicClient.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens || 4096,
            system: systemMessage,
            messages: chatMessages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            temperature: this.config.temperature,
        });

        const textContent = response.content[0].type === 'text' ? response.content[0].text : '';

        return {
            content: textContent,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
            },
        };
    }

    private async chatGoogle(messages: ChatMessage[]): Promise<LLMResponse> {
        if (!this.googleClient) throw new Error('Google client not initialized');

        const model = this.googleClient.getGenerativeModel({ model: this.config.model });

        // Convert messages to Google format
        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages.filter(m => m.role !== 'system');

        const prompt = chatMessages.map(m =>
            `${m.role === 'user' ? 'User' : 'Model'}: ${m.content}`
        ).join('\n\n');

        const fullPrompt = systemMessage ? `${systemMessage}\n\n${prompt}` : prompt;

        const result = await model.generateContent(fullPrompt);
        const response = result.response;

        return {
            content: response.text(),
        };
    }

    /**
     * Stream a chat response (simplified for now, falls back to non-streaming for CLI)
     */
    async *streamChat(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
        if (this.config.useCLI) {
            // CLI tools don't support streaming easily, so we await full response
            const response = await this.chatCLI(messages);
            yield response.content;
            return;
        }

        switch (this.config.provider) {
            case 'openai':
                yield* this.streamOpenAI(messages);
                break;
            case 'anthropic':
                yield* this.streamAnthropic(messages);
                break;
            case 'google':
                // Fallback to non-streaming for Google (simplification)
                const response = await this.chatGoogle(messages);
                yield response.content;
                break;
        }
    }

    private async *streamOpenAI(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
        if (!this.openaiClient) return;

        const stream = await this.openaiClient.chat.completions.create({
            model: this.config.model,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content,
            })),
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) yield content;
        }
    }

    private async *streamAnthropic(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
        if (!this.anthropicClient) return;

        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages.filter(m => m.role !== 'system');

        const stream = await this.anthropicClient.messages.create({
            model: this.config.model,
            max_tokens: this.config.maxTokens || 4096,
            system: systemMessage,
            messages: chatMessages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            temperature: this.config.temperature,
            stream: true,
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                yield event.delta.text;
            }
        }
    }
}
