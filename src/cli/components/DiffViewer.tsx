import React, { useState } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';
import { ParsedDiff } from '../../git';
import type { ParsedHunk, ParsedLine } from '../../git';

interface DiffViewerProps {
    diffs: ParsedDiff[];
    onSelectHunk?: (diff: ParsedDiff, hunkIndex: number) => void;
    onAskQuestion?: (diff: ParsedDiff, hunkIndex: number) => void;
}

interface HunkPosition {
    diffIndex: number;
    hunkIndex: number;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
    diffs,
    onSelectHunk,
    onAskQuestion
}) => {
    const [selectedHunk, setSelectedHunk] = useState<HunkPosition>({ diffIndex: 0, hunkIndex: 0 });
    const { isFocused } = useFocus({ autoFocus: true });

    // Build flat list of all hunks for navigation
    const allHunks: { diff: ParsedDiff; hunkIndex: number; diffIndex: number }[] = [];
    diffs.forEach((diff, diffIndex) => {
        diff.hunks.forEach((_, hunkIndex) => {
            allHunks.push({ diff, hunkIndex, diffIndex });
        });
    });

    const totalHunks = allHunks.length;

    useInput((input, key) => {
        if (!isFocused) return;

        // Navigation
        if (key.upArrow || input === 'k' || input === 'w') {
            const currentIdx = allHunks.findIndex(
                h => h.diffIndex === selectedHunk.diffIndex && h.hunkIndex === selectedHunk.hunkIndex
            );
            if (currentIdx > 0) {
                const prev = allHunks[currentIdx - 1];
                setSelectedHunk({ diffIndex: prev.diffIndex, hunkIndex: prev.hunkIndex });
            }
        } else if (key.downArrow || input === 'j' || input === 's') {
            const currentIdx = allHunks.findIndex(
                h => h.diffIndex === selectedHunk.diffIndex && h.hunkIndex === selectedHunk.hunkIndex
            );
            if (currentIdx < totalHunks - 1) {
                const next = allHunks[currentIdx + 1];
                setSelectedHunk({ diffIndex: next.diffIndex, hunkIndex: next.hunkIndex });
            }
        }

        // Actions
        if (key.return || input === ' ') {
            const current = allHunks.find(
                h => h.diffIndex === selectedHunk.diffIndex && h.hunkIndex === selectedHunk.hunkIndex
            );
            if (current && onSelectHunk) {
                onSelectHunk(current.diff, current.hunkIndex);
            }
        }

        if (input === '?') {
            const current = allHunks.find(
                h => h.diffIndex === selectedHunk.diffIndex && h.hunkIndex === selectedHunk.hunkIndex
            );
            if (current && onAskQuestion) {
                onAskQuestion(current.diff, current.hunkIndex);
            }
        }
    });

    if (diffs.length === 0) {
        return (
            <Box padding={1}>
                <Text color="yellow">No changes to display</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <Text color="cyan" bold>
                    {diffs.length} file(s) changed
                </Text>
                <Text color="gray"> • </Text>
                <Text color="green">+{diffs.reduce((s, d) => s + d.additions, 0)}</Text>
                <Text color="gray"> / </Text>
                <Text color="red">-{diffs.reduce((s, d) => s + d.deletions, 0)}</Text>
                <Text color="gray"> • Use ↑↓/ws to navigate, ? to ask, Enter to expand</Text>
            </Box>

            {/* Diffs */}
            {diffs.map((diff, diffIndex) => (
                <DiffFile
                    key={`${diff.oldFile}-${diff.newFile}`}
                    diff={diff}
                    diffIndex={diffIndex}
                    selectedHunk={selectedHunk}
                    isFocused={isFocused}
                />
            ))}
        </Box>
    );
};

interface DiffFileProps {
    diff: ParsedDiff;
    diffIndex: number;
    selectedHunk: HunkPosition;
    isFocused: boolean;
}

const DiffFile: React.FC<DiffFileProps> = ({ diff, diffIndex, selectedHunk, isFocused }) => {
    const getFileStatus = () => {
        if (diff.isNew) return { text: 'NEW', color: 'green' as const };
        if (diff.isDeleted) return { text: 'DEL', color: 'red' as const };
        if (diff.isRenamed) return { text: 'REN', color: 'yellow' as const };
        return { text: 'MOD', color: 'blue' as const };
    };

    const status = getFileStatus();

    return (
        <Box flexDirection="column" marginBottom={1}>
            {/* File header */}
            <Box>
                <Text color={status.color} bold>[{status.text}]</Text>
                <Text> </Text>
                <Text bold>{diff.newFile}</Text>
                <Text color="gray"> (</Text>
                <Text color="green">+{diff.additions}</Text>
                <Text color="gray">/</Text>
                <Text color="red">-{diff.deletions}</Text>
                <Text color="gray">)</Text>
            </Box>

            {/* Hunks */}
            {diff.hunks.map((hunk, hunkIndex) => {
                const isSelected = selectedHunk.diffIndex === diffIndex && selectedHunk.hunkIndex === hunkIndex;
                return (
                    <HunkView
                        key={hunk.header}
                        hunk={hunk}
                        isSelected={isSelected && isFocused}
                    />
                );
            })}
        </Box>
    );
};

interface HunkViewProps {
    hunk: ParsedHunk;
    isSelected: boolean;
}

const HunkView: React.FC<HunkViewProps> = ({ hunk, isSelected }) => {
    return (
        <Box
            flexDirection="column"
            borderStyle={isSelected ? 'round' : undefined}
            borderColor={isSelected ? 'cyan' : undefined}
            paddingLeft={1}
        >
            {/* Hunk header */}
            <Text color="cyan" dimColor>{hunk.header}</Text>

            {/* Lines */}
            {hunk.lines.map((line, lineIndex) => (
                <DiffLine key={lineIndex} line={line} />
            ))}
        </Box>
    );
};

interface DiffLineProps {
    line: ParsedLine;
}

const DiffLine: React.FC<DiffLineProps> = ({ line }) => {
    const getLinePrefix = () => {
        switch (line.type) {
            case 'add': return '+';
            case 'delete': return '-';
            case 'context': return ' ';
        }
    };

    const getColor = (): 'greenBright' | 'redBright' | 'gray' => {
        switch (line.type) {
            case 'add': return 'greenBright';
            case 'delete': return 'redBright';
            case 'context': return 'gray';
        }
    };

    const lineNum = line.type === 'delete'
        ? (line.oldLineNumber?.toString() || '').padStart(4, ' ')
        : (line.newLineNumber?.toString() || '').padStart(4, ' ');

    return (
        <Box>
            <Text color="gray" dimColor>{lineNum} </Text>
            <Text color={getColor()} dimColor={line.type === 'context'}>
                {getLinePrefix()}{line.content}
            </Text>
        </Box>
    );
};

export default DiffViewer;
