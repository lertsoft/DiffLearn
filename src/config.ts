export type LLMProvider =
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'ollama'
    | 'lmstudio'
    | 'gemini-cli'
    | 'claude-code'
    | 'codex'
    | 'cursor-cli';

export interface Config {
    provider: LLMProvider;
    model: string;
    apiKey: string;
    baseUrl?: string;  // Custom API base URL (for Ollama/LM Studio)
    temperature?: number;
    maxTokens?: number;
    useCLI: boolean;  // Whether using CLI-based provider
    spawner?: (command: string, args: string[], options: any) => any; // For testing
}

interface ProviderDefaults {
    model: string;
    envKey: string;
    cli?: boolean;
    command?: string;
    authCommand?: string[];
    authHint?: string[];
    authStatusCommand?: string[];
    baseUrl?: string;  // Default API base URL
    noApiKey?: boolean;  // Provider doesn't require API key
}

const PROVIDER_DEFAULTS: Record<LLMProvider, ProviderDefaults> = {
    openai: { model: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
    anthropic: { model: 'claude-sonnet-4-20250514', envKey: 'ANTHROPIC_API_KEY' },
    google: { model: 'gemini-2.0-flash', envKey: 'GOOGLE_AI_API_KEY' },
    // Local LLM providers (OpenAI-compatible APIs)
    ollama: { model: 'llama3.2', envKey: '', baseUrl: 'http://localhost:11434/v1', noApiKey: true },
    lmstudio: { model: 'local-model', envKey: '', baseUrl: 'http://localhost:1234/v1', noApiKey: true },
    // CLI-based providers (use existing subscriptions)
    'gemini-cli': {
        model: 'gemini',
        envKey: '',
        cli: true,
        command: 'gemini',
        authCommand: ['gemini'],
        authHint: [
            'When prompted, choose Login with Google or Use API key.',
            'Complete the browser sign-in flow if it opens.',
        ],
    },
    'claude-code': {
        model: 'claude',
        envKey: '',
        cli: true,
        command: 'claude',
        authCommand: ['claude'],
        authHint: ['At the prompt, run /login and follow the instructions.'],
    },
    'codex': {
        model: 'codex',
        envKey: '',
        cli: true,
        command: 'codex',
        authCommand: ['codex', 'login'],
        authStatusCommand: ['codex', 'login', 'status'],
    },
    'cursor-cli': {
        model: 'cursor',
        envKey: '',
        cli: true,
        command: 'agent',
        authCommand: ['agent', 'login'],
        authStatusCommand: ['agent', 'status'],
        authHint: ['For scripts, you can set CURSOR_API_KEY.'],
    },
};

/**
 * Check if a CLI tool is available in PATH
 */
export async function isCLIAvailable(command: string): Promise<boolean> {
    try {
        const proc = Bun.spawn(['which', command], { stdout: 'pipe', stderr: 'pipe' });
        const exitCode = await proc.exited;
        return exitCode === 0;
    } catch {
        return false;
    }
}

/**
 * Check if a Cursor CLI agent binary is available
 */
export async function isCursorAgentAvailable(): Promise<boolean> {
    try {
        const isInstalled = await isCLIAvailable('agent');
        if (!isInstalled) return false;

        const proc = Bun.spawn(['agent', '--version'], { stdout: 'pipe', stderr: 'pipe' });
        const [stdout, stderr] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        if (exitCode !== 0) return false;

        const output = `${stdout}\n${stderr}`.toLowerCase();
        return output.includes('cursor');
    } catch {
        return false;
    }
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Load configuration from ~/.difflearn file
 */
function loadConfigFromFile(): Record<string, string> {
    const configFile = path.join(os.homedir(), '.difflearn');

    if (!fs.existsSync(configFile)) {
        return {};
    }

    try {
        const content = fs.readFileSync(configFile, 'utf-8');
        const config: Record<string, string> = {};

        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                if (key && valueParts.length > 0) {
                    config[key.trim()] = valueParts.join('=').trim();
                }
            }
        }

        return config;
    } catch {
        return {};
    }
}

