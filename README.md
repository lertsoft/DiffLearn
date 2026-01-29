# DiffLearn 🔍

**Interactive git diff learning tool with LLM-powered explanations**

DiffLearn helps developers understand code changes through an interactive terminal UI with AI-powered explanations. Navigate diffs with keyboard controls, click on changes to ask questions, and get instant AI insights.

![Demo](./demo.gif)

## Features

- **🎨 Interactive Diff Viewer** - Red/green syntax highlighting with keyboard navigation
- **💬 Click-to-Ask** - Select any change and ask questions about it
- **🌐 Web UI** - Beautiful local web interface for viewing all commits and diffs
- **🆓 Use Your Subscriptions** - Works with Gemini CLI, Claude Code, Cursor (no API fees!)
- **🤖 API Support** - Also supports OpenAI, Anthropic, and Google APIs
- **🔌 MCP Server** - Works with Cursor, Claude Code, Gemini CLI, OpenCode
- **📊 Multiple Modes** - Local changes, commits, branches, staged files


## Installation

```bash
# Clone and install
git clone https://github.com/yourusername/DiffLearn.git
cd DiffLearn
bun install

# Run directly
bun run dev

# Or install globally
bun link
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
```

## Interactive Controls

| Key | Action |
|-----|--------|
| `↑`/`k` | Move to previous hunk |
| `↓`/`j` | Move to next hunk |
| `?` | Open chat for selected hunk |
| `Enter` | Expand/collapse hunk |
| `ESC` | Close chat panel |
| `q` | Quit |

## LLM Configuration

Set one of these environment variables:

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
GET  /diff/commit/:sha              # Commit diff
GET  /diff/branch/:b1/:b2          # Branch diff
GET  /history                       # Commit history
POST /explain                       # AI explanation
POST /review                        # AI code review
POST /ask                           # Ask about diff
POST /summary                       # Quick summary
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
| `serve --mcp\|--api` | Start server |

## Building

### Development

```bash
# Run in development mode
bun run dev

# Launch web UI
bun run web

# Run tests
bun test
```

### Cross-Platform Builds

Build standalone executables for all major platforms:

```bash
# Build for current platform
bun run build:macos

# Build for specific platforms
bun run build:macos-arm    # macOS Apple Silicon (M1/M2/M3)
bun run build:macos-x64    # macOS Intel

bun run build:linux        # Linux x64
bun run build:linux-arm    # Linux ARM64

bun run build:windows      # Windows x64

# Build all platforms at once
bun run build:all
```

### Output

Compiled binaries are placed in `dist/`:

| Platform | File |
|----------|------|
| macOS ARM64 | `dist/difflearn-macos-arm64` |
| macOS x64 | `dist/difflearn-macos-x64` |
| Linux x64 | `dist/difflearn-linux-x64` |
| Linux ARM64 | `dist/difflearn-linux-arm64` |
| Windows x64 | `dist/difflearn-windows-x64.exe` |

### Usage After Build

```bash
# Make executable (macOS/Linux)
chmod +x dist/difflearn-macos-arm64

# Run directly
./dist/difflearn-macos-arm64 web

# Or move to your PATH
mv dist/difflearn-macos-arm64 /usr/local/bin/difflearn
```

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
