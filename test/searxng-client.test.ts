import { describe, expect, test } from "bun:test"
import { loadConfig } from "../src/config"
import { SearxngClient } from "../src/services/searxng-client"

describe("searxng client", () => {
  test("maps JSON results and trims to requested count", async () => {
    let requestedUrl = ""

    const client = new SearxngClient(loadConfig({ CLAWRUBBER_SEARXNG_BASE_URL: "https://search.example" }), {
      fetchImpl: async (input) => {
        requestedUrl = String(input)
        return new Response(
          JSON.stringify({
            results: [
              {
                url: "https://example.com/one",
                title: "One",
                content: "Snippet one",
                publishedDate: "2026-01-01",
              },
              {
                url: "https://example.com/two",
                title: "Two",
                content: "Snippet two",
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        )
      },
    })

    const result = await client.search({
      query: "bun",
      count: 1,
      searchLang: "en",
      safesearch: "strict",
      freshness: "pw",
    })

    const requested = new URL(requestedUrl)
    expect(requested.origin + requested.pathname).toBe("https://search.example/search")
    expect(requested.searchParams.get("q")).toBe("bun")
    expect(requested.searchParams.get("format")).toBe("json")
    expect(requested.searchParams.get("language")).toBe("en")
    expect(requested.searchParams.get("safesearch")).toBe("2")
    expect(requested.searchParams.get("time_range")).toBe("week")

    expect(result.results.length).toBe(1)
    expect(result.results[0]).toEqual({
      url: "https://example.com/one",
      title: "One",
      snippet: "Snippet one",
      source: "example.com",
      published: "2026-01-01",
    })
  })

  test("throws when searxng URL is not configured", async () => {
    const client = new SearxngClient(loadConfig({}))
    await expect(client.search({ query: "bun", count: 1 })).rejects.toThrow(
      "CLAWRUBBER_SEARXNG_BASE_URL is not configured",
    )
  })
})
