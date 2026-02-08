import { describe, expect, test } from "bun:test"
import type { AppConfig } from "../src/config"
import { handleFetch } from "../src/routes/fetch"
import { handleWebFetch } from "../src/routes/web-fetch"
import type { ServerContext } from "../src/server-context"

const RESULT_ID = "11111111-1111-4111-8111-111111111111"

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

function makeContext({
  config,
  searchRecordUrl = "https://example.com/path",
  fetchFinalUrl,
}: {
  config: AppConfig
  searchRecordUrl?: string
  fetchFinalUrl?: string
}): ServerContext {
  const recordUrl = new URL(searchRecordUrl)

  return {
    config,
    db: {
      getSearchResult: () => ({
        resultId: RESULT_ID,
        requestId: "req-1",
        query: "test query",
        rank: 1,
        url: searchRecordUrl,
        domain: recordUrl.hostname,
        title: "Example Title",
        snippet: "Example snippet",
        source: "example.com",
        availability: "allowed",
        blockReason: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      }),
      getEffectiveAllowlist: () => [],
      getEffectiveBlocklist: (blocklist: string[]) => [...blocklist],
      storeFetchEvent: () => "fetch-event-1",
      storeFlaggedPayload: () => {},
    },
    loggers: {
      app: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      security: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    },
    braveClient: {
      webSearch: async () => {
        throw new Error("not used")
      },
    },
    contentFetcher: {
      fetchPage: async (url: string) => ({
        finalUrl: fetchFinalUrl ?? url,
        contentType: "text/html",
        body: "<html><body>Hello world content</body></html>",
        backendUsed: "http-fetch" as const,
        rendered: false,
        fallbackUsed: false,
      }),
    },
    llmJudge: {
      classify: async () => ({ label: "benign" as const, confidence: 1, reasons: [] }),
    },
  } as unknown as ServerContext
}

describe("URL exposure on content responses", () => {
  test("/v1/fetch includes url/final_url when exposure is enabled", async () => {
    const ctx = makeContext({ config: makeConfig({ exposeSafeContentUrls: true }) })

    const response = await handleFetch(
      new Request("http://localhost/v1/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result_id: RESULT_ID }),
      }),
      ctx,
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { url?: string; final_url?: string }
    expect(payload.url).toBe("https://example.com/path")
    expect(payload.final_url).toBe("https://example.com/path")
  })

  test("/v1/fetch omits url/final_url when exposure is disabled", async () => {
    const ctx = makeContext({ config: makeConfig({ exposeSafeContentUrls: false }) })

    const response = await handleFetch(
      new Request("http://localhost/v1/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result_id: RESULT_ID }),
      }),
      ctx,
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { url?: string; final_url?: string }
    expect(payload.url).toBeUndefined()
    expect(payload.final_url).toBeUndefined()
  })

  test("/v1/web-fetch blocked response omits top-level URL fields", async () => {
    const ctx = makeContext({
      config: makeConfig({
        blocklistDomains: ["example.com"],
        exposeSafeContentUrls: true,
      }),
    })

    const response = await handleWebFetch(
      new Request("http://localhost/v1/web-fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/path", extractMode: "text" }),
      }),
      ctx,
    )

    expect(response.status).toBe(422)
    const payload = (await response.json()) as { url?: string; final_url?: string }
    expect(payload.url).toBeUndefined()
    expect(payload.final_url).toBeUndefined()
  })

  test("redirect to blocklisted final URL returns 422", async () => {
    const ctx = makeContext({
      config: makeConfig({
        blocklistDomains: ["evil.example"],
        exposeSafeContentUrls: true,
      }),
      searchRecordUrl: "https://safe.example/article",
      fetchFinalUrl: "https://evil.example/payload",
    })

    const response = await handleFetch(
      new Request("http://localhost/v1/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ result_id: RESULT_ID }),
      }),
      ctx,
    )

    expect(response.status).toBe(422)
    const payload = (await response.json()) as {
      url?: string
      final_url?: string
      safety?: { reason?: string; decision?: string }
    }
    expect(payload.url).toBeUndefined()
    expect(payload.final_url).toBeUndefined()
    expect(payload.safety?.decision).toBe("block")
    expect(payload.safety?.reason).toContain("Redirected final URL blocked")
  })
})
