import { jsonResponse } from "../lib/http";
import type { ServerContext } from "../server-context";

export function handleHealthz(_request: Request, ctx: ServerContext): Response {
  const braveConfigured = Boolean(ctx.config.braveApiKey);

  return jsonResponse({
    status: "ok",
    timestamp: new Date().toISOString(),
    checks: {
      brave_api_key_configured: braveConfigured,
      llm_judge_enabled: ctx.config.llmJudgeEnabled,
      profile: ctx.config.profile,
    },
  });
}
