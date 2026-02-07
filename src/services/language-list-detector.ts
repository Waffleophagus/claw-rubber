import { SEEDED_LANGUAGE_NAMES } from "./language-names"

export interface LanguageListDetection {
  isLanguageListLikely: boolean
  matchedNames: string[]
  distinctMatchCount: number
  tokenCount: number
  matchedTokenCount: number
  nonLanguageTokenRatio: number
  confidence: number
}

const TOKEN_RE = /[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)*/gu
const LIST_SEPARATOR_RE = /[|•·,;:\n]/g
const LANGUAGE_CUE_RE =
  /\b(language|languages|idioma|idiomas|langue|lingua|sprache|язык|لغة|언어|言語)\b/iu

export function detectLanguageList(text: string, extraNames: string[] = []): LanguageListDetection {
  const dictionary = buildDictionary(extraNames)
  const normalized = text.normalize("NFKC").toLowerCase()
  const tokens = [...normalized.matchAll(TOKEN_RE)]
    .map((match) => match[0])
    .filter((token) => token.length > 0)

  const matchedNames: string[] = []
  const matchedTokenIndexes = new Set<number>()

  for (let index = 0; index < tokens.length; index += 1) {
    let matchedLength = 0
    let matchedName = ""

    for (let length = 3; length >= 1; length -= 1) {
      if (index + length > tokens.length) {
        continue
      }

      const phrase = tokens.slice(index, index + length).join(" ")
      if (dictionary.has(phrase)) {
        matchedLength = length
        matchedName = phrase
        break
      }
    }

    if (matchedLength === 0) {
      continue
    }

    matchedNames.push(matchedName)
    for (let offset = 0; offset < matchedLength; offset += 1) {
      matchedTokenIndexes.add(index + offset)
    }
    index += matchedLength - 1
  }

  const distinctMatchCount = new Set(matchedNames).size
  const matchedTokenCount = matchedTokenIndexes.size
  const tokenCount = tokens.length
  const matchedRatio = tokenCount > 0 ? matchedTokenCount / tokenCount : 0
  const nonLanguageTokenRatio = tokenCount > 0 ? 1 - matchedRatio : 1
  const listSignalCount = (normalized.match(LIST_SEPARATOR_RE) ?? []).length
  const hasCue = LANGUAGE_CUE_RE.test(normalized)

  const hasStrongLanguageDensity =
    distinctMatchCount >= 4 && matchedTokenCount >= 5 && matchedRatio >= 0.45
  const hasVeryStrongLanguageDensity =
    distinctMatchCount >= 8 && matchedTokenCount >= 8 && matchedRatio >= 0.35
  const hasListSignals = listSignalCount >= 2 || matchedRatio >= 0.7 || hasCue
  const isLanguageListLikely =
    (hasStrongLanguageDensity && hasListSignals) || hasVeryStrongLanguageDensity

  const confidence = Math.max(
    0,
    Math.min(
      1,
      (distinctMatchCount / 10) * 0.5 +
        matchedRatio * 0.4 +
        (Math.min(listSignalCount, 6) / 6) * 0.1,
    ),
  )

  return {
    isLanguageListLikely,
    matchedNames: [...new Set(matchedNames)].slice(0, 16),
    distinctMatchCount,
    tokenCount,
    matchedTokenCount,
    nonLanguageTokenRatio,
    confidence,
  }
}

function buildDictionary(extraNames: string[]): Set<string> {
  const merged = [...SEEDED_LANGUAGE_NAMES, ...extraNames]
    .map((item) => item.normalize("NFKC").toLowerCase().trim())
    .filter((item) => item.length > 1 && item.length <= 80)
  return new Set(merged)
}
