package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"

	"difflearn-go/internal/config"
	"difflearn-go/internal/git"
	"difflearn-go/internal/llm"
)

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcResp struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id"`
	Result  any    `json:"result,omitempty"`
	Error   any    `json:"error,omitempty"`
}

func Serve(repoPath string) error {
	g := git.NewGitExtractor(repoPath)
	formatter := git.NewDiffFormatter()
	s := bufio.NewScanner(os.Stdin)
	for s.Scan() {
		line := s.Bytes()
		var req rpcReq
		if err := json.Unmarshal(line, &req); err != nil {
			continue
		}
		resp := rpcResp{JSONRPC: "2.0", ID: req.ID}
		switch req.Method {
		case "tools/list":
			resp.Result = map[string]any{"tools": []map[string]any{{"name": "get_local_diff", "description": "Get uncommitted changes"}, {"name": "get_commit_diff", "description": "Get diff for commit"}, {"name": "get_branch_diff", "description": "Get diff between branches"}, {"name": "get_commit_history", "description": "Get recent commits"}, {"name": "explain_diff", "description": "AI explanation"}, {"name": "review_diff", "description": "AI review"}, {"name": "ask_about_diff", "description": "Ask question"}}}
		case "tools/call":
			var p struct {
				Name      string                 `json:"name"`
				Arguments map[string]interface{} `json:"arguments"`
			}
			_ = json.Unmarshal(req.Params, &p)
			result, err := callTool(g, formatter, p.Name, p.Arguments)
			if err != nil {
				resp.Error = map[string]any{"code": -32000, "message": err.Error()}
			} else {
				resp.Result = result
			}
		default:
			resp.Error = map[string]any{"code": -32601, "message": "method not found"}
		}
		b, _ := json.Marshal(resp)
		fmt.Println(string(b))
	}
	return s.Err()
}

func callTool(g *git.GitExtractor, formatter *git.DiffFormatter, name string, args map[string]interface{}) (map[string]any, error) {
	toText := func(s string) map[string]any { return map[string]any{"content": []map[string]string{{"type": "text", "text": s}}} }

	sBool := func(key string) bool {
		v, ok := args[key]
		if !ok {
			return false
		}
		b, _ := v.(bool)
		return b
	}
	sStr := func(key string) string {
		v, ok := args[key]
		if !ok {
			return ""
		}
		s, _ := v.(string)
		return s
	}
	sNum := func(key string, d int) int {
		v, ok := args[key]
		if !ok {
			return d
		}
		f, ok := v.(float64)
		if !ok {
			return d
		}
		return int(f)
	}

	switch name {
	case "get_local_diff":
		diffs, err := g.GetLocalDiff(git.DiffOptions{Staged: sBool("staged")})
		if err != nil {
			return nil, err
		}
		format := sStr("format")
		if format == "json" {
			return toText(formatter.ToJSON(diffs)), nil
		}
		if format == "raw" {
			raw, err := g.GetRawDiff(map[bool]string{true: "staged", false: "local"}[sBool("staged")], nil)
			if err != nil {
				return nil, err
			}
			return toText(raw), nil
		}
		return toText(formatter.ToMarkdown(diffs)), nil
	case "get_commit_diff":
		diffs, err := g.GetCommitDiff(sStr("commit1"), sStr("commit2"))
		if err != nil {
			return nil, err
		}
		return toText(formatter.ToMarkdown(diffs)), nil
	case "get_branch_diff":
		diffs, err := g.GetBranchDiff(sStr("branch1"), sStr("branch2"))
		if err != nil {
			return nil, err
		}
		return toText(formatter.ToMarkdown(diffs)), nil
	case "get_commit_history":
		commits, err := g.GetCommitHistory(sNum("limit", 10))
		if err != nil {
			return nil, err
		}
		b, _ := json.MarshalIndent(commits, "", "  ")
		return toText(string(b)), nil
	case "explain_diff", "review_diff", "ask_about_diff":
		cfg := config.LoadConfig()
		diffs, err := g.GetLocalDiff(git.DiffOptions{Staged: sBool("staged")})
		if err != nil {
			return nil, err
		}
		if !config.IsLLMAvailable(cfg) {
			return toText("No LLM configured."), nil
		}
		client := llm.NewClient(cfg)
		prompt := ""
		if name == "explain_diff" {
			prompt = llm.CreateExplainPrompt(formatter, diffs)
		}
		if name == "review_diff" {
			prompt = llm.CreateReviewPrompt(formatter, diffs)
		}
		if name == "ask_about_diff" {
			prompt = llm.CreateQuestionPrompt(formatter, diffs, sStr("question"))
		}
		resp, err := client.Chat([]llm.ChatMessage{{Role: "system", Content: llm.SystemPrompt}, {Role: "user", Content: prompt}})
		if err != nil {
			return nil, err
		}
		return toText(resp.Content), nil
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}
