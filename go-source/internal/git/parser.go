package git

import (
	"regexp"
	"strconv"
	"strings"
)

type DiffParser struct{}

func NewDiffParser() *DiffParser { return &DiffParser{} }

func (p *DiffParser) Parse(rawDiff string) []ParsedDiff {
	if strings.TrimSpace(rawDiff) == "" {
		return []ParsedDiff{}
	}

	parts := p.splitByFile(rawDiff)
	diffs := make([]ParsedDiff, 0, len(parts))
	for _, part := range parts {
		if parsed, ok := p.parseFileDiff(part); ok {
			diffs = append(diffs, parsed)
		}
	}
	return diffs
}

func (p *DiffParser) splitByFile(rawDiff string) []string {
	r := regexp.MustCompile(`(?m)^diff --git `)
	idxs := r.FindAllStringIndex(rawDiff, -1)
	if len(idxs) == 0 {
		return nil
	}
	out := make([]string, 0, len(idxs))
	for i := range idxs {
		start := idxs[i][0]
		end := len(rawDiff)
		if i+1 < len(idxs) {
			end = idxs[i+1][0]
		}
		out = append(out, rawDiff[start:end])
	}
	return out
}

func (p *DiffParser) parseFileDiff(fileDiff string) (ParsedDiff, bool) {
	lines := strings.Split(fileDiff, "\n")
	if len(lines) == 0 {
		return ParsedDiff{}, false
	}

	headerRe := regexp.MustCompile(`^diff --git a/(.+?) b/(.+)$`)
	hm := headerRe.FindStringSubmatch(lines[0])
	if len(hm) != 3 {
		return ParsedDiff{}, false
	}

	oldFile, newFile := hm[1], hm[2]
	isBinary := strings.Contains(fileDiff, "Binary files")
	isNew := strings.Contains(fileDiff, "new file mode")
	isDeleted := strings.Contains(fileDiff, "deleted file mode")
	isRenamed := strings.Contains(fileDiff, "rename from") || oldFile != newFile

	hunks := make([]ParsedHunk, 0)
	var current *ParsedHunk
	oldLineNum, newLineNum := 0, 0
	hunkRe := regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$`)

	for _, line := range lines {
		if m := hunkRe.FindStringSubmatch(line); len(m) > 0 {
			if current != nil {
				hunks = append(hunks, *current)
			}
			oldStart, _ := strconv.Atoi(m[1])
			oldLines := 1
			if m[2] != "" {
				oldLines, _ = strconv.Atoi(m[2])
			}
			newStart, _ := strconv.Atoi(m[3])
			newLines := 1
			if m[4] != "" {
				newLines, _ = strconv.Atoi(m[4])
			}
			oldLineNum, newLineNum = oldStart, newStart
			current = &ParsedHunk{
				OldStart: oldStart,
				OldLines: oldLines,
				NewStart: newStart,
				NewLines: newLines,
				Header:   line,
				Lines:    make([]ParsedLine, 0),
			}
			continue
		}

		if current == nil {
			continue
		}

		switch {
		case strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++"):
			n := newLineNum
			current.Lines = append(current.Lines, ParsedLine{Type: LineAdd, Content: strings.TrimPrefix(line, "+"), NewLineNumber: &n})
			newLineNum++
		case strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---"):
			n := oldLineNum
			current.Lines = append(current.Lines, ParsedLine{Type: LineDelete, Content: strings.TrimPrefix(line, "-"), OldLineNumber: &n})
			oldLineNum++
		case strings.HasPrefix(line, " "):
			o, n := oldLineNum, newLineNum
			current.Lines = append(current.Lines, ParsedLine{Type: LineContext, Content: strings.TrimPrefix(line, " "), OldLineNumber: &o, NewLineNumber: &n})
			oldLineNum++
			newLineNum++
		}
	}
	if current != nil {
		hunks = append(hunks, *current)
	}

	adds, dels := 0, 0
	for _, h := range hunks {
		for _, l := range h.Lines {
			if l.Type == LineAdd {
				adds++
			}
			if l.Type == LineDelete {
				dels++
			}
		}
	}

	return ParsedDiff{
		OldFile:   oldFile,
		NewFile:   newFile,
		Hunks:     hunks,
		IsBinary:  isBinary,
		IsNew:     isNew,
		IsDeleted: isDeleted,
		IsRenamed: isRenamed,
		Additions: adds,
		Deletions: dels,
	}, true
}

func (p *DiffParser) GetStats(diffs []ParsedDiff) DiffStats {
	stats := DiffStats{Files: len(diffs)}
	for _, d := range diffs {
		stats.Additions += d.Additions
		stats.Deletions += d.Deletions
	}
	return stats
}
