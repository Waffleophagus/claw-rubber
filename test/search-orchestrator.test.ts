import { describe, expect, test } from "bun:test"
import type { SearchSettings } from "../src/config"
import {
  SearchDisabledError,
  SearchFallbackError,
  SearchOrchestrator,
} from "../src/services/search-orchestrator"
import type {
  SearchProviderClient,
  SearchProviderName,
  SearchRequest,
  SearchResponse,
} from "../src/services/search-provider"

class MockProvider implements SearchProviderClient {
  calls: SearchRequest[] = []

  constructor(
    readonly name: SearchProviderName,
    private readonly handler: (request: SearchRequest) => Promise<SearchResponse>,
  ) {}

  async search(request: SearchRequest): Promise<SearchResponse> {
    this.calls.push(request)
    return this.handler(request)
  }
}

const request: SearchRequest = {
  query: "rubber duck",
  count: 3,
  safesearch: "moderate",
}

function buildSettings(overrides: Partial<SearchSettings> = {}): SearchSettings {
  return {
    strategy: "single",
    primary: "brave",
    ...overrides,
  }
}

describe("search orchestrator", () => {
  test("throws when search is disabled", async () => {
    const brave = new MockProvider("brave", async () => ({ raw: {}, results: [] }))
    const searxng = new MockProvider("searxng", async () => ({ raw: {}, results: [] }))

    const orchestrator = new SearchOrchestrator(buildSettings({ strategy: "disabled" }), {
      braveClient: brave,
      searxngClient: searxng,
    })

    await expect(orchestrator.search(request)).rejects.toBeInstanceOf(SearchDisabledError)
    expect(brave.calls.length).toBe(0)
    expect(searxng.calls.length).toBe(0)
  })

  test("uses configured primary provider in single mode", async () => {
    const brave = new MockProvider("brave", async () => ({ raw: { provider: "brave" }, results: [] }))
    const searxng = new MockProvider("searxng", async () => ({
      raw: { provider: "searxng" },
      results: [
        {
          url: "https://example.com",
          title: "Example",
          snippet: "Snippet",
          source: "example.com",
        },
      ],
    }))

    const orchestrator = new SearchOrchestrator(
      buildSettings({ strategy: "single", primary: "searxng" }),
      {
        braveClient: brave,
        searxngClient: searxng,
      },
    )

    const result = await orchestrator.search(request)

    expect(result.provider).toBe("searxng")
    expect(result.fallbackUsed).toBe(false)
    expect(result.results.length).toBe(1)
    expect(brave.calls.length).toBe(0)
    expect(searxng.calls.length).toBe(1)
  })

  test("falls back when primary fails", async () => {
    const brave = new MockProvider("brave", async () => {
      throw new Error("brave unavailable")
    })
    const searxng = new MockProvider("searxng", async () => ({
      raw: { provider: "searxng" },
      results: [
        {
          url: "https://fallback.test",
          title: "Fallback",
          snippet: "Fallback snippet",
          source: "fallback.test",
        },
      ],
    }))

    const orchestrator = new SearchOrchestrator(
      buildSettings({ strategy: "fallback", primary: "brave" }),
      {
        braveClient: brave,
        searxngClient: searxng,
      },
    )

    const result = await orchestrator.search(request)

    expect(result.provider).toBe("searxng")
    expect(result.fallbackUsed).toBe(true)
    expect(brave.calls.length).toBe(1)
    expect(searxng.calls.length).toBe(1)
  })

  test("throws SearchFallbackError when both providers fail", async () => {
    const brave = new MockProvider("brave", async () => {
      throw new Error("brave unavailable")
    })
    const searxng = new MockProvider("searxng", async () => {
      throw new Error("searxng unavailable")
    })

    const orchestrator = new SearchOrchestrator(
      buildSettings({ strategy: "fallback", primary: "brave" }),
      {
        braveClient: brave,
        searxngClient: searxng,
      },
    )

    let caught: unknown
    try {
      await orchestrator.search(request)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(SearchFallbackError)
    const fallbackError = caught as SearchFallbackError
    expect(fallbackError.primaryProvider).toBe("brave")
    expect(fallbackError.fallbackProvider).toBe("searxng")
  })
})
