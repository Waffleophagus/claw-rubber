import type { InjectionScore } from "../types";
import { detectEncodingObfuscationSignals } from "./encoding-signals";
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

export function scorePromptInjection(content: string): InjectionScore {
  const normalized = normalizeForSecurity(content);
  const flags = new Set<string>();
  let score = 0;

  for (const rule of RULES) {
    const targetText = rule.target === "raw" ? content : normalized.normalizedText;
    if (rule.pattern.test(targetText)) {
      score += rule.weight;
      flags.add(rule.id);
    }
  }

  for (const signal of normalized.signalFlags) {
    const signalWeight = NORMALIZATION_SIGNAL_SCORES[signal];
    if (signalWeight !== undefined) {
      score += signalWeight;
    }

    flags.add(signal);
  }

  const typoglycemia = detectTypoglycemiaSignals(normalized.normalizedText);
  if (typoglycemia.score > 0) {
    score += typoglycemia.score;
    for (const flag of typoglycemia.flags) {
      flags.add(flag);
    }
  }

  const encodingSignals = detectEncodingObfuscationSignals(content);
  if (encodingSignals.score > 0) {
    score += encodingSignals.score;
    for (const flag of encodingSignals.flags) {
      flags.add(flag);
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
    normalizationApplied: normalized.transformations,
    obfuscationSignals,
  };
}
