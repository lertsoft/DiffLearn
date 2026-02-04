import chalk from 'chalk';
import { ParsedDiff } from './parser';
import type { ParsedLine } from './parser';

export type OutputFormat = 'terminal' | 'markdown' | 'json';

export interface FormatterOptions {
    showLineNumbers?: boolean;
    showStats?: boolean;
    contextLines?: number;
}

export class DiffFormatter {
    /**
     * Format diff for terminal display with colors
     */
    toTerminal(diffs: ParsedDiff[], options: FormatterOptions = {}): string {
        const { showLineNumbers = true, showStats = true } = options;
        const output: string[] = [];

        for (const diff of diffs) {
            // File header
            output.push(chalk.bold.white('─'.repeat(60)));
            output.push(this.formatFileHeader(diff));

            if (showStats) {
                output.push(this.formatStats(diff.additions, diff.deletions));
            }
            output.push('');

            // Hunks
            for (const hunk of diff.hunks) {
                output.push(chalk.cyan(hunk.header));

                for (const line of hunk.lines) {
                    output.push(this.formatLine(line, showLineNumbers));
                }
                output.push('');
            }
        }

        return output.join('\n');
    }

    /**
     * Format file header with appropriate color
     */
    private formatFileHeader(diff: ParsedDiff): string {
        if (diff.isNew) {
            return chalk.green.bold(`+ New: ${diff.newFile}`);
        } else if (diff.isDeleted) {
            return chalk.red.bold(`- Deleted: ${diff.oldFile}`);
        } else if (diff.isRenamed) {
            return chalk.yellow.bold(`→ Renamed: ${diff.oldFile} → ${diff.newFile}`);
        } else {
            return chalk.blue.bold(`Modified: ${diff.newFile}`);
        }
    }

    /**
     * Format stats line
     */
    private formatStats(additions: number, deletions: number): string {
        const addStr = chalk.green(`+${additions}`);
        const delStr = chalk.red(`-${deletions}`);
        return `  ${addStr} ${delStr}`;
    }

    /**
     * Format a single diff line with color
     */
    private formatLine(line: ParsedLine, showLineNumbers: boolean): string {
        let lineNum = '';

        if (showLineNumbers) {
            const oldNum = line.oldLineNumber?.toString().padStart(4, ' ') || '    ';
            const newNum = line.newLineNumber?.toString().padStart(4, ' ') || '    ';
            lineNum = chalk.gray(`${oldNum} ${newNum} │ `);
        }

        const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
        const content = prefix + line.content;

        switch (line.type) {
            case 'add':
                return lineNum + chalk.green(content);
            case 'delete':
                return lineNum + chalk.red(content);
            case 'context':
                return lineNum + chalk.gray(content);
        }
    }

    /**
     * Format diff as markdown (for LLM consumption)
     */
    toMarkdown(diffs: ParsedDiff[], options: FormatterOptions = {}): string {
        const { showStats = true } = options;
        const output: string[] = [];

        output.push('# Git Diff Summary\n');

        // Overall stats
        const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0);
        const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0);
        output.push(`**Files changed:** ${diffs.length}`);
        output.push(`**Additions:** +${totalAdditions} | **Deletions:** -${totalDeletions}\n`);

        for (const diff of diffs) {
            // File header
            const status = diff.isNew ? '(new)' : diff.isDeleted ? '(deleted)' : diff.isRenamed ? '(renamed)' : '';
            output.push(`## ${diff.newFile} ${status}`);

            if (showStats && (diff.additions > 0 || diff.deletions > 0)) {
                output.push(`*+${diff.additions} -${diff.deletions}*\n`);
            }

            // Code block with diff
            output.push('```diff');
            for (const hunk of diff.hunks) {
                output.push(hunk.header);
                for (const line of hunk.lines) {
                    const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
                    output.push(prefix + line.content);
                }
            }
            output.push('```\n');
        }

        return output.join('\n');
    }

    /**
     * Format diff as JSON (for API responses)
     */
    toJSON(diffs: ParsedDiff[]): string {
        return JSON.stringify({
            summary: {
                files: diffs.length,
                additions: diffs.reduce((sum, d) => sum + d.additions, 0),
                deletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
            },
            files: diffs,
        }, null, 2);
    }

    /**
     * Create a compact summary string
     */
    toSummary(diffs: ParsedDiff[]): string {
        const files = diffs.length;
        const additions = diffs.reduce((sum, d) => sum + d.additions, 0);
        const deletions = diffs.reduce((sum, d) => sum + d.deletions, 0);

        const fileList = diffs.map(d => {
            const status = d.isNew ? '+ ' : d.isDeleted ? '- ' : d.isRenamed ? '→ ' : 'M ';
            return `${status}${d.newFile}`;
        });

        return `${files} file(s) changed, +${additions} -${deletions}\n\n${fileList.join('\n')}`;
    }
}
