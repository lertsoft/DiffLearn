import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import {
    loadConfig,
    isCLIAvailable,
    isCursorAgentAvailable,
    getCLIAuthCommand,
    getCLIAuthHint,
    getCLIAuthStatusCommand,
    LLMProvider,
} from '../../config';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface ProviderInfo {
    id: LLMProvider;
    name: string;
    type: 'cli' | 'api' | 'local';
    description: string;
    authCommand?: string[];
    authHint?: string[];
    authStatusCommand?: string[];
    envKey?: string;
    installed?: boolean;
    configured?: boolean;
    baseUrl?: string;  // For local providers
}

const PROVIDERS: ProviderInfo[] = [
    // Local LLM providers (free & private)
    {
        id: 'ollama',
        name: 'Ollama',
        type: 'local',
        description: 'Run AI Models locally',
        baseUrl: 'http://localhost:11434',
    },
    {
        id: 'lmstudio',
        name: 'LM Studio',
        type: 'local',
        description: 'Run AI Models locally',
        baseUrl: 'http://localhost:1234',
    },
    // CLI-based providers
    {
        id: 'gemini-cli',
        name: 'Gemini CLI',
        type: 'cli',
        description: 'Use your Google Gemini subscription',
        authCommand: getCLIAuthCommand('gemini-cli'),
        authHint: getCLIAuthHint('gemini-cli'),
        authStatusCommand: getCLIAuthStatusCommand('gemini-cli'),
    },
    {
        id: 'claude-code',
        name: 'Claude Code',
        type: 'cli',
        description: 'Use your Anthropic subscription',
        authCommand: getCLIAuthCommand('claude-code'),
        authHint: getCLIAuthHint('claude-code'),
        authStatusCommand: getCLIAuthStatusCommand('claude-code'),
    },
    {
        id: 'codex',
        name: 'OpenAI Codex CLI',
        type: 'cli',
        description: 'Use your OpenAI subscription',
        authCommand: getCLIAuthCommand('codex'),
        authHint: getCLIAuthHint('codex'),
        authStatusCommand: getCLIAuthStatusCommand('codex'),
    },
    {
        id: 'cursor-cli',
        name: 'Cursor',
        type: 'cli',
        description: 'Use your Cursor subscription',
        authCommand: getCLIAuthCommand('cursor-cli'),
        authHint: getCLIAuthHint('cursor-cli'),
        authStatusCommand: getCLIAuthStatusCommand('cursor-cli'),
    },
    // API-based providers
    {
        id: 'openai',
        name: 'OpenAI API',
        type: 'api',
        description: 'Direct API access (requires API key)',
        envKey: 'OPENAI_API_KEY',
    },
    {
        id: 'anthropic',
        name: 'Anthropic API',
        type: 'api',
        description: 'Direct API access (requires API key)',
        envKey: 'ANTHROPIC_API_KEY',
    },
    {
        id: 'google',
        name: 'Google AI API',
        type: 'api',
        description: 'Direct API access (requires API key)',
        envKey: 'GOOGLE_AI_API_KEY',
    },
];

/**
 * Fetch available models from Ollama
 */
async function fetchOllamaModels(): Promise<string[]> {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (!response.ok) return [];
        const data = await response.json() as { models?: { name: string }[] };
        return (data.models || []).map(m => m.name);
    } catch {
        return [];
    }
}

/**
 * Fetch available models from LM Studio
 */
async function fetchLMStudioModels(): Promise<string[]> {
    try {
        const response = await fetch('http://localhost:1234/v1/models');
        if (!response.ok) return [];
        const data = await response.json() as { data?: { id: string }[] };
        return (data.data || []).map(m => m.id);
    } catch {
        return [];
    }
}

/**
 * Check if a local provider is running
 */
async function isLocalProviderRunning(provider: ProviderInfo): Promise<boolean> {
    if (provider.id === 'ollama') {
        const models = await fetchOllamaModels();
        return models.length > 0;
    } else if (provider.id === 'lmstudio') {
        const models = await fetchLMStudioModels();
        return models.length > 0;
    }
    return false;
}

type Screen = 'main' | 'select' | 'api-setup' | 'cli-auth' | 'model-select' | 'status' | 'success';

