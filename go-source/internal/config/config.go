package config

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type LLMProvider string

const (
	ProviderOpenAI    LLMProvider = "openai"
	ProviderAnthropic LLMProvider = "anthropic"
	ProviderGoogle    LLMProvider = "google"
	ProviderOllama    LLMProvider = "ollama"
	ProviderLMStudio  LLMProvider = "lmstudio"
	ProviderGeminiCLI LLMProvider = "gemini-cli"
	ProviderClaude    LLMProvider = "claude-code"
	ProviderCodex     LLMProvider = "codex"
	ProviderCursor    LLMProvider = "cursor-cli"
)

type Config struct {
	Provider    LLMProvider
	Model       string
	APIKey      string
	BaseURL     string
	Temperature float64
	MaxTokens   int
	UseCLI      bool
}

type providerDefaults struct {
	model     string
	envKey    string
	cli       bool
	command   string
	baseURL   string
	noAPIKey  bool
	authCmd   []string
	authHint  []string
	authCheck []string
}

var providerDefaultsMap = map[LLMProvider]providerDefaults{
	ProviderOpenAI:    {model: "gpt-4o", envKey: "OPENAI_API_KEY"},
	ProviderAnthropic: {model: "claude-sonnet-4-20250514", envKey: "ANTHROPIC_API_KEY"},
	ProviderGoogle:    {model: "gemini-2.0-flash", envKey: "GOOGLE_AI_API_KEY"},
	ProviderOllama:    {model: "llama3.2", noAPIKey: true, baseURL: "http://localhost:11434/v1"},
	ProviderLMStudio:  {model: "local-model", noAPIKey: true, baseURL: "http://localhost:1234/v1"},
	ProviderGeminiCLI: {model: "gemini", cli: true, command: "gemini", authCmd: []string{"gemini"}},
	ProviderClaude:    {model: "claude", cli: true, command: "claude", authCmd: []string{"claude"}},
	ProviderCodex:     {model: "codex", cli: true, command: "codex", authCmd: []string{"codex", "login"}, authCheck: []string{"codex", "login", "status"}},
	ProviderCursor:    {model: "cursor", cli: true, command: "agent", authCmd: []string{"agent", "login"}, authCheck: []string{"agent", "status"}},
}

func loadConfigFromFile() map[string]string {
	home, err := os.UserHomeDir()
	if err != nil {
		return map[string]string{}
	}
	p := filepath.Join(home, ".difflearn")
	f, err := os.Open(p)
	if err != nil {
		return map[string]string{}
	}
	defer f.Close()

	out := map[string]string{}
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			out[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	return out
}

func LoadConfig() Config {
	fileCfg := loadConfigFromFile()
	for k, v := range fileCfg {
		if os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}

	provider := LLMProvider(os.Getenv("DIFFLEARN_LLM_PROVIDER"))
	if provider == "" {
		provider = DetectProvider()
	}
	if provider == "" {
		provider = ProviderOpenAI
	}

	d, ok := providerDefaultsMap[provider]
	if !ok {
		provider = ProviderOpenAI
		d = providerDefaultsMap[provider]
	}

	needsAPIKey := !d.cli && !d.noAPIKey
	apiKey := "local"
	if needsAPIKey {
		apiKey = os.Getenv(d.envKey)
	}

	temp, _ := strconv.ParseFloat(defaultStr(os.Getenv("DIFFLEARN_TEMPERATURE"), "0.3"), 64)
	maxTokens, _ := strconv.Atoi(defaultStr(os.Getenv("DIFFLEARN_MAX_TOKENS"), "4096"))
	baseURL := os.Getenv("DIFFLEARN_BASE_URL")
	if baseURL == "" {
		baseURL = d.baseURL
	}

	return Config{
		Provider:    provider,
		Model:       defaultStr(os.Getenv("DIFFLEARN_MODEL"), d.model),
		APIKey:      apiKey,
		BaseURL:     baseURL,
		Temperature: temp,
		MaxTokens:   maxTokens,
		UseCLI:      d.cli,
	}
}

func IsLLMAvailable(c Config) bool {
	if c.UseCLI || c.Provider == ProviderOllama || c.Provider == ProviderLMStudio {
		return true
	}
	return strings.TrimSpace(c.APIKey) != ""
}

func DetectProvider() LLMProvider {
	if os.Getenv("OPENAI_API_KEY") != "" {
		return ProviderOpenAI
	}
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		return ProviderAnthropic
	}
	if os.Getenv("GOOGLE_AI_API_KEY") != "" {
		return ProviderGoogle
	}
	return ""
}

func DetectCLIProvider() LLMProvider {
	if IsCLIAvailable("gemini") {
		return ProviderGeminiCLI
	}
	if IsCLIAvailable("claude") {
		return ProviderClaude
	}
	if IsCLIAvailable("codex") {
		return ProviderCodex
	}
	if IsCursorAgentAvailable() {
		return ProviderCursor
	}
	return ""
}

func IsCLIAvailable(command string) bool {
	_, err := exec.LookPath(command)
	return err == nil
}

func IsCursorAgentAvailable() bool {
	if !IsCLIAvailable("agent") {
		return false
	}
	cmd := exec.Command("agent", "--version")
	b, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(b)), "cursor")
}

func GetCLIAuthCommand(provider LLMProvider) []string {
	return providerDefaultsMap[provider].authCmd
}

func GetCLIAuthHint(provider LLMProvider) []string {
	return providerDefaultsMap[provider].authHint
}

func defaultStr(v, d string) string {
	if strings.TrimSpace(v) == "" {
		return d
	}
	return v
}
