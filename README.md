# claw-rubber

A Bun-based secure proxy for OpenClaw web access via Brave Search.

## Features
- Brave Web Search proxy (`/v1/search`)
- Opaque result ID fetch flow (`/v1/fetch`)
- Domain allowlist + blocklist support
- Prompt-injection rule scoring and fail-closed policy
- Optional model adjudication via Vercel AI SDK (OpenAI/Ollama)
- SQLite audit storage for flagged payloads
- Rotating structured log files

## Quick Start
1. Install dependencies:
```bash
bun install
```

2. Configure environment:
```bash
export BRAVE_API_KEY="..."
export CR_PROFILE="strict"
export CR_ALLOWLIST_DOMAINS="docs.bun.sh"
export CR_BLOCKLIST_DOMAINS="evil.example"
```

3. Run server:
```bash
bun run dev
```

Server runs on `http://localhost:3000` by default.

## Endpoints
- `POST /v1/search`
- `POST /v1/fetch`
- `GET /healthz`

## URL Exposure
Search URLs are redacted by default. Set `CR_REDACT_URLS=false` to include URLs in `/v1/search` responses.

## Domain Policy
- Blocklist wins over allowlist.
- Allowlisted domains bypass prompt-injection filtering.
- Blocklisted domains are denied in both search availability and fetch.

## Environment Variables
- `BRAVE_API_KEY`
- `CR_PROFILE=baseline|strict|paranoid`
- `CR_REDACT_URLS=true|false`
- `CR_FAIL_CLOSED=true|false`
- `CR_ALLOWLIST_DOMAINS=example.com,docs.example.com`
- `CR_BLOCKLIST_DOMAINS=bad.example`
- `CR_DB_PATH` (default `./data/claw-rubber.db`)
- `CR_LOG_DIR` (default `./data/logs`)
- `CR_RETENTION_DAYS` (default `30`)
- `CR_LLM_JUDGE_ENABLED=true|false`
- `CR_LLM_PROVIDER=openai|ollama`
- `CR_LLM_MODEL` (default `gpt-4o-mini`)
- `OPENAI_API_KEY`
- `OLLAMA_BASE_URL` (default `http://localhost:11434/api`)

## Tests
```bash
bun test
```

## Docker
```bash
docker build -t claw-rubber .
docker run --rm -p 3000:3000 -e BRAVE_API_KEY=... claw-rubber
```
