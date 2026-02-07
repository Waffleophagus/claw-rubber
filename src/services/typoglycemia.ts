export interface SignalScore {
  score: number;
  flags: string[];
}

const HIGH_RISK_KEYWORDS = [
  "ignore",
  "bypass",
  "override",
  "system",
  "prompt",
  "instruction",
  "instructions",
  "developer",
  "secret",
  "password",
  "token",
  "execute",
  "shell",
  "command",
  "curl",
  "wget",
  "reveal",
  "exfiltrate",
];

export function detectTypoglycemiaSignals(content: string): SignalScore {
  const tokens = tokenize(content);
  const matches = new Set<string>();

  for (const token of tokens) {
    if (token.length < 5 || token.length > 20) {
      continue;
    }

    for (const keyword of HIGH_RISK_KEYWORDS) {
      if (token === keyword || token.length !== keyword.length) {
        continue;
      }

      if (isLikelyTypoglycemiaVariant(token, keyword)) {
        matches.add(keyword);
      }
    }
  }

  if (matches.size === 0) {
    return { score: 0, flags: [] };
  }

  const score = Math.min(3 + Math.max(matches.size - 1, 0), 7);
  return {
    score,
    flags: [
      "typoglycemia_high_risk_keyword",
      ...[...matches].map((keyword) => `typoglycemia_keyword:${keyword}`),
    ],
  };
}

function tokenize(content: string): string[] {
  const matches = content.match(/[a-z]{3,}/g);
  return matches ?? [];
}

function isLikelyTypoglycemiaVariant(token: string, keyword: string): boolean {
  if (token[0] !== keyword[0] || token[token.length - 1] !== keyword[keyword.length - 1]) {
    return false;
  }

  const tokenMiddle = token.slice(1, -1);
  const keywordMiddle = keyword.slice(1, -1);

  if (sortCharacters(tokenMiddle) === sortCharacters(keywordMiddle)) {
    return true;
  }

  const distance = damerauLevenshtein(token, keyword);
  return distance <= 2;
}

function sortCharacters(input: string): string {
  return [...input].sort().join("");
}

function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i]![0] = i;
  }

  for (let j = 0; j < cols; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      let value = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, matrix[i - 2]![j - 2]! + cost);
      }

      matrix[i]![j] = value;
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}
