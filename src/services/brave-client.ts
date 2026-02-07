import type { AppConfig } from "../config";

export interface BraveWebSearchRequest {
  query: string;
  count: number;
  country?: string;
  searchLang?: string;
  safesearch?: "off" | "moderate" | "strict";
  freshness?: string;
}

export interface BraveWebResult {
  url: string;
  title: string;
  snippet: string;
  source: string;
  published?: string;
}

export class BraveClient {
  constructor(private readonly config: AppConfig) {}

  async webSearch(request: BraveWebSearchRequest): Promise<{ raw: unknown; results: BraveWebResult[] }> {
    if (!this.config.braveApiKey) {
      throw new Error("CLAWRUBBER_BRAVE_API_KEY is not configured");
    }

    const query = new URLSearchParams({
      q: request.query,
      count: String(request.count),
      safesearch: request.safesearch ?? "moderate",
    });

    if (request.country) {
      query.set("country", request.country);
    }

    if (request.searchLang) {
      query.set("search_lang", request.searchLang);
    }

    if (request.freshness) {
      query.set("freshness", request.freshness);
    }

    const endpoint = `${this.config.braveApiBaseUrl.replace(/\/+$/, "")}/web/search?${query.toString()}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": this.config.braveApiKey,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`Brave API returned ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const json = await response.json();
    const maybeResults = (json as { web?: { results?: unknown[] } }).web?.results;
    const results = Array.isArray(maybeResults) ? maybeResults : [];

    const normalized: BraveWebResult[] = [];
    for (const unknownItem of results) {
      const item = unknownItem as Record<string, unknown>;
      const url = typeof item.url === "string" ? item.url : "";
      if (!url) {
        continue;
      }

      let source = "unknown";
      try {
        source = new URL(url).hostname;
      } catch {
        source = "unknown";
      }

      const title = typeof item.title === "string" ? item.title : "Untitled";
      const snippet = typeof item.description === "string" ? item.description : "";
      const age = typeof item.age === "string" ? item.age : undefined;

      normalized.push({
        url,
        title,
        snippet,
        source,
        published: age,
      });
    }

    return {
      raw: json,
      results: normalized,
    };
  }
}
