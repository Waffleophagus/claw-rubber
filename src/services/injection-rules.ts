import type { EvidenceBasis, EvidenceDetector, EvidenceMatch, InjectionScore } from "../types.ts";
import { detectEncodingObfuscationSignals } from "./encoding-signals";
import { detectLanguageList } from "./language-list-detector";
import { normalizeForSecurity } from "./obfuscation-normalizer";
import { detectTypoglycemiaSignals } from "./typoglycemia";

interface Rule {
  id: string;
  weight: number;
  pattern: RegExp;
  target: "raw" | "normalized";
}

const RULES: Rule[] = [
  {
    id: "instruction_override",
    weight: 4,
    pattern: /(ignore|disregard|override)\b.{0,40}\b(previous|prior|all)\b.{0,30}\b(instruction|prompt|rule)/i,
    target: "normalized",
  },
  {
    id: "role_hijack",
    weight: 3,
    pattern: /\b(you are now|act as|pretend to be)\b.{0,40}\b(system|developer|administrator|root)\b/i,
    target: "normalized",
  },
  {
    id: "prompt_exfiltration",
    weight: 4,
    pattern: /\b(show|reveal|print|leak|expose)\b.{0,30}\b(system prompt|developer message|hidden instructions?)\b/i,
    target: "normalized",
  },
  {
    id: "secret_exfiltration",
    weight: 5,
    pattern: /\b(api key|access token|secret|password|private key)\b.{0,30}\b(send|share|output|return|dump)\b/i,
    target: "normalized",
  },
  {
    id: "tool_abuse",
    weight: 3,
    pattern: /\b(run|execute|invoke|call)\b.{0,20}\b(shell|command|tool|curl|wget|powershell)\b/i,
    target: "normalized",
  },
  {
    id: "encoding_obfuscation",
    weight: 2,
    pattern: /\b(base64|hex|rot13|decode this|obfuscated)\b/i,
    target: "normalized",
  },
  {
    id: "jailbreak_marker",
    weight: 4,
    pattern: /\b(do not follow safety|bypass safeguards|jailbreak|developer mode|dan mode)\b/i,
    target: "normalized",
  },
  {
    id: "invisible_characters",
    weight: 2,
    pattern: /[\u200B-\u200F\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/,
    target: "raw",
  },
  {
    id: "urgent_manipulation",
    weight: 2,
    pattern: /\b(urgent|immediately|do this now)\b.{0,40}\b(ignore|bypass|disable)\b/i,
    target: "normalized",
  },
];

const NORMALIZATION_SIGNAL_SCORES: Record<string, number> = {
  unicode_invisible_or_bidi: 2,
  confusable_mixed_script: 3,
};
const INVISIBLE_OR_BIDI_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

const HIGH_RISK_INTENT_FLAGS = new Set<string>([
  "instruction_override",
  "role_hijack",
  "prompt_exfiltration",
  "secret_exfiltration",
  "tool_abuse",
  "jailbreak_marker",
  "urgent_manipulation",
  "typoglycemia_high_risk_keyword",
  "decode_instruction_context",
]);

interface ScorePromptInjectionOptions {
  languageNameAllowlistExtra?: string[];
}

export function scorePromptInjection(content: string, options: ScorePromptInjectionOptions = {}): InjectionScore {
  const normalized = normalizeForSecurity(content);
  const flags = new Set<string>();
  const allowSignals = new Set<string>();
  const evidence: EvidenceMatch[] = [];
  let score = 0;

  for (const rule of RULES) {
    const targetText = rule.target === "raw" ? content : normalized.normalizedText;
    const matches = collectRegexMatches(targetText, rule.pattern, 3);
    if (matches.length > 0) {
      score += rule.weight;
      flags.add(rule.id);
      for (const match of matches) {
        evidence.push(buildEvidence({
          flag: rule.id,
          detector: "rule",
          basis: rule.target,
          start: match.start,
          end: match.end,
          matchedText: match.text,
          contextText: targetText,
          weight: rule.weight,
        }));
      }
    }
  }

  for (const signal of normalized.signalFlags) {
    if (signal === "confusable_mixed_script") {
      continue;
    }

    const signalWeight = NORMALIZATION_SIGNAL_SCORES[signal];
    if (signalWeight !== undefined) {
      score += signalWeight;
    }

    flags.add(signal);
    evidence.push(
      ...collectNormalizationEvidence(signal, content, normalized.normalizedText, signalWeight ?? 0),
    );
  }

  const typoglycemia = detectTypoglycemiaSignals(normalized.normalizedText);
  if (typoglycemia.score > 0) {
    score += typoglycemia.score;
    for (const flag of typoglycemia.flags) {
      flags.add(flag);
    }
    for (const item of typoglycemia.evidence) {
      evidence.push(buildEvidence({
        flag: item.flag,
        detector: "typoglycemia",
        basis: "normalized",
        start: item.start,
        end: item.end,
        matchedText: item.matchedText,
        contextText: normalized.normalizedText,
        weight: typoglycemia.score,
        notes: item.notes,
      }));
    }
  }

  const encodingSignals = detectEncodingObfuscationSignals(content);
  if (encodingSignals.score > 0) {
    score += encodingSignals.score;
    for (const flag of encodingSignals.flags) {
      flags.add(flag);
    }
    for (const item of encodingSignals.evidence) {
      evidence.push(buildEvidence({
        flag: item.flag,
        detector: "encoding",
        basis: "raw",
        start: item.start,
        end: item.end,
        matchedText: item.matchedText,
        contextText: content,
        weight: encodingSignals.score,
        notes: item.notes,
      }));
    }
  }

  const hasHighRiskIntent = [...flags].some((flag) => HIGH_RISK_INTENT_FLAGS.has(flag));
  const hasSuspiciousConfusableTokens = normalized.confusableAnalysis.suspiciousTokens.length > 0;
  const hasConfusableMappings = normalized.confusableAnalysis.mappedCount > 0;
  const languageList = hasConfusableMappings
    ? detectLanguageList(content, options.languageNameAllowlistExtra ?? [])
    : null;

  if (languageList?.isLanguageListLikely) {
    allowSignals.add("language_exception");
  }

  if (hasSuspiciousConfusableTokens) {
    if (!languageList?.isLanguageListLikely && hasHighRiskIntent) {
      const confusableWeight = NORMALIZATION_SIGNAL_SCORES.confusable_mixed_script ?? 0;
      if (confusableWeight > 0) {
        score += confusableWeight;
      }
      flags.add("confusable_mixed_script");
      evidence.push(...collectConfusableEvidence(normalized.confusableAnalysis.suspiciousTokens, confusableWeight));
    }
  }

  const allFlags = [...flags];
  const obfuscationSignals = allFlags.filter((flag) =>
    flag.startsWith("typoglycemia") ||
    flag.startsWith("encoded_") ||
    flag.startsWith("decode_") ||
    flag.startsWith("escape_") ||
    flag === "confusable_mixed_script" ||
    flag === "unicode_invisible_or_bidi",
  );

  return {
    score,
    flags: allFlags,
    allowSignals: [...allowSignals],
    normalizationApplied: normalized.transformations,
    obfuscationSignals,
    evidence: finalizeEvidence(evidence, 20),
  };
}

interface BuildEvidenceInput {
  flag: string;
  detector: EvidenceDetector;
  basis: EvidenceBasis;
  start: number | null;
  end: number | null;
  matchedText: string;
  contextText: string;
  weight: number;
  notes?: string;
}

interface RegexMatch {
  start: number;
  end: number;
  text: string;
}

function buildEvidence(input: BuildEvidenceInput): EvidenceMatch {
  const excerpt = createExcerpt(input.contextText, input.start, input.end, input.matchedText);
  return {
    id: "",
    flag: input.flag,
    detector: input.detector,
    basis: input.basis,
    start: input.start,
    end: input.end,
    matchedText: input.matchedText,
    excerpt,
    weight: input.weight,
    notes: input.notes,
  };
}

function createExcerpt(source: string, start: number | null, end: number | null, fallback: string): string {
  if (start === null || end === null || start < 0 || end <= start || end > source.length) {
    return fallback.slice(0, 240);
  }

  const context = 50;
  const left = Math.max(0, start - context);
  const right = Math.min(source.length, end + context);
  return source.slice(left, right);
}

function collectRegexMatches(text: string, pattern: RegExp, limit: number): RegexMatch[] {
  const regex = pattern.flags.includes("g")
    ? new RegExp(pattern.source, pattern.flags)
    : new RegExp(pattern.source, `${pattern.flags}g`);

  const matches: RegexMatch[] = [];
  for (const match of text.matchAll(regex)) {
    const value = match[0];
    const start = match.index;
    if (!value || start === undefined) {
      continue;
    }

    matches.push({
      start,
      end: start + value.length,
      text: value,
    });

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}

function collectNormalizationEvidence(
  signal: string,
  rawText: string,
  normalizedText: string,
  weight: number,
): EvidenceMatch[] {
  if (signal === "unicode_invisible_or_bidi") {
    const matches = collectRegexMatches(rawText, INVISIBLE_OR_BIDI_RE, 6);
    return matches.map((match) => buildEvidence({
      flag: signal,
      detector: "normalization",
      basis: "raw",
      start: match.start,
      end: match.end,
      matchedText: match.text,
      contextText: rawText,
      weight,
      notes: "Invisible or bidi control character",
    }));
  }

  return [];
}

function collectConfusableEvidence(
  suspiciousTokens: Array<{ token: string; confusableCount: number }>,
  weight: number,
): EvidenceMatch[] {
  return suspiciousTokens.slice(0, 4).map((token) =>
    buildEvidence({
      flag: "confusable_mixed_script",
      detector: "normalization",
      basis: "normalized",
      start: null,
      end: null,
      matchedText: token.token,
      contextText: token.token,
      weight,
      notes: `Mixed-script token with ${token.confusableCount} confusable character(s)`,
    }));
}

function finalizeEvidence(evidence: EvidenceMatch[], maxItems: number): EvidenceMatch[] {
  const seen = new Set<string>();
  const deduped: EvidenceMatch[] = [];

  for (const item of evidence) {
    const key = `${item.flag}:${item.detector}:${item.basis}:${item.start ?? "n"}:${item.end ?? "n"}:${item.matchedText}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((a, b) => b.weight - a.weight || a.flag.localeCompare(b.flag));

  return deduped.slice(0, maxItems).map((item, index) => ({
    ...item,
    id: `${item.flag}-${item.detector}-${index}`,
  }));
}
