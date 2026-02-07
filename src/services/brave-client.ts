import type { AppConfig } from "../config";
import { RateLimiterQueue } from "./rate-limiter";

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

interface BraveClientDependencies {
  fetchImpl?: (input: Request | URL | string, init?: RequestInit) => Promise<Response>;
  limiter?: RateLimiterQueue;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

export class BraveClient {
  private readonly limiter: RateLimiterQueue;
  private readonly fetchImpl: (input: Request | URL | string, init?: RequestInit) => Promise<Response>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(
    private readonly config: AppConfig,
    dependencies: BraveClientDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.sleep = dependencies.sleep ?? ((ms) => Bun.sleep(ms));
    this.now = dependencies.now ?? Date.now;
    this.random = dependencies.random ?? Math.random;
    this.limiter = dependencies.limiter ?? new RateLimiterQueue({
      requestsPerSecond: config.braveRateLimit.requestsPerSecond,
      maxQueued: config.braveRateLimit.queueMax,
      now: this.now,
      sleep: this.sleep,
    });
  }

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
    const response = await this.searchWithRetry(endpoint);

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

  private async searchWithRetry(endpoint: string): Promise<Response> {
    const maxAttempts = this.config.braveRateLimit.retryOn429
      ? this.config.braveRateLimit.retryMax + 1
      : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await this.limiter.schedule(() => this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.config.braveApiKey,
        },
      }));

      const shouldRetry = response.status === 429
        && this.config.braveRateLimit.retryOn429
        && attempt < maxAttempts;

      if (!shouldRetry) {
        return response;
      }

      await this.sleep(this.computeRetryDelayMs(response));
    }

    throw new Error("Brave search attempts exhausted");
  }

  private computeRetryDelayMs(response: Response): number {
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter) {
      const parsedSeconds = Number.parseFloat(retryAfter);
      if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
        return Math.ceil(parsedSeconds * 1000 + this.jitterMs());
      }
    }

    const reset = response.headers.get("x-ratelimit-reset");
    if (reset) {
      const parsedReset = Number.parseFloat(reset);
      if (Number.isFinite(parsedReset) && parsedReset > 0) {
        // Brave may return either a delta-seconds value or an epoch timestamp.
        if (parsedReset > 1_000_000_000) {
          return Math.max(0, Math.ceil(parsedReset * 1000 - this.now() + this.jitterMs()));
        }
        return Math.ceil(parsedReset * 1000 + this.jitterMs());
      }
    }

    return 1000 + this.jitterMs();
  }

  private jitterMs(): number {
    return Math.floor(this.random() * 250);
  }
}
