package git

import (
	"strings"
	"testing"
)

func testExtractor() *GitExtractor {
	return NewGitExtractor("../../..")
}

func TestGetBranchesDetailed(t *testing.T) {
	g := testExtractor()
	branches, err := g.GetBranchesDetailed()
	if err != nil {
		t.Fatalf("GetBranchesDetailed() error = %v", err)
	}
	if len(branches) == 0 {
		t.Fatalf("expected branches, got none")
	}
	first := branches[0]
	if first.Name == "" || first.Ref == "" || first.LocalName == "" {
		t.Fatalf("expected branch metadata fields to be populated: %+v", first)
	}
}

func TestEnsureLocalBranchOnCurrentBranch(t *testing.T) {
	g := testExtractor()
	current, err := g.GetCurrentBranch()
	if err != nil {
		t.Fatalf("GetCurrentBranch() error = %v", err)
	}

	resolved, err := g.EnsureLocalBranch(current)
	if err != nil {
		t.Fatalf("EnsureLocalBranch() error = %v", err)
	}
	if resolved.ResolvedLocalBranch != current {
		t.Fatalf("expected resolved branch %s, got %s", current, resolved.ResolvedLocalBranch)
	}
	if resolved.WasRemote {
		t.Fatalf("expected local branch resolution")
	}
}

func TestGetBranchDiffSupportsModes(t *testing.T) {
	g := testExtractor()
	current, err := g.GetCurrentBranch()
	if err != nil {
		t.Fatalf("GetCurrentBranch() error = %v", err)
	}

	triple, err := g.GetBranchDiff(current, current, BranchModeTriple)
	if err != nil {
		t.Fatalf("GetBranchDiff triple error = %v", err)
	}
	double, err := g.GetBranchDiff(current, current, BranchModeDouble)
	if err != nil {
		t.Fatalf("GetBranchDiff double error = %v", err)
	}

	if triple == nil || double == nil {
		t.Fatalf("expected diff slices")
	}
}

func TestSwitchBranchReturnsMetadata(t *testing.T) {
	g := testExtractor()
	current, err := g.GetCurrentBranch()
	if err != nil {
		t.Fatalf("GetCurrentBranch() error = %v", err)
	}

	result, err := g.SwitchBranch(current, SwitchBranchOptions{AutoStash: false})
	if err != nil {
		// Some restricted environments deny writes to .git/index.lock during checkout.
		if !strings.Contains(err.Error(), ".git/index.lock") {
			t.Fatalf("SwitchBranch() error = %v", err)
		}
		return
	}
	if result.CurrentBranch != current {
		t.Fatalf("expected current branch %s, got %s", current, result.CurrentBranch)
	}
	if len(result.Messages) == 0 {
		t.Fatalf("expected switch messages")
	}
}
