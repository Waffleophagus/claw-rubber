import { jsonResponse } from "../lib/http"
import type { ServerContext } from "../server-context"

export function handleReadyz(_request: Request, ctx: ServerContext): Response {
  const braveApiKeyConfigured = Boolean(ctx.config.braveApiKey)
  const dbReachable = ctx.db.isHealthy()
  const browserlessConfigured =
    ctx.config.websiteRendererBackend !== "browserless" || Boolean(ctx.config.browserless.baseUrl)
  const browserlessBaseUrlValid =
    ctx.config.websiteRendererBackend !== "browserless" || isValidUrl(ctx.config.browserless.baseUrl)

  const checks = {
    brave_api_key_configured: braveApiKeyConfigured,
    db_reachable: dbReachable,
    website_renderer_backend: ctx.config.websiteRendererBackend,
    browserless_configured: browserlessConfigured,
    browserless_base_url_valid: browserlessBaseUrlValid,
  }

  const ready = braveApiKeyConfigured && dbReachable && browserlessConfigured && browserlessBaseUrlValid
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
