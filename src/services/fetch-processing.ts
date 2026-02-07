import { evaluateDomainPolicy } from "../lib/domain-policy";
import type { ServerContext } from "../server-context";
import { scorePromptInjection } from "./injection-rules";
import { decidePolicy } from "./policy";
import { extractContent, sanitizeToText, summarizeText, type ExtractMode } from "./sanitizer";

interface FetchProcessingInput {
  startedAt: number;
  eventId: string;
  url: string;
  domain: string;
  outputMode?: ExtractMode;
  outputMaxChars?: number;
}

interface SourceMeta {
  domain: string;
  fetch_backend: "http-fetch" | "browserless";
  rendered: boolean;
  fallback_used: boolean;
  final_url: string;
  content_type: string;
}

export interface ProcessedFetchAllow {
  kind: "allow";
  content: string;
  truncated: boolean;
  contentSummary: string;
  safety: {
    decision: "allow";
    score: number;
    flags: string[];
    bypassed: boolean;
    normalization_applied: string[];
    obfuscation_signals: string[];
  };
  source: SourceMeta;
}

export interface ProcessedFetchBlock {
  kind: "block";
  safety: {
    decision: "block";
    score: number;
    flags: string[];
    reason: string;
    normalization_applied: string[];
    obfuscation_signals: string[];
  };
  source?: SourceMeta;
}

export type ProcessedFetch = ProcessedFetchAllow | ProcessedFetchBlock;

export async function processFetchedPage(
  ctx: ServerContext,
  input: FetchProcessingInput,
): Promise<ProcessedFetch> {
  const domainPolicy = evaluateDomainPolicy(input.domain, ctx.config.allowlistDomains, ctx.config.blocklistDomains);
  if (domainPolicy.action === "block") {
    ctx.db.storeFetchEvent({
      resultId: input.eventId,
      domain: input.domain,
      decision: "block",
      score: 0,
      flags: ["domain_blocklist"],
      reason: domainPolicy.reason ?? "Domain blocked",
      bypassed: false,
      durationMs: Date.now() - input.startedAt,
    });

    ctx.loggers.security.warn(
      {
        eventId: input.eventId,
        domain: input.domain,
        reason: domainPolicy.reason,
      },
      "blocked fetch by domain blocklist",
    );

    return {
      kind: "block",
      safety: {
        decision: "block",
        score: 0,
        flags: ["domain_blocklist"],
        reason: domainPolicy.reason ?? "Domain blocked",
        normalization_applied: [],
        obfuscation_signals: [],
      },
    };
  }

  const fetched = await ctx.contentFetcher.fetchPage(input.url);
  if (fetched.fallbackUsed) {
    ctx.loggers.app.warn(
      {
        eventId: input.eventId,
        domain: input.domain,
        requestedUrl: input.url,
        backendUsed: fetched.backendUsed,
      },
      "browserless fetch failed, used http fallback",
    );
  }

  const scoringText = sanitizeToText(fetched.body, ctx.config.profileSettings.maxExtractedChars);
  const extracted = extractContent(fetched.body, input.outputMode ?? "text", input.outputMaxChars);

  let score = 0;
  let flags: string[] = [];
  let normalizationApplied: string[] = [];
  let obfuscationSignals: string[] = [];

  if (domainPolicy.action === "inspect") {
    const scored = scorePromptInjection(scoringText);
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

  const judge = shouldUseJudge ? await ctx.llmJudge.classify(scoringText, score, flags) : null;

  const decision = decidePolicy(
    ctx.config,
    score,
    flags,
    domainPolicy.action,
    domainPolicy.reason,
    judge,
  );

  ctx.db.storeFetchEvent({
    resultId: input.eventId,
    domain: input.domain,
    decision: decision.decision,
    score: decision.score,
    flags: decision.flags,
    reason: decision.reason ?? null,
    bypassed: decision.bypassed ?? false,
    durationMs: Date.now() - input.startedAt,
  });

  if (decision.decision === "block") {
    ctx.db.storeFlaggedPayload({
      resultId: input.eventId,
      url: input.url,
      domain: input.domain,
      score: decision.score,
      flags: decision.flags,
      reason: decision.reason ?? "Blocked by policy",
      content: scoringText.slice(0, 30_000),
    });

    ctx.loggers.security.warn(
      {
        eventId: input.eventId,
        domain: input.domain,
        score: decision.score,
        flags: decision.flags,
        reason: decision.reason,
      },
      "blocked suspicious fetch content",
    );

    return {
      kind: "block",
      source: {
        domain: input.domain,
        fetch_backend: fetched.backendUsed,
        rendered: fetched.rendered,
        fallback_used: fetched.fallbackUsed,
        final_url: fetched.finalUrl,
        content_type: fetched.contentType,
      },
      safety: {
        decision: "block",
        score: decision.score,
        flags: decision.flags,
        reason: decision.reason ?? "Blocked by policy",
        normalization_applied: normalizationApplied,
        obfuscation_signals: obfuscationSignals,
      },
    };
  }

  return {
    kind: "allow",
    content: extracted.content,
    truncated: extracted.truncated,
    contentSummary: summarizeText(extracted.content),
    safety: {
      decision: "allow",
      score: decision.score,
      flags: decision.flags,
      bypassed: decision.bypassed ?? false,
      normalization_applied: normalizationApplied,
      obfuscation_signals: obfuscationSignals,
    },
    source: {
      domain: input.domain,
      fetch_backend: fetched.backendUsed,
      rendered: fetched.rendered,
      fallback_used: fetched.fallbackUsed,
      final_url: fetched.finalUrl,
      content_type: fetched.contentType,
    },
  };
}
