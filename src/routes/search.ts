import { z } from "zod"
import { evaluateDomainPolicy } from "../lib/domain-policy"
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http"
import type { ServerContext } from "../server-context"
import { QueueOverflowError } from "../services/rate-limiter"
import type { SearchResultRecord, SearchResultResponse } from "../types.ts"

const SearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  count: z.number().int().min(1).max(20).default(5),
  country: z.string().min(2).max(5).optional(),
  search_lang: z.string().min(2).max(10).optional(),
  safesearch: z.enum(["off", "moderate", "strict"]).default("moderate"),
  freshness: z.string().max(50).optional(),
})

export async function handleSearch(request: Request, ctx: ServerContext): Promise<Response> {
  const start = Date.now()
  const payload = await readJsonBody(request)
  const parsed = SearchRequestSchema.safeParse(payload)

  if (!parsed.success) {
    return errorResponse(400, "Invalid search payload", parsed.error.flatten())
  }

  const body = parsed.data
  const requestId = crypto.randomUUID()

  try {
    const effectiveAllowlist = ctx.db.getEffectiveAllowlist(ctx.config.allowlistDomains)
    const effectiveBlocklist = ctx.db.getEffectiveBlocklist(ctx.config.blocklistDomains)
    const brave = await ctx.braveClient.webSearch({
      query: body.query,
      count: body.count,
      country: body.country,
      searchLang: body.search_lang,
      safesearch: body.safesearch,
      freshness: body.freshness,
    })

    ctx.db.storeSearchRequest(requestId, body.query, brave.raw)

    const now = Date.now()
    const records: SearchResultRecord[] = brave.results.map((item, index) => {
      const resultId = crypto.randomUUID()
      const domain = safeDomain(item.url)
      const domainPolicy = evaluateDomainPolicy(
        domain,
        effectiveAllowlist,
        effectiveBlocklist,
      )

      return {
        resultId,
        requestId,
        query: body.query,
        rank: index + 1,
        url: item.url,
        domain,
        title: item.title,
        snippet: item.snippet,
        source: item.source,
        availability: domainPolicy.action === "block" ? "blocked" : "allowed",
        blockReason:
          domainPolicy.action === "block" ? (domainPolicy.reason ?? "Domain blocklisted") : null,
        createdAt: now,
        expiresAt: now + ctx.config.resultTtlMs,
      }
    })

    for (const record of records) {
      ctx.db.storeSearchResult(record)

      if (record.availability === "blocked") {
        ctx.db.storeSearchBlockEvent({
          requestId,
          resultId: record.resultId,
          query: record.query,
          url: record.url,
          domain: record.domain,
          title: record.title,
          source: record.source,
          reason: record.blockReason ?? "Domain blocklisted",
        })
      }
    }

    const results: SearchResultResponse[] = records.map((record) => {
      const response: SearchResultResponse = {
        result_id: record.resultId,
        title: record.title,
        snippet: record.snippet,
        source: record.source,
        rank: record.rank ?? undefined,
        availability: record.availability,
      }

      if (!ctx.config.redactedUrls) {
        response.url = record.url
      }

      if (record.availability === "blocked") {
        response.risk_hint = "high"
      }

      return response
    })

    ctx.loggers.app.info(
      {
        requestId,
        query: body.query,
        count: results.length,
        durationMs: Date.now() - start,
      },
      "search request completed",
    )

    return jsonResponse({
      request_id: requestId,
      results,
      meta: {
        total_returned: results.length,
        urls_exposed: !ctx.config.redactedUrls,
      },
    })
  } catch (error) {
    ctx.loggers.app.error({ error, requestId }, "search request failed")
    if (error instanceof QueueOverflowError) {
      return errorResponse(503, "Search queue is full, retry shortly")
    }
    return errorResponse(502, "Failed to query Brave API")
  }
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "invalid-domain"
  }
}