/**
 * Load configuration from environment variables and config file
 */
export function loadConfig(): Config {
    // Load from config file first, then overlay env vars
    const fileConfig = loadConfigFromFile();

    // Merge file config into process.env (env vars take precedence)
    for (const [key, value] of Object.entries(fileConfig)) {
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }

    const provider = (process.env.DIFFLEARN_LLM_PROVIDER || detectProvider() || 'openai') as LLMProvider;

    if (!PROVIDER_DEFAULTS[provider]) {
        throw new Error(
            `Unknown LLM provider: ${provider}. ` +
            `Use 'openai', 'anthropic', 'google', 'ollama', 'lmstudio', 'gemini-cli', 'claude-code', 'codex', or 'cursor-cli'.`
        );
    }

    const defaults = PROVIDER_DEFAULTS[provider];
    const useCLI = defaults.cli || false;

    // For CLI providers and local providers, no API key needed
    const needsApiKey = !useCLI && !defaults.noApiKey;
    const apiKey = needsApiKey ? (process.env[defaults.envKey] || '') : 'local';

    // Get base URL (custom or default)
    const baseUrl = process.env.DIFFLEARN_BASE_URL || defaults.baseUrl;

    if (needsApiKey && !apiKey) {
        console.warn(`Warning: ${defaults.envKey} not set. LLM features will be unavailable.`);
        console.warn(`Tip: Use 'ollama', 'lmstudio', 'gemini-cli', 'claude-code', 'codex', or 'cursor-cli' for local/subscription based options.`);
    }

    return {
        provider,
        model: process.env.DIFFLEARN_MODEL || defaults.model,
        apiKey,
        baseUrl,
        temperature: parseFloat(process.env.DIFFLEARN_TEMPERATURE || '0.3'),
        maxTokens: parseInt(process.env.DIFFLEARN_MAX_TOKENS || '4096', 10),
        useCLI,
    };
}

/**
 * Check if LLM is configured and available
 */
export function isLLMAvailable(config: Config): boolean {
    // CLI, Ollama, and LM Studio don't need API keys
    if (config.useCLI || config.provider === 'ollama' || config.provider === 'lmstudio') {
        return true;
    }
    return !!config.apiKey;
}

/**
 * Detect best available provider based on environment
 */
export function detectProvider(): LLMProvider | null {
    // Check API keys first
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.GOOGLE_AI_API_KEY) return 'google';

    // No API keys - will check for CLIs later
    return null;
}

/**
 * Auto-detect best available CLI provider
 */
export async function detectCLIProvider(): Promise<LLMProvider | null> {
    // Check for CLI tools in order of preference
    if (await isCLIAvailable('gemini')) return 'gemini-cli';
    if (await isCLIAvailable('claude')) return 'claude-code';
    if (await isCLIAvailable('codex')) return 'codex';
    if (await isCursorAgentAvailable()) return 'cursor-cli';
    return null;
}

/**
 * Get CLI command for a provider
 */
export function getCLICommand(provider: LLMProvider): string | undefined {
    return PROVIDER_DEFAULTS[provider]?.command;
}

/**
 * Get CLI authentication command for a provider
 */
export function getCLIAuthCommand(provider: LLMProvider): string[] | undefined {
    return PROVIDER_DEFAULTS[provider]?.authCommand;
}

/**
 * Get CLI authentication hint text for a provider
 */
export function getCLIAuthHint(provider: LLMProvider): string[] | undefined {
    return PROVIDER_DEFAULTS[provider]?.authHint;
}

/**
 * Get CLI authentication status command for a provider
 */
export function getCLIAuthStatusCommand(provider: LLMProvider): string[] | undefined {
    return PROVIDER_DEFAULTS[provider]?.authStatusCommand;
}
