# DiffLearn Go Port

This folder contains a Go port of DiffLearn, designed to run alongside the original Bun/TypeScript source.

## Run

```bash
cd go-source
go mod tidy
go run ./cmd/difflearn
```

## Commands

- `difflearn` (interactive dashboard)
- `difflearn local [--staged]`
- `difflearn commit <sha> [--compare <sha2>]`
- `difflearn branch <branch1> <branch2>`
- `difflearn explain [--staged]`
- `difflearn review [--staged]`
- `difflearn summary [--staged]`
- `difflearn export --format markdown|json|terminal [--staged]`
- `difflearn history [-n 10]`
- `difflearn web [-p 3000]`
- `difflearn config`
- `difflearn serve-mcp`
- `difflearn update`

The Go port reuses the same `~/.difflearn` config file format and compatible environment variables.
