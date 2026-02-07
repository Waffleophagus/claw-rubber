import { z } from "zod"
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http"
import type { ServerContext } from "../server-context"
import { processFetchedPage } from "../services/fetch-processing"

const FetchRequestSchema = z.object({
  result_id: z.string().uuid(),
})

export async function handleFetch(request: Request, ctx: ServerContext): Promise<Response> {
  const started = Date.now()
  const payload = await readJsonBody(request)
  const parsed = FetchRequestSchema.safeParse(payload)

  if (!parsed.success) {
    return errorResponse(400, "Invalid fetch payload", parsed.error.flatten())
  }

  const resultId = parsed.data.result_id
  const record = ctx.db.getSearchResult(resultId)

  if (!record) {
    return errorResponse(404, "Unknown or expired result_id")
  }

  try {
    const processed = await processFetchedPage(ctx, {
      startedAt: started,
      eventId: resultId,
      url: record.url,
      domain: record.domain,
      outputMode: "text",
      outputMaxChars: ctx.config.profileSettings.maxExtractedChars,
      traceKind: "search-result-fetch",
      searchContext: {
        requestId: record.requestId,
        query: record.query,
        rank: record.rank ?? null,
      },
    })

    if (processed.kind === "block") {
      return jsonResponse(
        {
          result_id: resultId,
          source: processed.source
            ? {
                domain: processed.source.domain,
                fetch_backend: processed.source.fetch_backend,
                rendered: processed.source.rendered,
                fallback_used: processed.source.fallback_used,
              }
            : undefined,
          safety: processed.safety,
        },
        422,
      )
    }

    const payload: Record<string, unknown> = {
      result_id: resultId,
      content: processed.content,
      content_summary: processed.contentSummary,
      safety: processed.safety,
      source: {
        domain: processed.source.domain,
        fetch_backend: processed.source.fetch_backend,
        rendered: processed.source.rendered,
        fallback_used: processed.source.fallback_used,
      },
    }

    if (ctx.config.exposeSafeContentUrls) {
      payload.url = record.url
      payload.final_url = processed.source.final_url
    }

    return jsonResponse(payload)
  } catch (error) {
    ctx.loggers.app.error({ error, resultId, url: record.url }, "fetch request failed")
    return errorResponse(502, "Failed to fetch upstream page content")
  }
}
