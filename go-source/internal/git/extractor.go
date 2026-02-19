package git

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
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

func normalizeBranchDiffMode(mode BranchDiffMode) BranchDiffMode {
	if mode == BranchModeDouble {
		return BranchModeDouble
	}
	return BranchModeTriple
}

func branchRange(base, target string, mode BranchDiffMode) string {
	if normalizeBranchDiffMode(mode) == BranchModeDouble {
		return base + ".." + target
	}
	return base + "..." + target
}

func (g *GitExtractor) findBranchEntry(branchRef string, branches []BranchEntry) *BranchEntry {
	trimmed := strings.TrimSpace(branchRef)
	if trimmed == "" {
		return nil
	}

	for i := range branches {
		branch := branches[i]
		if branch.Name == trimmed || branch.Ref == trimmed {
			return &branch
		}
		if branch.Kind == BranchKindLocal && "refs/heads/"+branch.Name == trimmed {
			return &branch
		}
		if branch.Kind == BranchKindRemote && "refs/remotes/"+branch.Name == trimmed {
			return &branch
		}
	}

	return nil
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

func (g *GitExtractor) GetBranchDiff(branch1, branch2 string, mode ...BranchDiffMode) ([]ParsedDiff, error) {
	effectiveMode := BranchModeTriple
	if len(mode) > 0 {
		effectiveMode = normalizeBranchDiffMode(mode[0])
	}
	raw, err := g.runGit("diff", branchRange(branch1, branch2, effectiveMode))
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

func (g *GitExtractor) GetBranchesDetailed() ([]BranchEntry, error) {
	currentBranch, _ := g.GetCurrentBranch()
	out, err := g.runGit("for-each-ref", "--format=%(refname)%09%(refname:short)%09%(objectname)", "refs/heads", "refs/remotes")
	if err != nil {
		return nil, err
	}

	localBranches := make(map[string]BranchEntry)
	remoteBranches := make([]BranchEntry, 0)

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}
		ref := parts[0]
		shortName := parts[1]
		commit := ""
		if len(parts) > 2 {
			commit = parts[2]
		}

		if strings.HasSuffix(shortName, "/HEAD") {
			continue
		}

		if strings.HasPrefix(ref, "refs/heads/") {
			localBranches[shortName] = BranchEntry{
				Name:              shortName,
				Ref:               ref,
				Kind:              BranchKindLocal,
				Current:           shortName == currentBranch,
				Remote:            nil,
				LocalName:         shortName,
				NeedsLocalization: false,
				Commit:            commit,
			}
			continue
		}

		if !strings.HasPrefix(ref, "refs/remotes/") {
			continue
		}

		slashIdx := strings.Index(shortName, "/")
		if slashIdx < 0 {
			continue
		}
		remote := shortName[:slashIdx]
		localName := shortName[slashIdx+1:]
		if localName == "" {
			continue
		}

		remoteBranches = append(remoteBranches, BranchEntry{
			Name:              shortName,
			Ref:               ref,
			Kind:              BranchKindRemote,
			Current:           false,
			Remote:            &remote,
			LocalName:         localName,
			NeedsLocalization: false,
			Commit:            commit,
		})
	}

	entries := make([]BranchEntry, 0, len(localBranches)+len(remoteBranches))
	localSet := make(map[string]bool)
	for _, local := range localBranches {
		entries = append(entries, local)
		localSet[local.Name] = true
	}
	for _, remote := range remoteBranches {
		remote.NeedsLocalization = !localSet[remote.LocalName]
		entries = append(entries, remote)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == BranchKindLocal
		}
		return entries[i].Name < entries[j].Name
	})

	return entries, nil
}

