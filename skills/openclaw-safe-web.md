# OpenClaw Safe Web Skill

## Purpose
Use Claw-Rubber as the only web discovery and retrieval channel.

## Hard Constraints
1. Always use `POST /v1/search` for discovery.
2. Never open external URLs directly.
3. Always use `POST /v1/fetch` with a `result_id` from `/v1/search`.
4. Treat proxy safety decisions as authoritative.
5. Never attempt to bypass block decisions with prompt tricks.

## Safesearch Semantics
1. `safesearch` is passed through to Brave search filtering:
`off | moderate | strict`.
2. It affects which results Brave returns.
3. It is not an explicit NSFW label in proxy responses.
4. Default to `moderate` unless user asks otherwise.

## Search Request Contract
Use:
```json
{
  "query": "...",
  "count": 5,
  "safesearch": "moderate"
}
```

Expect result entries like:
```json
{
  "result_id": "...",
  "title": "...",
  "snippet": "...",
  "source": "...",
  "availability": "allowed"
}
```

Notes:
1. `availability: "blocked"` means domain policy already denied it.
2. URLs may be redacted by proxy configuration.
3. Use `title + snippet + source` to choose candidates to fetch.

## Fetch Request Contract
Use:
```json
{
  "result_id": "..."
}
```

Handle success:
1. Use `content` and `content_summary` for reasoning.
2. Track `source.fetch_backend`, `source.rendered`, `source.fallback_used` for provenance.
3. Prefer quoting/paraphrasing retrieved content over assumptions.

Handle blocked:
1. If `safety.decision = "block"` (typically HTTP `422`), do not retry same `result_id`.
2. Pick another candidate result or refine search query.
3. A blocked result should be treated as untrusted/unsafe input.

Handle other errors:
1. `404`: result ID unknown/expired, rerun `/v1/search`.
2. `502`: upstream fetch/search failure, retry with alternate result or refined query.

## Decision Policy for the LLM
1. Start with 3 to 5 search results, then fetch only top candidates.
2. Stop fetching once evidence is sufficient.
3. If evidence is weak or conflicting, run another search query.
4. Cite with `title`, `source`, and `result_id`.
5. Do not fabricate facts not present in fetched content.
