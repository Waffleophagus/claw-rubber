import type { AppConfig } from "../config";
import type { JudgeResult, PolicyDecision } from "../types.ts";

export function decidePolicy(
  config: AppConfig,
  initialScore: number,
  initialFlags: string[],
  domainAction: "allow-bypass" | "block" | "inspect",
  domainReason: string | undefined,
  judgeResult: JudgeResult | null,
): PolicyDecision {
  if (domainAction === "block") {
    return {
      decision: "block",
      score: initialScore,
      flags: [...initialFlags, "domain_blocklist"],
      reason: domainReason ?? "Domain is blocklisted",
      bypassed: false,
    };
  }

  if (domainAction === "allow-bypass") {
    return {
      decision: "allow",
      score: 0,
      flags: ["domain_allowlist_bypass"],
      reason: domainReason,
      bypassed: true,
    };
  }

  const score = initialScore;
  const flags = [...initialFlags];

  if (judgeResult) {
    flags.push(`llm_judge:${judgeResult.label}`);

    if (judgeResult.label === "malicious") {
      return {
        decision: "block",
        score,
        flags,
        reason: `LLM judge labeled malicious (${judgeResult.confidence.toFixed(2)})`,
        bypassed: false,
      };
    }

    if (judgeResult.label === "suspicious" && judgeResult.confidence >= 0.75) {
      return {
        decision: "block",
        score,
        flags,
        reason: `LLM judge labeled suspicious with confidence ${judgeResult.confidence.toFixed(2)}`,
        bypassed: false,
      };
    }
  }

  if (score >= config.profileSettings.blockThreshold) {
    return {
      decision: "block",
      score,
      flags,
      reason: `Rule score ${score} >= block threshold ${config.profileSettings.blockThreshold}`,
      bypassed: false,
    };
  }

  if (config.failClosed && score >= config.profileSettings.mediumThreshold) {
    return {
      decision: "block",
      score,
      flags,
      reason: `Fail-closed: rule score ${score} >= medium threshold ${config.profileSettings.mediumThreshold}`,
      bypassed: false,
    };
  }

  return {
    decision: "allow",
    score,
    flags,
    bypassed: false,
  };
}
