import type { AppConfig } from "../config";
import { assertPublicHost } from "../lib/network";

const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];

export interface FetchResult {
  finalUrl: string;
  contentType: string;
  body: string;
}

export class ContentFetcher {
  constructor(private readonly config: AppConfig) {}

  async fetchPage(url: string): Promise<FetchResult> {
    const first = new URL(url);

    if (first.protocol !== "https:") {
      throw new Error("Only https URLs are allowed");
    }

    let current = first;

    for (let i = 0; i <= this.config.profileSettings.maxRedirects; i += 1) {
      await assertPublicHost(current.hostname);

      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": this.config.userAgent,
          Accept: "text/html,text/plain,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(this.config.profileSettings.fetchTimeoutMs),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");

        if (!location) {
          throw new Error(`Redirect response without location from ${current}`);
        }

        current = new URL(location, current);

        if (current.protocol !== "https:") {
          throw new Error("Redirected to non-https URL");
        }

        continue;
      }

      if (!response.ok) {
        throw new Error(`Upstream page request failed with status ${response.status}`);
      }

      const contentTypeHeader = response.headers.get("content-type") ?? "application/octet-stream";
      const contentType = contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";

      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      const body = await readBodyWithLimit(response, this.config.profileSettings.maxFetchBytes);
      return {
        finalUrl: current.toString(),
        contentType,
        body,
      };
    }

    throw new Error("Too many redirects");
  }
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  let total = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }

    total += result.value.byteLength;
    if (total > maxBytes) {
      throw new Error(`Page body exceeded max size of ${maxBytes} bytes`);
    }

    chunks.push(result.value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}
