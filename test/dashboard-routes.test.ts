import { describe, expect, test } from "bun:test"
import type { AppConfig } from "../src/config"
import { handleDashboardAllowlistPost, handleDashboardBlocklistPost } from "../src/routes/dashboard"
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
    allowlistDomains: ["example.org"],
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

function makeContext(config: AppConfig): ServerContext {
  return {
    config,
    db: {
      addRuntimeAllowlistDomain: (domain: string, note?: string) => ({
        domain,
        note: note ?? null,
        addedAt: Date.now(),
      }),
      getEffectiveAllowlist: (allowlist: string[]) => [...allowlist, "docs.bun.sh"],
      addRuntimeBlocklistDomain: (domain: string, note?: string) => ({
        domain,
        note: note ?? null,
        addedAt: Date.now(),
      }),
      getEffectiveBlocklist: (blocklist: string[]) => [...blocklist, "evil.example"],
    },
  } as unknown as ServerContext
}

describe("dashboard allowlist write gate", () => {
  test("rejects writes when disabled", async () => {
    const response = await handleDashboardAllowlistPost(
      new Request("http://localhost/v1/dashboard/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "docs.bun.sh" }),
      }),
      makeContext(makeConfig({ enableDashboardWriteApi: false })),
    )

    expect(response.status).toBe(403)
  })

  test("allows writes when enabled", async () => {
    const response = await handleDashboardAllowlistPost(
      new Request("http://localhost/v1/dashboard/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "docs.bun.sh" }),
      }),
      makeContext(makeConfig({ enableDashboardWriteApi: true })),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      effectiveAllowlist?: string[]
      entry?: { domain?: string }
    }
    expect(payload.entry?.domain).toBe("docs.bun.sh")
    expect(payload.effectiveAllowlist?.includes("docs.bun.sh")).toBe(true)
  })
})

describe("dashboard blocklist write gate", () => {
  test("rejects writes when disabled", async () => {
    const response = await handleDashboardBlocklistPost(
      new Request("http://localhost/v1/dashboard/blocklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "evil.example" }),
      }),
      makeContext(makeConfig({ enableDashboardWriteApi: false })),
    )

    expect(response.status).toBe(403)
  })

  test("allows writes when enabled", async () => {
    const response = await handleDashboardBlocklistPost(
      new Request("http://localhost/v1/dashboard/blocklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: "evil.example" }),
      }),
      makeContext(makeConfig({ enableDashboardWriteApi: true })),
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      effectiveBlocklist?: string[]
      entry?: { domain?: string }
    }
    expect(payload.entry?.domain).toBe("evil.example")
    expect(payload.effectiveBlocklist?.includes("evil.example")).toBe(true)
  })
})
