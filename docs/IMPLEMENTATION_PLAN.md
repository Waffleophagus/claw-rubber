# Claw-Rubber v1 Implementation Plan

## Summary
Claw-Rubber will be a Bun-based safety proxy between OpenClaw and Brave Web Search.  
OpenClaw calls this proxy for search and content retrieval instead of calling Brave or arbitrary websites directly.

The proxy will:
- Query Brave Web Search for discovery.
- Return sanitized metadata and opaque IDs to OpenClaw.
- Fetch result pages server-side by opaque ID.
- Optionally fetch fully rendered pages through Browserless.
- Apply prompt-injection defenses before returning content.
- Persist malicious/flagged payloads and audit events.
- Support configurable safety profiles and optional model-based adjudication.

## v1 Scope
Endpoints:
- `POST /v1/search`
- `POST /v1/fetch`
- `POST /v1/web-fetch`
- `GET /healthz`

Out of scope for v1:
- Brave summarizer endpoints
- Brave chat endpoints
- UI dashboard

## Public API Contract
### `POST /v1/search`
Request:
- `query: string` (required)
- `count?: number` (default `5`, max `20`)
- `country?: string`
- `search_lang?: string`
- `safesearch?: "off" | "moderate" | "strict"` (default `moderate`)
- `freshness?: string`

Behavior:
- Calls Brave Web Search endpoint.
- Generates `result_id` per returned result.
- Stores internal mapping `result_id -> url + metadata + policy decision`.

Response:
- `request_id: string`
- `results: Array<{ result_id: string; title: string; snippet: string; source: string; published?: string; availability: "allowed" | "blocked"; risk_hint?: "low" | "medium" | "high"; url?: string }>`
- `meta: { total_returned: number; urls_exposed: boolean }`

URL handling:
- Default: URLs redacted (`url` omitted).
- Config flag may allow URL inclusion.

### `POST /v1/fetch`
Request:
- `result_id: string`

Behavior:
- Resolves URL from server-side cache.
- Applies hard domain policy first (allowlist/blocklist).
- Retrieves and sanitizes content with SSRF/network limits.
- Applies rule-based and optional LLM-based injection checks.

Response (allow):
- `result_id: string`
- `content: string`
- `content_summary: string`
- `safety: { decision: "allow"; score: number; flags: string[]; bypassed?: boolean }`

Response (block):
- `result_id: string`
- `safety: { decision: "block"; score: number; flags: string[]; reason: string }`
- HTTP `422` by default (fail-closed).

### `POST /v1/web-fetch`
Request:
- `url: string` (required)
- `extractMode?: "text" | "markdown"` (default `markdown`)
- `maxChars?: number` (optional; unlimited when omitted)

Behavior:
- Fetches the requested page URL through the same safety pipeline used by `/v1/fetch`.
- Supports direct URL retrieval for OpenClaw-style web-fetch flows.

Response (allow):
- `fetch_id: string`
- `url: string`
- `final_url: string`
- `extract_mode: "text" | "markdown"`
- `content: string`
- `content_summary: string`
- `truncated: boolean`
- `safety: { decision: "allow"; score: number; flags: string[]; bypassed?: boolean }`

Response (block):
- `fetch_id: string`
- `url: string`
- `final_url?: string`
- `extract_mode: "text" | "markdown"`
- `safety: { decision: "block"; score: number; flags: string[]; reason: string }`
- HTTP `422` by default (fail-closed).

### `GET /healthz`
- Returns liveness and readiness status with dependency checks.

## Domain Policy (Allowlist + Blocklist)
Config:
- `CLAWRUBBER_ALLOWLIST_DOMAINS` (comma-separated domains)
- `CLAWRUBBER_BLOCKLIST_DOMAINS` (comma-separated domains)

Rules:
1. Blocklist has highest priority:
   - If domain matches blocklist, result is marked blocked immediately.
   - `/v1/fetch` for blocklisted results always denies access.
2. Allowlist bypass:
   - If domain matches allowlist and not blocklisted, injection filtering/scoring is bypassed.
   - Fetch still enforces transport protections (SSRF checks, size/time limits, content-type limits).
3. Non-listed domains:
   - Full sanitization and policy checks apply.

Matching behavior:
- Exact domain and subdomain match supported (e.g., `example.com` matches `example.com` and `docs.example.com`).

## Security Controls
### Input/Output controls
- Strict JSON schema validation for all endpoint inputs.
- No direct arbitrary URL fetch endpoint (only opaque `result_id`).
- Optional URL redaction enabled by default.

