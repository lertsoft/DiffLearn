package api

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"difflearn-go/internal/config"
	"difflearn-go/internal/git"
	"difflearn-go/internal/llm"
	webassets "difflearn-go/web"
)

type diffRequestBody struct {
	Question     string `json:"question"`
	Staged       bool   `json:"staged"`
	Commit       string `json:"commit"`
	BranchBase   string `json:"branchBase"`
	BranchTarget string `json:"branchTarget"`
	BranchMode   string `json:"branchMode"`
}

func normalizeBranchMode(mode string) git.BranchDiffMode {
	if mode == string(git.BranchModeDouble) {
		return git.BranchModeDouble
	}
	return git.BranchModeTriple
}

func formattedDiffPayload(formatter *git.DiffFormatter, diffs []git.ParsedDiff, comparison map[string]any) map[string]any {
	parsed := map[string]any{}
	_ = json.Unmarshal([]byte(formatter.ToJSON(diffs)), &parsed)
	if comparison != nil {
		parsed["comparison"] = comparison
	}
	return parsed
}

func resolveBranchComparison(g *git.GitExtractor, base, target string, mode git.BranchDiffMode) ([]git.ParsedDiff, map[string]any, error) {
	baseResolved, err := g.EnsureLocalBranch(base)
	if err != nil {
		return nil, nil, err
	}
	targetResolved, err := g.EnsureLocalBranch(target)
	if err != nil {
		return nil, nil, err
	}

	diffs, err := g.GetBranchDiff(baseResolved.ResolvedLocalBranch, targetResolved.ResolvedLocalBranch, mode)
	if err != nil {
		return nil, nil, err
	}

	localizedBranches := make([]string, 0)
	if baseResolved.Localized {
		localizedBranches = append(localizedBranches, baseResolved.ResolvedLocalBranch)
	}
	if targetResolved.Localized {
		found := false
		for _, existing := range localizedBranches {
			if existing == targetResolved.ResolvedLocalBranch {
				found = true
				break
			}
		}
		if !found {
			localizedBranches = append(localizedBranches, targetResolved.ResolvedLocalBranch)
		}
	}

	messages := make([]string, 0)
	if baseResolved.Message != "" {
		messages = append(messages, baseResolved.Message)
	}
	if targetResolved.Message != "" && targetResolved.Message != baseResolved.Message {
		messages = append(messages, targetResolved.Message)
	}

	comparison := map[string]any{
		"baseResolved":      baseResolved.ResolvedLocalBranch,
		"targetResolved":    targetResolved.ResolvedLocalBranch,
		"mode":              mode,
		"localizedBranches": localizedBranches,
		"messages":          messages,
	}

	return diffs, comparison, nil
}

