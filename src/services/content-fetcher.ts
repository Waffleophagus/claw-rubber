import type { AppConfig } from "../config"
import { assertPublicHost as assertPublicHostDefault } from "../lib/network"
import { BrowserlessClient, type RenderClient } from "./browserless-client"

const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"]

export interface FetchResult {
  finalUrl: string
  contentType: string
  body: string
  backendUsed: "http-fetch" | "browserless"
  rendered: boolean
  fallbackUsed: boolean
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface ContentFetcherDeps {
  browserlessClient?: RenderClient
  assertPublicHost?: (host: string) => Promise<void>
  fetchImpl?: FetchLike
}

export class ContentFetcher {
  private readonly browserlessClient: RenderClient
  private readonly assertPublicHost: (host: string) => Promise<void>
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly config: AppConfig,
    deps: ContentFetcherDeps = {},
  ) {
    this.browserlessClient = deps.browserlessClient ?? new BrowserlessClient(config)
    this.assertPublicHost = deps.assertPublicHost ?? assertPublicHostDefault
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  async fetchPage(url: string): Promise<FetchResult> {
    const first = new URL(url)

    if (first.protocol !== "https:") {
      throw new Error("Only https URLs are allowed")
    }

    if (this.config.websiteRendererBackend === "browserless") {
      try {
        const resolvedFinalUrl = await this.resolveFinalUrl(url)
        const rendered = await this.browserlessClient.render(resolvedFinalUrl)
        const finalUrl = rendered.finalUrl ?? resolvedFinalUrl
        await this.validateFinalUrl(finalUrl)

        return {
          finalUrl,
          contentType: "text/html",
          body: rendered.html,
          backendUsed: "browserless",
          rendered: true,
          fallbackUsed: false,
        }
      } catch (error) {
        if (!this.config.browserless.fallbackToHttp) {
          throw error
        }

        const fallback = await this.fetchViaHttp(url)
        return {
          ...fallback,
          backendUsed: "http-fetch",
          rendered: false,
          fallbackUsed: true,
        }
      }
    }

    const fetched = await this.fetchViaHttp(url)
    return {
      ...fetched,
      backendUsed: "http-fetch",
      rendered: false,
      fallbackUsed: false,
    }
  }

  private async fetchViaHttp(
    url: string,
  ): Promise<Pick<FetchResult, "finalUrl" | "contentType" | "body">> {
    const first = new URL(url)
    let current = first

    for (let i = 0; i <= this.config.profileSettings.maxRedirects; i += 1) {
      await this.assertPublicHost(current.hostname)

      const response = await this.fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": this.config.userAgent,
          "Accept": "text/html,text/plain,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(this.config.profileSettings.fetchTimeoutMs),
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")

        if (!location) {
          throw new Error(`Redirect response without location from ${current}`)
        }

        current = new URL(location, current)

        if (current.protocol !== "https:") {
          throw new Error("Redirected to non-https URL")
        }

        continue
      }

      if (!response.ok) {
        throw new Error(`Upstream page request failed with status ${response.status}`)
      }

      const contentTypeHeader = response.headers.get("content-type") ?? "application/octet-stream"
      const contentType =
        contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream"

      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        throw new Error(`Unsupported content type: ${contentType}`)
      }

      const body = await readBodyWithLimit(response, this.config.profileSettings.maxFetchBytes)
      return {
        finalUrl: current.toString(),
        contentType,
        body,
      }
    }

    throw new Error("Too many redirects")
  }

  private async resolveFinalUrl(url: string): Promise<string> {
    const first = new URL(url)
    let current = first

    for (let i = 0; i <= this.config.profileSettings.maxRedirects; i += 1) {
      await this.assertPublicHost(current.hostname)

      const response = await this.fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": this.config.userAgent,
          "Accept": "text/html,text/plain,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(this.config.profileSettings.fetchTimeoutMs),
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")

        await consumeAndDiscardBody(response)

        if (!location) {
          throw new Error(`Redirect response without location from ${current}`)
        }

        current = new URL(location, current)

        if (current.protocol !== "https:") {
          throw new Error("Redirected to non-https URL")
        }

        continue
      }

      await consumeAndDiscardBody(response)
      return current.toString()
    }

    throw new Error("Too many redirects")
  }

  private async validateFinalUrl(value: string): Promise<void> {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:") {
      throw new Error("Renderer returned non-https final URL")
    }

    await this.assertPublicHost(parsed.hostname)
  }
}

async function consumeAndDiscardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // no-op
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    return ""
  }

  let total = 0
  const chunks: Uint8Array[] = []

  while (true) {
    const result = await reader.read()
    if (result.done) {
      break
    }

    total += result.value.byteLength
    if (total > maxBytes) {
      throw new Error(`Page body exceeded max size of ${maxBytes} bytes`)
    }

    chunks.push(result.value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(merged)
}
