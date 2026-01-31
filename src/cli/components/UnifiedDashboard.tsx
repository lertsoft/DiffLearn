import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { GitExtractor, ParsedDiff, CommitInfo, DiffFormatter } from '../../git';
import { LLMClient } from '../../llm';
import { loadConfig, isLLMAvailable } from '../../config';
import { createExplainPrompt, createReviewPrompt, createSummaryPrompt, createQuestionPrompt, SYSTEM_PROMPT } from '../../llm/prompts';
import { checkForUpdates, formatUpdateMessage, UpdateInfo } from '../../update';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface UnifiedDashboardProps {
    repoPath?: string;
}

type Section = 'local' | 'staged' | 'history';
type FocusArea = 'dashboard' | 'input' | 'response';

interface SectionData {
    localDiffs: ParsedDiff[];
    stagedDiffs: ParsedDiff[];
    commits: CommitInfo[];
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

// Slash command categories
interface SlashCommand {
    cmd: string;
    desc: string;
    requiresChanges?: boolean;  // Needs local/staged changes or selected commit
    requiresCommit?: boolean;   // Needs a commit selected
    globalOnly?: boolean;       // Only on main dashboard (no commit selected)
}

// Available slash commands - grouped by context
const SLASH_COMMANDS: SlashCommand[] = [
    // AI commands - require changes to analyze
    { cmd: '/explain', desc: 'Get a detailed explanation of the changes', requiresChanges: true },
    { cmd: '/review', desc: 'Get a code review with suggestions', requiresChanges: true },
    { cmd: '/summarize', desc: 'Get a quick summary of changes', requiresChanges: true },

    // Export/utility commands
    { cmd: '/export', desc: 'Export diff as markdown/json', requiresChanges: true },
    { cmd: '/history', desc: 'Show more commit history', globalOnly: true },

    // Navigation commands
    { cmd: '/local', desc: 'View local (unstaged) changes', globalOnly: true },
    { cmd: '/staged', desc: 'View staged changes', globalOnly: true },
    { cmd: '/web', desc: 'Open web UI in browser', globalOnly: true },
    { cmd: '/config', desc: 'Show LLM configuration status', globalOnly: true },
    { cmd: '/update', desc: 'Check for updates', globalOnly: true },

    // Commands that work on commits
    { cmd: '/compare', desc: 'Compare with another commit', requiresCommit: true },
];

export const UnifiedDashboard: React.FC<UnifiedDashboardProps> = ({
    repoPath = process.cwd(),
}) => {
    const { exit } = useApp();
    const [data, setData] = useState<SectionData>({ localDiffs: [], stagedDiffs: [], commits: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedSection, setSelectedSection] = useState<Section>('local');
    const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
    const [commitDiff, setCommitDiff] = useState<ParsedDiff[]>([]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const [llmClient, setLlmClient] = useState<LLMClient | undefined>();

    // Chat state
    const [chatInput, setChatInput] = useState('');
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [isAsking, setIsAsking] = useState(false);
    const [focusArea, setFocusArea] = useState<FocusArea>('dashboard'); // Start with dashboard focused
    const [responseScrollOffset, setResponseScrollOffset] = useState(0);

    // Compare mode state
    const [compareMode, setCompareMode] = useState(false);
    const [compareIndex, setCompareIndex] = useState(0);
    const [compareWith, setCompareWith] = useState<CommitInfo | null>(null); // The second commit in comparison

    // Update state
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

    // Load all data at once
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const git = new GitExtractor(repoPath);

                if (!await git.isRepo()) {
                    throw new Error('Not a git repository');
                }

                const config = loadConfig();
                if (isLLMAvailable(config)) {
                    setLlmClient(new LLMClient(config));
                }

                const [localDiffs, stagedDiffs, commits] = await Promise.all([
                    git.getLocalDiff(),
                    git.getLocalDiff({ staged: true }),
                    git.getCommitHistory(20),
                ]);

                setData({ localDiffs, stagedDiffs, commits });

                // Check for updates in background (non-blocking)
                checkForUpdates().then(info => {
                    if (info) setUpdateInfo(info);
                }).catch(() => {
                    // Silently ignore update check failures
                });
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An error occurred');
            } finally {
                setLoading(false);
            }
        };

        init();
    }, [repoPath]);

    // Handle commit selection
    const handleSelectCommit = useCallback(async (commit: CommitInfo) => {
        setSelectedCommit(commit);
        try {
            const git = new GitExtractor(repoPath);
            const diffs = await git.getCommitDiff(commit.hash);
            setCommitDiff(diffs);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load commit');
        }
    }, [repoPath]);

    // Determine if there are changes available for AI commands
    const hasChangesToAnalyze = useCallback(() => {
        if (selectedCommit && commitDiff.length > 0) return true;
        if (selectedSection === 'local' && data.localDiffs.length > 0) return true;
        if (selectedSection === 'staged' && data.stagedDiffs.length > 0) return true;
        return false;
    }, [selectedCommit, commitDiff, selectedSection, data.localDiffs, data.stagedDiffs]);

    // Get matching slash commands based on current input and context
    const getMatchingCommands = useCallback(() => {
        if (!chatInput.startsWith('/')) return [];

        const hasChanges = hasChangesToAnalyze();
        const isViewingCommit = selectedCommit !== null;

        return SLASH_COMMANDS.filter(c => {
            // First check if command matches input
            if (!c.cmd.startsWith(chatInput) && chatInput !== '/') return false;

            // Check context requirements
            if (c.requiresChanges && !hasChanges) return false;
            if (c.requiresCommit && !isViewingCommit) return false;
            if (c.globalOnly && isViewingCommit) return false;

            return true;
        });
    }, [chatInput, hasChangesToAnalyze, selectedCommit]);

    // Key handling
    useInput((input, key) => {
        // Tab handling - different behavior based on context
        if (key.tab) {
            // In input mode with a partial slash command - autocomplete
            if (focusArea === 'input' && chatInput.startsWith('/')) {
                const matches = getMatchingCommands();
                if (matches.length === 1 && matches[0].cmd !== chatInput) {
                    setChatInput(matches[0].cmd);
                    return;
                }
            }

            // Otherwise, if in input mode, exit to dashboard
            if (focusArea === 'input') {
                setFocusArea('dashboard');
            }

            // Switch sections (only when NOT viewing a commit)
            if (!selectedCommit) {
                setSelectedSection(prev => {
                    if (prev === 'local') return 'staged';
                    if (prev === 'staged') return 'history';
                    return 'local';
                });
            }
            return;
        }

        // Escape ALWAYS exits current mode (consistent everywhere)
        if (key.escape) {
            if (focusArea === 'input') {
                setChatInput('');
                setFocusArea('dashboard');
            } else if (focusArea === 'response') {
                setFocusArea('dashboard');
            } else if (selectedCommit) {
                // Escape also goes back from commit view
                setSelectedCommit(null);
                setCommitDiff([]);
                setCompareWith(null);
            }
            return;
        }

        // When in input mode, let TextInput handle most keys
        if (focusArea === 'input') {
            // Ctrl+C exits input mode
            if (key.ctrl && input === 'c') {
                setChatInput('');
                setFocusArea('dashboard');
                return;
            }
            return;
        }

        // Response scrolling mode (works same in both dashboard and commit view)
        if (focusArea === 'response') {
            if (key.upArrow) {
                setResponseScrollOffset(prev => Math.max(0, prev - 1));
                return;
            } else if (key.downArrow) {
                const lastResponse = chatHistory.filter(m => m.role === 'assistant').pop();
                const lines = (lastResponse?.content || '').split('\n');
                setResponseScrollOffset(prev => Math.min(Math.max(0, lines.length - 5), prev + 1));
                return;
            } else if (input === 'i' || input === '/') {
                setFocusArea('input');
                return;
            } else if (input === 'c') {
                setChatHistory([]);
                setResponseScrollOffset(0);
                setFocusArea('dashboard');
                return;
            } else if (input === 'q') {
                setFocusArea('dashboard');
                return;
            }
        }

        // q to quit or go back (consistent behavior)
        if (input === 'q' && focusArea === 'dashboard') {
            if (compareMode) {
                // Cancel compare mode
                setCompareMode(false);
                return;
            }
            if (selectedCommit) {
                // Go back from commit view
                setSelectedCommit(null);
                setCommitDiff([]);
                setCompareWith(null);
            } else {
                // Quit app
                exit();
            }
            return;
        }

        // Compare mode navigation
        if (compareMode && focusArea === 'dashboard') {
            const maxIndex = Math.min(4, data.commits.length - 1); // Show max 5 commits
            if (key.upArrow) {
                setCompareIndex(prev => Math.max(0, prev - 1));
                return;
            } else if (key.downArrow) {
                setCompareIndex(prev => Math.min(maxIndex, prev + 1));
                return;
            } else if (key.return) {
                // Select commit to compare
                const targetCommit = data.commits[compareIndex];
                if (targetCommit && selectedCommit) {
                    // Store the comparison target
                    setCompareWith(targetCommit);
                    // Load comparison diff
                    const git = new GitExtractor(repoPath);
                    git.getCommitDiff(selectedCommit.hash, targetCommit.hash).then(diffs => {
                        setCommitDiff(diffs);
                        const msg: ChatMessage = {
                            role: 'assistant',
                            content: `✅ Comparing commits:\n  Base: ${selectedCommit.hash.slice(0, 7)} - ${selectedCommit.message.split('\n')[0].slice(0, 40)}\n  With: ${targetCommit.hash.slice(0, 7)} - ${targetCommit.message.split('\n')[0].slice(0, 40)}`
                        };
                        setChatHistory(prev => [...prev, msg]);
                    }).catch(err => {
                        const msg: ChatMessage = { role: 'assistant', content: `❌ Compare failed: ${err.message}` };
                        setChatHistory(prev => [...prev, msg]);
                        setCompareWith(null);
                    });
                    setCompareMode(false);
                }
                return;
            } else if (key.escape) {
                setCompareMode(false);
                return;
            }
        }

        // Navigate history when in history section (only on main dashboard)
        if (selectedSection === 'history' && !selectedCommit && focusArea === 'dashboard' && !compareMode) {
            if (key.upArrow) {
                setHistoryIndex(prev => Math.max(0, prev - 1));
                return;
            } else if (key.downArrow) {
                setHistoryIndex(prev => Math.min(data.commits.length - 1, prev + 1));
                return;
            } else if (key.return) {
                if (data.commits[historyIndex]) {
                    handleSelectCommit(data.commits[historyIndex]);
                }
                return;
            }
        }

        // / or i to focus input (works in both dashboard and commit view)
        if ((input === '/' || input === 'i') && focusArea === 'dashboard' && !compareMode) {
            setFocusArea('input');
            return;
        }

        // r to browse response (works in both views)
        if (input === 'r' && chatHistory.length > 0 && focusArea === 'dashboard' && !compareMode) {
            setFocusArea('response');
        }
    });

    // Handle chat submit
    const handleChatSubmit = useCallback(async (value: string) => {
        if (!value.trim()) return;

        const query = value.trim();

        // Check if this is a partial slash command - autocomplete instead of submit
        if (query.startsWith('/')) {
            const contextMatches = getMatchingCommands();
            const isExactMatch = contextMatches.some(c => c.cmd === query);

            if (contextMatches.length === 1 && !isExactMatch) {
                // Autocomplete the command
                setChatInput(contextMatches[0].cmd);
                return;
            }

            // Handle non-LLM commands
            if (query === '/local') {
                setSelectedSection('local');
                setSelectedCommit(null);
                setCommitDiff([]);
                setCompareWith(null);
                setChatInput('');
                const msg: ChatMessage = { role: 'assistant', content: '📝 Switched to Local Changes view' };
                setChatHistory(prev => [...prev, msg]);
                setFocusArea('dashboard');
                return;
            }

            if (query === '/staged') {
                setSelectedSection('staged');
                setSelectedCommit(null);
                setCommitDiff([]);
                setCompareWith(null);
                setChatInput('');
                const msg: ChatMessage = { role: 'assistant', content: '📦 Switched to Staged Changes view' };
                setChatHistory(prev => [...prev, msg]);
                setFocusArea('dashboard');
                return;
            }

            if (query === '/history') {
                setSelectedSection('history');
                setSelectedCommit(null);
                setCommitDiff([]);
                setCompareWith(null);
                setChatInput('');
                const msg: ChatMessage = { role: 'assistant', content: `📜 Showing ${data.commits.length} recent commits. Use ↑↓ to navigate, Enter to select.` };
                setChatHistory(prev => [...prev, msg]);
                setFocusArea('dashboard');
                return;
            }

            if (query === '/web') {
                setChatInput('');
                // Actually start the web server
                setChatInput('');
                const msg: ChatMessage = { role: 'assistant', content: '🌐 Starting web UI...' };
                setChatHistory(prev => [...prev, msg]);

                // Start the web server in background
                const port = 3000;
                import('../../api/server').then(async ({ startAPIServer }) => {
                    await startAPIServer(port);
                    const url = `http://localhost:${port}`;
                    const openCmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start' : 'xdg-open';
                    Bun.spawn([openCmd, url]);

                    const successMsg: ChatMessage = { role: 'assistant', content: `✅ Web UI running at ${url}` };
                    setChatHistory(prev => [...prev, successMsg]);
                }).catch(err => {
                    const errorMsg: ChatMessage = { role: 'assistant', content: `❌ Failed to start web UI: ${err.message}` };
                    setChatHistory(prev => [...prev, errorMsg]);
                });
                return;
            }

            if (query === '/config') {
                setChatInput('');
                const configStatus = llmClient
                    ? `✅ LLM is configured and ready\nRun 'difflearn config --status' for details.`
                    : `⚠️ No LLM configured\nRun 'difflearn config' to set up an API key.`;
                const msg: ChatMessage = { role: 'assistant', content: configStatus };
                setChatHistory(prev => [...prev, msg]);
                return;
            }

            if (query === '/export') {
                // Determine what to export
                let diffsToExport: ParsedDiff[] = [];
                let exportContext = '';

                if (selectedCommit) {
                    diffsToExport = commitDiff;
                    exportContext = `commit-${selectedCommit.hash.slice(0, 7)}`;
                } else if (selectedSection === 'local') {
                    diffsToExport = data.localDiffs;
                    exportContext = 'local-changes';
                } else if (selectedSection === 'staged') {
                    diffsToExport = data.stagedDiffs;
                    exportContext = 'staged-changes';
                }

                if (diffsToExport.length === 0) {
                    const msg: ChatMessage = { role: 'assistant', content: '⚠️ No changes to export. Select local/staged changes or a commit first.' };
                    setChatHistory(prev => [...prev, msg]);
                    setChatInput('');
                    return;
                }

                // Actually export to Downloads folder
                const formatter = new DiffFormatter();
                const markdown = formatter.toMarkdown(diffsToExport);
                const downloadsDir = path.join(os.homedir(), 'Downloads');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const filename = `difflearn-${exportContext}-${timestamp}.md`;
                const filepath = path.join(downloadsDir, filename);

                try {
                    fs.writeFileSync(filepath, markdown);
                    setChatInput('');
                    const msg: ChatMessage = { role: 'assistant', content: `📤 Exported to:\n${filepath}` };
                    setChatHistory(prev => [...prev, msg]);
                } catch (err) {
                    const msg: ChatMessage = { role: 'assistant', content: `❌ Export failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
                    setChatHistory(prev => [...prev, msg]);
                    setChatInput('');
                }
                return;
            }

            if (query === '/compare' && selectedCommit) {
                // Enter compare mode - show commit selection
                setChatInput('');
                setCompareMode(true);
                setCompareIndex(0);
                const msg: ChatMessage = {
                    role: 'assistant',
                    content: `🔀 Select a commit to compare with ${selectedCommit.hash.slice(0, 7)}:\nUse ↑↓ to navigate, Enter to select, Esc to cancel`
                };
                setChatHistory(prev => [...prev, msg]);
                setFocusArea('dashboard');
                return;
            }

            if (query === '/update') {
                setChatInput('');
                const msg: ChatMessage = { role: 'assistant', content: '🔍 Checking for updates...' };
                setChatHistory(prev => [...prev, msg]);

                checkForUpdates().then(info => {
                    if (info) {
                        setUpdateInfo(info);
                        const updateMsg: ChatMessage = { role: 'assistant', content: formatUpdateMessage(info) };
                        setChatHistory(prev => [...prev, updateMsg]);
                    } else {
                        const errorMsg: ChatMessage = { role: 'assistant', content: '⚠️ Could not check for updates. Are you connected to the internet?' };
                        setChatHistory(prev => [...prev, errorMsg]);
                    }
                }).catch(err => {
                    const errorMsg: ChatMessage = { role: 'assistant', content: `❌ Update check failed: ${err.message}` };
                    setChatHistory(prev => [...prev, errorMsg]);
                });
                return;
            }

            // If we get here with a slash command, it wasn't handled above
            // This means it's either a partial match with multiple options, or invalid
            const isValidCommand = ['/explain', '/review', '/summarize', '/local', '/staged', '/history', '/web', '/config', '/export', '/compare', '/update'].includes(query);
            if (!isValidCommand) {
                const contextMatches = getMatchingCommands();
                if (contextMatches.length > 1) {
                    // Multiple matches - show them
                    const matchList = contextMatches.map(c => c.cmd).join(', ');
                    const msg: ChatMessage = { role: 'assistant', content: `🔍 Multiple matches: ${matchList}\nType more to narrow down, or press Tab to autocomplete.` };
                    setChatHistory(prev => [...prev, msg]);
                    // Don't clear input so they can continue typing
                    return;
                } else if (contextMatches.length === 0) {
                    const msg: ChatMessage = { role: 'assistant', content: `❌ Unknown command: ${query}\nType / to see available commands.` };
                    setChatHistory(prev => [...prev, msg]);
                    setChatInput('');
                    return;
                }
            }
        }

        // LLM commands require the client
        if (!llmClient) {
            const msg: ChatMessage = { role: 'assistant', content: '⚠️ No LLM configured. Run "difflearn config" to set up.' };
            setChatHistory(prev => [...prev, msg]);
            setChatInput('');
            return;
        }

        // Validate AI commands have content to analyze
        const needsChanges = query.startsWith('/explain') || query.startsWith('/review') || query.startsWith('/summarize');
        if (needsChanges && !hasChangesToAnalyze()) {
            const msg: ChatMessage = {
                role: 'assistant',
                content: '⚠️ No changes to analyze. Select local/staged changes with content, or select a commit from history.'
            };
            setChatHistory(prev => [...prev, msg]);
            setChatInput('');
            return;
        }

        const userMessage: ChatMessage = { role: 'user', content: query };
        setChatHistory(prev => [...prev, userMessage]);
        setChatInput('');
        setIsAsking(true);

        try {
            // Determine which diffs to use
            let diffsToUse: ParsedDiff[] = [];
            if (selectedCommit) {
                diffsToUse = commitDiff;
            } else if (selectedSection === 'local') {
                diffsToUse = data.localDiffs;
            } else if (selectedSection === 'staged') {
                diffsToUse = data.stagedDiffs;
            }

            let prompt = '';

            if (query.startsWith('/explain')) {
                prompt = createExplainPrompt(diffsToUse);
            } else if (query.startsWith('/review')) {
                prompt = createReviewPrompt(diffsToUse);
            } else if (query.startsWith('/summarize') || query.startsWith('/summary')) {
                prompt = createSummaryPrompt(diffsToUse);
            } else {
                prompt = createQuestionPrompt(diffsToUse, query);
            }

            const response = await llmClient.chat([
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt }
            ]);

            const assistantMessage: ChatMessage = { role: 'assistant', content: response.content };
            setChatHistory(prev => [...prev, assistantMessage]);
            setResponseScrollOffset(0); // Reset scroll to top of new response
        } catch (err) {
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`
            };
            setChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setIsAsking(false);
            // Keep input focused for follow-up questions
            setFocusArea('input');
        }
    }, [llmClient, selectedCommit, commitDiff, selectedSection, data]);

    if (error) {
        return (
            <Box padding={1}>
                <Text color="red">❌ {error}</Text>
            </Box>
        );
    }

    if (loading) {
        return (
            <Box padding={1}>
                <Text color="cyan">⏳ Loading dashboard...</Text>
            </Box>
        );
    }

    // Render a compact diff summary
    const renderDiffSummary = (diffs: ParsedDiff[], title: string, isActive: boolean) => {
        const totalAdditions = diffs.reduce((s, d) => s + d.additions, 0);
        const totalDeletions = diffs.reduce((s, d) => s + d.deletions, 0);

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={isActive ? 'cyan' : 'gray'}
                paddingX={1}
                paddingY={0}
            >
                <Box marginBottom={0}>
                    <Text bold color={isActive ? 'cyan' : 'white'}>{title}</Text>
                    <Text color="gray"> ({diffs.length} files, </Text>
                    <Text color="greenBright">+{totalAdditions}</Text>
                    <Text color="gray">/</Text>
                    <Text color="redBright">-{totalDeletions}</Text>
                    <Text color="gray">)</Text>
                </Box>
                {diffs.length === 0 ? (
                    <Text color="gray" dimColor>No changes</Text>
                ) : (
                    <Box flexDirection="column">
                        {diffs.slice(0, 5).map((diff, i) => (
                            <Box key={i}>
                                <Text color={diff.isNew ? 'greenBright' : diff.isDeleted ? 'redBright' : 'yellow'}>
                                    {diff.isNew ? '+ ' : diff.isDeleted ? '- ' : '~ '}
                                </Text>
                                <Text>{diff.newFile.split('/').pop()?.slice(0, 30)}</Text>
                                <Text color="gray"> (</Text>
                                <Text color="greenBright">+{diff.additions}</Text>
                                <Text color="gray">/</Text>
                                <Text color="redBright">-{diff.deletions}</Text>
                                <Text color="gray">)</Text>
                            </Box>
                        ))}
                        {diffs.length > 5 && (
                            <Text color="gray" dimColor>  ...and {diffs.length - 5} more</Text>
                        )}
                    </Box>
                )}
            </Box>
        );
    };

    // Render history section with windowing
    const renderHistorySummary = (isActive: boolean) => {
        const VISIBLE_COUNT = 8;
        const total = data.commits.length;

        // Calculate window to keep selection visible
        const windowStart = Math.max(0, Math.min(historyIndex - Math.floor(VISIBLE_COUNT / 2), total - VISIBLE_COUNT));
        const windowEnd = Math.min(total, windowStart + VISIBLE_COUNT);
        const visibleCommits = data.commits.slice(windowStart, windowEnd);

        const canScrollUp = windowStart > 0;
        const canScrollDown = windowEnd < total;

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor={isActive ? 'cyan' : 'gray'}
                paddingX={1}
            >
                <Text bold color={isActive ? 'cyan' : 'white'}>Recent Commits ({total})</Text>

                {canScrollUp && isActive && (
                    <Text color="gray" dimColor>  ▲ {windowStart} more above</Text>
                )}

                {visibleCommits.map((commit, i) => {
                    const actualIndex = windowStart + i;
                    const isSelected = actualIndex === historyIndex && isActive;

                    return (
                        <Box key={commit.hash}>
                            <Text color={isSelected ? 'cyan' : 'gray'}>
                                {isSelected ? '▸ ' : '  '}
                            </Text>
                            <Text color="yellow">{commit.hash.slice(0, 7)}</Text>
                            <Text> </Text>
                            <Text color={isSelected ? 'white' : 'gray'}>
                                {commit.message.split('\n')[0].slice(0, 35)}
                                {commit.message.length > 35 ? '...' : ''}
                            </Text>
                        </Box>
                    );
                })}

                {canScrollDown && isActive && (
                    <Text color="gray" dimColor>  ▼ {total - windowEnd} more below</Text>
                )}

                {isActive && <Text color="gray" dimColor>↑↓ navigate, Enter select</Text>}
            </Box>
        );
    };

    // Render full diff for selected commit
    const renderCommitDiff = () => {
        if (!selectedCommit) return null;

        return (
            <Box flexDirection="column" borderStyle="round" borderColor="magenta" padding={1}>
                <Box marginBottom={1}>
                    <Text bold color="magenta">Commit: </Text>
                    <Text color="yellow">{selectedCommit.hash.slice(0, 7)}</Text>
                    <Text> - {selectedCommit.message.split('\n')[0]}</Text>
                </Box>

                {commitDiff.map((diff, i) => (
                    <Box key={i} flexDirection="column" marginBottom={1}>
                        <Box>
                            <Text color={diff.isNew ? 'greenBright' : diff.isDeleted ? 'redBright' : 'yellow'} bold>
                                {diff.isNew ? '[NEW] ' : diff.isDeleted ? '[DEL] ' : '[MOD] '}
                            </Text>
                            <Text bold>{diff.newFile}</Text>
                        </Box>
                        {diff.hunks.slice(0, 2).map((hunk, hi) => (
                            <Box key={hi} flexDirection="column" paddingLeft={1}>
                                <Text color="cyan" dimColor>{hunk.header}</Text>
                                {hunk.lines.slice(0, 8).map((line, li) => (
                                    <Box key={li}>
                                        <Text
                                            color={line.type === 'add' ? 'greenBright' : line.type === 'delete' ? 'redBright' : 'gray'}
                                            dimColor={line.type === 'context'}
                                        >
                                            {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
                                            {line.content.slice(0, 80)}
                                        </Text>
                                    </Box>
                                ))}
                                {hunk.lines.length > 8 && <Text color="gray" dimColor>  ... {hunk.lines.length - 8} more lines</Text>}
                            </Box>
                        ))}
                        {diff.hunks.length > 2 && <Text color="gray" dimColor>  ... {diff.hunks.length - 2} more hunks</Text>}
                    </Box>
                ))}
            </Box>
        );
    };

    // Render scrollable response
    const renderChatResponse = () => {
        if (chatHistory.length === 0) return null;

        const VISIBLE_LINES = 12; // Number of lines to show at once
        const lastAssistant = chatHistory.filter(m => m.role === 'assistant').pop();

        if (!lastAssistant) return null;

        const lines = lastAssistant.content.split('\n');
        const visibleLines = lines.slice(responseScrollOffset, responseScrollOffset + VISIBLE_LINES);
        const canScrollUp = responseScrollOffset > 0;
        const canScrollDown = responseScrollOffset + VISIBLE_LINES < lines.length;

        return (
            <Box flexDirection="column" marginTop={1}>
                {/* Scroll indicator */}
                {canScrollUp && (
                    <Text color="gray" dimColor>  ▲ scroll up (↑)</Text>
                )}

                {/* Response content */}
                <Box flexDirection="column" borderStyle={focusArea === 'response' ? 'round' : undefined} borderColor="cyan" paddingX={1}>
                    {visibleLines.map((line, i) => (
                        <Text key={i} color="white" wrap="wrap">{line}</Text>
                    ))}
                </Box>

                {/* Bottom scroll indicator */}
                {canScrollDown && (
                    <Text color="gray" dimColor>  ▼ scroll down (↓) - {lines.length - responseScrollOffset - VISIBLE_LINES} more lines</Text>
                )}

                {/* Response navigation hint */}
                <Text color="gray" dimColor>
                    {focusArea === 'response'
                        ? '↑↓: scroll • i: type • c: clear • Esc: back'
                        : 'Esc: browse response • c: clear'}
                </Text>
            </Box>
        );
    };

    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text color="magenta" bold>🔍 DiffLearn</Text>
                {selectedCommit && (
                    <>
                        <Text color="gray"> • </Text>
                        <Text color="yellow">{selectedCommit.hash.slice(0, 7)}</Text>
                    </>
                )}
                <Text color="gray"> • </Text>
                <Text color={llmClient ? 'greenBright' : 'yellow'}>
                    {llmClient ? '🤖 AI' : '⚠ No AI'}
                </Text>
                {updateInfo?.updateAvailable && (
                    <>
                        <Text color="gray"> • </Text>
                        <Text color="yellow">🆕 v{updateInfo.latestVersion} available</Text>
                    </>
                )}
                <Text color="gray"> • </Text>
                <Text color="gray">
                    {selectedCommit
                        ? '/: ask AI • q/Esc: back'
                        : 'Tab: switch • /: ask AI • q: quit'}
                </Text>
            </Box>

            {/* If viewing a commit, show full diff */}
            {selectedCommit ? (
                renderCommitDiff()
            ) : (
                /* Unified view - all three sections */
                <Box flexDirection="column">
                    <Box flexDirection="row" marginBottom={1}>
                        <Box width="50%" marginRight={1}>
                            {renderDiffSummary(data.localDiffs, '📝 Local Changes', selectedSection === 'local')}
                        </Box>
                        <Box width="50%">
                            {renderDiffSummary(data.stagedDiffs, '📦 Staged Changes', selectedSection === 'staged')}
                        </Box>
                    </Box>

                    {renderHistorySummary(selectedSection === 'history')}
                </Box>
            )}

            {/* Compare mode commit selector */}
            {compareMode && selectedCommit && (
                <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1} paddingY={1}>
                    <Text bold color="yellow">🔀 Select commit to compare with {selectedCommit.hash.slice(0, 7)}:</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {data.commits.slice(0, 5).map((commit, idx) => (
                            <Box key={commit.hash}>
                                <Text color={idx === compareIndex ? 'greenBright' : 'gray'}>
                                    {idx === compareIndex ? '❯ ' : '  '}
                                </Text>
                                <Text color={idx === compareIndex ? 'yellow' : 'gray'}>{commit.hash.slice(0, 7)}</Text>
                                <Text color={idx === compareIndex ? 'white' : 'gray'}> - {commit.message.split('\n')[0].slice(0, 50)}</Text>
                            </Box>
                        ))}
                    </Box>
                    <Box marginTop={1} flexDirection="column">
                        <Text color="gray" dimColor>↑↓: navigate • Enter: select • Esc/q: cancel</Text>
                        {data.commits.length > 5 && (
                            <Text color="gray" dimColor>Or run: difflearn commit {selectedCommit.hash.slice(0, 7)} --compare &lt;sha&gt;</Text>
                        )}
                    </Box>
                </Box>
            )}

            {/* Chat input */}
            {llmClient && (
                <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={focusArea === 'input' ? 'cyan' : 'gray'} paddingX={1}>
                    <Box>
                        <Text color={focusArea === 'input' ? 'cyan' : 'gray'}>
                            {isAsking ? '⏳ ' : focusArea === 'input' ? '❯ ' : '  '}
                        </Text>
                        <TextInput
                            value={chatInput}
                            onChange={setChatInput}
                            onSubmit={handleChatSubmit}
                            focus={focusArea === 'input'}
                            placeholder={isAsking ? 'Thinking...' : focusArea === 'input' ? 'Type / for commands, or ask a question...' : 'Press / to ask AI...'}
                        />
                    </Box>

                    {/* Slash command suggestions */}
                    {focusArea === 'input' && chatInput.startsWith('/') && !isAsking && (() => {
                        const matches = getMatchingCommands();
                        const canAutocomplete = matches.length === 1 && matches[0].cmd !== chatInput;

                        return (
                            <Box flexDirection="column" marginTop={1} paddingLeft={2}>
                                <Text color="gray" dimColor>
                                    Commands{canAutocomplete ? ' (Tab or Enter to complete)' : ':'}
                                </Text>
                                {matches.map(({ cmd, desc }) => (
                                    <Box key={cmd}>
                                        <Text color={canAutocomplete ? 'greenBright' : 'cyan'} bold>{cmd}</Text>
                                        <Text color="gray"> - {desc}</Text>
                                    </Box>
                                ))}
                                {matches.length === 0 && (
                                    <Text color="yellow">No matching commands</Text>
                                )}
                            </Box>
                        );
                    })()}

                    {focusArea === 'input' && !chatInput.startsWith('/') && (
                        <Text color="gray" dimColor>Esc: cancel • Tab: switch section • Enter: submit</Text>
                    )}
                </Box>
            )}

            {/* Chat response (scrollable) */}
            {renderChatResponse()}
        </Box>
    );
};

export default UnifiedDashboard;
