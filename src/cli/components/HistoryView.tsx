import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { CommitInfo } from '../../git/extractor';

interface HistoryViewProps {
    commits: CommitInfo[];
    onSelectCommit: (commit: CommitInfo) => void;
    isLoading?: boolean;
}

const HistoryView: React.FC<HistoryViewProps> = ({ commits, onSelectCommit, isLoading }) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selection when commits change significantly (optional, but good practice)
    useEffect(() => {
        if (selectedIndex >= commits.length && commits.length > 0) {
            setSelectedIndex(0);
        }
    }, [commits.length]);

    useInput((input, key) => {
        if (isLoading || commits.length === 0) return;

        if (key.upArrow) {
            setSelectedIndex(prev => Math.max(0, prev - 1));
        } else if (key.downArrow) {
            setSelectedIndex(prev => Math.min(commits.length - 1, prev + 1));
        } else if (key.return) {
            onSelectCommit(commits[selectedIndex]);
        }
    });

    if (isLoading) {
        return <Text color="gray">Loading history...</Text>;
    }

    if (commits.length === 0) {
        return <Text color="yellow">No history found.</Text>;
    }

    // Simple pagination / windowing could be added here if history is long,
    // but for now let's just show the list or a slice. 
    // Ink handles scrolling if we wrap in a fixed height Box, but standard terminal scrolling is often better.
    // Let's rely on a limited number of items being passed or simple slicing for display.
    // We'll show a window of 10 items around the selection.

    const WINDOW_SIZE = 10;
    const startIdx = Math.max(0, Math.min(selectedIndex - Math.floor(WINDOW_SIZE / 2), commits.length - WINDOW_SIZE));
    const endIdx = Math.min(commits.length, startIdx + WINDOW_SIZE);

    const visibleCommits = commits.slice(startIdx, endIdx);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="blue" padding={1}>
            <Box marginBottom={1}>
                <Text bold underline>Commit History</Text>
            </Box>
            {visibleCommits.map((commit, index) => {
                const actualIndex = startIdx + index;
                const isSelected = actualIndex === selectedIndex;

                return (
                    <Box key={commit.hash} flexDirection="row">
                        <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
                            {isSelected ? "> " : "  "}
                        </Text>
                        <Text color="yellow">{commit.hash.slice(0, 7)}</Text>
                        <Text>  </Text>
                        <Text color={isSelected ? "cyan" : "white"}>
                            {commit.message.split('\n')[0].slice(0, 50)}
                            {commit.message.length > 50 ? '...' : ''}
                        </Text>
                        <Box flexGrow={1} />
                        <Text color="gray">{new Date(commit.date).toLocaleDateString()}</Text>
                        <Text>  </Text>
                        <Text color="blue">@{commit.author}</Text>
                    </Box>
                );
            })}
            <Box marginTop={1}>
                <Text color="gray">
                    Showing {startIdx + 1}-{endIdx} of {commits.length}. Use ↑/↓ to navigate, Enter to select.
                </Text>
            </Box>
        </Box>
    );
};

export default HistoryView;