func StartAPIServer(port int, repoPath string) error {
	if port == 0 {
		port = 3000
	}
	if repoPath == "" {
		repoPath = "."
	}
	g := git.NewGitExtractor(repoPath)
	formatter := git.NewDiffFormatter()

	webDir, hasDiskWeb := findWebDir(repoPath)

	mux := http.NewServeMux()
	withCORS := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			h(w, r)
		}
	}

	mux.HandleFunc("/styles.css", withCORS(func(w http.ResponseWriter, r *http.Request) {
		serveWebAsset(w, r, hasDiskWeb, webDir, "styles.css", "text/css")
	}))
	mux.HandleFunc("/app.js", withCORS(func(w http.ResponseWriter, r *http.Request) {
		serveWebAsset(w, r, hasDiskWeb, webDir, "app.js", "application/javascript")
	}))

	mux.HandleFunc("/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		accept := r.Header.Get("Accept")
		if strings.Contains(accept, "text/html") {
			serveWebAsset(w, r, hasDiskWeb, webDir, "index.html", "text/html")
			return
		}
		cfg := config.LoadConfig()
		writeJSON(w, 200, map[string]any{
			"name":         "difflearn",
			"version":      "0.3.0",
			"status":       "running",
			"llmAvailable": config.IsLLMAvailable(cfg),
			"llmProvider":  cfg.Provider,
			"cwd":          g.RepoPath(),
		})
	}))

	mux.HandleFunc("/branches", withCORS(func(w http.ResponseWriter, r *http.Request) {
		branches, err := g.GetBranchesDetailed()
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}
		current, err := g.GetCurrentBranch()
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}

		writeJSON(w, 200, map[string]any{
			"success": true,
			"data": map[string]any{
				"currentBranch": current,
				"branches":      branches,
			},
		})
	}))

	mux.HandleFunc("/diff/local", withCORS(func(w http.ResponseWriter, r *http.Request) {
		staged := r.URL.Query().Get("staged") == "true"
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "json"
		}
		diffs, err := g.GetLocalDiff(git.DiffOptions{Staged: staged})
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}
		switch format {
		case "markdown":
			w.Write([]byte(formatter.ToMarkdown(diffs)))
		case "raw":
			raw, err := g.GetRawDiff(map[bool]string{true: "staged", false: "local"}[staged], nil)
			if err != nil {
				writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
				return
			}
			w.Write([]byte(raw))
		default:
			writeJSON(w, 200, map[string]any{"success": true, "data": formattedDiffPayload(formatter, diffs, nil)})
		}
	}))

	mux.HandleFunc("/diff/commit/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		sha := strings.TrimPrefix(r.URL.Path, "/diff/commit/")
		sha2 := r.URL.Query().Get("compare")
		diffs, err := g.GetCommitDiff(sha, sha2)
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"success": true, "data": formattedDiffPayload(formatter, diffs, nil)})
	}))

	mux.HandleFunc("/diff/branch", withCORS(func(w http.ResponseWriter, r *http.Request) {
		base := r.URL.Query().Get("base")
		target := r.URL.Query().Get("target")
		if base == "" || target == "" {
			writeJSON(w, 400, map[string]any{"success": false, "error": "base and target are required"})
			return
		}
		mode := normalizeBranchMode(r.URL.Query().Get("mode"))
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "json"
		}

		diffs, comparison, err := resolveBranchComparison(g, base, target, mode)
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}

		if format == "markdown" {
			w.Write([]byte(formatter.ToMarkdown(diffs)))
			return
		}

		writeJSON(w, 200, map[string]any{"success": true, "data": formattedDiffPayload(formatter, diffs, comparison)})
	}))

	mux.HandleFunc("/diff/branch/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/diff/branch/"), "/")
		if len(parts) < 2 {
			writeJSON(w, 400, map[string]any{"success": false, "error": "branch1 and branch2 required"})
			return
		}
		branch1 := parts[0]
		branch2 := parts[1]
		mode := normalizeBranchMode(r.URL.Query().Get("mode"))
		format := r.URL.Query().Get("format")
		if format == "" {
			format = "json"
		}

		diffs, comparison, err := resolveBranchComparison(g, branch1, branch2, mode)
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}

		if format == "markdown" {
			w.Write([]byte(formatter.ToMarkdown(diffs)))
			return
		}

		writeJSON(w, 200, map[string]any{"success": true, "data": formattedDiffPayload(formatter, diffs, comparison)})
	}))

	mux.HandleFunc("/branch/switch", withCORS(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Branch    string `json:"branch"`
			AutoStash *bool  `json:"autoStash"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if strings.TrimSpace(body.Branch) == "" {
			writeJSON(w, 400, map[string]any{"success": false, "error": "branch is required"})
			return
		}

		autoStash := true
		if body.AutoStash != nil {
			autoStash = *body.AutoStash
		}

		result, err := g.SwitchBranch(body.Branch, git.SwitchBranchOptions{AutoStash: autoStash})
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}

		writeJSON(w, 200, map[string]any{"success": true, "data": result})
	}))

	mux.HandleFunc("/history", withCORS(func(w http.ResponseWriter, r *http.Request) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit == 0 {
			limit = 10
		}
		commits, err := g.GetCommitHistory(limit)
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"success": true, "data": commits})
	}))

	aiHandler := func(kind string) http.HandlerFunc {
		return withCORS(func(w http.ResponseWriter, r *http.Request) {
			var body diffRequestBody
			_ = json.NewDecoder(r.Body).Decode(&body)

			diffs, err := getDiffForRequest(g, body)
			if err != nil {
				writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
				return
			}
			if len(diffs) == 0 {
				field := map[string]string{"explain": "explanation", "review": "review", "ask": "answer", "summary": "summary"}[kind]
				writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{field: "No changes."}})
				return
			}

			cfg := config.LoadConfig()
			if !config.IsLLMAvailable(cfg) {
				prompt := ""
				switch kind {
				case "explain":
					prompt = llm.CreateExplainPrompt(formatter, diffs)
				case "review":
					prompt = llm.CreateReviewPrompt(formatter, diffs)
				case "ask":
					if body.Question == "" {
						writeJSON(w, 400, map[string]any{"success": false, "error": "Question is required"})
						return
					}
					prompt = llm.CreateQuestionPrompt(formatter, diffs, body.Question)
				case "summary":
					writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"summary": formatter.ToSummary(diffs), "llmAvailable": false}})
					return
				}
				writeJSON(w, 200, map[string]any{"success": true, "data": map[string]any{"llmAvailable": false, "prompt": prompt, "message": "No LLM API key configured. Use the prompt with your own LLM."}})
				return
			}

			client := llm.NewClient(cfg)
			prompt := ""
			respField := ""
			switch kind {
			case "explain":
				prompt = llm.CreateExplainPrompt(formatter, diffs)
				respField = "explanation"
			case "review":
				prompt = llm.CreateReviewPrompt(formatter, diffs)
				respField = "review"
			case "ask":
				if body.Question == "" {
					writeJSON(w, 400, map[string]any{"success": false, "error": "Question is required"})
					return
				}
				prompt = llm.CreateQuestionPrompt(formatter, diffs, body.Question)
				respField = "answer"
			case "summary":
				prompt = llm.CreateSummaryPrompt(formatter, diffs)
				respField = "summary"
			}
			resp, err := client.Chat([]llm.ChatMessage{{Role: "system", Content: llm.SystemPrompt}, {Role: "user", Content: prompt}})
			if err != nil {
				writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
				return
			}
			data := map[string]any{respField: resp.Content, "usage": resp.Usage}
			if kind == "summary" {
				data["basicSummary"] = formatter.ToSummary(diffs)
			}
			writeJSON(w, 200, map[string]any{"success": true, "data": data})
		})
	}

	mux.HandleFunc("/explain", aiHandler("explain"))
	mux.HandleFunc("/review", aiHandler("review"))
	mux.HandleFunc("/ask", aiHandler("ask"))
	mux.HandleFunc("/summary", aiHandler("summary"))

	addr := fmt.Sprintf(":%d", port)
	fmt.Printf("\n🔍 DiffLearn Web UI running at http://localhost:%d\n", port)
	fmt.Printf("   API available at http://localhost:%d/diff/local\n\n", port)
	return http.ListenAndServe(addr, mux)
}

func findWebDir(repoPath string) (string, bool) {
	candidates := []string{
		filepath.Join(repoPath, "go-source", "web"),
		filepath.Join(repoPath, "web"),
		filepath.Join(repoPath, "src", "web"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(filepath.Join(c, "index.html")); err == nil {
			return c, true
		}
	}
	return "", false
}

func serveWebAsset(w http.ResponseWriter, r *http.Request, hasDiskWeb bool, webDir, name, contentType string) {
	if hasDiskWeb {
		http.ServeFile(w, r, filepath.Join(webDir, name))
		return
	}

	data, err := fs.ReadFile(webassets.Assets, name)
	if err != nil {
		http.Error(w, "web asset not found: "+name, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", contentType)
	_, _ = w.Write(data)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func getDiffForRequest(g *git.GitExtractor, body diffRequestBody) ([]git.ParsedDiff, error) {
	if body.BranchBase != "" && body.BranchTarget != "" {
		mode := normalizeBranchMode(body.BranchMode)
		diffs, _, err := resolveBranchComparison(g, body.BranchBase, body.BranchTarget, mode)
		return diffs, err
	}

	if body.Commit != "" {
		if strings.Contains(body.Commit, "..") {
			parts := strings.SplitN(body.Commit, "..", 2)
			if len(parts) == 2 {
				return g.GetCommitDiff(parts[0], parts[1])
			}
		}
		return g.GetCommitDiff(body.Commit, "")
	}

	return g.GetLocalDiff(git.DiffOptions{Staged: body.Staged})
}
