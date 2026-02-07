import { jsonResponse } from "../lib/http"
import type { ServerContext } from "../server-context"

export function handleHealthz(request: Request, ctx: ServerContext): Response {
  return jsonResponse({
    status: "ok",
    timestamp: new Date().toISOString(),
    checks: {
      process_running: true,
      request_method: request.method,
      profile: ctx.config.profile,
    },
  })
}
