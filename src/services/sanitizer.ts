import TurndownService from "turndown"

export type ExtractMode = "text" | "markdown"

const turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  bulletListMarker: "-",
})

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

export function sanitizeToText(input: string, maxChars: number): string {
  const stripped = stripDangerousMarkup(input)
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")

  const normalized = decodeHtmlEntities(stripped)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\r/g, "")
    .trim()

  return maxChars < normalized.length ? normalized.slice(0, maxChars) : normalized
}

export function extractContent(
  input: string,
  mode: ExtractMode,
  maxChars?: number,
): { content: string; truncated: boolean } {
  const raw =
    mode === "markdown" ? sanitizeToMarkdown(input) : sanitizeToText(input, Number.MAX_SAFE_INTEGER)
  return applyMaxChars(raw, maxChars)
}

export function summarizeText(input: string, maxChars = 600): string {
  const summary = input.split(/\s+/).slice(0, 120).join(" ").trim()

  return summary.slice(0, maxChars)
}

function stripDangerousMarkup(input: string): string {
  return input
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(
      /<(script|style|noscript|iframe|object|embed|svg|math|form|button|input|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    )
}

function sanitizeToMarkdown(input: string): string {
  const safeHtml = stripDangerousMarkup(input)
  const markdown = turndown.turndown(safeHtml)

  return decodeHtmlEntities(markdown)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\r/g, "")
    .trim()
}

function applyMaxChars(
  content: string,
  maxChars?: number,
): { content: string; truncated: boolean } {
  if (maxChars === undefined) {
    return { content, truncated: false }
  }

  if (!Number.isFinite(maxChars) || maxChars < 1) {
    return { content: "", truncated: content.length > 0 }
  }

  if (content.length <= maxChars) {
    return { content, truncated: false }
  }

  return {
    content: content.slice(0, maxChars),
    truncated: true,
  }
}