export function ConfigWizard() {
    const { exit } = useApp();
    const [screen, setScreen] = useState<Screen>('main');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [providers, setProviders] = useState<ProviderInfo[]>(PROVIDERS);
    const [currentProvider, setCurrentProvider] = useState<ProviderInfo | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [message, setMessage] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [authRunning, setAuthRunning] = useState(false);
    const [cachedConfig, setCachedConfig] = useState<{ provider: string; useCLI: boolean } | null>(null);
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [modelIndex, setModelIndex] = useState(0);
    const [loadingModels, setLoadingModels] = useState(false);

    // Check which CLI tools are installed and local providers running
    useEffect(() => {
        async function checkProviders() {
            const updated = await Promise.all(
                PROVIDERS.map(async (p) => {
                    if (p.type === 'cli') {
                        let installed = false;
                        if (p.id === 'cursor-cli') {
                            installed = await isCursorAgentAvailable();
                        } else {
                            const cmd = p.authCommand?.[0] || '';
                            installed = cmd ? await isCLIAvailable(cmd) : false;
                        }
                        return { ...p, installed };
                    } else if (p.type === 'local') {
                        const running = await isLocalProviderRunning(p);
                        return { ...p, installed: running, configured: running };
                    } else {
                        const configured = !!process.env[p.envKey || ''];
                        return { ...p, installed: true, configured };
                    }
                })
            );
            setProviders(updated);
            setIsLoading(false);
        }
        checkProviders();
    }, []);

    // Load config once on mount (suppress warnings)
    useEffect(() => {
        const originalWarn = console.warn;
        console.warn = () => { }; // Temporarily suppress warnings
        try {
            const config = loadConfig();
            setCachedConfig({ provider: config.provider, useCLI: config.useCLI });
        } catch { }
        console.warn = originalWarn;
    }, []);

    // Use cached config or default
    const currentConfig = cachedConfig || { provider: 'openai', useCLI: false };

    useInput((input, key) => {
        if (key.escape || input === 'q') {
            if (screen === 'main') {
                exit();
            } else {
                setScreen('main');
                setApiKey('');
            }
            return;
        }

        if (screen === 'main') {
            if (input === '1' || input === 's') {
                setScreen('status');
            } else if (input === '2' || input === 'c') {
                setScreen('select');
                setSelectedIndex(0);
            } else if (input === '3' || input === 'q') {
                exit();
            }
        } else if (screen === 'select') {
            if (key.upArrow || input === 'k') {
                setSelectedIndex((i) => Math.max(0, i - 1));
            } else if (key.downArrow || input === 'j') {
                setSelectedIndex((i) => Math.min(providers.length - 1, i + 1));
            } else if (key.return) {
                const provider = providers[selectedIndex];
                setCurrentProvider(provider);

                if (provider.type === 'local') {
                    // Fetch available models (wrap in IIFE since callback isn't async)
                    setLoadingModels(true);
                    void (async () => {
                        const models = provider.id === 'ollama'
                            ? await fetchOllamaModels()
                            : await fetchLMStudioModels();
                        setLoadingModels(false);

                        if (models.length === 0) {
                            setMessage(`${provider.name} is not running or has no models. Start it first.`);
                            setScreen('main');
                        } else {
                            setAvailableModels(models);
                            setModelIndex(0);
                            setScreen('model-select');
                        }
                    })();
                } else if (provider.type === 'cli') {
                    if (!provider.installed) {
                        setMessage(`${provider.name} is not installed. Please install it first.`);
                        setScreen('main');
                    } else {
                        setScreen('cli-auth');
                    }
                } else {
                    setScreen('api-setup');
                }
            }
        } else if (screen === 'api-setup') {
            if (key.return && apiKey.length > 0) {
                saveApiKey(currentProvider!, apiKey);
                setMessage(`✅ ${currentProvider?.name} configured successfully!`);
                setScreen('success');
            } else if (key.backspace || key.delete) {
                setApiKey((k) => k.slice(0, -1));
            } else if (input && !key.ctrl && !key.meta) {
                setApiKey((k) => k + input);
            }
        } else if (screen === 'cli-auth') {
            if (key.return && !authRunning) {
                setAuthRunning(true);
                runAuthCommand(currentProvider!);
            }
        } else if (screen === 'model-select') {
            if (key.upArrow || input === 'k') {
                setModelIndex((i) => Math.max(0, i - 1));
            } else if (key.downArrow || input === 'j') {
                setModelIndex((i) => Math.min(availableModels.length - 1, i + 1));
            } else if (key.return && availableModels.length > 0) {
                saveLocalProvider(currentProvider!, availableModels[modelIndex]);
                setMessage(`✅ ${currentProvider?.name} configured with ${availableModels[modelIndex]}!`);
                setScreen('success');
            }
        } else if (screen === 'success' || screen === 'status') {
            if (key.return || input) {
                setScreen('main');
                setMessage('');
            }
        }
    });

    function saveApiKey(provider: ProviderInfo, key: string) {
        const envFile = join(process.cwd(), '.env');
        const globalEnvFile = join(homedir(), '.difflearn');

        const envLine = `${provider.envKey}=${key}`;
        const providerLine = `DIFFLEARN_LLM_PROVIDER=${provider.id}`;

        // Save to global config file
        try {
            let content = '';
            if (existsSync(globalEnvFile)) {
                content = readFileSync(globalEnvFile, 'utf-8');
            }

            // Update or add the env key
            const lines = content.split('\n').filter(l => !l.startsWith(provider.envKey!) && !l.startsWith('DIFFLEARN_LLM_PROVIDER'));
            lines.push(envLine);
            lines.push(providerLine);

            writeFileSync(globalEnvFile, lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
        } catch (error) {
            // Fallback to local .env
            if (existsSync(envFile)) {
                appendFileSync(envFile, `\n${envLine}\n${providerLine}\n`);
            } else {
                writeFileSync(envFile, `${envLine}\n${providerLine}\n`, { mode: 0o600 });
            }
        }
    }

    function saveLocalProvider(provider: ProviderInfo, model: string) {
        const globalEnvFile = join(homedir(), '.difflearn');

        try {
            let content = '';
            if (existsSync(globalEnvFile)) {
                content = readFileSync(globalEnvFile, 'utf-8');
            }

            // Update or add the provider and model
            const lines = content.split('\n').filter(l =>
                !l.startsWith('DIFFLEARN_LLM_PROVIDER') &&
                !l.startsWith('DIFFLEARN_MODEL')
            );
            lines.push(`DIFFLEARN_LLM_PROVIDER=${provider.id}`);
            lines.push(`DIFFLEARN_MODEL=${model}`);

            writeFileSync(globalEnvFile, lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
        } catch (error) {
            // Silently fail
        }
    }

    async function runStatusCommand(command: string[]): Promise<{ code: number | null; output: string }> {
        return new Promise((resolve) => {
            const proc = spawn(command[0], command.slice(1), {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer | string) => { stdout += data.toString(); });
            proc.stderr.on('data', (data: Buffer | string) => { stderr += data.toString(); });

            proc.on('close', (code) => {
                const output = (stdout || stderr || '').trim();
                resolve({ code, output });
            });

            proc.on('error', (err: Error) => {
                resolve({ code: -1, output: err.message });
            });
        });
    }

    function inferAuthStatus(output: string, exitCode: number | null): boolean {
        const lower = output.toLowerCase();
        const unauthPatterns = ['not authenticated', 'not logged', 'unauthenticated', 'login required', 'not logged in'];
        const authPatterns = ['authenticated', 'logged in', 'signed in'];

        if (unauthPatterns.some((pattern) => lower.includes(pattern))) return false;
        if (authPatterns.some((pattern) => lower.includes(pattern))) return true;

        return exitCode === 0;
    }


    function runAuthCommand(provider: ProviderInfo) {
        if (!provider.authCommand) return;

        // Save provider preference
        const globalEnvFile = join(homedir(), '.difflearn');
        try {
            let content = '';
            if (existsSync(globalEnvFile)) {
                content = readFileSync(globalEnvFile, 'utf-8');
            }
            const lines = content.split('\n').filter(l => !l.startsWith('DIFFLEARN_LLM_PROVIDER'));
            lines.push(`DIFFLEARN_LLM_PROVIDER=${provider.id}`);
            writeFileSync(globalEnvFile, lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
        } catch { }

        // Exit and run the auth command
        console.log(`\n\n🔐 Running: ${provider.authCommand.join(' ')}\n`);

        const proc = spawn(provider.authCommand[0], provider.authCommand.slice(1), {
            stdio: 'inherit',
        });

        proc.on('close', (code) => {
            void (async () => {
                if (code === 0) {
                    if (provider.authStatusCommand?.length) {
                        const status = await runStatusCommand(provider.authStatusCommand);
                        const isAuthed = inferAuthStatus(status.output, status.code);

                        if (isAuthed) {
                            console.log(`\n✅ ${provider.name} authenticated successfully!`);
                        } else {
                            console.log(`\n⚠️ ${provider.name} may not be logged in yet.`);
                        }

                        if (status.output) {
                            console.log(`\nStatus: ${status.output}`);
                        }
                    } else {
                        console.log(`\n✅ ${provider.name} login flow finished.`);
                    }

                    console.log(`\nRun 'difflearn config' again to verify.\n`);
                } else {
                    console.log(`\n⚠️ Authentication may have failed. Try running '${provider.authCommand?.join(' ')}' manually.\n`);
                }
                process.exit(0);
            })();
        });
    }

    if (isLoading) {
        return (
            <Box flexDirection="column" padding={1}>
                <Text color="cyan">🔍 Checking available providers...</Text>
            </Box>
        );
    }

    // Main Menu
    if (screen === 'main') {
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">🔧 DiffLearn Configuration</Text>
                </Box>

                {message && (
                    <Box marginBottom={1}>
                        <Text color="green">{message}</Text>
                    </Box>
                )}

                <Box marginBottom={1}>
                    <Text dimColor>Current provider: </Text>
                    <Text bold color="yellow">{currentConfig.provider}</Text>
                    {currentConfig.useCLI && <Text dimColor> (CLI-based)</Text>}
                </Box>

                <Box flexDirection="column" marginTop={1}>
                    <Text>[1] View Status</Text>
                    <Text>[2] Configure Provider</Text>
                    <Text>[3] Quit</Text>
                </Box>

                <Box marginTop={1}>
                    <Text dimColor>Press a number or q to quit</Text>
                </Box>
            </Box>
        );
    }

    // Status Screen
    if (screen === 'status') {
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">📊 Provider Status</Text>
                </Box>

                <Box flexDirection="column">
                    <Text bold dimColor>Local LLM (free & private):</Text>
                    {providers.filter(p => p.type === 'local').map(p => (
                        <Box key={p.id}>
                            <Text color={p.installed ? 'green' : 'gray'}>
                                {p.installed ? '✓' : '○'} {p.name}
                            </Text>
                            <Text dimColor> - {p.installed ? 'Running' : 'Not running'}</Text>
                            {p.id === currentConfig.provider && <Text color="cyan"> (active)</Text>}
                        </Box>
                    ))}
                </Box>

                <Box flexDirection="column" marginTop={1}>
                    <Text bold dimColor>CLI-based (use your subscriptions):</Text>
                    {providers.filter(p => p.type === 'cli').map(p => (
                        <Box key={p.id}>
                            <Text color={p.installed ? 'green' : 'gray'}>
                                {p.installed ? '✓' : '○'} {p.name}
                            </Text>
                            <Text dimColor> - {p.installed ? 'Installed' : 'Not installed'}</Text>
                            {p.id === currentConfig.provider && <Text color="cyan"> (active)</Text>}
                        </Box>
                    ))}
                </Box>

                <Box flexDirection="column" marginTop={1}>
                    <Text bold dimColor>API-based (requires API key):</Text>
                    {providers.filter(p => p.type === 'api').map(p => (
                        <Box key={p.id}>
                            <Text color={p.configured ? 'green' : 'gray'}>
                                {p.configured ? '✓' : '○'} {p.name}
                            </Text>
                            <Text dimColor> - {p.configured ? 'Configured' : 'Not configured'}</Text>
                            {p.id === currentConfig.provider && <Text color="cyan"> (active)</Text>}
                        </Box>
                    ))}
                </Box>

                <Box marginTop={1}>
                    <Text dimColor>Press any key to go back</Text>
                </Box>
            </Box>
        );
    }

    // Provider Selection
    if (screen === 'select') {
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">🔌 Select a Provider</Text>
                </Box>

                <Box flexDirection="column" marginBottom={1}>
                    <Text bold dimColor>Local LLM (free & private):</Text>
                    {providers.filter(p => p.type === 'local').map((p) => {
                        const realIndex = providers.indexOf(p);
                        return (
                            <Box key={p.id}>
                                <Text color={selectedIndex === realIndex ? 'cyan' : 'white'}>
                                    {selectedIndex === realIndex ? '▸ ' : '  '}
                                    {p.installed ? '✓' : '○'} {p.name}
                                </Text>
                                <Text dimColor> - {p.description}</Text>
                                {!p.installed && <Text color="yellow"> (not running)</Text>}
                            </Box>
                        );
                    })}
                </Box>

                <Box flexDirection="column" marginBottom={1}>
                    <Text bold dimColor>CLI-based (Use your subscription):</Text>
                    {providers.filter(p => p.type === 'cli').map((p, i) => {
                        const realIndex = providers.indexOf(p);
                        return (
                            <Box key={p.id}>
                                <Text color={selectedIndex === realIndex ? 'cyan' : 'white'}>
                                    {selectedIndex === realIndex ? '▸ ' : '  '}
                                    {p.installed ? '✓' : '○'} {p.name}
                                </Text>
                                <Text dimColor> - {p.description}</Text>
                            </Box>
                        );
                    })}
                </Box>

                <Box flexDirection="column">
                    <Text bold dimColor>API-based (pay-per-use):</Text>
                    {providers.filter(p => p.type === 'api').map((p) => {
                        const realIndex = providers.indexOf(p);
                        return (
                            <Box key={p.id}>
                                <Text color={selectedIndex === realIndex ? 'cyan' : 'white'}>
                                    {selectedIndex === realIndex ? '▸ ' : '  '}
                                    {p.configured ? '✓' : '○'} {p.name}
                                </Text>
                                <Text dimColor> - {p.description}</Text>
                            </Box>
                        );
                    })}
                </Box>

                <Box marginTop={1}>
                    <Text dimColor>↑/↓ to navigate, Enter to select, Esc to go back</Text>
                </Box>
            </Box>
        );
    }

    // CLI Auth Screen
    if (screen === 'cli-auth' && currentProvider) {
        const authHints = currentProvider.authHint || [];
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">🔐 Authenticate {currentProvider.name}</Text>
                </Box>

                <Text>This will start the login flow:</Text>
                <Box marginY={1}>
                    <Text color="yellow" bold>{currentProvider.authCommand?.join(' ')}</Text>
                </Box>

                <Text dimColor>This opens an interactive session.</Text>
                {authHints.map((hint: string) => (
                    <Text key={hint} dimColor>{hint}</Text>
                ))}
                <Text dimColor>After authenticating, run 'difflearn config' again.</Text>

                <Box marginTop={1}>
                    <Text>Press Enter to continue, Esc to cancel</Text>
                </Box>
            </Box>
        );
    }

    // Model Selection Screen (for Ollama/LM Studio)
    if (screen === 'model-select' && currentProvider) {
        if (loadingModels) {
            return (
                <Box flexDirection="column" padding={1}>
                    <Text color="cyan">⏳ Loading models from {currentProvider.name}...</Text>
                </Box>
            );
        }

        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">🤖 Select a Model ({currentProvider.name})</Text>
                </Box>

                <Box flexDirection="column" marginBottom={1}>
                    {availableModels.map((model, i) => (
                        <Box key={model}>
                            <Text color={modelIndex === i ? 'cyan' : 'white'}>
                                {modelIndex === i ? '▸ ' : '  '}{model}
                            </Text>
                        </Box>
                    ))}
                </Box>

                <Box marginTop={1}>
                    <Text dimColor>↑/↓ to navigate, Enter to select, Esc to go back</Text>
                </Box>
            </Box>
        );
    }

    // API Key Setup Screen
    if (screen === 'api-setup' && currentProvider) {
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="cyan">🔑 Configure {currentProvider.name}</Text>
                </Box>

                <Text>Enter your API key:</Text>
                <Box marginY={1}>
                    <Text color="yellow">{apiKey.length > 0 ? '•'.repeat(apiKey.length) : '(type your key)'}</Text>
                </Box>

                <Text dimColor>Your key will be saved to ~/.difflearn</Text>
                <Text dimColor>Environment variable: {currentProvider.envKey}</Text>

                <Box marginTop={1}>
                    <Text dimColor>Press Enter to save, Esc to cancel</Text>
                </Box>
            </Box>
        );
    }

    // Success Screen
    if (screen === 'success') {
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="green">✅ Configuration Saved!</Text>
                </Box>

                <Text>Provider: <Text bold>{currentProvider?.name}</Text></Text>
                <Text dimColor>Config saved to ~/.difflearn</Text>

                <Box marginTop={1} flexDirection="column">
                    <Text color="yellow">⚠️ Restart DiffLearn to apply the new provider.</Text>
                    <Text dimColor>Run 'difflearn' or 'difflearn web' to use the new configuration.</Text>
                </Box>

                <Box marginTop={1}>
                    <Text>Press any key to continue</Text>
                </Box>
            </Box>
        );
    }

    return null;
}
