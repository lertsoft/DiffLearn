export type LLMProvider = 'openai' | 'anthropic' | 'google';

export interface Config {
    provider: LLMProvider;
    model: string;
    apiKey: string;
    temperature?: number;
    maxTokens?: number;
}

const PROVIDER_DEFAULTS: Record<LLMProvider, { model: string; envKey: string }> = {
    openai: { model: 'gpt-4o', envKey: 'OPENAI_API_KEY' },
    anthropic: { model: 'claude-sonnet-4-20250514', envKey: 'ANTHROPIC_API_KEY' },
    google: { model: 'gemini-2.0-flash', envKey: 'GOOGLE_AI_API_KEY' },
};

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
    const provider = (process.env.DIFFLEARN_LLM_PROVIDER || 'openai') as LLMProvider;

    if (!PROVIDER_DEFAULTS[provider]) {
        throw new Error(`Unknown LLM provider: ${provider}. Use 'openai', 'anthropic', or 'google'.`);
    }

    const defaults = PROVIDER_DEFAULTS[provider];
    const apiKey = process.env[defaults.envKey] || '';

    if (!apiKey) {
        console.warn(`Warning: ${defaults.envKey} not set. LLM features will be unavailable.`);
    }

    return {
        provider,
        model: process.env.DIFFLEARN_MODEL || defaults.model,
        apiKey,
        temperature: parseFloat(process.env.DIFFLEARN_TEMPERATURE || '0.3'),
        maxTokens: parseInt(process.env.DIFFLEARN_MAX_TOKENS || '4096', 10),
    };
}

/**
 * Check if LLM is configured and available
 */
export function isLLMAvailable(config: Config): boolean {
    return !!config.apiKey;
}

/**
 * Detect best available provider based on environment
 */
export function detectProvider(): LLMProvider | null {
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
    if (process.env.GOOGLE_AI_API_KEY) return 'google';
    return null;
}
