package llm

import (
	"strings"
	"testing"

	"difflearn-go/internal/git"
)

func sampleDiff() git.ParsedDiff {
	return git.ParsedDiff{
		NewFile: "main.go",
		Hunks: []git.ParsedHunk{
			{
				Header: "@@ -1,1 +1,2 @@",
				Lines: []git.ParsedLine{
					{Type: git.LineDelete, Content: "old()"},
					{Type: git.LineAdd, Content: "new()"},
				},
			},
		},
		Additions: 1,
		Deletions: 1,
	}
}

func TestCreatePromptVariants(t *testing.T) {
	f := git.NewDiffFormatter()
	diffs := []git.ParsedDiff{sampleDiff()}

	explain := CreateExplainPrompt(f, diffs)
	review := CreateReviewPrompt(f, diffs)
	summary := CreateSummaryPrompt(f, diffs)
	question := CreateQuestionPrompt(f, diffs, "why?")

	for name, prompt := range map[string]string{
		"explain":  explain,
		"review":   review,
		"summary":  summary,
		"question": question,
	} {
		if !strings.Contains(prompt, "main.go") {
			t.Fatalf("%s prompt missing file context", name)
		}
	}
	if !strings.Contains(review, "severity") {
		t.Fatalf("review prompt missing guidance")
	}
}

func TestCreateLineQuestionPrompt(t *testing.T) {
	prompt := CreateLineQuestionPrompt(sampleDiff(), 0, "is this safe?")
	if !strings.Contains(prompt, "In file `main.go`") {
		t.Fatalf("line question missing file name")
	}
	if !strings.Contains(prompt, "is this safe?") {
		t.Fatalf("line question missing user question")
	}
}

