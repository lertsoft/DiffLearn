# DiffLearn 🔍

**Interactive git diff learning tool with LLM-powered explanations**

DiffLearn helps developers understand code changes through an interactive terminal UI with AI-powered explanations. Navigate diffs with keyboard controls, click on changes to ask questions, and get instant AI insights.

![Demo](DiffLearn_Demo.gif)

## Features

- **🎨 Interactive Diff Viewer** - Red/green syntax highlighting with keyboard navigation
- **💬 Click-to-Ask** - Select any change and ask questions about it
- **🚀 Unified Dashboard** - View local, staged, and history on one screen in the terminal
- **🔀 Commit Comparison** - Select any two commits in Web or CLI to see and analyze the diff between them
- **🌐 Remote Web UI** - Beautiful local web interface with comparison support and AI chat
- **🆓 Use Your Subscriptions** - Works with Gemini CLI, Claude Code, Cursor (no API fees!)
- **🤖 API Support** - Native support for OpenAI, Anthropic, and Google AI APIs
- **🔌 MCP Server** - Full integration with Cursor, Claude Code, and other MCP clients
- **⌨️ Keyboard First** - Full scrolling and windowing support for large diffs and histories


## Getting Started

### One-Line Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/lertsoft/DiffLearn/master/install.sh | bash
```

### Manual Installation

```bash
# Clone and install
git clone https://github.com/lertsoft/DiffLearn.git
cd DiffLearn
bun install

# Run directly
bun run dev

# Or install globally
bun link
```

### Development

```bash
# Clone and install
git clone https://github.com/lertsoft/DiffLearn.git
cd DiffLearn
bun run dev

# Launch web UI
bun run web

# Run tests
bun test

# Run lint
bun run lint

# Auto-fix lint
bun run lint:fix
```


## Quick Start

```bash
# 🌐 Launch the Web UI (recommended!)
difflearn web

# Terminal: View local changes interactively
difflearn local

# View staged changes only
difflearn local --staged

# Compare commits
difflearn commit abc123
difflearn commit abc123 --compare def456

# Compare branches
difflearn branch main feature/new-auth

# Quick AI explanations (non-interactive)
difflearn explain
difflearn review
difflearn summary

# Interactive Compare
difflearn local       # Use Tab to switch to History, then Enter to select
difflearn web         # Click '+' buttons next to commits to compare two SHAs
```

## Web UI Accessibility & Controls

The Web Interface (`difflearn web`) is fully accessible and keyboard-friendly:

| Key | Action |
|-----|--------|
| `s`/`j`/`↓` | Select next commit in list |
| `w`/`k`/`↑` | Select previous commit in list |
| `Enter` | Select currently focused commit / Confirm comparison |
| `a`/`←` | Switch to previous view (e.g. History → Staged) |
| `d`/`→` | Switch to next view (e.g. Local → Staged) |
| `/` | Focus Chat Input |
| `Esc` | Close panels / Exit comparison mode |
| `+` (Web) | Click the '+' button next to commits to select for comparison (max 2) |

## CLI Interactive Controls

| Key | Action |
|-----|--------|
| `Tab` | Switch between Local Changes, Staged Changes, and History |
| `↑`/`↓` | Navigate history list or scroll long AI responses |
| `Enter` | View diff for selected commit or file |
| `/` / `i` | Focus AI Chat input |
| `Esc` | Exit chat/scrolling mode back to dashboard |
| `q` | Quit or go back from current view |
| `c` (Chat) | Clear current chat history |

### Slash Commands (type `/` in chat)

| Command | Description |
|---------|-------------|
| `/explain` | Get AI explanation of current changes |
| `/review` | Get AI code review with suggestions |
| `/summarize` | Get a quick summary of changes |
| `/update` | Check for updates |
| `/export` | Export diff as markdown |
| `/web` | Open web UI in browser |
| `/config` | Show LLM configuration status |

## LLM Configuration

### Quick Setup (Recommended)

The easiest way to configure DiffLearn is with the interactive wizard:

```bash
difflearn config
```

This will:
- Show available providers (CLI-based and API-based)
- Guide you through authentication
- Save configuration securely to `~/.difflearn`

### CLI-Based Providers (Use your current Subscription!)

Use your existing AI subscriptions without extra API costs:

| Provider | Requirement |
|----------|-------------|
| **Gemini CLI** | [Install gemini-cli](https://github.com/google-gemini/gemini-cli) |
| **Claude Code** | [Install claude](https://docs.anthropic.com/en/docs/claude-code) |
| **OpenAI Codex** | [Install codex](https://github.com/openai/codex) |
| **Cursor** | [Install Cursor CLI](https://cursor.com/docs/cli/overview) |

Login commands (provider-specific):

```bash
# Gemini CLI (interactive login selection)
gemini

