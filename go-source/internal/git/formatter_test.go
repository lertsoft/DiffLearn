package git

import (
	"strings"
	"testing"
)

func TestFormatterMarkdownAndSummary(t *testing.T) {
	diffs := []ParsedDiff{
		{
			OldFile:   "a.txt",
			NewFile:   "a.txt",
			Additions: 2,
			Deletions: 1,
			Hunks: []ParsedHunk{
				{
					Header: "@@ -1,2 +1,3 @@",
					Lines: []ParsedLine{
						{Type: LineContext, Content: "line"},
						{Type: LineDelete, Content: "old"},
						{Type: LineAdd, Content: "new"},
						{Type: LineAdd, Content: "new2"},
					},
				},
			},
		},
	}

	f := NewDiffFormatter()
	md := f.ToMarkdown(diffs)
	if !strings.Contains(md, "# Git Diff Summary") {
		t.Fatalf("expected markdown header, got: %s", md)
	}
	if !strings.Contains(md, "## a.txt") {
		t.Fatalf("expected file header in markdown")
	}
	if !strings.Contains(md, "+new") {
		t.Fatalf("expected added line in markdown")
	}

	summary := f.ToSummary(diffs)
	if !strings.Contains(summary, "1 file(s) changed, +2 -1") {
		t.Fatalf("unexpected summary: %s", summary)
	}
}

