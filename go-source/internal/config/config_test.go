package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfigFromEnv(t *testing.T) {
	t.Setenv("DIFFLEARN_LLM_PROVIDER", "openai")
	t.Setenv("OPENAI_API_KEY", "test-key")
	t.Setenv("DIFFLEARN_MODEL", "gpt-test")
	t.Setenv("DIFFLEARN_TEMPERATURE", "0.7")
	t.Setenv("DIFFLEARN_MAX_TOKENS", "1024")

	cfg := LoadConfig()
	if cfg.Provider != ProviderOpenAI {
		t.Fatalf("expected provider openai, got %s", cfg.Provider)
	}
	if cfg.APIKey != "test-key" {
		t.Fatalf("expected api key from env")
	}
	if cfg.Model != "gpt-test" {
		t.Fatalf("expected model gpt-test, got %s", cfg.Model)
	}
	if !IsLLMAvailable(cfg) {
		t.Fatalf("expected llm to be available")
	}
}

func TestLoadConfigFromDotfile(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)
	t.Setenv("DIFFLEARN_LLM_PROVIDER", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("GOOGLE_AI_API_KEY", "")
	t.Setenv("DIFFLEARN_MODEL", "")

	content := "DIFFLEARN_LLM_PROVIDER=ollama\nDIFFLEARN_MODEL=llama3.2\n"
	if err := os.WriteFile(filepath.Join(tmpHome, ".difflearn"), []byte(content), 0o644); err != nil {
		t.Fatalf("write .difflearn: %v", err)
	}

	cfg := LoadConfig()
	if cfg.Provider != ProviderOllama {
		t.Fatalf("expected provider ollama, got %s", cfg.Provider)
	}
	if cfg.Model != "llama3.2" {
		t.Fatalf("expected model from file, got %s", cfg.Model)
	}
	if !IsLLMAvailable(cfg) {
		t.Fatalf("expected ollama to be treated as available")
	}
}

