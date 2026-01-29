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
        const command = getCLICommand(this.config.provider);
        if (!command) {
            throw new Error(`No CLI command for provider: ${this.config.provider}`);
        }

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
            case 'claude-cli':
                result = await this.execClaudeCLI(fullPrompt);
                break;
            case 'cursor-cli':
                result = await this.execCursorCLI(fullPrompt);
                break;
            default:
                throw new Error(`Unknown CLI provider: ${this.config.provider}`);
        }

        return { content: result };
    }

    /**
     * Execute Gemini CLI: gemini -p "prompt"
     */
    private async execGeminiCLI(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn('gemini', ['-p', prompt], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Gemini CLI failed: ${stderr || stdout}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to run gemini: ${err.message}. Is Gemini CLI installed?`));
            });
        });
    }

    /**
     * Execute Claude Code CLI: claude -p "prompt" --output-format text
     */
    private async execClaudeCLI(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn('claude', ['-p', prompt, '--output-format', 'text'], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Claude CLI failed: ${stderr || stdout}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to run claude: ${err.message}. Is Claude Code CLI installed?`));
            });
        });
    }

    /**
     * Execute Cursor CLI: cursor-agent chat "prompt"
     */
    private async execCursorCLI(prompt: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn('cursor-agent', ['chat', prompt], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => { stdout += data.toString(); });
            proc.stderr.on('data', (data) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Cursor CLI failed: ${stderr || stdout}`));
                }
            });

            proc.on('error', (err) => {
                reject(new Error(`Failed to run cursor-agent: ${err.message}. Is Cursor CLI installed?`));
            });
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
        });

        const textContent = response.content.find(c => c.type === 'text');

        return {
            content: textContent?.type === 'text' ? textContent.text : '',
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
            },
        };
    }

    private async chatGoogle(messages: ChatMessage[]): Promise<LLMResponse> {
        if (!this.googleClient) throw new Error('Google client not initialized');

        const model = this.googleClient.getGenerativeModel({ model: this.config.model });

        // Extract system message and format history
        const systemMessage = messages.find(m => m.role === 'system')?.content || '';
        const chatMessages = messages.filter(m => m.role !== 'system');

        // Format as a single prompt for simplicity
        const prompt = chatMessages.map(m =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        ).join('\n\n');

        const fullPrompt = systemMessage ? `${systemMessage}\n\n${prompt}` : prompt;

        const result = await model.generateContent(fullPrompt);
        const response = result.response;

        return {
            content: response.text(),
        };
    }

    /**
     * Stream chat responses (for real-time display)
     */
    async *streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
        // CLI-based providers don't support streaming, return full response
        if (this.config.useCLI) {
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
                // Google doesn't have a straightforward streaming API in this SDK
                const response = await this.chatGoogle(messages);
                yield response.content;
                break;
        }
    }

    private async *streamOpenAI(messages: ChatMessage[]): AsyncGenerator<string> {
        if (!this.openaiClient) throw new Error('OpenAI client not initialized');

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
            const content = chunk.choices[0]?.delta?.content;
            if (content) yield content;
        }
    }

    private async *streamAnthropic(messages: ChatMessage[]): AsyncGenerator<string> {
        if (!this.anthropicClient) throw new Error('Anthropic client not initialized');

        const systemMessage = messages.find(m => m.role === 'system')?.content;
        const chatMessages = messages.filter(m => m.role !== 'system');

        const stream = await this.anthropicClient.messages.stream({
            model: this.config.model,
            max_tokens: this.config.maxTokens || 4096,
            system: systemMessage,
            messages: chatMessages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                yield event.delta.text;
            }
        }
    }
}