# Claude Code (interactive, then type /login)
claude

# OpenAI Codex
codex login

# Cursor CLI
agent login
```

```bash
# Check which providers are available
difflearn config --status

# Example: Use Gemini CLI
export DIFFLEARN_LLM_PROVIDER=gemini-cli
```

### Local LLM Providers (Free & Private!)

Run AI locally on your machine with no API costs and full privacy:

| Provider | Default URL | Setup |
|----------|-------------|-------|
| **Ollama** | `localhost:11434` | [Install Ollama](https://ollama.com) + `ollama pull llama3.2` |
| **LM Studio** | `localhost:1234` | [Install LM Studio](https://lmstudio.ai) + start local server |

The easiest way to configure is with the wizard, which detects your downloaded models:

```bash
difflearn config
# Select Ollama or LM Studio, then choose from your available models
```

Or set environment variables directly:

```bash
# Use Ollama
export DIFFLEARN_LLM_PROVIDER=ollama
export DIFFLEARN_MODEL=llama3.2

# Use LM Studio
export DIFFLEARN_LLM_PROVIDER=lmstudio

# Custom base URL (if not using default port)
export DIFFLEARN_BASE_URL=http://localhost:8080/v1
```

### API-Based Providers

For direct API access (pay-per-use):

```bash
# Option 1: OpenAI (default)
export OPENAI_API_KEY=sk-...

# Option 2: Anthropic
export ANTHROPIC_API_KEY=sk-ant-...
export DIFFLEARN_LLM_PROVIDER=anthropic

# Option 3: Google AI
export GOOGLE_AI_API_KEY=...
export DIFFLEARN_LLM_PROVIDER=google

# Optional: Custom model
export DIFFLEARN_MODEL=gpt-4o-mini
```

### Configuration File

DiffLearn stores config in `~/.difflearn`:

```bash
# ~/.difflearn
DIFFLEARN_LLM_PROVIDER=gemini-cli
OPENAI_API_KEY=sk-...
```

Environment variables override the config file.

> **Note:** DiffLearn works without an API key! When no LLM is configured, it outputs formatted prompts you can use with any AI tool.

## MCP Integration

### Cursor / Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "difflearn": {
      "command": "bun",
      "args": ["run", "/path/to/DiffLearn/src/mcp/server.ts"]
    }
  }
}
```

### Available MCP Tools

- `get_local_diff` - Get uncommitted changes
- `get_commit_diff` - Get diff for a commit
- `get_branch_diff` - Compare branches
- `get_commit_history` - List recent commits
- `explain_diff` - AI explanation of changes
- `review_diff` - AI code review
- `ask_about_diff` - Ask questions about changes

## REST API

```bash
# Start API server
difflearn serve --api --port 3000

# Endpoints
GET  /diff/local                    # Local changes
GET  /diff/commit/:sha              # Single commit or comparison (using ?compare=sha2)
GET  /diff/branch/:b1/:b2          # Branch diff
GET  /history                       # Commit history with windowing support
POST /explain                       # AI explanation (supports commit/staged/compare)
POST /review                        # AI code review (supports commit/staged/compare)
POST /ask                           # Ask questions (supports commit/staged/compare)
POST /summary                       # Quick summary (supports commit/staged/compare)
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `local [--staged]` | View local changes interactively |
| `commit <sha> [--compare <sha2>]` | View commit diff |
| `branch <b1> <b2>` | Compare branches |
| `explain [--staged]` | AI explanation |
| `review [--staged]` | AI code review |
| `summary [--staged]` | Quick summary |
| `export [--format json\|markdown]` | Export diff |
| `history [-n count]` | List commits |
| `web [-p port]` | Launch the web UI |
| `config [--status]` | Configure LLM provider |
| `serve --mcp\|--api` | Start server |


## Architecture

```
src/
├── cli/
│   ├── index.tsx         # CLI entry point
│   └── components/
│       ├── App.tsx       # Main app component
│       ├── DiffViewer.tsx # Interactive diff viewer
│       └── ChatPanel.tsx  # Q&A chat panel
├── git/
│   ├── extractor.ts      # Git operations
│   ├── parser.ts         # Diff parsing
│   └── formatter.ts      # Output formatting
├── llm/
│   ├── client.ts         # LLM providers
│   └── prompts.ts        # Prompt templates
├── mcp/
│   └── server.ts         # MCP server
└── api/
    └── server.ts         # REST API
```

## License

MIT
