import { z } from "zod";

export type ProfileName = "baseline" | "strict" | "paranoid";

export interface ProfileSettings {
  mediumThreshold: number;
  blockThreshold: number;
  maxFetchBytes: number;
  maxExtractedChars: number;
  fetchTimeoutMs: number;
  maxRedirects: number;
}

export interface AppConfig {
  port: number;
  host: string;
  braveApiKey: string;
  braveApiBaseUrl: string;
  profile: ProfileName;
  profileSettings: ProfileSettings;
  redactedUrls: boolean;
  failClosed: boolean;
  allowlistDomains: string[];
  blocklistDomains: string[];
  dbPath: string;
  logDir: string;
  resultTtlMs: number;
  retentionDays: number;
  llmJudgeEnabled: boolean;
  llmProvider: "openai" | "ollama";
  llmModel: string;
  openaiApiKey: string;
  ollamaBaseUrl: string;
  userAgent: string;
}

const profiles: Record<ProfileName, ProfileSettings> = {
  baseline: {
    mediumThreshold: 8,
    blockThreshold: 14,
    maxFetchBytes: 1_500_000,
    maxExtractedChars: 22_000,
    fetchTimeoutMs: 8_000,
    maxRedirects: 4,
  },
  strict: {
    mediumThreshold: 6,
    blockThreshold: 10,
    maxFetchBytes: 1_000_000,
    maxExtractedChars: 16_000,
    fetchTimeoutMs: 7_000,
    maxRedirects: 3,
  },
  paranoid: {
    mediumThreshold: 4,
    blockThreshold: 7,
    maxFetchBytes: 750_000,
    maxExtractedChars: 10_000,
    fetchTimeoutMs: 6_000,
    maxRedirects: 2,
  },
};

const EnvSchema = z.object({
  PORT: z.string().optional(),
  HOST: z.string().optional(),
  BRAVE_API_KEY: z.string().default(""),
  CR_BRAVE_API_BASE_URL: z.string().default("https://api.search.brave.com/res/v1"),
  CR_PROFILE: z.enum(["baseline", "strict", "paranoid"]).default("strict"),
  CR_REDACT_URLS: z.string().optional(),
  CR_FAIL_CLOSED: z.string().optional(),
  CR_ALLOWLIST_DOMAINS: z.string().optional(),
  CR_BLOCKLIST_DOMAINS: z.string().optional(),
  CR_DB_PATH: z.string().default("./data/claw-rubber.db"),
  CR_LOG_DIR: z.string().default("./data/logs"),
  CR_RESULT_TTL_MINUTES: z.string().optional(),
  CR_RETENTION_DAYS: z.string().optional(),
  CR_LLM_JUDGE_ENABLED: z.string().optional(),
  CR_LLM_PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
  CR_LLM_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_API_KEY: z.string().default(""),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434/api"),
  CR_USER_AGENT: z.string().default("claw-rubber/0.1 (+https://github.com/)"),
});

function toBoolean(input: string | undefined, defaultValue: boolean): boolean {
  if (input === undefined) {
    return defaultValue;
  }

  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function toInteger(input: string | undefined, defaultValue: number): number {
  if (!input) {
    return defaultValue;
  }

  const parsed = Number.parseInt(input, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  return parsed;
}

function parseDomainList(input: string | undefined): string[] {
  if (!input) {
    return [];
  }

  return [...new Set(input
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .map((item) => item.replace(/^\*\./, ""))
    .map((item) => item.replace(/\.+$/, ""))
    .filter((item) => item.length > 0))];
}

export function loadConfig(env = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const profileSettings = profiles[parsed.CR_PROFILE];

  return {
    port: toInteger(parsed.PORT, 3000),
    host: parsed.HOST ?? "0.0.0.0",
    braveApiKey: parsed.BRAVE_API_KEY,
    braveApiBaseUrl: parsed.CR_BRAVE_API_BASE_URL,
    profile: parsed.CR_PROFILE,
    profileSettings,
    redactedUrls: toBoolean(parsed.CR_REDACT_URLS, true),
    failClosed: toBoolean(parsed.CR_FAIL_CLOSED, true),
    allowlistDomains: parseDomainList(parsed.CR_ALLOWLIST_DOMAINS),
    blocklistDomains: parseDomainList(parsed.CR_BLOCKLIST_DOMAINS),
    dbPath: parsed.CR_DB_PATH,
    logDir: parsed.CR_LOG_DIR,
    resultTtlMs: toInteger(parsed.CR_RESULT_TTL_MINUTES, 30) * 60 * 1000,
    retentionDays: toInteger(parsed.CR_RETENTION_DAYS, 30),
    llmJudgeEnabled: toBoolean(parsed.CR_LLM_JUDGE_ENABLED, false),
    llmProvider: parsed.CR_LLM_PROVIDER,
    llmModel: parsed.CR_LLM_MODEL,
    openaiApiKey: parsed.OPENAI_API_KEY,
    ollamaBaseUrl: parsed.OLLAMA_BASE_URL,
    userAgent: parsed.CR_USER_AGENT,
  };
}
