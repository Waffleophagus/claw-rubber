import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDb } from "../src/db";

function createDbPath(): string {
  return join(tmpdir(), `claw-rubber-dashboard-${crypto.randomUUID()}.db`);
}

function createDb(): { db: AppDb; path: string } {
  const path = createDbPath();
  return {
    db: new AppDb(path),
    path,
  };
}

function cleanupDb(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // no-op
  }
}

describe("dashboard db", () => {
  test("runtime allowlist merges with static allowlist", () => {
    const { db, path } = createDb();
    try {
      db.addRuntimeAllowlistDomain("*.docs.bun.sh", "investigator override");
      db.addRuntimeAllowlistDomain("api.example.com");
      expect(() => db.addRuntimeAllowlistDomain("$$$")).toThrow("Invalid domain");

      const runtime = db.listRuntimeAllowlistDomains();
      expect(runtime.length).toBe(2);
      expect(runtime[0]?.domain).toBe("api.example.com");
      expect(runtime[1]?.domain).toBe("docs.bun.sh");

      const effective = db.getEffectiveAllowlist(["example.org", "docs.bun.sh"]);
      expect(effective.includes("example.org")).toBe(true);
      expect(effective.includes("docs.bun.sh")).toBe(true);
      expect(effective.includes("api.example.com")).toBe(true);
    } finally {
      cleanupDb(path);
    }
  });

  test("fetch event detail returns payload and triage metadata", () => {
    const { db, path } = createDb();
    try {
      const fetchEventId = db.storeFetchEvent({
        resultId: "result-1",
        url: "https://evil.example/path",
        domain: "evil.example",
        decision: "block",
        score: 13,
        flags: ["instruction_override", "exfiltration"],
        reason: "Rule score 13 >= block threshold 10",
        blockedBy: "rule-threshold",
        domainAction: "inspect",
        mediumThreshold: 6,
        blockThreshold: 10,
        bypassed: false,
        durationMs: 120,
      });

      db.storeFlaggedPayload({
        fetchEventId,
        resultId: "result-1",
        url: "https://evil.example/path",
        domain: "evil.example",
        score: 13,
        flags: ["instruction_override", "exfiltration"],
        reason: "Rule score 13 >= block threshold 10",
        content: "malicious block payload",
      });

      const detail = db.getDashboardEventDetail(`fetch:${fetchEventId}`);
      expect(detail).toBeDefined();
      expect(detail?.blockedBy).toBe("rule-threshold");
      expect(detail?.score).toBe(13);
      expect(detail?.blockThreshold).toBe(10);
      expect(detail?.payloadContent).toContain("malicious block payload");
    } finally {
      cleanupDb(path);
    }
  });

  test("dashboard events combine fetch and search sources with filters", () => {
    const { db, path } = createDb();
    try {
      db.storeSearchBlockEvent({
        requestId: "req-1",
        resultId: "result-search-1",
        query: "suspicious websites",
        url: "https://blocked.example",
        domain: "blocked.example",
        title: "Blocked Domain Result",
        source: "brave",
        reason: "Domain matched blocklist rule: blocked.example",
      });

      db.storeFetchEvent({
        resultId: "result-fetch-1",
        url: "https://review.example",
        domain: "review.example",
        decision: "allow",
        score: 2,
        flags: ["low_risk_reference"],
        reason: null,
        blockedBy: null,
        domainAction: "inspect",
        mediumThreshold: 6,
        blockThreshold: 10,
        bypassed: false,
        durationMs: 44,
      });

      db.storeFetchEvent({
        resultId: "result-fetch-2",
        url: "https://bad.example",
        domain: "bad.example",
        decision: "block",
        score: 8,
        flags: ["tool_abuse", "llm_judge:suspicious"],
        reason: "Fail-closed: rule score 8 >= medium threshold 6",
        blockedBy: "fail-closed",
        domainAction: "inspect",
        mediumThreshold: 6,
        blockThreshold: 10,
        bypassed: false,
        durationMs: 80,
      });

      const now = Date.now();
      const baseQuery = {
        from: now - 60_000,
        to: now + 60_000,
        source: "all" as const,
        decision: "block" as const,
        offset: 0,
        limit: 100,
      };

      const blockedOnly = db.getDashboardEvents(baseQuery);
      expect(blockedOnly.total).toBe(2);
      expect(blockedOnly.events.some((event) => event.source === "search")).toBe(true);
      expect(blockedOnly.events.some((event) => event.blockedBy === "fail-closed")).toBe(true);

      const flagged = db.getDashboardEvents({
        ...baseQuery,
        flagContains: "llm_judge",
      });
      expect(flagged.total).toBe(1);
      expect(flagged.events[0]?.domain).toBe("bad.example");
    } finally {
      cleanupDb(path);
    }
  });
});
