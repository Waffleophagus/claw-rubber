# claw-rubber

A Bun-based secure proxy for OpenClaw web access via Brave Search.

## Features
- Brave Web Search proxy (`/v1/search`)
- Opaque result ID fetch flow (`/v1/fetch`)
- Domain allowlist + blocklist support
- Prompt-injection rule scoring and fail-closed policy
- Obfuscation-aware detection (typoglycemia, confusables, escape/encoding signals)
- Optional model adjudication via Vercel AI SDK (OpenAI/Ollama)
- Optional Browserless-rendered fetches for JavaScript-heavy pages
- SQLite audit storage for flagged payloads
- Rotating structured log files

## Quick Start
1. Install dependencies:
```bash
bun install
```

2. Configure environment:
```bash
export CLAWRUBBER_BRAVE_API_KEY="..."
export CLAWRUBBER_PROFILE="strict"
export CLAWRUBBER_ALLOWLIST_DOMAINS="docs.bun.sh"
export CLAWRUBBER_BLOCKLIST_DOMAINS="evil.example"
export CLAWRUBBER_WEBSITE_RENDERER_BACKEND="none"
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
Search URLs are redacted by default. Set `CLAWRUBBER_REDACT_URLS=false` to include URLs in `/v1/search` responses.

## Domain Policy
- Blocklist wins over allowlist.
- Allowlisted domains bypass prompt-injection filtering.
- Blocklisted domains are denied in both search availability and fetch.

## Website Rendering
- Default behavior uses plain HTTP fetches.
- Set `CLAWRUBBER_WEBSITE_RENDERER_BACKEND=browserless` to fetch rendered HTML through Browserless.
- If Browserless is enabled and `CLAWRUBBER_BROWSERLESS_FALLBACK_TO_HTTP=true`, failed render attempts fall back to plain fetch.
- Run Browserless in an isolated network context; treat it as a high-privilege fetcher.

## Environment Variables
- `CLAWRUBBER_BRAVE_API_KEY`
- `CLAWRUBBER_PROFILE=baseline|strict|paranoid`
- `CLAWRUBBER_REDACT_URLS=true|false`
- `CLAWRUBBER_FAIL_CLOSED=true|false`
- `CLAWRUBBER_ALLOWLIST_DOMAINS=example.com,docs.example.com`
- `CLAWRUBBER_BLOCKLIST_DOMAINS=bad.example`
- `CLAWRUBBER_DB_PATH` (default `./data/claw-rubber.db`)
- `CLAWRUBBER_LOG_DIR` (default `./data/logs`)
- `CLAWRUBBER_RETENTION_DAYS` (default `30`)
- `CLAWRUBBER_LLM_JUDGE_ENABLED=true|false`
- `CLAWRUBBER_LLM_PROVIDER=openai|ollama`
- `CLAWRUBBER_LLM_MODEL` (default `gpt-4o-mini`)
- `CLAWRUBBER_OPENAI_API_KEY`
- `CLAWRUBBER_OLLAMA_BASE_URL` (default `http://localhost:11434/api`)
- `CLAWRUBBER_WEBSITE_RENDERER_BACKEND=none|browserless`
- `CLAWRUBBER_BROWSERLESS_URL` (default `http://browserless:3000`)
- `CLAWRUBBER_BROWSERLESS_TOKEN`
- `CLAWRUBBER_BROWSERLESS_TIMEOUT_MS` (default `12000`)
- `CLAWRUBBER_BROWSERLESS_WAIT_UNTIL=domcontentloaded|load|networkidle`
- `CLAWRUBBER_BROWSERLESS_WAIT_FOR_SELECTOR`
- `CLAWRUBBER_BROWSERLESS_MAX_HTML_BYTES` (default `1500000`)
- `CLAWRUBBER_BROWSERLESS_FALLBACK_TO_HTTP=true|false`
- `CLAWRUBBER_BROWSERLESS_BLOCK_ADS=true|false`

## Tests
```bash
bun test
```

## Docker
```bash
docker build -t claw-rubber .
docker run --rm -p 3000:3000 -e CLAWRUBBER_BRAVE_API_KEY=... claw-rubber
```

## Docker Compose
`docker-compose.yml` includes:
- `claw-rubber` service (always)
- `browserless` service (optional profile: `browserless`)

Run claw-rubber only (plain HTTP fetch):
```bash
export CLAWRUBBER_BRAVE_API_KEY="..."
docker compose up --build
```

Run claw-rubber + Browserless rendering:
```bash
export CLAWRUBBER_BRAVE_API_KEY="..."
export CLAWRUBBER_WEBSITE_RENDERER_BACKEND="browserless"
export CLAWRUBBER_BROWSERLESS_URL="http://browserless:3000"
docker compose --profile browserless up --build
```

Optional local Browserless debug port:
- Browserless is exposed on `http://localhost:3001` by default (`BROWSERLESS_HOST_PORT` to override).
