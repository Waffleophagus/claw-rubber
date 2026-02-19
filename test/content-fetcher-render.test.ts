import { describe, expect, test } from "bun:test"
import type { AppConfig } from "../src/config"
import { ContentFetcher } from "../src/services/content-fetcher"

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

describe("content fetcher render backend", () => {
  test("uses plain fetch when renderer backend is none", async () => {
    let browserlessCalled = 0

    const fetcher = new ContentFetcher(makeConfig(), {
      browserlessClient: {
        render: async () => {
          browserlessCalled += 1
          return { finalUrl: "https://example.com", html: "nope" }
        },
      },
      assertPublicHost: async () => {},
      fetchImpl: async () =>
        new Response("<html>plain</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    })

    const result = await fetcher.fetchPage("https://example.com")

    expect(result.backendUsed).toBe("http-fetch")
    expect(result.rendered).toBe(false)
    expect(result.fallbackUsed).toBe(false)
    expect(browserlessCalled).toBe(0)
  })

  test("uses browserless when enabled", async () => {
    const fetcher = new ContentFetcher(makeConfig({ websiteRendererBackend: "browserless" }), {
      browserlessClient: {
        render: async () => ({
          finalUrl: "https://example.com",
          html: "<html>rendered</html>",
        }),
      },
      assertPublicHost: async () => {},
      fetchImpl: async () =>
        new Response("<html>plain</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    })

    const result = await fetcher.fetchPage("https://example.com")

    expect(result.backendUsed).toBe("browserless")
    expect(result.rendered).toBe(true)
    expect(result.fallbackUsed).toBe(false)
    expect(result.body).toContain("rendered")
  })

  test("uses resolved redirect URL when renderer cannot report final URL", async () => {
    let requestCount = 0

    const fetcher = new ContentFetcher(makeConfig({ websiteRendererBackend: "browserless" }), {
      browserlessClient: {
        render: async (url: string) => ({
          finalUrl: null,
          html: `<html>rendered-from:${url}</html>`,
        }),
      },
      assertPublicHost: async () => {},
      fetchImpl: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://final.example/path" },
          })
        }

        return new Response("<html>resolved</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      },
    })

    const result = await fetcher.fetchPage("https://start.example/path")

    expect(result.backendUsed).toBe("browserless")
    expect(result.finalUrl).toBe("https://final.example/path")
    expect(result.body).toContain("https://final.example/path")
  })

  test("falls back to plain fetch when browserless fails and fallback is enabled", async () => {
    const fetcher = new ContentFetcher(makeConfig({ websiteRendererBackend: "browserless" }), {
      browserlessClient: {
        render: async () => {
          throw new Error("browserless offline")
        },
      },
      assertPublicHost: async () => {},
      fetchImpl: async () =>
        new Response("<html>plain-fallback</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    })

    const result = await fetcher.fetchPage("https://example.com")

    expect(result.backendUsed).toBe("http-fetch")
    expect(result.rendered).toBe(false)
    expect(result.fallbackUsed).toBe(true)
    expect(result.body).toContain("plain-fallback")
  })

  test("throws when browserless fails and fallback is disabled", async () => {
    const fetcher = new ContentFetcher(
      makeConfig({
        websiteRendererBackend: "browserless",
        browserless: {
          baseUrl: "http://browserless:3000",
          token: "",
          timeoutMs: 12_000,
          waitUntil: "networkidle",
          waitForSelector: "",
          maxHtmlBytes: 1_500_000,
          fallbackToHttp: false,
          blockAds: true,
        },
      }),
      {
        browserlessClient: {
          render: async () => {
            throw new Error("browserless offline")
          },
        },
        assertPublicHost: async () => {},
        fetchImpl: async () =>
          new Response("<html>plain</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      },
    )

    await expect(fetcher.fetchPage("https://example.com")).rejects.toThrow("browserless offline")
  })
})
