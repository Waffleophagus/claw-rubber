# claw-rubber

A Bun-based secure proxy for OpenClaw web access via Brave Search.

## Features
- Brave Web Search proxy (`/v1/search`)
- Opaque result ID fetch flow (`/v1/fetch`)
- OpenClaw-style direct URL fetch flow (`/v1/web-fetch`)
- Human investigator dashboard (`/dashboard`)
- Domain allowlist + blocklist support
- Runtime allowlist updates from dashboard/API
- Prompt-injection rule scoring and fail-closed policy
- Obfuscation-aware detection (typoglycemia, confusables, escape/encoding signals)
- Language-selector exception handling for benign multilingual lists (confusable signal only)
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
export CLAWRUBBER_LANGUAGE_NAME_ALLOWLIST_EXTRA="Klingon,tlhIngan Hol"
export CLAWRUBBER_WEBSITE_RENDERER_BACKEND="none"
export CLAWRUBBER_RATE_LIMIT="free"
export CLAWRUBBER_BRAVE_QUEUE_MAX="10"
```

3. Run server:
```bash
bun run dev
```

Server runs on `http://localhost:3000` by default.

## Endpoints
- `POST /v1/search`
- `POST /v1/fetch`
- `POST /v1/web-fetch`
- `GET /healthz`
- `GET /dashboard`
- `GET /v1/dashboard/overview`
- `GET /v1/dashboard/events`
- `GET /v1/dashboard/events/:id`
- `GET /v1/dashboard/timeseries`
- `GET /v1/dashboard/top-domains`
- `GET /v1/dashboard/top-flags`
- `GET /v1/dashboard/top-reasons`
- `GET /v1/dashboard/allowlist`
- `POST /v1/dashboard/allowlist`

## Investigator Dashboard
The dashboard is designed for human false-positive investigation and policy tuning:
- See why requests were blocked (reason, `blockedBy`, flags, score, thresholds)
- Track allow-path exceptions (`allowedBy`) such as domain allowlist bypass and language exceptions
- Review blocked fetch events and search domain blocks
- Open event details including stored flagged payload content
- Add domains to runtime allowlist without restarting the service

Open:
```bash
http://localhost:3000/dashboard
```

Seed local dashboard data (for local UI testing):
```bash
bun run db:seed -- --reset
```

Optional seeding flags:
- `--db ./data/claw-rubber.db` to target a specific SQLite file
- `--fetch-events 200` to increase synthetic fetch traces
- `--search-blocks 40` to increase synthetic search-block traces

Runtime allowlist behavior:
- Added domains are persisted in SQLite and applied immediately.
- Blocklist still has highest precedence (blocklist always wins).
- Environment allowlist (`CLAWRUBBER_ALLOWLIST_DOMAINS`) remains active and is merged with runtime entries.

## Web Fetch Compatibility
`/v1/web-fetch` is the OpenClaw-style direct fetch endpoint.

Request:
```json
{
  "url": "https://example.com",
  "extractMode": "markdown",
  "maxChars": 5000
}
```

Notes:
- `extractMode`: `markdown` (default) or `text`.
- If `maxChars` is omitted, Claw-Rubber returns full extracted content.
- Truncation happens only when `maxChars` is explicitly provided.

## URL Exposure
Search URLs are redacted by default. Set `CLAWRUBBER_REDACT_URLS=false` to include URLs in `/v1/search` responses.

Successful full-content responses (`/v1/fetch` and `/v1/web-fetch`) include vetted `url` and `final_url` by default.
Set `CLAWRUBBER_EXPOSE_SAFE_CONTENT_URLS=false` to hide these URL fields.

## Brave Rate Limiting
Brave requests are rate-limited through an internal queue to avoid 429s under burst traffic.

- `CLAWRUBBER_RATE_LIMIT` accepts either a tier name or a positive integer:
  - Tier presets: `free=1 rps`, `paid=20 rps`, `base=20 rps`, `pro=50 rps`
  - Numeric override examples: `1`, `20`, `50`, `75`
- Queue capacity is configurable with `CLAWRUBBER_BRAVE_QUEUE_MAX` (default `10`).
- When queue is full, `/v1/search` returns `503`.
- On Brave `429`, the client retries by default using `retry-after`/`x-ratelimit-reset` headers.

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
- `CLAWRUBBER_RATE_LIMIT` (`free|paid|base|pro` or positive integer, default `free`)
- `CLAWRUBBER_BRAVE_QUEUE_MAX` (default `10`)
- `CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_ON_429=true|false` (default `true`)
- `CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_MAX` (default `1`)
- `CLAWRUBBER_PROFILE=baseline|strict|paranoid`
- `CLAWRUBBER_REDACT_URLS=true|false`
- `CLAWRUBBER_EXPOSE_SAFE_CONTENT_URLS=true|false` (default `true`)
- `CLAWRUBBER_FAIL_CLOSED=true|false`
- `CLAWRUBBER_ALLOWLIST_DOMAINS=example.com,docs.example.com`
- `CLAWRUBBER_BLOCKLIST_DOMAINS=bad.example`
- `CLAWRUBBER_LANGUAGE_NAME_ALLOWLIST_EXTRA=Euskalki Berezia,tlhIngan Hol`
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

Integration tests (not run by default):
```bash
# 1) Fill in one file with your proxy/auth/test targets:
#    test/integration/config.ts
#
# 2) Run all integration tests:
bun run test:integration
#
# Optional overrides without editing config.ts:
bun run test:integration https://your-proxy-domain
bun run test:integration https://your-proxy-domain YOUR_BEARER_TOKEN
#
# Run only web-fetch integration tests:
bun test ./test/integration/web-fetch.integration.ts
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
- `claw-rubber` image default: `ghcr.io/waffleophagus/claw-rubber:main`

Run claw-rubber only (plain HTTP fetch):
```bash
export CLAWRUBBER_BRAVE_API_KEY="..."
docker compose pull
docker compose up -d
```

Run claw-rubber + Browserless rendering:
```bash
export CLAWRUBBER_BRAVE_API_KEY="..."
export CLAWRUBBER_WEBSITE_RENDERER_BACKEND="browserless"
export CLAWRUBBER_BROWSERLESS_URL="http://browserless:3000"
docker compose --profile browserless pull
docker compose --profile browserless up -d
```

Optional local Browserless debug port:
- Browserless is exposed on `http://localhost:3001` by default (`BROWSERLESS_HOST_PORT` to override).
- Override app image/tag with `CLAWRUBBER_IMAGE` in `.env` if needed.
- If GHCR denies pulls, run: `docker login ghcr.io`.

### Docker volume permissions troubleshooting
If startup fails with `EACCES` on `/data/logs`, your existing named volume may be owned by root.

One-time fix:
```bash
docker compose run --rm --user 0:0 claw-rubber sh -lc 'chown -R bun:bun /data'
docker compose up -d
```

If that still fails, recreate the volume:
```bash
docker compose down -v
docker compose up -d
```