### Retrieval controls
- HTTPS-only by default.
- Redirect limit with validation on every hop.
- Localhost/private CIDR rejection (anti-SSRF).
- Content-type allowlist and max body size.
- Request timeout and user-agent control.
- Optional Browserless renderer backend for JavaScript-rendered pages.
- Configurable fallback from Browserless to plain HTTP fetch.

### Injection defenses
- Deterministic heuristic scoring based on OWASP guidance:
  - Instruction override and role hijacking phrases
  - Tool abuse and exfiltration phrases
  - Encoding/obfuscation and invisible character patterns
- Decision profiles:
  - `baseline`
  - `strict` (default)
  - `paranoid`
- Fail-closed default for suspicious content above configured threshold.

### Optional model adjudication
- Rules-first, model-optional.
- Vercel AI SDK providers:
  - OpenAI
  - Ollama
- Model used only for gray-zone decisions.

## Persistence and Logging
### SQLite (`bun:sqlite`)
Tables:
- `search_requests`
- `search_results_cache`
- `fetch_events`
- `flagged_payloads`

### Logging
- Structured JSON logs using a logging library with file rotation.
- Separate channels for:
  - Access events
  - Security decisions
  - Upstream/provider errors

Retention:
- Configurable retention days for flagged payloads and logs.

## Config Surface
- `CLAWRUBBER_BRAVE_API_KEY`
- `CLAWRUBBER_PROFILE=baseline|strict|paranoid` (default `strict`)
- `CLAWRUBBER_REDACT_URLS=true|false` (default `true`)
- `CLAWRUBBER_FAIL_CLOSED=true|false` (default `true`)
- `CLAWRUBBER_ALLOWLIST_DOMAINS=...`
- `CLAWRUBBER_BLOCKLIST_DOMAINS=...`
- `CLAWRUBBER_DB_PATH` (default `/data/claw-rubber.db`)
- `CLAWRUBBER_LOG_DIR` (default `/data/logs`)
- `CLAWRUBBER_RETENTION_DAYS` (default `30`)
- `CLAWRUBBER_LLM_JUDGE_ENABLED=true|false` (default `false`)
- `CLAWRUBBER_LLM_PROVIDER=openai|ollama`
- `CLAWRUBBER_LLM_MODEL=...`
- Provider keys/endpoints (`CLAWRUBBER_OPENAI_API_KEY`, `CLAWRUBBER_OLLAMA_BASE_URL`)
- `CLAWRUBBER_WEBSITE_RENDERER_BACKEND=none|browserless` (default `none`)
- `CLAWRUBBER_BROWSERLESS_URL` (default `http://browserless:3000`)
- `CLAWRUBBER_BROWSERLESS_TOKEN`
- `CLAWRUBBER_BROWSERLESS_TIMEOUT_MS` (default `12000`)
- `CLAWRUBBER_BROWSERLESS_WAIT_UNTIL=domcontentloaded|load|networkidle`
- `CLAWRUBBER_BROWSERLESS_WAIT_FOR_SELECTOR`
- `CLAWRUBBER_BROWSERLESS_MAX_HTML_BYTES` (default `1500000`)
- `CLAWRUBBER_BROWSERLESS_FALLBACK_TO_HTTP=true|false` (default `true`)
- `CLAWRUBBER_BROWSERLESS_BLOCK_ADS=true|false` (default `true`)

## OpenClaw Skill File
Create a skill markdown for OpenClaw users to enforce:
- Use `/v1/search` for discovery.
- Never browse external URLs directly.
- Use `/v1/fetch` with `result_id`.
- Handle blocked responses by choosing alternate results.
- Cite source/title/result_id.

## Packaging and Delivery
### Local
- `bun install`
- `bun run dev` / `bun run start`
- `bun test`

### Docker
- Multi-stage Bun image.
- Non-root runtime user.
- Volume mount for `/data`.
- Healthcheck against `/healthz`.

### GitHub Actions
- CI workflow: install, typecheck, test.
- Container workflow: build and push image to GHCR on `main` and tags.

## Test Plan
Unit tests:
- Domain allowlist/blocklist precedence.
- Injection scoring and threshold behavior.
- Policy decision combinations.

Integration tests:
- `/v1/search` transforms Brave results and redacts URLs by default.
- `/v1/fetch` blocks blocklisted domains.
- `/v1/fetch` bypasses injection filtering for allowlisted domains.
- `/v1/fetch` blocks malicious content for non-allowlisted domains.
- SSRF and redirect protections.

Acceptance criteria:
- OpenClaw can complete browse workflow with no direct URL access required.
- Blocklist always blocks, allowlist always bypasses filtering (with network safeguards retained).
- Flagged/malicious content persisted and auditable.
- Service runs locally and in Docker with equivalent behavior.
