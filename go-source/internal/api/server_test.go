package api

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
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
