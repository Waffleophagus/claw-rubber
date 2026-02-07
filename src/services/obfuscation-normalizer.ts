export interface NormalizationResult {
  normalizedText: string
  transformations: string[]
  signalFlags: string[]
  confusableAnalysis: {
    totalTokens: number
    mappedCount: number
    suspiciousTokens: Array<{
      token: string
      start: number
      end: number
      confusableCount: number
    }>
  }
}

const CONTROL_OR_INVISIBLE_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g
const TOKEN_RE = /[\p{L}\p{M}\p{N}_-]+/gu
const LATIN_SCRIPT_RE = /\p{Script=Latin}/u
const CYRILLIC_SCRIPT_RE = /\p{Script=Cyrillic}/u
const GREEK_SCRIPT_RE = /\p{Script=Greek}/u

// High-risk confusables frequently used in mixed-script obfuscation attempts.
const CONFUSABLES: Record<string, string> = {
  а: "a",
  А: "A", // Cyrillic a
  е: "e",
  Е: "E", // Cyrillic e
  о: "o",
  О: "O", // Cyrillic o
  р: "p",
  Р: "P", // Cyrillic er
  с: "c",
  С: "C", // Cyrillic es
  у: "y",
  У: "Y", // Cyrillic u
  х: "x",
  Х: "X", // Cyrillic ha
  і: "i",
  І: "I", // Cyrillic i
  ј: "j",
  Ј: "J", // Cyrillic je
  ԁ: "d", // Cyrillic d-like
  ԛ: "q", // Cyrillic q-like
  α: "a",
  Α: "A", // Greek alpha
  β: "b",
  Β: "B", // Greek beta
  γ: "y",
  Γ: "Y", // Greek gamma (approx)
  δ: "d",
  Δ: "D", // Greek delta
  ε: "e",
  Ε: "E", // Greek epsilon
  ι: "i",
  Ι: "I", // Greek iota
  κ: "k",
  Κ: "K", // Greek kappa
  ο: "o",
  Ο: "O", // Greek omicron
  ρ: "p",
  Ρ: "P", // Greek rho
  τ: "t",
  Τ: "T", // Greek tau
  υ: "u",
  Υ: "U", // Greek upsilon
  ν: "v",
  Ν: "N", // Greek nu
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const parsed = Number.parseInt(hex, 16)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ""
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const parsed = Number.parseInt(dec, 10)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ""
    })
}

function mapConfusables(input: string): { text: string; replacedCount: number } {
  let replacedCount = 0
  let output = ""

  for (const char of input) {
    const mapped = CONFUSABLES[char]
    if (mapped) {
      replacedCount += 1
      output += mapped
    } else {
      output += char
    }
  }

  return { text: output, replacedCount }
}

function collapseRepeatedCharacters(input: string): string {
  return input.replace(/([a-zA-Z])\1{3,}/g, "$1$1")
}

function detectConfusableMixedScriptTokens(input: string): {
  totalTokens: number
  suspiciousTokens: Array<{ token: string; start: number; end: number; confusableCount: number }>
} {
  const suspiciousTokens: Array<{
    token: string
    start: number
    end: number
    confusableCount: number
  }> = []
  let totalTokens = 0

  for (const match of input.matchAll(TOKEN_RE)) {
    const token = match[0]
    const start = match.index
    if (!token || start === undefined) {
      continue
    }

    totalTokens += 1
    let hasLatin = false
    let confusableCount = 0

    for (const char of token) {
      if (LATIN_SCRIPT_RE.test(char)) {
        hasLatin = true
      }

      if (CONFUSABLES[char] && (CYRILLIC_SCRIPT_RE.test(char) || GREEK_SCRIPT_RE.test(char))) {
        confusableCount += 1
      }
    }

    if (hasLatin && confusableCount > 0) {
      suspiciousTokens.push({
        token,
        start,
        end: start + token.length,
        confusableCount,
      })
    }
  }

  return { totalTokens, suspiciousTokens }
}

export function normalizeForSecurity(input: string): NormalizationResult {
  const transformations: string[] = []
  const signalFlags: string[] = []

  let text = input

  const nfkc = text.normalize("NFKC")
  if (nfkc !== text) {
    transformations.push("unicode_nfkc")
    text = nfkc
  }

  const controlMatches = text.match(CONTROL_OR_INVISIBLE_RE)
  if (controlMatches && controlMatches.length > 0) {
    signalFlags.push("unicode_invisible_or_bidi")
    transformations.push("strip_invisible_controls")
    text = text.replace(CONTROL_OR_INVISIBLE_RE, "")
  }

  const decodedEntities = decodeHtmlEntities(text)
  if (decodedEntities !== text) {
    transformations.push("decode_html_entities")
    text = decodedEntities
  }

  const confusableTokenAnalysis = detectConfusableMixedScriptTokens(text)
  const confusableResult = mapConfusables(text)
  if (confusableResult.replacedCount > 0) {
    transformations.push("map_confusables")
    text = confusableResult.text
  }
  if (confusableTokenAnalysis.suspiciousTokens.length > 0) {
    signalFlags.push("confusable_mixed_script")
  }

  const collapsedPunctuation = text.replace(/[._\-:/\\|]{2,}/g, " ")
  if (collapsedPunctuation !== text) {
    transformations.push("collapse_punctuation_runs")
    text = collapsedPunctuation
  }

  const lower = text.toLowerCase()
  if (lower !== text) {
    transformations.push("lowercase")
    text = lower
  }

  const collapsedRepeats = collapseRepeatedCharacters(text)
  if (collapsedRepeats !== text) {
    transformations.push("collapse_repeated_chars")
    text = collapsedRepeats
  }

  const compactWhitespace = text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (compactWhitespace !== text) {
    transformations.push("normalize_whitespace")
    text = compactWhitespace
  }

  return {
    normalizedText: text,
    transformations: [...new Set(transformations)],
    signalFlags: [...new Set(signalFlags)],
    confusableAnalysis: {
      totalTokens: confusableTokenAnalysis.totalTokens,
      mappedCount: confusableResult.replacedCount,
      suspiciousTokens: confusableTokenAnalysis.suspiciousTokens,
    },
  }
}
