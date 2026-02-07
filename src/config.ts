import { z } from "zod"

export type ProfileName = "baseline" | "strict" | "paranoid"
export type WebsiteRendererBackend = "none" | "browserless"
export type BrowserlessWaitUntil = "domcontentloaded" | "load" | "networkidle"
export type BraveRateLimitTier = "free" | "paid" | "base" | "pro"

export interface ProfileSettings {
  mediumThreshold: number
  blockThreshold: number
  maxFetchBytes: number
  maxExtractedChars: number
  fetchTimeoutMs: number
  maxRedirects: number
}

export interface BrowserlessSettings {
  baseUrl: string
  token: string
  timeoutMs: number
  waitUntil: BrowserlessWaitUntil
  waitForSelector: string
  maxHtmlBytes: number
  fallbackToHttp: boolean
  blockAds: boolean
}

export interface BraveRateLimitSettings {
  tier: BraveRateLimitTier | "custom"
  requestsPerSecond: number
  queueMax: number
  retryOn429: boolean
  retryMax: number
}

export interface AppConfig {
  port: number
  host: string
  braveApiKey: string
  braveApiBaseUrl: string
  braveRateLimit: BraveRateLimitSettings
  profile: ProfileName
  profileSettings: ProfileSettings
  redactedUrls: boolean
  exposeSafeContentUrls: boolean
  failClosed: boolean
  allowlistDomains: string[]
  blocklistDomains: string[]
  languageNameAllowlistExtra: string[]
  dbPath: string
  logDir: string
  resultTtlMs: number
  retentionDays: number
  llmJudgeEnabled: boolean
  llmProvider: "openai" | "ollama"
  llmModel: string
  openaiApiKey: string
  ollamaBaseUrl: string
  userAgent: string
  websiteRendererBackend: WebsiteRendererBackend
  browserless: BrowserlessSettings
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
}

const braveTierRps: Record<BraveRateLimitTier, number> = {
  free: 1,
  paid: 20,
  base: 20,
  pro: 50,
}

const RateLimitTierSchema = z.enum(["free", "paid", "base", "pro"])
const RateLimitSettingSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value
    }

    const normalized = value.trim().toLowerCase()
    if (/^\d+$/.test(normalized)) {
      return Number.parseInt(normalized, 10)
    }

    return normalized
  },
  z.union([RateLimitTierSchema, z.number().int().positive()]),
)

const EnvSchema = z.object({
  PORT: z.string().optional(),
  HOST: z.string().optional(),
  CLAWRUBBER_BRAVE_API_KEY: z.string().default(""),
  CLAWRUBBER_BRAVE_API_BASE_URL: z.string().default("https://api.search.brave.com/res/v1"),
  CLAWRUBBER_RATE_LIMIT: RateLimitSettingSchema.default("free"),
  CLAWRUBBER_BRAVE_QUEUE_MAX: z.string().optional(),
  CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_ON_429: z.string().optional(),
  CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_MAX: z.string().optional(),
  CLAWRUBBER_PROFILE: z.enum(["baseline", "strict", "paranoid"]).default("strict"),
  CLAWRUBBER_REDACT_URLS: z.string().optional(),
  CLAWRUBBER_EXPOSE_SAFE_CONTENT_URLS: z.string().optional(),
  CLAWRUBBER_FAIL_CLOSED: z.string().optional(),
  CLAWRUBBER_ALLOWLIST_DOMAINS: z.string().optional(),
  CLAWRUBBER_BLOCKLIST_DOMAINS: z.string().optional(),
  CLAWRUBBER_LANGUAGE_NAME_ALLOWLIST_EXTRA: z.string().optional(),
  CLAWRUBBER_DB_PATH: z.string().default("./data/claw-rubber.db"),
  CLAWRUBBER_LOG_DIR: z.string().default("./data/logs"),
  CLAWRUBBER_RESULT_TTL_MINUTES: z.string().optional(),
  CLAWRUBBER_RETENTION_DAYS: z.string().optional(),
  CLAWRUBBER_LLM_JUDGE_ENABLED: z.string().optional(),
  CLAWRUBBER_LLM_PROVIDER: z.enum(["openai", "ollama"]).default("openai"),
  CLAWRUBBER_LLM_MODEL: z.string().default("gpt-4o-mini"),
  CLAWRUBBER_OPENAI_API_KEY: z.string().default(""),
  CLAWRUBBER_OLLAMA_BASE_URL: z.string().default("http://localhost:11434/api"),
  CLAWRUBBER_USER_AGENT: z.string().default("claw-rubber/0.1 (+https://github.com/)"),
  CLAWRUBBER_WEBSITE_RENDERER_BACKEND: z.enum(["none", "browserless"]).default("none"),
  CLAWRUBBER_BROWSERLESS_URL: z.string().default("http://browserless:3000"),
  CLAWRUBBER_BROWSERLESS_TOKEN: z.string().default(""),
  CLAWRUBBER_BROWSERLESS_TIMEOUT_MS: z.string().optional(),
  CLAWRUBBER_BROWSERLESS_WAIT_UNTIL: z
    .enum(["domcontentloaded", "load", "networkidle"])
    .default("networkidle"),
  CLAWRUBBER_BROWSERLESS_WAIT_FOR_SELECTOR: z.string().default(""),
  CLAWRUBBER_BROWSERLESS_MAX_HTML_BYTES: z.string().optional(),
  CLAWRUBBER_BROWSERLESS_FALLBACK_TO_HTTP: z.string().optional(),
  CLAWRUBBER_BROWSERLESS_BLOCK_ADS: z.string().optional(),
})

