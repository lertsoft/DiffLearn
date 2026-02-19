package git

import "testing"

func TestParseSingleFileDiff(t *testing.T) {
	raw := `diff --git a/main.go b/main.go
index 1111111..2222222 100644
--- a/main.go
+++ b/main.go
@@ -1,3 +1,4 @@
 package main
-func old() {}
+func old() {}
+func added() {}
 func unchanged() {}`

	p := NewDiffParser()
	diffs := p.Parse(raw)
	if len(diffs) != 1 {
		t.Fatalf("expected 1 diff, got %d", len(diffs))
	}

	d := diffs[0]
	if d.NewFile != "main.go" {
		t.Fatalf("expected new file main.go, got %s", d.NewFile)
	}
	if d.Additions != 2 {
		t.Fatalf("expected 2 additions, got %d", d.Additions)
	}
	if d.Deletions != 1 {
		t.Fatalf("expected 1 deletion, got %d", d.Deletions)
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("expected 1 hunk, got %d", len(d.Hunks))
	}
}

func TestParseRenameDiff(t *testing.T) {
	raw := `diff --git a/old.txt b/new.txt
similarity index 100%
rename from old.txt
rename to new.txt`

	p := NewDiffParser()
	diffs := p.Parse(raw)
	if len(diffs) != 1 {
		t.Fatalf("expected 1 diff, got %d", len(diffs))
	}
	if !diffs[0].IsRenamed {
		t.Fatalf("expected renamed file")
	}
}

func TestGetStats(t *testing.T) {
	p := NewDiffParser()
	stats := p.GetStats([]ParsedDiff{
		{Additions: 3, Deletions: 1},
		{Additions: 5, Deletions: 2},
	})
	if stats.Files != 2 || stats.Additions != 8 || stats.Deletions != 3 {
		t.Fatalf("unexpected stats: %+v", stats)
	}
}

