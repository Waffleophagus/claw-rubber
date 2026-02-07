export type Availability = "allowed" | "blocked";

export interface SearchResultRecord {
  resultId: string;
  requestId: string;
  query: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  source: string;
  availability: Availability;
  blockReason: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface SearchResultResponse {
  result_id: string;
  title: string;
  snippet: string;
  source: string;
  published?: string;
  availability: Availability;
  risk_hint?: "low" | "medium" | "high";
  url?: string;
}

export interface InjectionScore {
  score: number;
  flags: string[];
  normalizationApplied?: string[];
  obfuscationSignals?: string[];
}

export interface JudgeResult {
  label: "benign" | "suspicious" | "malicious";
  confidence: number;
  reasons: string[];
}

export interface PolicyDecision {
  decision: "allow" | "block";
  score: number;
  flags: string[];
  reason?: string;
  bypassed?: boolean;
}
