import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { GitExtractor, ParsedDiff } from '../../git';
import { LLMClient } from '../../llm';
import { loadConfig, isLLMAvailable } from '../../config';
import DiffViewer from './DiffViewer';
import ChatPanel from './ChatPanel';

export type DiffMode = 'local' | 'staged' | 'commit' | 'branch';

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
    mode,
    repoPath = process.cwd(),
    commit1,
    commit2,
    branch1,
    branch2,
}) => {
    const { exit } = useApp();
    const [diffs, setDiffs] = useState<ParsedDiff[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [chatState, setChatState] = useState<ChatState>({ isOpen: false, hunkIndex: 0 });
    const [llmClient, setLlmClient] = useState<LLMClient | undefined>();

    // Initialize
    useEffect(() => {
        const init = async () => {
            try {
                const git = new GitExtractor(repoPath);

                // Check if it's a git repo
                if (!await git.isRepo()) {
                    throw new Error('Not a git repository. Run this command from a git project.');
                }

                // Load diff based on mode
                let loadedDiffs: ParsedDiff[];
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
                    default:
                        loadedDiffs = [];
                }

                setDiffs(loadedDiffs);

                // Initialize LLM client if available
                const config = loadConfig();
                if (isLLMAvailable(config)) {
                    setLlmClient(new LLMClient(config));
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An error occurred');
            } finally {
                setLoading(false);
            }
        };

        init();
    }, [mode, repoPath, commit1, commit2, branch1, branch2]);

    // Global key handlers
    useInput((input, key) => {
        if (input === 'q' && !chatState.isOpen) {
            exit();
        }
    });

    const handleAskQuestion = useCallback((diff: ParsedDiff, hunkIndex: number) => {
        setChatState({ isOpen: true, diff, hunkIndex });
    }, []);

    const handleCloseChat = useCallback(() => {
        setChatState({ isOpen: false, hunkIndex: 0 });
    }, []);

    // Loading state
    if (loading) {
        return (
            <Box padding={1}>
                <Text color="cyan">⏳ Loading diff...</Text>
            </Box>
        );
    }

    // Error state
    if (error) {
        return (
            <Box padding={1} flexDirection="column">
                <Text color="red" bold>❌ Error</Text>
                <Text color="red">{error}</Text>
            </Box>
        );
    }

    // No changes state
    if (diffs.length === 0) {
        return (
            <Box padding={1} flexDirection="column">
                <Text color="yellow">📭 No changes found</Text>
                <Text color="gray">
                    {mode === 'local' && 'Your working directory is clean.'}
                    {mode === 'staged' && 'No staged changes.'}
                    {mode === 'commit' && 'No changes in the specified commit(s).'}
                    {mode === 'branch' && 'No differences between branches.'}
                </Text>
            </Box>
        );
    }

    // Main view
    return (
        <Box flexDirection="column" width="100%">
            {/* Header */}
            <Box marginBottom={1} paddingX={1}>
                <Text color="magenta" bold>
                    🔍 DiffLearn
                </Text>
                <Text color="gray"> • </Text>
                <Text color="white">
                    {mode === 'local' && 'Local Changes'}
                    {mode === 'staged' && 'Staged Changes'}
                    {mode === 'commit' && `Commit: ${commit1}${commit2 ? `..${commit2}` : ''}`}
                    {mode === 'branch' && `${branch1} ⟷ ${branch2}`}
                </Text>
                <Text color="gray"> • </Text>
                <Text color={llmClient ? 'green' : 'yellow'}>
                    {llmClient ? '🤖 AI Ready' : '⚠ No LLM configured'}
                </Text>
                <Text color="gray"> • Press 'q' to quit</Text>
            </Box>

            {/* Main content - split view when chat is open */}
            <Box flexGrow={1}>
                {chatState.isOpen && chatState.diff ? (
                    <Box flexDirection="row" width="100%">
                        {/* Diff viewer - narrower when chat open */}
                        <Box width="50%">
                            <DiffViewer
                                diffs={diffs}
                                onAskQuestion={handleAskQuestion}
                            />
                        </Box>
                        {/* Chat panel */}
                        <Box width="50%">
                            <ChatPanel
                                diff={chatState.diff}
                                hunkIndex={chatState.hunkIndex}
                                llmClient={llmClient}
                                onClose={handleCloseChat}
                            />
                        </Box>
                    </Box>
                ) : (
                    <DiffViewer
                        diffs={diffs}
                        onAskQuestion={handleAskQuestion}
                    />
                )}
            </Box>
        </Box>
    );
};

export default App;
