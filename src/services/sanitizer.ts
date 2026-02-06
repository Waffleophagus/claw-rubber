function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function sanitizeToText(input: string, maxChars: number): string {
  const stripped = input
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(script|style|noscript|iframe|object|embed|svg|math|form|button|input|textarea|select)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");

  return decodeHtmlEntities(stripped)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\r/g, "")
    .trim()
    .slice(0, maxChars);
}

export function summarizeText(input: string, maxChars = 600): string {
  const summary = input
    .split(/\s+/)
    .slice(0, 120)
    .join(" ")
    .trim();

  return summary.slice(0, maxChars);
}
