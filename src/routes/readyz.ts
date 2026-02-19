import { jsonResponse } from "../lib/http"
import type { ServerContext } from "../server-context"

export function handleReadyz(_request: Request, ctx: ServerContext): Response {
  const searchEnabled = ctx.config.search.strategy !== "disabled"
  const braveRequired =
    searchEnabled && (ctx.config.search.primary === "brave" || ctx.config.search.strategy === "fallback")
  const searxngRequired =
    searchEnabled &&
    (ctx.config.search.primary === "searxng" || ctx.config.search.strategy === "fallback")

  const braveApiKeyConfigured = !braveRequired || Boolean(ctx.config.braveApiKey)
  const searxngBaseUrlConfigured = !searxngRequired || Boolean(ctx.config.searxng.baseUrl)
  const searxngBaseUrlValid = !searxngRequired || isValidUrl(ctx.config.searxng.baseUrl)
  const dbReachable = ctx.db.isHealthy()
  const browserlessConfigured =
    ctx.config.websiteRendererBackend !== "browserless" || Boolean(ctx.config.browserless.baseUrl)
  const browserlessBaseUrlValid =
    ctx.config.websiteRendererBackend !== "browserless" || isValidUrl(ctx.config.browserless.baseUrl)

  const checks = {
    search_strategy: ctx.config.search.strategy,
    search_primary: ctx.config.search.primary,
    search_enabled: searchEnabled,
    brave_required: braveRequired,
    brave_api_key_configured: braveApiKeyConfigured,
    searxng_required: searxngRequired,
    searxng_base_url_configured: searxngBaseUrlConfigured,
    searxng_base_url_valid: searxngBaseUrlValid,
    db_reachable: dbReachable,
    website_renderer_backend: ctx.config.websiteRendererBackend,
    browserless_configured: browserlessConfigured,
    browserless_base_url_valid: browserlessBaseUrlValid,
  }

  const ready =
    braveApiKeyConfigured &&
    searxngBaseUrlConfigured &&
    searxngBaseUrlValid &&
    dbReachable &&
    browserlessConfigured &&
    browserlessBaseUrlValid
  return jsonResponse(
    {
      status: ready ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      checks,
    },
    ready ? 200 : 503,
  )
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}
