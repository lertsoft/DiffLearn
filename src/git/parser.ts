export interface ParsedLine {
    type: 'add' | 'delete' | 'context';
    content: string;
    oldLineNumber?: number;
    newLineNumber?: number;
}

export interface ParsedHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    header: string;
    lines: ParsedLine[];
}

export interface ParsedDiff {
    oldFile: string;
    newFile: string;
    hunks: ParsedHunk[];
    isBinary: boolean;
    isNew: boolean;
    isDeleted: boolean;
    isRenamed: boolean;
    additions: number;
    deletions: number;
}

export interface DiffStats {
    files: number;
    additions: number;
    deletions: number;
}

export class DiffParser {
    /**
     * Parse unified diff format into structured data
     */
    parse(rawDiff: string): ParsedDiff[] {
        if (!rawDiff.trim()) {
            return [];
        }

        const diffs: ParsedDiff[] = [];
        const fileDiffs = this.splitByFile(rawDiff);

        for (const fileDiff of fileDiffs) {
            const parsed = this.parseFileDiff(fileDiff);
            if (parsed) {
                diffs.push(parsed);
            }
        }

        return diffs;
    }

    /**
     * Split raw diff into individual file diffs
     */
    private splitByFile(rawDiff: string): string[] {
        const parts = rawDiff.split(/^diff --git /m);
        return parts.filter(part => part.trim()).map(part => 'diff --git ' + part);
    }

    /**
     * Parse a single file's diff
     */
    private parseFileDiff(fileDiff: string): ParsedDiff | null {
        const lines = fileDiff.split('\n');

        // Extract file names from the diff header
        const headerMatch = lines[0]?.match(/^diff --git a\/(.+?) b\/(.+)$/);
        if (!headerMatch) {
            return null;
        }

        const oldFile = headerMatch[1];
        const newFile = headerMatch[2];

        // Check for special cases
        const isBinary = fileDiff.includes('Binary files');
        const isNew = fileDiff.includes('new file mode');
        const isDeleted = fileDiff.includes('deleted file mode');
        const isRenamed = fileDiff.includes('rename from') || oldFile !== newFile;

        // Parse hunks
        const hunks: ParsedHunk[] = [];
        let currentHunk: ParsedHunk | null = null;
        let oldLineNum = 0;
        let newLineNum = 0;

        for (const line of lines) {
            // Hunk header: @@ -start,lines +start,lines @@
            const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);

            if (hunkMatch) {
                if (currentHunk) {
                    hunks.push(currentHunk);
                }

                oldLineNum = parseInt(hunkMatch[1], 10);
                newLineNum = parseInt(hunkMatch[3], 10);

                currentHunk = {
                    oldStart: oldLineNum,
                    oldLines: parseInt(hunkMatch[2] || '1', 10),
                    newStart: newLineNum,
                    newLines: parseInt(hunkMatch[4] || '1', 10),
                    header: line,
                    lines: [],
                };
                continue;
            }

            if (currentHunk) {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentHunk.lines.push({
                        type: 'add',
                        content: line.slice(1),
                        newLineNumber: newLineNum++,
                    });
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentHunk.lines.push({
                        type: 'delete',
                        content: line.slice(1),
                        oldLineNumber: oldLineNum++,
                    });
                } else if (line.startsWith(' ')) {
                    currentHunk.lines.push({
                        type: 'context',
                        content: line.slice(1),
                        oldLineNumber: oldLineNum++,
                        newLineNumber: newLineNum++,
                    });
                }
            }
        }

        if (currentHunk) {
            hunks.push(currentHunk);
        }

        // Calculate stats
        let additions = 0;
        let deletions = 0;
        for (const hunk of hunks) {
            for (const line of hunk.lines) {
                if (line.type === 'add') additions++;
                if (line.type === 'delete') deletions++;
            }
        }

        return {
            oldFile,
            newFile,
            hunks,
            isBinary,
            isNew,
            isDeleted,
            isRenamed,
            additions,
            deletions,
        };
    }

    /**
     * Get overall stats for a set of parsed diffs
     */
    getStats(diffs: ParsedDiff[]): DiffStats {
        return {
            files: diffs.length,
            additions: diffs.reduce((sum, d) => sum + d.additions, 0),
            deletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
        };
    }

    /**
     * Convert parsed diff back to unified format string
     */
    toUnifiedFormat(diff: ParsedDiff): string {
        const lines: string[] = [];

        lines.push(`diff --git a/${diff.oldFile} b/${diff.newFile}`);

        if (diff.isNew) {
            lines.push('new file mode 100644');
        } else if (diff.isDeleted) {
            lines.push('deleted file mode 100644');
        }

        lines.push(`--- ${diff.isNew ? '/dev/null' : 'a/' + diff.oldFile}`);
        lines.push(`+++ ${diff.isDeleted ? '/dev/null' : 'b/' + diff.newFile}`);

        for (const hunk of diff.hunks) {
            lines.push(hunk.header);
            for (const line of hunk.lines) {
                const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
                lines.push(prefix + line.content);
            }
        }

        return lines.join('\n');
    }
}
