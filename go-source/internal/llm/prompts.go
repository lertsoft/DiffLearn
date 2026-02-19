package llm

import (
	"fmt"

	"difflearn-go/internal/git"
)

var SystemPrompt = `You are DiffLearn, an expert code reviewer and teacher. Your role is to help developers understand git diffs and code changes.

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
- Use ` + "`code blocks`" + ` for code snippets
- Use lists for readability

Keep responses focused and actionable.`

func CreateExplainPrompt(formatter *git.DiffFormatter, diffs []git.ParsedDiff) string {
	diffMarkdown := formatter.ToMarkdown(diffs)
	return fmt.Sprintf("Please explain the following code changes. Describe what was changed, why it might have been changed, and any implications:\n\n%s\n\nProvide a clear, structured explanation that would help someone understand these changes quickly.", diffMarkdown)
}

func CreateReviewPrompt(formatter *git.DiffFormatter, diffs []git.ParsedDiff) string {
	diffMarkdown := formatter.ToMarkdown(diffs)
	return fmt.Sprintf("Please review the following code changes. Look for:\n- Potential bugs or errors\n- Security concerns\n- Performance issues\n- Code style and best practices\n- Suggestions for improvement\n\n%s\n\nProvide constructive feedback organized by severity (critical, important, minor).", diffMarkdown)
}

func CreateSummaryPrompt(formatter *git.DiffFormatter, diffs []git.ParsedDiff) string {
	diffMarkdown := formatter.ToMarkdown(diffs)
	return fmt.Sprintf("Please provide a brief summary of these changes in 2-3 sentences. Focus on the main purpose and impact:\n\n%s", diffMarkdown)
}

func CreateQuestionPrompt(formatter *git.DiffFormatter, diffs []git.ParsedDiff, question string) string {
	diffMarkdown := formatter.ToMarkdown(diffs)
	return fmt.Sprintf("Given the following code changes:\n\n%s\n\nUser question: %s\n\nPlease answer the question based on the diff context provided.", diffMarkdown, question)
}

func CreateLineQuestionPrompt(diff git.ParsedDiff, hunkIndex int, question string) string {
	if hunkIndex < 0 || hunkIndex >= len(diff.Hunks) {
		return CreateQuestionPrompt(git.NewDiffFormatter(), []git.ParsedDiff{diff}, question)
	}
	h := diff.Hunks[hunkIndex]
	lines := ""
	for _, l := range h.Lines {
		prefix := " "
		if l.Type == git.LineAdd {
			prefix = "+"
		}
		if l.Type == git.LineDelete {
			prefix = "-"
		}
		lines += prefix + l.Content + "\n"
	}
	return fmt.Sprintf("In file `%s`, looking at this specific change:\n\n```diff\n%s\n%s```\n\nUser question: %s\n\nPlease answer focusing on this specific change.", diff.NewFile, h.Header, lines, question)
}
