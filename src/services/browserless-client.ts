import type { AppConfig, BrowserlessWaitUntil } from "../config"

export interface BrowserlessRenderResult {
  finalUrl: string
  html: string
}

export interface RenderClient {
  render(url: string): Promise<BrowserlessRenderResult>
}

export class BrowserlessClient implements RenderClient {
  constructor(private readonly config: AppConfig) {}

  async render(url: string): Promise<BrowserlessRenderResult> {
    const endpoint = buildBrowserlessContentEndpoint(this.config)
    const body: Record<string, unknown> = {
      url,
      gotoOptions: {
        waitUntil: mapWaitUntil(this.config.browserless.waitUntil),
        timeout: this.config.browserless.timeoutMs,
      },
      bestAttempt: true,
      blockAds: this.config.browserless.blockAds,
    }

    if (this.config.browserless.waitForSelector) {
      body.waitForSelector = {
        selector: this.config.browserless.waitForSelector,
        timeout: this.config.browserless.timeoutMs,
      }
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(this.config.browserless.timeoutMs),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Browserless returned ${response.status}: ${text.slice(0, 500)}`)
    }

    const html = await readBodyWithLimit(response, this.config.browserless.maxHtmlBytes)

    return {
      finalUrl: url,
      html,
    }
  }
}

function buildBrowserlessContentEndpoint(config: AppConfig): string {
  const base = config.browserless.baseUrl.replace(/\/+$/, "")
  const endpoint = new URL(`${base}/chromium/content`)

  if (config.browserless.token) {
    endpoint.searchParams.set("token", config.browserless.token)
  }

  return endpoint.toString()
}

function mapWaitUntil(value: BrowserlessWaitUntil): string {
  if (value === "networkidle") {
    return "networkidle0"
  }

  return value
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
      throw new Error(`Rendered HTML exceeded max size of ${maxBytes} bytes`)
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
