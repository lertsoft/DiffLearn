package git

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

type DiffOptions struct {
	Staged  bool
	Context int
}

type GitExtractor struct {
	repoPath string
	parser   *DiffParser
}

func NewGitExtractor(repoPath string) *GitExtractor {
	if repoPath == "" {
		repoPath = "."
	}
	return &GitExtractor{repoPath: repoPath, parser: NewDiffParser()}
}

func (g *GitExtractor) runGit(args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = g.repoPath
	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("git %s failed: %s", strings.Join(args, " "), msg)
	}
	return out.String(), nil
}

func (g *GitExtractor) GetLocalDiff(options DiffOptions) ([]ParsedDiff, error) {
	ctx := options.Context
	if ctx == 0 {
		ctx = 3
	}
	args := []string{"diff", fmt.Sprintf("-U%d", ctx)}
	if options.Staged {
		args = []string{"diff", "--cached", fmt.Sprintf("-U%d", ctx)}
	}
	raw, err := g.runGit(args...)
	if err != nil {
		return nil, err
	}
	return g.parser.Parse(raw), nil
}

func (g *GitExtractor) GetAllLocalChanges() (staged, unstaged []ParsedDiff, err error) {
	staged, err = g.GetLocalDiff(DiffOptions{Staged: true})
	if err != nil {
		return nil, nil, err
	}
	unstaged, err = g.GetLocalDiff(DiffOptions{Staged: false})
	return staged, unstaged, err
}

func (g *GitExtractor) GetCommitDiff(commit1 string, commit2 string) ([]ParsedDiff, error) {
	rangeArg := commit1 + "^.." + commit1
	if commit2 != "" {
		rangeArg = commit1 + ".." + commit2
	}
	raw, err := g.runGit("diff", rangeArg)
	if err != nil {
		return nil, err
	}
	return g.parser.Parse(raw), nil
}

func (g *GitExtractor) GetBranchDiff(branch1, branch2 string) ([]ParsedDiff, error) {
	raw, err := g.runGit("diff", branch1+"..."+branch2)
	if err != nil {
		return nil, err
	}
	return g.parser.Parse(raw), nil
}

func (g *GitExtractor) GetFileDiff(filePath, commit string) ([]ParsedDiff, error) {
	if commit != "" {
		raw, err := g.runGit("diff", commit+"^.."+commit, "--", filePath)
		if err != nil {
			return nil, err
		}
		return g.parser.Parse(raw), nil
	}
	raw, err := g.runGit("diff", "--", filePath)
	if err != nil {
		return nil, err
	}
	return g.parser.Parse(raw), nil
}

func (g *GitExtractor) GetCommitHistory(limit int) ([]CommitInfo, error) {
	if limit <= 0 {
		limit = 20
	}
	format := `%H%x1f%aI%x1f%s%x1f%an`
	out, err := g.runGit("log", fmt.Sprintf("--max-count=%d", limit), "--name-only", "--pretty=format:"+format)
	if err != nil {
		return nil, err
	}

	commits := make([]CommitInfo, 0)
	blocks := strings.Split(out, "\n\n")
	for _, b := range blocks {
		lines := strings.Split(strings.TrimSpace(b), "\n")
		if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
			continue
		}
		parts := strings.Split(lines[0], "\x1f")
		if len(parts) < 4 {
			continue
		}
		files := make([]string, 0)
		for _, f := range lines[1:] {
			f = strings.TrimSpace(f)
			if f != "" {
				files = append(files, f)
			}
		}
		commits = append(commits, CommitInfo{
			Hash:    parts[0],
			Date:    parts[1],
			Message: parts[2],
			Author:  parts[3],
			Files:   files,
		})
	}
	return commits, nil
}

func (g *GitExtractor) GetBranches() ([]BranchInfo, error) {
	out, err := g.runGit("branch", "-vv", "--no-abbrev")
	if err != nil {
		return nil, err
	}
	branches := make([]BranchInfo, 0)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		current := strings.HasPrefix(line, "*")
		if current {
			line = strings.TrimSpace(strings.TrimPrefix(line, "*"))
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		branches = append(branches, BranchInfo{Name: parts[0], Current: current, Commit: parts[1]})
	}
	return branches, nil
}

func (g *GitExtractor) GetCurrentBranch() (string, error) {
	out, err := g.runGit("rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

func (g *GitExtractor) IsRepo() bool {
	cmd := exec.Command("git", "rev-parse", "--is-inside-work-tree")
	cmd.Dir = g.repoPath
	return cmd.Run() == nil
}

func (g *GitExtractor) GetRawDiff(kind string, options map[string]string) (string, error) {
	switch kind {
	case "local":
		return g.runGit("diff")
	case "staged":
		return g.runGit("diff", "--cached")
	case "commit":
		c1 := options["commit1"]
		if c1 == "" {
			return "", fmt.Errorf("commit1 is required")
		}
		r := c1 + "^.." + c1
		if c2 := options["commit2"]; c2 != "" {
			r = c1 + ".." + c2
		}
		return g.runGit("diff", r)
	case "branch":
		b1, b2 := options["branch1"], options["branch2"]
		if b1 == "" || b2 == "" {
			return "", fmt.Errorf("branch1 and branch2 are required")
		}
		return g.runGit("diff", b1+"..."+b2)
	default:
		return "", fmt.Errorf("unknown diff type: %s", kind)
	}
}

func (g *GitExtractor) RepoPath() string {
	abs, err := filepath.Abs(g.repoPath)
	if err != nil {
		return g.repoPath
	}
	return abs
}

func MarshalJSON(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}
