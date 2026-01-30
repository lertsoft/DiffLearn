import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { GitExtractor, ParsedDiff, CommitInfo } from '../../git';
import { LLMClient } from '../../llm';
import { loadConfig, isLLMAvailable } from '../../config';
import DiffViewer from './DiffViewer';
import ChatPanel from './ChatPanel';
import HistoryView from './HistoryView';

export type DiffMode = 'dashboard' | 'local' | 'staged' | 'commit' | 'branch';
export type Tab = 'local' | 'staged' | 'history';

interface AppProps {
    mode: DiffMode;
    repoPath?: string;
    commit1?: string;
    commit2?: string;
    branch1?: string;
    branch2?: string;
}

interface ChatState {
    isOpen: boolean;
    diff?: ParsedDiff;
    hunkIndex: number;
}

export const App: React.FC<AppProps> = ({
    mode: initialMode,
    repoPath = process.cwd(),
    commit1,
    commit2,
    branch1,
    branch2,
}) => {
    const { exit } = useApp();
    const [mode, setMode] = useState<DiffMode>(initialMode);
    const [activeTab, setActiveTab] = useState<Tab>('local');
    const [diffs, setDiffs] = useState<ParsedDiff[]>([]);
    const [commits, setCommits] = useState<CommitInfo[]>([]);
    const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [chatState, setChatState] = useState<ChatState>({ isOpen: false, hunkIndex: 0 });
    const [llmClient, setLlmClient] = useState<LLMClient | undefined>();

    // Initialize & Data Fetching
    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const git = new GitExtractor(repoPath);

                // Check if it's a git repo
                if (!await git.isRepo()) {
                    throw new Error('Not a git repository. Run this command from a git project.');
                }

                // Initialize LLM client if available
                const config = loadConfig();
                if (isLLMAvailable(config)) {
                    setLlmClient(new LLMClient(config));
                }

                if (mode === 'dashboard') {
                    // Fetch based on active tab
                    if (activeTab === 'local') {
                        const loadedDiffs = await git.getLocalDiff();
                        setDiffs(loadedDiffs);
                    } else if (activeTab === 'staged') {
                        const loadedDiffs = await git.getLocalDiff({ staged: true });
                        setDiffs(loadedDiffs);
                    } else if (activeTab === 'history') {
                        const loadedCommits = await git.getCommitHistory(50);
                        setCommits(loadedCommits);
                    }
                } else {
                    // Legacy specific modes
                    let loadedDiffs: ParsedDiff[] = [];
                    switch (mode) {
                        case 'local':
                            loadedDiffs = await git.getLocalDiff();
                            break;
                        case 'staged':
                            loadedDiffs = await git.getLocalDiff({ staged: true });
                            break;
                        case 'commit':
                            if (!commit1) throw new Error('Commit hash required');
                            loadedDiffs = await git.getCommitDiff(commit1, commit2);
                            break;
                        case 'branch':
                            if (!branch1 || !branch2) throw new Error('Both branches required');
                            loadedDiffs = await git.getBranchDiff(branch1, branch2);
                            break;
                    }
                    setDiffs(loadedDiffs);
                }

            } catch (err) {
                setError(err instanceof Error ? err.message : 'An error occurred');
            } finally {
                setLoading(false);
            }
        };

        init();
    }, [mode, activeTab, repoPath, commit1, commit2, branch1, branch2]);

    // Handle commit selection from History
    const handleSelectCommit = useCallback(async (commit: CommitInfo) => {
        setSelectedCommit(commit);
        setLoading(true);
        try {
            const git = new GitExtractor(repoPath);
            const loadedDiffs = await git.getCommitDiff(commit.hash);
            setDiffs(loadedDiffs);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load commit diff');
        } finally {
            setLoading(false);
        }
    }, [repoPath]);

    const handleBackToHistory = useCallback(() => {
        setSelectedCommit(null);
        setDiffs([]);
    }, []);

    // Global key handlers
    useInput((input, key) => {
        if (input === 'q' && !chatState.isOpen) {
            if (selectedCommit) {
                handleBackToHistory();
            } else {
                exit();
            }
        }

        if (mode === 'dashboard' && !chatState.isOpen && !selectedCommit) {
            if (key.tab) {
                setActiveTab(prev => {
                    if (prev === 'local') return 'staged';
                    if (prev === 'staged') return 'history';
                    return 'local';
                });
            }
        }
    });

    const handleAskQuestion = useCallback((diff: ParsedDiff, hunkIndex: number) => {
        setChatState({ isOpen: true, diff, hunkIndex });
    }, []);

    const handleCloseChat = useCallback(() => {
        setChatState({ isOpen: false, hunkIndex: 0 });
    }, []);

    const renderHeader = () => (
        <Box marginBottom={1} paddingX={1} flexDirection="row">
            <Text color="magenta" bold>
                🔍 DiffLearn
            </Text>
            <Text color="gray"> • </Text>

            {mode === 'dashboard' ? (
                <Box>
                    <Text bold={activeTab === 'local'} color={activeTab === 'local' ? 'cyan' : 'gray'}> Local </Text>
                    <Text color="gray"> | </Text>
                    <Text bold={activeTab === 'staged'} color={activeTab === 'staged' ? 'cyan' : 'gray'}> Staged </Text>
                    <Text color="gray"> | </Text>
                    <Text bold={activeTab === 'history'} color={activeTab === 'history' ? 'cyan' : 'gray'}> History </Text>
                </Box>
            ) : (
                <Text color="white">
                    {mode === 'local' && 'Local Changes'}
                    {mode === 'staged' && 'Staged Changes'}
                    {mode === 'commit' && `Commit: ${commit1}${commit2 ? `..${commit2}` : ''}`}
                    {mode === 'branch' && `${branch1} ⟷ ${branch2}`}
                </Text>
            )}

            <Text color="gray"> • </Text>
            <Text color={llmClient ? 'green' : 'yellow'}>
                {llmClient ? '🤖 AI Ready' : '⚠ No AI'}
            </Text>
            <Text color="gray"> • {selectedCommit ? 'q: back' : 'q: quit'}{mode === 'dashboard' ? ', Tab: switch view' : ''}</Text>
        </Box>
    );

    // Error state
    if (error) {
        return (
            <Box padding={1} flexDirection="column">
                <Text color="red" bold>❌ Error</Text>
                <Text color="red">{error}</Text>
            </Box>
        );
    }

    const renderContent = () => {
        if (loading) {
            return (
                <Box padding={1}>
                    <Text color="cyan">⏳ Loading...</Text>
                </Box>
            );
        }

        if (mode === 'dashboard' && activeTab === 'history' && !selectedCommit) {
            return (
                <HistoryView
                    commits={commits}
                    onSelectCommit={handleSelectCommit}
                    isLoading={loading}
                />
            );
        }

        if (diffs.length === 0) {
            return (
                <Box padding={1} flexDirection="column">
                    <Text color="yellow">📭 No changes found</Text>
                    <Text color="gray">
                        {mode === 'local' && 'Your working directory is clean.'}
                        {mode === 'dashboard' && activeTab === 'local' && 'Your working directory is clean.'}
                        {(mode === 'staged' || (mode === 'dashboard' && activeTab === 'staged')) && 'No staged changes.'}
                    </Text>
                </Box>
            );
        }

        if (chatState.isOpen && chatState.diff) {
            return (
                <Box flexDirection="row" width="100%">
                    <Box width="50%">
                        <DiffViewer
                            diffs={diffs}
                            onAskQuestion={handleAskQuestion}
                        />
                    </Box>
                    <Box width="50%">
                        <ChatPanel
                            diff={chatState.diff}
                            hunkIndex={chatState.hunkIndex}
                            llmClient={llmClient}
                            onClose={handleCloseChat}
                        />
                    </Box>
                </Box>
            );
        }

        return (
            <DiffViewer
                diffs={diffs}
                onAskQuestion={handleAskQuestion}
            />
        );
    };

    return (
        <Box flexDirection="column" width="100%">
            {renderHeader()}
            <Box flexGrow={1}>
                {renderContent()}
            </Box>
        </Box>
    );
};

export default App;
