export type LLMProvider =
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'gemini-cli'
    | 'claude-code'
    | 'codex'
    | 'cursor-cli';

export interface Config {
    provider: LLMProvider;
    model: string;
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
    useCLI: boolean;  // Whether using CLI-based provider
}

interface ProviderDefaults {
    model: string;
    envKey: string;
    cli?: boolean;
    command?: string;
}

const PROVIDER_DEFAULTS: Record<LLMProvider, ProviderDefaults> = {
    openai: { model: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
    anthropic: { model: 'claude-sonnet-4-20250514', envKey: 'ANTHROPIC_API_KEY' },
    google: { model: 'gemini-2.0-flash', envKey: 'GOOGLE_AI_API_KEY' },
    // CLI-based providers (use existing subscriptions)
    'gemini-cli': { model: 'gemini', envKey: '', cli: true, command: 'gemini' },
    'claude-code': { model: 'claude', envKey: '', cli: true, command: 'claude' },
    'codex': { model: 'codex', envKey: '', cli: true, command: 'codex' },
    'cursor-cli': { model: 'cursor', envKey: '', cli: true, command: 'cursor' },
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
 * Load configuration from ~/.difflearn file
 */
function loadConfigFromFile(): Record<string, string> {
    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');
    const { homedir } = require('os');

    const configFile = join(homedir(), '.difflearn');

    if (!existsSync(configFile)) {
        return {};
    }

    try {
        const content = readFileSync(configFile, 'utf-8');
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
            `Use 'openai', 'anthropic', 'google', 'gemini-cli', 'claude-code', 'codex', or 'cursor-cli'.`
        );
    }

    const defaults = PROVIDER_DEFAULTS[provider];
    const useCLI = defaults.cli || false;

    // For CLI providers, no API key needed
    const apiKey = useCLI ? 'cli' : (process.env[defaults.envKey] || '');

    if (!useCLI && !apiKey) {
        console.warn(`Warning: ${defaults.envKey} not set. LLM features will be unavailable.`);
        console.warn(`Tip: Use 'gemini-cli', 'claude-code', 'codex', or 'cursor-cli' to use your existing subscriptions.`);
    }

    return {
        provider,
        model: process.env.DIFFLEARN_MODEL || defaults.model,
        apiKey,
        temperature: parseFloat(process.env.DIFFLEARN_TEMPERATURE || '0.3'),
        maxTokens: parseInt(process.env.DIFFLEARN_MAX_TOKENS || '4096', 10),
        useCLI,
    };
}

/**
 * Check if LLM is configured and available
 */
export function isLLMAvailable(config: Config): boolean {
    return config.useCLI || !!config.apiKey;
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
    if (await isCLIAvailable('cursor')) return 'cursor-cli';
    return null;
}

/**
 * Get CLI command for a provider
 */
export function getCLICommand(provider: LLMProvider): string | undefined {
    return PROVIDER_DEFAULTS[provider]?.command;
}
