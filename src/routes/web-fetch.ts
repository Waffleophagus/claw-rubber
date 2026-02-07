import { z } from "zod";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http";
import type { ServerContext } from "../server-context";
import { processFetchedPage } from "../services/fetch-processing";

const WebFetchRequestSchema = z.object({
  url: z.string().url(),
  extractMode: z.enum(["text", "markdown"]).default("markdown"),
  maxChars: z.number().int().min(1).max(5_000_000).optional(),
});

export async function handleWebFetch(request: Request, ctx: ServerContext): Promise<Response> {
  const started = Date.now();
  const payload = await readJsonBody(request);
  const parsed = WebFetchRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return errorResponse(400, "Invalid web fetch payload", parsed.error.flatten());
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(parsed.data.url);
  } catch {
    return errorResponse(400, "Invalid URL");
  }

  if (targetUrl.protocol !== "https:") {
    return errorResponse(400, "Only https URLs are allowed");
  }

  const fetchId = crypto.randomUUID();
  const requestedUrl = targetUrl.toString();
  const domain = targetUrl.hostname.toLowerCase();

  try {
    const processed = await processFetchedPage(ctx, {
      startedAt: started,
      eventId: fetchId,
      url: requestedUrl,
      domain,
      outputMode: parsed.data.extractMode,
      outputMaxChars: parsed.data.maxChars,
    });

    if (processed.kind === "block") {
      return jsonResponse(
        {
          fetch_id: fetchId,
          url: requestedUrl,
          final_url: processed.source?.final_url,
          extract_mode: parsed.data.extractMode,
          safety: processed.safety,
          source: processed.source,
        },
        422,
      );
    }

    return jsonResponse({
      fetch_id: fetchId,
      url: requestedUrl,
      final_url: processed.source.final_url,
      extract_mode: parsed.data.extractMode,
      content: processed.content,
      content_summary: processed.contentSummary,
      truncated: processed.truncated,
      safety: processed.safety,
      source: processed.source,
    });
  } catch (error) {
    ctx.loggers.app.error({ error, fetchId, url: requestedUrl }, "web fetch request failed");
    return errorResponse(502, "Failed to fetch upstream page content");
  }
}
