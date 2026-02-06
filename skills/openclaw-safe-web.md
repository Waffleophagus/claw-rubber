# OpenClaw Safe Web Skill

## Purpose
Use Claw-Rubber as the only web-search and page-retrieval channel.

## Rules
1. Use `POST /v1/search` for all web discovery.
2. Never browse external URLs directly.
3. Use `POST /v1/fetch` with `result_id` from search results.
4. If `/v1/fetch` returns a block decision, do not force retry on the same `result_id`.
5. If blocked, pick another result or refine the query.
6. Cite sources using `title`, `source`, and `result_id`.

## Workflow
1. Send search payload:
```json
{
  "query": "...",
  "count": 5,
  "safesearch": "moderate"
}
```

2. Receive result list with opaque IDs:
```json
{
  "results": [
    {
      "result_id": "...",
      "title": "...",
      "snippet": "...",
      "source": "...",
      "availability": "allowed"
    }
  ]
}
```

3. Retrieve content through proxy:
```json
{
  "result_id": "..."
}
```

4. Use `content` and `content_summary` from proxy response for reasoning.
