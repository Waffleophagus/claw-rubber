import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { SearchResultRecord } from "./types";

export interface FetchEventInput {
  resultId: string;
  domain: string;
  decision: "allow" | "block";
  score: number;
  flags: string[];
  reason: string | null;
  bypassed: boolean;
  durationMs: number;
}

export interface FlaggedPayloadInput {
  resultId: string;
  url: string;
  domain: string;
  score: number;
  flags: string[];
  reason: string;
  content: string;
}

export class AppDb {
  private readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS search_requests (
        request_id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        response_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_results_cache (
        result_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        query TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        snippet TEXT NOT NULL,
        source TEXT NOT NULL,
        availability TEXT NOT NULL,
        block_reason TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_search_results_expiry ON search_results_cache(expires_at);

      CREATE TABLE IF NOT EXISTS fetch_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        decision TEXT NOT NULL,
        score INTEGER NOT NULL,
        flags_json TEXT NOT NULL,
        reason TEXT,
        bypassed INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flagged_payloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        score INTEGER NOT NULL,
        flags_json TEXT NOT NULL,
        reason TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  storeSearchRequest(requestId: string, query: string, responseJson: unknown): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO search_requests (request_id, query, created_at, response_json) VALUES (?, ?, ?, ?)`,
    );

    stmt.run(requestId, query, now, JSON.stringify(responseJson));
  }

  storeSearchResult(record: SearchResultRecord): void {
    const stmt = this.db.prepare(
      `
        INSERT INTO search_results_cache (
          result_id, request_id, query, url, domain, title, snippet, source,
          availability, block_reason, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    stmt.run(
      record.resultId,
      record.requestId,
      record.query,
      record.url,
      record.domain,
      record.title,
      record.snippet,
      record.source,
      record.availability,
      record.blockReason,
      record.createdAt,
      record.expiresAt,
    );
  }

  getSearchResult(resultId: string): SearchResultRecord | null {
    const now = Date.now();
    const stmt = this.db.prepare(
      `
        SELECT
          result_id,
          request_id,
          query,
          url,
          domain,
          title,
          snippet,
          source,
          availability,
          block_reason,
          created_at,
          expires_at
        FROM search_results_cache
        WHERE result_id = ? AND expires_at > ?
      `,
    );

    const row = stmt.get(resultId, now) as
      | {
          result_id: string;
          request_id: string;
          query: string;
          url: string;
          domain: string;
          title: string;
          snippet: string;
          source: string;
          availability: "allowed" | "blocked";
          block_reason: string | null;
          created_at: number;
          expires_at: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      resultId: row.result_id,
      requestId: row.request_id,
      query: row.query,
      url: row.url,
      domain: row.domain,
      title: row.title,
      snippet: row.snippet,
      source: row.source,
      availability: row.availability,
      blockReason: row.block_reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  storeFetchEvent(event: FetchEventInput): void {
    const stmt = this.db.prepare(
      `
        INSERT INTO fetch_events (
          result_id, domain, decision, score, flags_json, reason, bypassed, duration_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    stmt.run(
      event.resultId,
      event.domain,
      event.decision,
      event.score,
      JSON.stringify(event.flags),
      event.reason,
      event.bypassed ? 1 : 0,
      event.durationMs,
      Date.now(),
    );
  }

  storeFlaggedPayload(payload: FlaggedPayloadInput): void {
    const stmt = this.db.prepare(
      `
        INSERT INTO flagged_payloads (
          result_id, url, domain, score, flags_json, reason, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    stmt.run(
      payload.resultId,
      payload.url,
      payload.domain,
      payload.score,
      JSON.stringify(payload.flags),
      payload.reason,
      payload.content,
      Date.now(),
    );
  }

  purgeExpiredData(retentionDays: number): void {
    const now = Date.now();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    this.db.prepare(`DELETE FROM search_results_cache WHERE expires_at <= ?`).run(now);
    this.db.prepare(`DELETE FROM flagged_payloads WHERE created_at <= ?`).run(now - retentionMs);
    this.db.prepare(`DELETE FROM fetch_events WHERE created_at <= ?`).run(now - retentionMs);
    this.db.prepare(`DELETE FROM search_requests WHERE created_at <= ?`).run(now - retentionMs);
  }
}
