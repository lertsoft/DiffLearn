import { ParsedDiff } from '../git';
import { DiffFormatter } from '../git/formatter';

const formatter = new DiffFormatter();

/**
 * System prompt for diff analysis
 */
export const SYSTEM_PROMPT = `You are DiffLearn, an expert code reviewer and teacher. Your role is to help developers understand git diffs and code changes.

When analyzing diffs:
- Explain what changed in clear, accessible language
- Highlight potential issues, bugs, or improvements
- Note any patterns or best practices (or violations)
- Be concise but thorough

Format:
- In diffs, lines starting with '+' are additions (shown in green)
- Lines starting with '-' are deletions (shown in red)
- Lines starting with ' ' are context (unchanged)

Output Format:
- Use Markdown for formatting
- Use **bold** for emphasis and important terms
- Use \`code blocks\` for code snippets
- Use lists for readability

Keep responses focused and actionable.`;

/**
 * Create a prompt for explaining a diff
 */
export function createExplainPrompt(diffs: ParsedDiff[]): string {
    const diffMarkdown = formatter.toMarkdown(diffs);

    return `Please explain the following code changes. Describe what was changed, why it might have been changed, and any implications:

${diffMarkdown}

Provide a clear, structured explanation that would help someone understand these changes quickly.`;
}

/**
 * Create a prompt for code review
 */
export function createReviewPrompt(diffs: ParsedDiff[]): string {
    const diffMarkdown = formatter.toMarkdown(diffs);

    return `Please review the following code changes. Look for:
- Potential bugs or errors
- Security concerns
- Performance issues
- Code style and best practices
- Suggestions for improvement

${diffMarkdown}

Provide constructive feedback organized by severity (critical, important, minor).`;
}

/**
 * Create a prompt for summarizing changes
 */
export function createSummaryPrompt(diffs: ParsedDiff[]): string {
    const diffMarkdown = formatter.toMarkdown(diffs);

    return `Please provide a brief summary of these changes in 2-3 sentences. Focus on the main purpose and impact:

${diffMarkdown}`;
}

/**
 * Create a prompt for asking questions about a specific change
 */
export function createQuestionPrompt(diffs: ParsedDiff[], question: string): string {
    const diffMarkdown = formatter.toMarkdown(diffs);

    return `Given the following code changes:

${diffMarkdown}

User question: ${question}

Please answer the question based on the diff context provided.`;
}

/**
 * Create a prompt for asking about a specific line/hunk
 */
export function createLineQuestionPrompt(
    diff: ParsedDiff,
    hunkIndex: number,
    question: string
): string {
    const hunk = diff.hunks[hunkIndex];
    if (!hunk) {
        return createQuestionPrompt([diff], question);
    }

    const hunkLines = hunk.lines.map(line => {
        const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
        return prefix + line.content;
    }).join('\n');

    return `In file \`${diff.newFile}\`, looking at this specific change:

\`\`\`diff
${hunk.header}
${hunkLines}
\`\`\`

User question: ${question}

Please answer focusing on this specific change.`;
}

/**
 * Create a prompt for impact analysis
 */
export function createImpactPrompt(diffs: ParsedDiff[]): string {
    const diffMarkdown = formatter.toMarkdown(diffs);

    return `Analyze the potential impact of these changes:

${diffMarkdown}

Consider:
1. What functionality is affected?
2. Are there any breaking changes?
3. What tests might need to be updated?
4. Are there any dependencies that could be impacted?`;
}