func (g *GitExtractor) EnsureLocalBranch(branchRef string) (EnsureBranchResult, error) {
	branches, err := g.GetBranchesDetailed()
	if err != nil {
		return EnsureBranchResult{}, err
	}
	selected := g.findBranchEntry(branchRef, branches)
	if selected == nil {
		return EnsureBranchResult{}, fmt.Errorf("branch not found: %s", branchRef)
	}

	if selected.Kind == BranchKindLocal {
		return EnsureBranchResult{
			Input:               branchRef,
			ResolvedLocalBranch: selected.Name,
			Localized:           false,
			WasRemote:           false,
			RemoteRef:           nil,
		}, nil
	}

	if selected.Remote == nil {
		return EnsureBranchResult{}, fmt.Errorf("remote name missing for branch: %s", selected.Name)
	}

	remoteName := *selected.Remote
	_, err = g.runGit("fetch", remoteName, selected.LocalName)
	if err != nil {
		return EnsureBranchResult{}, err
	}

	localExists := false
	for _, branch := range branches {
		if branch.Kind == BranchKindLocal && branch.Name == selected.LocalName {
			localExists = true
			break
		}
	}

	localized := false
	if !localExists {
		_, err = g.runGit("branch", "--track", selected.LocalName, remoteName+"/"+selected.LocalName)
		if err != nil && !strings.Contains(err.Error(), "already exists") {
			return EnsureBranchResult{}, err
		}
		localized = true
	}

	action := "resolved to local branch"
	if localized {
		action = "created a local tracking branch"
	}
	message := fmt.Sprintf("DiffLearn fetched %s and %s %s for comparison and learning.", selected.Name, action, selected.LocalName)
	remoteRef := selected.Name

	return EnsureBranchResult{
		Input:               branchRef,
		ResolvedLocalBranch: selected.LocalName,
		Localized:           localized,
		WasRemote:           true,
		RemoteRef:           &remoteRef,
		Message:             message,
	}, nil
}

func (g *GitExtractor) SwitchBranch(branchRef string, options SwitchBranchOptions) (SwitchBranchResult, error) {
	previousBranch, err := g.GetCurrentBranch()
	if err != nil {
		return SwitchBranchResult{}, err
	}

	enabledAutoStash := options.AutoStash

	ensured, err := g.EnsureLocalBranch(branchRef)
	if err != nil {
		return SwitchBranchResult{}, err
	}

	messages := make([]string, 0)
	if ensured.Message != "" {
		messages = append(messages, ensured.Message)
	}

	stashCreated := false
	var stashMessage *string

	if enabledAutoStash {
		status, err := g.runGit("status", "--porcelain")
		if err != nil {
			return SwitchBranchResult{}, err
		}
		if strings.TrimSpace(status) != "" {
			msg := fmt.Sprintf("DiffLearn auto-stash before switching to %s at %s", ensured.ResolvedLocalBranch, time.Now().UTC().Format(time.RFC3339))
			out, err := g.runGit("stash", "push", "-u", "-m", msg)
			if err != nil {
				return SwitchBranchResult{}, err
			}
			if !strings.Contains(out, "No local changes to save") {
				stashCreated = true
				stashMessage = &msg
				messages = append(messages, "Created stash: "+msg)
			}
		}
	}

	_, err = g.runGit("checkout", ensured.ResolvedLocalBranch)
	if err != nil {
		return SwitchBranchResult{}, err
	}

	currentBranch, err := g.GetCurrentBranch()
	if err != nil {
		return SwitchBranchResult{}, err
	}
	messages = append(messages, fmt.Sprintf("Switched from %s to %s.", previousBranch, currentBranch))

	var localizedBranch *string
	if ensured.Localized {
		localizedBranch = &ensured.ResolvedLocalBranch
	}

	return SwitchBranchResult{
		PreviousBranch:  previousBranch,
		CurrentBranch:   currentBranch,
		StashCreated:    stashCreated,
		StashMessage:    stashMessage,
		LocalizedBranch: localizedBranch,
		Messages:        messages,
	}, nil
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
		mode := BranchModeTriple
		if options["branchMode"] == "double" {
			mode = BranchModeDouble
		}
		return g.runGit("diff", branchRange(b1, b2, mode))
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
