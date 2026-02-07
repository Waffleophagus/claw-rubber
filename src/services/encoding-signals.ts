export interface SignalScore {
  score: number;
  flags: string[];
}

const BASE64_RE = /\b[A-Za-z0-9+/]{32,}={0,2}\b/g;
const HEX_RUN_RE = /\b(?:[0-9a-fA-F]{2}){12,}\b/g;
const PERCENT_ESCAPE_RE = /(?:%[0-9a-fA-F]{2}){6,}/g;
const UNICODE_ESCAPE_RE = /(?:\\u[0-9a-fA-F]{4}){4,}/g;
const BYTE_ESCAPE_RE = /(?:\\x[0-9a-fA-F]{2}){4,}/g;
const DECODE_CONTEXT_RE = /\b(decode|deobfuscate|unpack|execute|run|ignore|bypass|instruction|prompt|shell|command)\b/i;

export function detectEncodingObfuscationSignals(content: string): SignalScore {
  const flags: string[] = [];

  const base64Hits = content.match(BASE64_RE)?.length ?? 0;
  const hexHits = content.match(HEX_RUN_RE)?.length ?? 0;
  const percentHits = content.match(PERCENT_ESCAPE_RE)?.length ?? 0;
  const unicodeEscapeHits = content.match(UNICODE_ESCAPE_RE)?.length ?? 0;
  const byteEscapeHits = content.match(BYTE_ESCAPE_RE)?.length ?? 0;

  const hasEncodingPayload =
    base64Hits > 0 ||
    hexHits > 0 ||
    percentHits > 0 ||
    unicodeEscapeHits > 0 ||
    byteEscapeHits > 0;

  if (!hasEncodingPayload) {
    return { score: 0, flags };
  }

  flags.push("encoded_payload_candidate");

  if (percentHits > 0 || unicodeEscapeHits > 0 || byteEscapeHits > 0) {
    flags.push("escape_sequence_obfuscation");
  }

  const decodeContext = DECODE_CONTEXT_RE.test(content);
  if (decodeContext) {
    flags.push("decode_instruction_context");
  }

  let score = 1;
  if (decodeContext) {
    score += 2;
  }

  if (unicodeEscapeHits + byteEscapeHits + percentHits >= 2) {
    score += 1;
  }

  if (base64Hits + hexHits >= 2) {
    score += 1;
  }

  return {
    score,
    flags,
  };
}
