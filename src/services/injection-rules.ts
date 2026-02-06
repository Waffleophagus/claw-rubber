import type { InjectionScore } from "../types";

interface Rule {
  id: string;
  weight: number;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    id: "instruction_override",
    weight: 4,
    pattern: /(ignore|disregard|override)\b.{0,40}\b(previous|prior|all)\b.{0,30}\b(instruction|prompt|rule)/i,
  },
  {
    id: "role_hijack",
    weight: 3,
    pattern: /\b(you are now|act as|pretend to be)\b.{0,40}\b(system|developer|administrator|root)\b/i,
  },
  {
    id: "prompt_exfiltration",
    weight: 4,
    pattern: /\b(show|reveal|print|leak|expose)\b.{0,30}\b(system prompt|developer message|hidden instructions?)\b/i,
  },
  {
    id: "secret_exfiltration",
    weight: 5,
    pattern: /\b(api key|access token|secret|password|private key)\b.{0,30}\b(send|share|output|return|dump)\b/i,
  },
  {
    id: "tool_abuse",
    weight: 3,
    pattern: /\b(run|execute|invoke|call)\b.{0,20}\b(shell|command|tool|curl|wget|powershell)\b/i,
  },
  {
    id: "encoding_obfuscation",
    weight: 2,
    pattern: /\b(base64|hex|rot13|decode this|obfuscated)\b/i,
  },
  {
    id: "jailbreak_marker",
    weight: 4,
    pattern: /\b(do not follow safety|bypass safeguards|jailbreak|developer mode|dan mode)\b/i,
  },
  {
    id: "invisible_characters",
    weight: 2,
    pattern: /[\u200B-\u200F\u2060\uFEFF]/,
  },
  {
    id: "urgent_manipulation",
    weight: 2,
    pattern: /\b(urgent|immediately|do this now)\b.{0,40}\b(ignore|bypass|disable)\b/i,
  },
];

export function scorePromptInjection(content: string): InjectionScore {
  const flags: string[] = [];
  let score = 0;

  for (const rule of RULES) {
    if (rule.pattern.test(content)) {
      score += rule.weight;
      flags.push(rule.id);
    }
  }

  return { score, flags };
}
