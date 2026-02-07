import { describe, expect, test } from "bun:test";
import type { AppConfig } from "../src/config";
import { decidePolicy } from "../src/services/policy";

function mockConfig(): AppConfig {
  return {
    port: 3000,
    host: "0.0.0.0",
    braveApiKey: "x",
    braveApiBaseUrl: "https://api.search.brave.com/res/v1",
    braveRateLimit: {
      tier: "free",
      requestsPerSecond: 1,
      queueMax: 10,
      retryOn429: true,
      retryMax: 1,
    },
    profile: "strict",
    profileSettings: {
      mediumThreshold: 6,
      blockThreshold: 10,
      maxFetchBytes: 1_000_000,
      maxExtractedChars: 16_000,
      fetchTimeoutMs: 7_000,
      maxRedirects: 3,
    },
    redactedUrls: true,
    failClosed: true,
    allowlistDomains: [],
    blocklistDomains: [],
    languageNameAllowlistExtra: [],
    dbPath: "./data/test.db",
    logDir: "./data/logs",
    resultTtlMs: 600_000,
    retentionDays: 7,
    llmJudgeEnabled: false,
    llmProvider: "openai",
    llmModel: "gpt-4o-mini",
    openaiApiKey: "",
    ollamaBaseUrl: "http://localhost:11434/api",
    userAgent: "test-agent",
    websiteRendererBackend: "none",
    browserless: {
      baseUrl: "http://browserless:3000",
      token: "",
      timeoutMs: 12_000,
      waitUntil: "networkidle",
      waitForSelector: "",
      maxHtmlBytes: 1_500_000,
      fallbackToHttp: true,
      blockAds: true,
    },
  };
}

describe("policy decisions", () => {
  test("block on blocklist", () => {
    const decision = decidePolicy(mockConfig(), 0, [], "block", "blocked domain", null);

    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("blocked domain");
  });

  test("allow on allowlist bypass", () => {
    const decision = decidePolicy(mockConfig(), 99, ["instruction_override"], "allow-bypass", "trusted domain", null);

    expect(decision.decision).toBe("allow");
    expect(decision.bypassed).toBe(true);
  });

  test("fail-closed blocks medium score", () => {
    const decision = decidePolicy(mockConfig(), 6, ["tool_abuse"], "inspect", undefined, null);

    expect(decision.decision).toBe("block");
  });

  test("allows low score", () => {
    const decision = decidePolicy(mockConfig(), 2, [], "inspect", undefined, null);

    expect(decision.decision).toBe("allow");
  });
});
