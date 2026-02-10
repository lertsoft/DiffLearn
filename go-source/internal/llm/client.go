package llm

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"difflearn-go/internal/config"
)

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type LLMResponse struct {
	Content string         `json:"content"`
	Usage   map[string]any `json:"usage,omitempty"`
}

type Client struct {
	cfg        config.Config
	httpClient *http.Client
}

func NewClient(cfg config.Config) *Client {
	return &Client{cfg: cfg, httpClient: &http.Client{Timeout: 120 * time.Second}}
}

func (c *Client) Chat(messages []ChatMessage) (LLMResponse, error) {
	if c.cfg.UseCLI {
		return c.chatCLI(messages)
	}
	switch c.cfg.Provider {
	case config.ProviderOpenAI, config.ProviderOllama, config.ProviderLMStudio:
		return c.chatOpenAICompat(messages)
	case config.ProviderAnthropic:
		return c.chatAnthropic(messages)
	case config.ProviderGoogle:
		return c.chatGoogle(messages)
	default:
		return LLMResponse{}, fmt.Errorf("unknown provider: %s", c.cfg.Provider)
	}
}

func (c *Client) StreamChat(messages []ChatMessage) (<-chan string, <-chan error) {
	chunks := make(chan string)
	errs := make(chan error, 1)
	go func() {
		defer close(chunks)
		defer close(errs)
		resp, err := c.Chat(messages)
		if err != nil {
			errs <- err
			return
		}
		for _, tok := range strings.Fields(resp.Content) {
			chunks <- tok + " "
		}
	}()
	return chunks, errs
}

func (c *Client) chatCLI(messages []ChatMessage) (LLMResponse, error) {
	system := ""
	var sb strings.Builder
	for _, m := range messages {
		if m.Role == "system" {
			system = m.Content
			continue
		}
		role := "User"
		if m.Role == "assistant" {
			role = "Assistant"
		}
		sb.WriteString(role + ": " + m.Content + "\n\n")
	}
	prompt := sb.String()
	if system != "" {
		prompt = system + "\n\n" + prompt
	}

	switch c.cfg.Provider {
	case config.ProviderGeminiCLI:
		out, err := runCLIWithStdin("gemini", []string{}, prompt)
		return LLMResponse{Content: out}, err
	case config.ProviderClaude:
		out, err := runCLIWithStdin("claude", []string{"-p", prompt}, "")
		return LLMResponse{Content: out}, err
	case config.ProviderCursor:
		out, err := runCLIWithStdin("agent", []string{"-p", prompt, "--output-format", "text"}, "")
		if err != nil && strings.Contains(strings.ToLower(err.Error()), "output-format") {
			out, err = runCLIWithStdin("agent", []string{"-p", prompt}, "")
		}
		return LLMResponse{Content: out}, err
	case config.ProviderCodex:
		out, err := runCLIWithStdin("codex", []string{"exec", "-"}, prompt)
		return LLMResponse{Content: out}, err
	default:
		return LLMResponse{}, fmt.Errorf("unsupported CLI provider: %s", c.cfg.Provider)
	}
}

func runCLIWithStdin(command string, args []string, input string) (string, error) {
	cmd := exec.Command(command, args...)
	if input != "" {
		cmd.Stdin = strings.NewReader(input)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s failed: %s", command, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func (c *Client) chatOpenAICompat(messages []ChatMessage) (LLMResponse, error) {
	url := "https://api.openai.com/v1/chat/completions"
	if c.cfg.Provider == config.ProviderOllama || c.cfg.Provider == config.ProviderLMStudio {
		url = strings.TrimRight(c.cfg.BaseURL, "/") + "/chat/completions"
	}

	payload := map[string]any{
		"model":       c.cfg.Model,
		"messages":    messages,
		"temperature": c.cfg.Temperature,
		"max_tokens":  c.cfg.MaxTokens,
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if c.cfg.Provider == config.ProviderOpenAI {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return LLMResponse{}, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return LLMResponse{}, errors.New(string(respBody))
	}
	var parsed struct {
		Choices []struct {
			Message ChatMessage `json:"message"`
		} `json:"choices"`
		Usage map[string]any `json:"usage"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return LLMResponse{}, err
	}
	if len(parsed.Choices) == 0 {
		return LLMResponse{}, fmt.Errorf("empty response")
	}
	return LLMResponse{Content: parsed.Choices[0].Message.Content, Usage: parsed.Usage}, nil
}

func (c *Client) chatAnthropic(messages []ChatMessage) (LLMResponse, error) {
	url := "https://api.anthropic.com/v1/messages"
	system := ""
	msgs := make([]map[string]string, 0)
	for _, m := range messages {
		if m.Role == "system" {
			system = m.Content
			continue
		}
		role := m.Role
		if role == "system" {
			role = "user"
		}
		msgs = append(msgs, map[string]string{"role": role, "content": m.Content})
	}
	payload := map[string]any{"model": c.cfg.Model, "system": system, "max_tokens": c.cfg.MaxTokens, "messages": msgs}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.cfg.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return LLMResponse{}, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return LLMResponse{}, errors.New(string(respBody))
	}
	var parsed struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		Usage map[string]any `json:"usage"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return LLMResponse{}, err
	}
	if len(parsed.Content) == 0 {
		return LLMResponse{}, fmt.Errorf("empty response")
	}
	return LLMResponse{Content: parsed.Content[0].Text, Usage: parsed.Usage}, nil
}

func (c *Client) chatGoogle(messages []ChatMessage) (LLMResponse, error) {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", c.cfg.Model, c.cfg.APIKey)
	parts := make([]map[string]any, 0)
	for _, m := range messages {
		if m.Role == "system" {
			parts = append(parts, map[string]any{"text": "System: " + m.Content})
			continue
		}
		parts = append(parts, map[string]any{"text": strings.Title(m.Role) + ": " + m.Content})
	}
	payload := map[string]any{"contents": []map[string]any{{"parts": parts}}}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return LLMResponse{}, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return LLMResponse{}, errors.New(string(respBody))
	}
	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return LLMResponse{}, err
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return LLMResponse{}, fmt.Errorf("empty response")
	}
	return LLMResponse{Content: parsed.Candidates[0].Content.Parts[0].Text}, nil
}
