import type { AppConfig } from "../config"
import type {
  SearchProviderClient,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from "./search-provider"

interface SearxngClientDependencies {
  fetchImpl?: (input: Request | URL | string, init?: RequestInit) => Promise<Response>
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

export class SearxngClient implements SearchProviderClient {
  readonly name = "searxng" as const

  private readonly fetchImpl: (
    input: Request | URL | string,
    init?: RequestInit,
  ) => Promise<Response>
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout

  constructor(
    private readonly config: AppConfig,
    dependencies: SearxngClientDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch
    this.setTimeoutImpl = dependencies.setTimeoutImpl ?? setTimeout
    this.clearTimeoutImpl = dependencies.clearTimeoutImpl ?? clearTimeout
  }

  async search(request: SearchRequest): Promise<SearchResponse> {
    if (!this.config.searxng.baseUrl) {
      throw new Error("CLAWRUBBER_SEARXNG_BASE_URL is not configured")
    }

    const query = new URLSearchParams({
      q: request.query,
      format: "json",
    })

    query.set("safesearch", toSearxngSafesearch(request.safesearch ?? "moderate"))

    if (request.searchLang) {
      query.set("language", request.searchLang)
    }

    if (request.freshness) {
      const timeRange = toSearxngTimeRange(request.freshness)
      if (timeRange) {
        query.set("time_range", timeRange)
      }
    }

    const endpoint = `${this.config.searxng.baseUrl}/search?${query.toString()}`

    const controller = new AbortController()
    const timeoutHandle = this.setTimeoutImpl(() => controller.abort(), this.config.searxng.timeoutMs)

    let response: Response
    try {
      response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      })
    } finally {
      this.clearTimeoutImpl(timeoutHandle)
    }

    if (!response.ok) {
      const bodyText = await response.text()
      throw new Error(`SearXNG API returned ${response.status}: ${bodyText.slice(0, 500)}`)
    }

    const json = await response.json()
    const maybeResults = (json as { results?: unknown[] }).results
    const results = Array.isArray(maybeResults) ? maybeResults : []

    const normalized: SearchResult[] = []
    for (const unknownItem of results) {
      const item = unknownItem as Record<string, unknown>
      const url = typeof item.url === "string" ? item.url : ""
      if (!url) {
        continue
      }

      normalized.push({
        url,
        title: typeof item.title === "string" ? item.title : "Untitled",
        snippet:
          typeof item.content === "string"
            ? item.content
            : typeof item.description === "string"
              ? item.description
              : "",
        source: safeHostname(url),
        published: typeof item.publishedDate === "string" ? item.publishedDate : undefined,
      })
    }

    return {
      raw: json,
      results: normalized.slice(0, request.count),
    }
  }
}

function toSearxngSafesearch(value: "off" | "moderate" | "strict"): string {
  if (value === "off") {
    return "0"
  }

  if (value === "strict") {
    return "2"
  }

  return "1"
}

function toSearxngTimeRange(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  const map: Record<string, string> = {
    pd: "day",
    day: "day",
    pw: "week",
    week: "week",
    pm: "month",
    month: "month",
    py: "year",
    year: "year",
  }

  return map[normalized] ?? null
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "unknown"
  }
}
