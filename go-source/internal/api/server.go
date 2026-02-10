package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"difflearn-go/internal/config"
	"difflearn-go/internal/git"
	"difflearn-go/internal/llm"
)

func StartAPIServer(port int, repoPath string) error {
	if port == 0 {
		port = 3000
	}
	if repoPath == "" {
		repoPath = "."
	}
	g := git.NewGitExtractor(repoPath)
	formatter := git.NewDiffFormatter()

	webDir, err := findWebDir(repoPath)
	if err != nil {
		return err
	}

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
		http.ServeFile(w, r, filepath.Join(webDir, "styles.css"))
	}))
	mux.HandleFunc("/app.js", withCORS(func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(webDir, "app.js"))
	}))

	mux.HandleFunc("/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		accept := r.Header.Get("Accept")
		if strings.Contains(accept, "text/html") {
			http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
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
			var parsed any
			_ = json.Unmarshal([]byte(formatter.ToJSON(diffs)), &parsed)
			writeJSON(w, 200, map[string]any{"success": true, "data": parsed})
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
		var parsed any
		_ = json.Unmarshal([]byte(formatter.ToJSON(diffs)), &parsed)
		writeJSON(w, 200, map[string]any{"success": true, "data": parsed})
	}))

	mux.HandleFunc("/diff/branch/", withCORS(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/diff/branch/"), "/")
		if len(parts) < 2 {
			writeJSON(w, 400, map[string]any{"success": false, "error": "branch1 and branch2 required"})
			return
		}
		diffs, err := g.GetBranchDiff(parts[0], parts[1])
		if err != nil {
			writeJSON(w, 500, map[string]any{"success": false, "error": err.Error()})
			return
		}
		var parsed any
		_ = json.Unmarshal([]byte(formatter.ToJSON(diffs)), &parsed)
		writeJSON(w, 200, map[string]any{"success": true, "data": parsed})
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
			var body struct {
				Question string `json:"question"`
				Staged   bool   `json:"staged"`
				Commit   string `json:"commit"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)

			diffs, err := getDiffForRequest(g, body.Commit, body.Staged)
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

func findWebDir(repoPath string) (string, error) {
	candidates := []string{
		filepath.Join(repoPath, "go-source", "web"),
		filepath.Join(repoPath, "web"),
		filepath.Join(repoPath, "src", "web"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(filepath.Join(c, "index.html")); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("could not find web directory")
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func getDiffForRequest(g *git.GitExtractor, commit string, staged bool) ([]git.ParsedDiff, error) {
	if commit != "" {
		if strings.Contains(commit, "..") {
			parts := strings.SplitN(commit, "..", 2)
			if len(parts) == 2 {
				return g.GetCommitDiff(parts[0], parts[1])
			}
		}
		return g.GetCommitDiff(commit, "")
	}
	return g.GetLocalDiff(git.DiffOptions{Staged: staged})
}