function toBoolean(input: string | undefined, defaultValue: boolean): boolean {
  if (input === undefined) {
    return defaultValue
  }

  const normalized = input.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }

  return defaultValue
}

function toInteger(input: string | undefined, defaultValue: number): number {
  if (!input) {
    return defaultValue
  }

  const parsed = Number.parseInt(input, 10)
  if (Number.isNaN(parsed)) {
    return defaultValue
  }

  return parsed
}

function toMinInteger(input: string | undefined, defaultValue: number, min: number): number {
  const parsed = toInteger(input, defaultValue)
  return parsed < min ? min : parsed
}

function parseDomainList(input: string | undefined): string[] {
  if (!input) {
    return []
  }

  return [
    ...new Set(
      input
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .map((item) => item.replace(/^\*\./, ""))
        .map((item) => item.replace(/\.+$/, ""))
        .filter((item) => item.length > 0),
    ),
  ]
}

function parseLanguageNameList(input: string | undefined): string[] {
  if (!input) {
    return []
  }

  return [
    ...new Set(
      input
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .map((item) => item.normalize("NFKC").toLowerCase())
        .filter((item) => item.length > 1 && item.length <= 80),
    ),
  ]
}

export function loadConfig(env = process.env): AppConfig {
  const parsed = EnvSchema.parse(env)
  const profileSettings = profiles[parsed.CLAWRUBBER_PROFILE]
  const maxHtmlBytes = toInteger(parsed.CLAWRUBBER_BROWSERLESS_MAX_HTML_BYTES, 1_500_000)
  const braveRateLimit =
    typeof parsed.CLAWRUBBER_RATE_LIMIT === "number"
      ? {
          tier: "custom" as const,
          requestsPerSecond: parsed.CLAWRUBBER_RATE_LIMIT,
        }
      : {
          tier: parsed.CLAWRUBBER_RATE_LIMIT as BraveRateLimitTier,
          requestsPerSecond: braveTierRps[parsed.CLAWRUBBER_RATE_LIMIT as BraveRateLimitTier],
        }

  return {
    port: toInteger(parsed.PORT, 3000),
    host: parsed.HOST ?? "0.0.0.0",
    braveApiKey: parsed.CLAWRUBBER_BRAVE_API_KEY,
    braveApiBaseUrl: parsed.CLAWRUBBER_BRAVE_API_BASE_URL,
    braveRateLimit: {
      tier: braveRateLimit.tier,
      requestsPerSecond: braveRateLimit.requestsPerSecond,
      queueMax: toMinInteger(parsed.CLAWRUBBER_BRAVE_QUEUE_MAX, 10, 1),
      retryOn429: toBoolean(parsed.CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_ON_429, true),
      retryMax: toMinInteger(parsed.CLAWRUBBER_BRAVE_RATE_LIMIT_RETRY_MAX, 1, 0),
    },
    profile: parsed.CLAWRUBBER_PROFILE,
    profileSettings,
    redactedUrls: toBoolean(parsed.CLAWRUBBER_REDACT_URLS, true),
    exposeSafeContentUrls: toBoolean(parsed.CLAWRUBBER_EXPOSE_SAFE_CONTENT_URLS, true),
    failClosed: toBoolean(parsed.CLAWRUBBER_FAIL_CLOSED, true),
    allowlistDomains: parseDomainList(parsed.CLAWRUBBER_ALLOWLIST_DOMAINS),
    blocklistDomains: parseDomainList(parsed.CLAWRUBBER_BLOCKLIST_DOMAINS),
    languageNameAllowlistExtra: parseLanguageNameList(
      parsed.CLAWRUBBER_LANGUAGE_NAME_ALLOWLIST_EXTRA,
    ),
    dbPath: parsed.CLAWRUBBER_DB_PATH,
    logDir: parsed.CLAWRUBBER_LOG_DIR,
    resultTtlMs: toInteger(parsed.CLAWRUBBER_RESULT_TTL_MINUTES, 30) * 60 * 1000,
    retentionDays: toInteger(parsed.CLAWRUBBER_RETENTION_DAYS, 30),
    llmJudgeEnabled: toBoolean(parsed.CLAWRUBBER_LLM_JUDGE_ENABLED, false),
    llmProvider: parsed.CLAWRUBBER_LLM_PROVIDER,
    llmModel: parsed.CLAWRUBBER_LLM_MODEL,
    openaiApiKey: parsed.CLAWRUBBER_OPENAI_API_KEY,
    ollamaBaseUrl: parsed.CLAWRUBBER_OLLAMA_BASE_URL,
    userAgent: parsed.CLAWRUBBER_USER_AGENT,
    websiteRendererBackend: parsed.CLAWRUBBER_WEBSITE_RENDERER_BACKEND,
    browserless: {
      baseUrl: parsed.CLAWRUBBER_BROWSERLESS_URL,
      token: parsed.CLAWRUBBER_BROWSERLESS_TOKEN,
      timeoutMs: toInteger(parsed.CLAWRUBBER_BROWSERLESS_TIMEOUT_MS, 12_000),
      waitUntil: parsed.CLAWRUBBER_BROWSERLESS_WAIT_UNTIL,
      waitForSelector: parsed.CLAWRUBBER_BROWSERLESS_WAIT_FOR_SELECTOR.trim(),
      maxHtmlBytes: maxHtmlBytes > 0 ? maxHtmlBytes : 1_500_000,
      fallbackToHttp: toBoolean(parsed.CLAWRUBBER_BROWSERLESS_FALLBACK_TO_HTTP, true),
      blockAds: toBoolean(parsed.CLAWRUBBER_BROWSERLESS_BLOCK_ADS, true),
    },
  }
}
