package api

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"difflearn-go/internal/git"
)

func TestFindWebDirFromRepoRoot(t *testing.T) {
	dir, ok := findWebDir("../..")
	if !ok {
		t.Fatalf("expected to find web dir from repo root")
	}
	if !strings.HasSuffix(dir, "web") {
		t.Fatalf("unexpected web dir path: %s", dir)
	}
}

func TestServeEmbeddedAssetFallback(t *testing.T) {
	req := httptest.NewRequest("GET", "/styles.css", nil)
	w := httptest.NewRecorder()

	serveWebAsset(w, req, false, "", "styles.css", "text/css")
	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "text/css") {
		t.Fatalf("expected text/css content type, got %s", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	if len(body) == 0 {
		t.Fatalf("expected non-empty asset body")
	}
}

func TestNormalizeBranchMode(t *testing.T) {
	if got := normalizeBranchMode("double"); got != git.BranchModeDouble {
		t.Fatalf("expected double mode, got %s", got)
	}
	if got := normalizeBranchMode(""); got != git.BranchModeTriple {
		t.Fatalf("expected triple mode default, got %s", got)
	}
}

func TestResolveBranchComparisonLocalBranches(t *testing.T) {
	g := git.NewGitExtractor("../../..")
	current, err := g.GetCurrentBranch()
	if err != nil {
		t.Fatalf("GetCurrentBranch() error = %v", err)
	}

	diffs, comparison, err := resolveBranchComparison(g, current, current, git.BranchModeTriple)
	if err != nil {
		t.Fatalf("resolveBranchComparison() error = %v", err)
	}
	if diffs == nil {
		t.Fatalf("expected diff slice")
	}
	if comparison["baseResolved"] == nil || comparison["targetResolved"] == nil {
		t.Fatalf("expected comparison metadata, got %+v", comparison)
	}
}

func TestGetDiffForRequestBranchPrecedence(t *testing.T) {
	g := git.NewGitExtractor("../../..")
	current, err := g.GetCurrentBranch()
	if err != nil {
		t.Fatalf("GetCurrentBranch() error = %v", err)
	}

	diffs, err := getDiffForRequest(g, diffRequestBody{
		BranchBase:   current,
		BranchTarget: current,
		BranchMode:   "double",
		Commit:       "deadbeef",
		Staged:       true,
	})
	if err != nil {
		t.Fatalf("getDiffForRequest() error = %v", err)
	}
	if diffs == nil {
		t.Fatalf("expected diff slice")
	}
}
