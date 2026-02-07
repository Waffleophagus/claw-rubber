import { evaluateDomainPolicy } from "../lib/domain-policy";
import type { EvidenceMatch } from "../types.ts";
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
  traceKind?: "search-result-fetch" | "direct-web-fetch" | "unknown";
  searchContext?: {
    requestId: string;
    query: string;
    rank: number | null;
  };
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
  const traceKind = classifyTraceKind(input.traceKind, input.searchContext);
  const effectiveAllowlist = ctx.db.getEffectiveAllowlist(ctx.config.allowlistDomains);
  const domainPolicy = evaluateDomainPolicy(input.domain, effectiveAllowlist, ctx.config.blocklistDomains);
  if (domainPolicy.action === "block") {
    ctx.db.storeFetchEvent({
      resultId: input.eventId,
      url: input.url,
      domain: input.domain,
      decision: "block",
      score: 0,
      flags: ["domain_blocklist"],
      reason: domainPolicy.reason ?? "Domain blocked",
      blockedBy: "domain-policy",
      allowedBy: null,
      domainAction: domainPolicy.action,
      mediumThreshold: ctx.config.profileSettings.mediumThreshold,
      blockThreshold: ctx.config.profileSettings.blockThreshold,
      bypassed: false,
      durationMs: Date.now() - input.startedAt,
      traceKind,
      searchRequestId: input.searchContext?.requestId ?? null,
      searchQuery: input.searchContext?.query ?? null,
      searchRank: input.searchContext?.rank ?? null,
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
  let allowSignals: string[] = [];
  let evidence: EvidenceMatch[] = [];

  if (domainPolicy.action === "inspect") {
    const scored = scorePromptInjection(scoringText, {
      languageNameAllowlistExtra: ctx.config.languageNameAllowlistExtra,
    });
    score = scored.score;
    flags = scored.flags;
    allowSignals = scored.allowSignals ?? [];
    normalizationApplied = scored.normalizationApplied ?? [];
    obfuscationSignals = scored.obfuscationSignals ?? [];
    evidence = scored.evidence ?? [];
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

  const allowedBy = classifyAllowedBy(
    decision.decision,
    decision.bypassed ?? false,
    allowSignals,
  );

  const fetchEventId = ctx.db.storeFetchEvent({
    resultId: input.eventId,
    url: input.url,
    domain: input.domain,
    decision: decision.decision,
    score: decision.score,
    flags: decision.flags,
    reason: decision.reason ?? null,
    blockedBy: classifyBlockedBy(decision.decision, decision.reason, decision.flags, domainPolicy.action),
    allowedBy,
    domainAction: domainPolicy.action,
    mediumThreshold: ctx.config.profileSettings.mediumThreshold,
    blockThreshold: ctx.config.profileSettings.blockThreshold,
    bypassed: decision.bypassed ?? false,
    durationMs: Date.now() - input.startedAt,
    traceKind,
    searchRequestId: input.searchContext?.requestId ?? null,
    searchQuery: input.searchContext?.query ?? null,
    searchRank: input.searchContext?.rank ?? null,
  });

  if (decision.decision === "block") {
    ctx.db.storeFlaggedPayload({
      fetchEventId,
      resultId: input.eventId,
      url: input.url,
      domain: input.domain,
      score: decision.score,
      flags: decision.flags,
      reason: decision.reason ?? "Blocked by policy",
      content: scoringText.slice(0, 30_000),
      evidence,
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

  if (allowedBy) {
    ctx.loggers.security.info(
      {
        eventId: input.eventId,
        domain: input.domain,
        allowedBy,
        allowSignals,
        suspiciousConfusableTokens: evidence
          .filter((item) => item.flag === "confusable_mixed_script")
          .map((item) => item.matchedText),
      },
      "allowed fetch due to exception pathway",
    );
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

function classifyBlockedBy(
  decision: "allow" | "block",
  reason: string | undefined,
  flags: string[],
  domainAction: "allow-bypass" | "block" | "inspect",
): string | null {
  if (decision !== "block") {
    return null;
  }

  if (domainAction === "block" || flags.includes("domain_blocklist")) {
    return "domain-policy";
  }

  const normalizedReason = (reason ?? "").toLowerCase();
  if (normalizedReason.startsWith("fail-closed:")) {
    return "fail-closed";
  }

  if (normalizedReason.startsWith("rule score")) {
    return "rule-threshold";
  }

  if (flags.some((flag) => flag.startsWith("llm_judge:")) || normalizedReason.includes("llm judge")) {
    return "llm-judge";
  }

  return "policy";
}

function classifyAllowedBy(
  decision: "allow" | "block",
  bypassed: boolean,
  allowSignals: string[],
): string | null {
  if (decision !== "allow") {
    return null;
  }

  if (bypassed) {
    return "domain-allowlist-bypass";
  }

  if (allowSignals.includes("language_exception")) {
    return "language-exception";
  }

  return null;
}

function classifyTraceKind(
  traceKind: FetchProcessingInput["traceKind"] | undefined,
  searchContext: FetchProcessingInput["searchContext"] | undefined,
): "search-result-fetch" | "direct-web-fetch" | "unknown" {
  if (traceKind && traceKind !== "unknown") {
    return traceKind;
  }

  if (searchContext) {
    return "search-result-fetch";
  }

  return traceKind ?? "unknown";
}
