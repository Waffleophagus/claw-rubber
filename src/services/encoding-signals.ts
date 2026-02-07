export interface SignalScore {
  score: number
  flags: string[]
  evidence: SignalEvidence[]
}

export interface SignalEvidence {
  flag: string
  start: number
  end: number
  matchedText: string
  notes?: string
}

const BASE64_RE = /\b[A-Za-z0-9+/]{32,}={0,2}\b/g
const HEX_RUN_RE = /\b(?:[0-9a-fA-F]{2}){12,}\b/g
const PERCENT_ESCAPE_RE = /(?:%[0-9a-fA-F]{2}){6,}/g
const UNICODE_ESCAPE_RE = /(?:\\u[0-9a-fA-F]{4}){4,}/g
const BYTE_ESCAPE_RE = /(?:\\x[0-9a-fA-F]{2}){4,}/g
const DECODE_CONTEXT_RE =
  /\b(decode|deobfuscate|unpack|execute|run|ignore|bypass|instruction|prompt|shell|command)\b/i

export function detectEncodingObfuscationSignals(content: string): SignalScore {
  const flags: string[] = []
  const evidence: SignalEvidence[] = []

  const base64Hits = collectMatches(content, BASE64_RE, 3)
  const hexHits = collectMatches(content, HEX_RUN_RE, 3)
  const percentHits = collectMatches(content, PERCENT_ESCAPE_RE, 3)
  const unicodeEscapeHits = collectMatches(content, UNICODE_ESCAPE_RE, 3)
  const byteEscapeHits = collectMatches(content, BYTE_ESCAPE_RE, 3)

  const hasEncodingPayload =
    base64Hits.length > 0 ||
    hexHits.length > 0 ||
    percentHits.length > 0 ||
    unicodeEscapeHits.length > 0 ||
    byteEscapeHits.length > 0

  if (!hasEncodingPayload) {
    return { score: 0, flags, evidence }
  }

  flags.push("encoded_payload_candidate")
  const encodedExamples = [
    ...base64Hits,
    ...hexHits,
    ...percentHits,
    ...unicodeEscapeHits,
    ...byteEscapeHits,
  ].slice(0, 4)
  for (const match of encodedExamples) {
    evidence.push({
      flag: "encoded_payload_candidate",
      start: match.start,
      end: match.end,
      matchedText: match.text,
    })
  }

  if (percentHits.length > 0 || unicodeEscapeHits.length > 0 || byteEscapeHits.length > 0) {
    flags.push("escape_sequence_obfuscation")
    const escapeExamples = [...percentHits, ...unicodeEscapeHits, ...byteEscapeHits].slice(0, 4)
    for (const match of escapeExamples) {
      evidence.push({
        flag: "escape_sequence_obfuscation",
        start: match.start,
        end: match.end,
        matchedText: match.text,
      })
    }
  }

  const decodeContextMatches = collectMatches(content, DECODE_CONTEXT_RE, 3)
  if (decodeContextMatches.length > 0) {
    flags.push("decode_instruction_context")
    for (const match of decodeContextMatches) {
      evidence.push({
        flag: "decode_instruction_context",
        start: match.start,
        end: match.end,
        matchedText: match.text,
      })
    }
  }

  let score = 1
  if (decodeContextMatches.length > 0) {
    score += 2
  }

  if (unicodeEscapeHits.length + byteEscapeHits.length + percentHits.length >= 2) {
    score += 1
  }

  if (base64Hits.length + hexHits.length >= 2) {
    score += 1
  }

  return {
    score,
    flags,
    evidence: dedupeEvidence(evidence),
  }
}

interface RegexMatch {
  start: number
  end: number
  text: string
}

function collectMatches(content: string, pattern: RegExp, limit: number): RegexMatch[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  const regex = new RegExp(pattern.source, flags)
  const matches: RegexMatch[] = []

  for (const match of content.matchAll(regex)) {
    const value = match[0]
    const start = match.index
    if (start === undefined || !value) {
      continue
    }

    matches.push({
      start,
      end: start + value.length,
      text: value,
    })

    if (matches.length >= limit) {
      break
    }
  }

  return matches
}

function dedupeEvidence(evidence: SignalEvidence[]): SignalEvidence[] {
  const seen = new Set<string>()
  const result: SignalEvidence[] = []
  for (const item of evidence) {
    const key = `${item.flag}:${item.start}:${item.end}:${item.matchedText}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(item)
  }

  return result
}
