import { z } from "zod";
import { evaluateDomainPolicy } from "../lib/domain-policy";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http";
import type { ServerContext } from "../server-context";
import { scorePromptInjection } from "../services/injection-rules";
import { decidePolicy } from "../services/policy";
import { sanitizeToText, summarizeText } from "../services/sanitizer";

const FetchRequestSchema = z.object({
  result_id: z.string().uuid(),
});

export async function handleFetch(request: Request, ctx: ServerContext): Promise<Response> {
  const started = Date.now();
  const payload = await readJsonBody(request);
  const parsed = FetchRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return errorResponse(400, "Invalid fetch payload", parsed.error.flatten());
  }

  const resultId = parsed.data.result_id;
  const record = ctx.db.getSearchResult(resultId);

  if (!record) {
    return errorResponse(404, "Unknown or expired result_id");
  }

  const domainPolicy = evaluateDomainPolicy(record.domain, ctx.config.allowlistDomains, ctx.config.blocklistDomains);
  if (domainPolicy.action === "block") {
    ctx.db.storeFetchEvent({
      resultId,
      domain: record.domain,
      decision: "block",
      score: 0,
      flags: ["domain_blocklist"],
      reason: domainPolicy.reason ?? "Domain blocked",
      bypassed: false,
      durationMs: Date.now() - started,
    });

    ctx.loggers.security.warn(
      {
        resultId,
        domain: record.domain,
        reason: domainPolicy.reason,
      },
      "blocked fetch by domain blocklist",
    );

    return jsonResponse(
      {
        result_id: resultId,
        safety: {
          decision: "block",
          score: 0,
          flags: ["domain_blocklist"],
          reason: domainPolicy.reason ?? "Domain blocked",
        },
      },
      422,
    );
  }

  try {
    const fetched = await ctx.contentFetcher.fetchPage(record.url);
    if (fetched.fallbackUsed) {
      ctx.loggers.app.warn(
        {
          resultId,
          domain: record.domain,
          requestedUrl: record.url,
          backendUsed: fetched.backendUsed,
        },
        "browserless fetch failed, used http fallback",
      );
    }

    const cleanText = sanitizeToText(fetched.body, ctx.config.profileSettings.maxExtractedChars);

    let score = 0;
    let flags: string[] = [];
    let normalizationApplied: string[] = [];
    let obfuscationSignals: string[] = [];

    if (domainPolicy.action === "inspect") {
      const scored = scorePromptInjection(cleanText);
      score = scored.score;
      flags = scored.flags;
      normalizationApplied = scored.normalizationApplied ?? [];
      obfuscationSignals = scored.obfuscationSignals ?? [];
    }

    const shouldUseJudge =
      ctx.config.llmJudgeEnabled &&
      domainPolicy.action === "inspect" &&
      score >= ctx.config.profileSettings.mediumThreshold &&
      score < ctx.config.profileSettings.blockThreshold;

    const judge = shouldUseJudge ? await ctx.llmJudge.classify(cleanText, score, flags) : null;

    const decision = decidePolicy(
      ctx.config,
      score,
      flags,
      domainPolicy.action,
      domainPolicy.reason,
      judge,
    );

    ctx.db.storeFetchEvent({
      resultId,
      domain: record.domain,
      decision: decision.decision,
      score: decision.score,
      flags: decision.flags,
      reason: decision.reason ?? null,
      bypassed: decision.bypassed ?? false,
      durationMs: Date.now() - started,
    });

    if (decision.decision === "block") {
      ctx.db.storeFlaggedPayload({
        resultId,
        url: record.url,
        domain: record.domain,
        score: decision.score,
        flags: decision.flags,
        reason: decision.reason ?? "Blocked by policy",
        content: cleanText.slice(0, 30_000),
      });

      ctx.loggers.security.warn(
        {
          resultId,
          domain: record.domain,
          score: decision.score,
          flags: decision.flags,
          reason: decision.reason,
        },
        "blocked suspicious fetch content",
      );

      return jsonResponse(
        {
          result_id: resultId,
          source: {
            domain: record.domain,
            fetch_backend: fetched.backendUsed,
            rendered: fetched.rendered,
            fallback_used: fetched.fallbackUsed,
          },
          safety: {
            decision: "block",
            score: decision.score,
            flags: decision.flags,
            reason: decision.reason ?? "Blocked by policy",
            normalization_applied: normalizationApplied,
            obfuscation_signals: obfuscationSignals,
          },
        },
        422,
      );
    }

    return jsonResponse({
      result_id: resultId,
      content: cleanText,
      content_summary: summarizeText(cleanText),
      safety: {
        decision: "allow",
        score: decision.score,
        flags: decision.flags,
        bypassed: decision.bypassed ?? false,
        normalization_applied: normalizationApplied,
        obfuscation_signals: obfuscationSignals,
      },
      source: {
        domain: record.domain,
        fetch_backend: fetched.backendUsed,
        rendered: fetched.rendered,
        fallback_used: fetched.fallbackUsed,
      },
    });
  } catch (error) {
    ctx.loggers.app.error({ error, resultId, url: record.url }, "fetch request failed");
    return errorResponse(502, "Failed to fetch upstream page content");
  }
}
