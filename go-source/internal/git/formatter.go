package git

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/fatih/color"
)

type FormatterOptions struct {
	ShowLineNumbers bool
	ShowStats       bool
}

type DiffFormatter struct{}

func NewDiffFormatter() *DiffFormatter { return &DiffFormatter{} }

func (f *DiffFormatter) ToTerminal(diffs []ParsedDiff, options FormatterOptions) string {
	showLineNumbers := true
	showStats := true
	if options.ShowLineNumbers == false {
		showLineNumbers = false
	}
	if options.ShowStats == false {
		showStats = false
	}

	out := make([]string, 0)
	for _, diff := range diffs {
		out = append(out, color.New(color.Bold).Sprint(strings.Repeat("─", 60)))
		out = append(out, f.formatFileHeader(diff))
		if showStats {
			out = append(out, fmt.Sprintf("  %s %s", color.GreenString("+%d", diff.Additions), color.RedString("-%d", diff.Deletions)))
		}
		out = append(out, "")
		for _, h := range diff.Hunks {
			out = append(out, color.CyanString(h.Header))
			for _, line := range h.Lines {
				out = append(out, f.formatLine(line, showLineNumbers))
			}
			out = append(out, "")
		}
	}
	return strings.Join(out, "\n")
}

func (f *DiffFormatter) formatFileHeader(diff ParsedDiff) string {
	switch {
	case diff.IsNew:
		return color.New(color.FgGreen, color.Bold).Sprintf("+ New: %s", diff.NewFile)
	case diff.IsDeleted:
		return color.New(color.FgRed, color.Bold).Sprintf("- Deleted: %s", diff.OldFile)
	case diff.IsRenamed:
		return color.New(color.FgYellow, color.Bold).Sprintf("→ Renamed: %s → %s", diff.OldFile, diff.NewFile)
	default:
		return color.New(color.FgBlue, color.Bold).Sprintf("Modified: %s", diff.NewFile)
	}
}

func (f *DiffFormatter) formatLine(line ParsedLine, showLineNumbers bool) string {
	lineNum := ""
	if showLineNumbers {
		oldNum := "    "
		newNum := "    "
		if line.OldLineNumber != nil {
			oldNum = fmt.Sprintf("%4d", *line.OldLineNumber)
		}
		if line.NewLineNumber != nil {
			newNum = fmt.Sprintf("%4d", *line.NewLineNumber)
		}
		lineNum = color.HiBlackString("%s %s │ ", oldNum, newNum)
	}
	prefix := " "
	if line.Type == LineAdd {
		prefix = "+"
	}
	if line.Type == LineDelete {
		prefix = "-"
	}
	content := prefix + line.Content
	switch line.Type {
	case LineAdd:
		return lineNum + color.GreenString(content)
	case LineDelete:
		return lineNum + color.RedString(content)
	default:
		return lineNum + color.HiBlackString(content)
	}
}

func (f *DiffFormatter) ToMarkdown(diffs []ParsedDiff) string {
	out := make([]string, 0)
	out = append(out, "# Git Diff Summary", "")
	adds, dels := 0, 0
	for _, d := range diffs {
		adds += d.Additions
		dels += d.Deletions
	}
	out = append(out, fmt.Sprintf("**Files changed:** %d", len(diffs)))
	out = append(out, fmt.Sprintf("**Additions:** +%d | **Deletions:** -%d", adds, dels), "")

	for _, d := range diffs {
		status := ""
		if d.IsNew {
			status = "(new)"
		} else if d.IsDeleted {
			status = "(deleted)"
		} else if d.IsRenamed {
			status = "(renamed)"
		}
		out = append(out, fmt.Sprintf("## %s %s", d.NewFile, status))
		if d.Additions > 0 || d.Deletions > 0 {
			out = append(out, fmt.Sprintf("*+%d -%d*", d.Additions, d.Deletions), "")
		}
		out = append(out, "```diff")
		for _, h := range d.Hunks {
			out = append(out, h.Header)
			for _, line := range h.Lines {
				prefix := " "
				if line.Type == LineAdd {
					prefix = "+"
				}
				if line.Type == LineDelete {
					prefix = "-"
				}
				out = append(out, prefix+line.Content)
			}
		}
		out = append(out, "```", "")
	}
	return strings.Join(out, "\n")
}

func (f *DiffFormatter) ToJSON(diffs []ParsedDiff) string {
	payload := map[string]any{
		"summary": map[string]any{
			"files":     len(diffs),
			"additions": sumAdds(diffs),
			"deletions": sumDels(diffs),
		},
		"files": diffs,
	}
	b, _ := json.MarshalIndent(payload, "", "  ")
	return string(b)
}

func (f *DiffFormatter) ToSummary(diffs []ParsedDiff) string {
	files := len(diffs)
	adds, dels := sumAdds(diffs), sumDels(diffs)
	list := make([]string, 0, len(diffs))
	for _, d := range diffs {
		status := "M "
		if d.IsNew {
			status = "+ "
		} else if d.IsDeleted {
			status = "- "
		} else if d.IsRenamed {
			status = "→ "
		}
		list = append(list, status+d.NewFile)
	}
	return fmt.Sprintf("%d file(s) changed, +%d -%d\n\n%s", files, adds, dels, strings.Join(list, "\n"))
}

func sumAdds(diffs []ParsedDiff) int {
	t := 0
	for _, d := range diffs {
		t += d.Additions
	}
	return t
}

func sumDels(diffs []ParsedDiff) int {
	t := 0
	for _, d := range diffs {
		t += d.Deletions
	}
	return t
}
