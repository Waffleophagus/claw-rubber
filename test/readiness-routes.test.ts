import { describe, expect, test } from "bun:test"
import type { AppConfig } from "../src/config"
import { handleHealthz } from "../src/routes/healthz"
import { handleReadyz } from "../src/routes/readyz"
import type { ServerContext } from "../src/server-context"

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 3000,
    host: "0.0.0.0",
    braveApiKey: "x",
    braveApiBaseUrl: "https://api.search.brave.com/res/v1",
    braveRateLimit: {
      tier: "free",
      requestsPerSecond: 1,
      queueMax: 10,
      retryOn429: true,
      retryMax: 1,
    },
    search: {
      strategy: "single",
      primary: "brave",
    },
    searxng: {
      baseUrl: "",
      timeoutMs: 8_000,
    },
    profile: "strict",
    profileSettings: {
      mediumThreshold: 6,
      blockThreshold: 10,
      maxFetchBytes: 1_000_000,
      maxExtractedChars: 16_000,
      fetchTimeoutMs: 7_000,
      maxRedirects: 3,
    },
    redactedUrls: true,
    exposeSafeContentUrls: true,
    failClosed: true,
    allowlistDomains: [],
    blocklistDomains: [],
    languageNameAllowlistExtra: [],
    enableDashboardWriteApi: false,
    dbPath: "./data/test.db",
    logDir: "./data/logs",
    resultTtlMs: 600_000,
    retentionDays: 7,
    llmJudgeEnabled: false,
    llmProvider: "openai",
    llmModel: "gpt-4o-mini",
    openaiApiKey: "",
    ollamaBaseUrl: "http://localhost:11434/api",
    userAgent: "test-agent",
    websiteRendererBackend: "none",
    browserless: {
      baseUrl: "http://browserless:3000",
      token: "",
      timeoutMs: 12_000,
      waitUntil: "networkidle",
      waitForSelector: "",
      maxHtmlBytes: 1_500_000,
      fallbackToHttp: true,
      blockAds: true,
    },
    ...overrides,
  }
}

function makeContext(config: AppConfig, dbHealthy: boolean): ServerContext {
  return {
    config,
    db: {
      isHealthy: () => dbHealthy,
    },
  } as unknown as ServerContext
}

describe("health and readiness routes", () => {
  test("/healthz remains liveness-only", async () => {
    const response = handleHealthz(
      new Request("http://localhost/healthz"),
      makeContext(makeConfig({ braveApiKey: "" }), true),
    )
    expect(response.status).toBe(200)

    const payload = (await response.json()) as { status?: string; checks?: { process_running?: boolean } }
    expect(payload.status).toBe("ok")
    expect(payload.checks?.process_running).toBe(true)
  })

  test("/readyz reports dependency failures", async () => {
    const response = handleReadyz(
      new Request("http://localhost/readyz"),
      makeContext(makeConfig({ braveApiKey: "" }), true),
    )
    expect(response.status).toBe(503)

    const payload = (await response.json()) as {
      status?: string
      checks?: { brave_api_key_configured?: boolean }
    }
    expect(payload.status).toBe("not_ready")
    expect(payload.checks?.brave_api_key_configured).toBe(false)
  })

  test("/readyz allows disabled search mode without provider credentials", async () => {
    const response = handleReadyz(
      new Request("http://localhost/readyz"),
      makeContext(
        makeConfig({
          braveApiKey: "",
          search: {
            strategy: "disabled",
            primary: "brave",
          },
          searxng: {
            baseUrl: "",
            timeoutMs: 8_000,
          },
        }),
        true,
      ),
    )
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      status?: string
      checks?: { search_enabled?: boolean; brave_required?: boolean; searxng_required?: boolean }
    }
    expect(payload.status).toBe("ready")
    expect(payload.checks?.search_enabled).toBe(false)
    expect(payload.checks?.brave_required).toBe(false)
    expect(payload.checks?.searxng_required).toBe(false)
  })
})
