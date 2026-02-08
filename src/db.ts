import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"
import { normalizeDomain } from "./lib/domain-policy"
import type { EvidenceMatch, SearchResultRecord } from "./types.ts"

export interface FetchEventInput {
  resultId: string
  url: string
  domain: string
  decision: "allow" | "block"
  score: number
  flags: string[]
  reason: string | null
  blockedBy: string | null
  allowedBy: string | null
  domainAction: "allow-bypass" | "block" | "inspect"
  mediumThreshold: number
  blockThreshold: number
  bypassed: boolean
  durationMs: number
  traceKind?: "search-result-fetch" | "direct-web-fetch" | "unknown"
  searchRequestId?: string | null
  searchQuery?: string | null
  searchRank?: number | null
}

export interface FlaggedPayloadInput {
  fetchEventId?: number
  resultId: string
  url: string
  domain: string
  score: number
  flags: string[]
  reason: string
  content: string
  evidence?: EvidenceMatch[]
}

export interface SearchBlockEventInput {
  requestId: string
  resultId: string
  query: string
  url: string
  domain: string
  title: string
  source: string
  reason: string
}

export type DashboardSource = "fetch" | "search"

export interface DashboardEventsQuery {
  from: number
  to: number
  source: "fetch" | "search" | "all"
  decision: "allow" | "block" | "all"
  domainContains?: string
  reasonContains?: string
  flagContains?: string
  allowedByContains?: string
  queryContains?: string
  traceKind?: "search-result-fetch" | "direct-web-fetch" | "unknown"
  minSearchRank?: number
  maxSearchRank?: number
  offset: number
  limit: number
}

export interface DashboardEventRecord {
  eventId: string
  source: DashboardSource
  createdAt: number
  resultId: string
  decision: "allow" | "block"
  domain: string
  url: string | null
  reason: string | null
  blockedBy: string | null
  allowedBy: string | null
  flags: string[]
  score: number
  mediumThreshold: number | null
  blockThreshold: number | null
  bypassed: boolean
  durationMs: number | null
  title: string | null
  query: string | null
  requestId: string | null
  traceKind: "search-result-fetch" | "direct-web-fetch" | "unknown"
  searchRank: number | null
}

export interface DashboardEventDetail extends DashboardEventRecord {
  payloadContent: string | null
  evidence: EvidenceMatch[]
}

export interface DashboardOverview {
  totalEvents: number
  blockedEvents: number
  allowedEvents: number
  blockedRate: number
  uniqueBlockedDomains: number
  bySource: {
    fetch: number
    search: number
  }
  topBlockedBy: string | null
  topAllowedBy: string | null
}

export interface DashboardTimeseriesPoint {
  bucketStart: number
  total: number
  blocked: number
  allowed: number
  fetch: number
  search: number
}

export interface DashboardTopItem {
  value: string
  count: number
}

export interface RuntimeAllowlistDomain {
  domain: string
  note: string | null
  addedAt: number
}

export interface RuntimeBlocklistDomain {
  domain: string
  note: string | null
  addedAt: number
}

interface DashboardEventRow {
  event_id: string
  source: DashboardSource
  created_at: number
  result_id: string
  decision: "allow" | "block"
  domain: string
  url: string | null
  reason: string | null
  blocked_by: string | null
  allowed_by: string | null
  flags_json: string
  score: number
  medium_threshold: number | null
  block_threshold: number | null
  bypassed: number
  duration_ms: number | null
  title: string | null
  query: string | null
  request_id: string | null
  trace_kind: "search-result-fetch" | "direct-web-fetch" | "unknown"
  search_rank: number | null
}

export class AppDb {
  private readonly db: Database

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true, strict: true })
    this.migrate()
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
        search_rank INTEGER NOT NULL DEFAULT 0,
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
        url TEXT NOT NULL DEFAULT '',
        domain TEXT NOT NULL,
        decision TEXT NOT NULL,
        score INTEGER NOT NULL,
        flags_json TEXT NOT NULL,
        reason TEXT,
        blocked_by TEXT,
        allowed_by TEXT,
        domain_action TEXT,
        trace_kind TEXT NOT NULL DEFAULT 'unknown',
        search_request_id TEXT,
        search_query TEXT,
        search_rank INTEGER,
        medium_threshold INTEGER,
        block_threshold INTEGER,
        bypassed INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS flagged_payloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fetch_event_id INTEGER,
        result_id TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        score INTEGER NOT NULL,
        flags_json TEXT NOT NULL,
        evidence_json TEXT,
        reason TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS search_block_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        result_id TEXT NOT NULL,
        query TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_allowlist_domains (
        domain TEXT PRIMARY KEY,
        note TEXT,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_blocklist_domains (
        domain TEXT PRIMARY KEY,
        note TEXT,
        added_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_fetch_events_created_at ON fetch_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_fetch_events_domain ON fetch_events(domain);
      CREATE INDEX IF NOT EXISTS idx_fetch_events_result_id ON fetch_events(result_id);
      CREATE INDEX IF NOT EXISTS idx_flagged_payloads_created_at ON flagged_payloads(created_at);
      CREATE INDEX IF NOT EXISTS idx_flagged_payloads_result_id ON flagged_payloads(result_id);
      CREATE INDEX IF NOT EXISTS idx_search_block_events_created_at ON search_block_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_search_block_events_domain ON search_block_events(domain);
      CREATE INDEX IF NOT EXISTS idx_search_block_events_result_id ON search_block_events(result_id);
    `)

    this.ensureColumn("fetch_events", "url", "TEXT NOT NULL DEFAULT ''")
    this.ensureColumn("fetch_events", "blocked_by", "TEXT")
    this.ensureColumn("fetch_events", "allowed_by", "TEXT")
    this.ensureColumn("fetch_events", "domain_action", "TEXT")
    this.ensureColumn("fetch_events", "trace_kind", "TEXT NOT NULL DEFAULT 'unknown'")
    this.ensureColumn("fetch_events", "search_request_id", "TEXT")
    this.ensureColumn("fetch_events", "search_query", "TEXT")
    this.ensureColumn("fetch_events", "search_rank", "INTEGER")
    this.ensureColumn("fetch_events", "medium_threshold", "INTEGER")
    this.ensureColumn("fetch_events", "block_threshold", "INTEGER")
    this.ensureColumn("search_results_cache", "search_rank", "INTEGER NOT NULL DEFAULT 0")
    this.ensureColumn("flagged_payloads", "fetch_event_id", "INTEGER")
    this.ensureColumn("flagged_payloads", "evidence_json", "TEXT")
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fetch_events_decision ON fetch_events(decision)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fetch_events_allowed_by ON fetch_events(allowed_by)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fetch_events_blocked_by ON fetch_events(blocked_by)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fetch_events_trace_kind ON fetch_events(trace_kind)`)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_fetch_events_search_rank ON fetch_events(search_rank)`)
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_flagged_payloads_fetch_event_id ON flagged_payloads(fetch_event_id)`,
    )
  }

  storeSearchRequest(requestId: string, query: string, responseJson: unknown): void {
    const now = Date.now()
    const stmt = this.db.prepare(
      `INSERT INTO search_requests (request_id, query, created_at, response_json) VALUES (?, ?, ?, ?)`,
    )

    stmt.run(requestId, query, now, JSON.stringify(responseJson))
  }

  storeSearchResult(record: SearchResultRecord): void {
    const stmt = this.db.prepare(
      `
        INSERT INTO search_results_cache (
          result_id, request_id, query, search_rank, url, domain, title, snippet, source,
          availability, block_reason, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )

    stmt.run(
      record.resultId,
      record.requestId,
      record.query,
      record.rank ?? 0,
      record.url,
      record.domain,
      record.title,
      record.snippet,
      record.source,
      record.availability,
      record.blockReason,
      record.createdAt,
      record.expiresAt,
    )
  }

  getSearchResult(resultId: string): SearchResultRecord | null {
    const now = Date.now()
    const stmt = this.db.prepare(
      `
        SELECT
          result_id,
          request_id,
          query,
          search_rank,
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
    )

    const row = stmt.get(resultId, now) as
      | {
          result_id: string
          request_id: string
          query: string
          search_rank: number
          url: string
          domain: string
          title: string
          snippet: string
          source: string
          availability: "allowed" | "blocked"
          block_reason: string | null
          created_at: number
          expires_at: number
        }
      | undefined

    if (!row) {
      return null
    }

    return {
      resultId: row.result_id,
      requestId: row.request_id,
      query: row.query,
      rank: row.search_rank,
      url: row.url,
      domain: row.domain,
      title: row.title,
      snippet: row.snippet,
      source: row.source,
      availability: row.availability,
      blockReason: row.block_reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  }

  storeFetchEvent(event: FetchEventInput): number {
    const createdAt = Date.now()
    const stmt = this.db.prepare(
      `
        INSERT INTO fetch_events (
          result_id, url, domain, decision, score, flags_json, reason,
          blocked_by, allowed_by, domain_action, trace_kind, search_request_id, search_query, search_rank,
          medium_threshold, block_threshold, bypassed, duration_ms, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )

    const result = stmt.run(
      event.resultId,
      event.url,
      event.domain,
      event.decision,
      event.score,
      JSON.stringify(event.flags),
      event.reason,
      event.blockedBy,
      event.allowedBy,
      event.domainAction,
      event.traceKind ?? "unknown",
      event.searchRequestId ?? null,
      event.searchQuery ?? null,
      event.searchRank ?? null,
      event.mediumThreshold,
      event.blockThreshold,
      event.bypassed ? 1 : 0,
      event.durationMs,
      createdAt,
    )

    return Number(result.lastInsertRowid)
  }

  storeFlaggedPayload(payload: FlaggedPayloadInput): void {
    const stmt = this.db.prepare(
      `
        INSERT INTO flagged_payloads (
          fetch_event_id, result_id, url, domain, score, flags_json, evidence_json, reason, content, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )

    stmt.run(
      payload.fetchEventId ?? null,
      payload.resultId,
      payload.url,
      payload.domain,
      payload.score,
      JSON.stringify(payload.flags),
      JSON.stringify(payload.evidence ?? []),
      payload.reason,
      payload.content,
      Date.now(),
    )
  }

  storeSearchBlockEvent(event: SearchBlockEventInput): void {
    const stmt = this.db.prepare(
      `
        INSERT INTO search_block_events (
          request_id, result_id, query, url, domain, title, source, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )

    stmt.run(
      event.requestId,
      event.resultId,
      event.query,
      event.url,
      event.domain,
      event.title,
      event.source,
      event.reason,
      Date.now(),
    )
  }

  addRuntimeAllowlistDomain(domain: string, note?: string): RuntimeAllowlistDomain {
    const normalized = normalizeDomain(domain).replace(/^\*\./, "")
    if (!isValidDomainEntry(normalized)) {
      throw new Error("Invalid domain")
    }

    const addedAt = Date.now()
    const trimmedNote = note?.trim() ? note.trim() : null
    const stmt = this.db.prepare(
      `
        INSERT INTO runtime_allowlist_domains (domain, note, added_at)
        VALUES (?, ?, ?)
        ON CONFLICT(domain) DO UPDATE SET
          note = excluded.note,
          added_at = excluded.added_at
      `,
    )

    stmt.run(normalized, trimmedNote, addedAt)
    return { domain: normalized, note: trimmedNote, addedAt }
  }

  listRuntimeAllowlistDomains(): RuntimeAllowlistDomain[] {
    const rows = this.db
      .prepare(
        `
          SELECT domain, note, added_at
          FROM runtime_allowlist_domains
          ORDER BY domain ASC
        `,
      )
      .all() as Array<{ domain: string; note: string | null; added_at: number }>

    return rows.map((row) => ({
      domain: row.domain,
      note: row.note,
      addedAt: row.added_at,
    }))
  }

  getEffectiveAllowlist(staticAllowlist: string[]): string[] {
    const combined = new Set<string>(staticAllowlist.map((domain) => normalizeDomain(domain)))
    for (const runtime of this.listRuntimeAllowlistDomains()) {
      combined.add(runtime.domain)
    }
    return [...combined]
  }

  addRuntimeBlocklistDomain(domain: string, note?: string): RuntimeBlocklistDomain {
    const normalized = normalizeDomain(domain).replace(/^\*\./, "")
    if (!isValidDomainEntry(normalized)) {
      throw new Error("Invalid domain")
    }

    const addedAt = Date.now()
    const trimmedNote = note?.trim() ? note.trim() : null
    const stmt = this.db.prepare(
      `
        INSERT INTO runtime_blocklist_domains (domain, note, added_at)
        VALUES (?, ?, ?)
        ON CONFLICT(domain) DO UPDATE SET
          note = excluded.note,
          added_at = excluded.added_at
      `,
    )

    stmt.run(normalized, trimmedNote, addedAt)
    return { domain: normalized, note: trimmedNote, addedAt }
  }

  listRuntimeBlocklistDomains(): RuntimeBlocklistDomain[] {
    const rows = this.db
      .prepare(
        `
          SELECT domain, note, added_at
          FROM runtime_blocklist_domains
          ORDER BY domain ASC
        `,
      )
      .all() as Array<{ domain: string; note: string | null; added_at: number }>

    return rows.map((row) => ({
      domain: row.domain,
      note: row.note,
      addedAt: row.added_at,
    }))
  }

  getEffectiveBlocklist(staticBlocklist: string[]): string[] {
    const combined = new Set<string>(staticBlocklist.map((domain) => normalizeDomain(domain)))
    for (const runtime of this.listRuntimeBlocklistDomains()) {
      combined.add(runtime.domain)
    }
    return [...combined]
  }

  getDashboardEvents(query: DashboardEventsQuery): {
    total: number
    events: DashboardEventRecord[]
  } {
    const { cteSql, params } = this.buildDashboardFilteredDataset(query)
    const totalRow = this.db
      .prepare(
        `
          ${cteSql}
          SELECT COUNT(*) AS total
          FROM filtered_events
        `,
      )
      .get(...params) as { total: number } | undefined

    const rows = this.db
      .prepare(
        `
          ${cteSql}
          SELECT
            event_id,
            source,
            created_at,
            result_id,
            decision,
            domain,
            url,
            reason,
            blocked_by,
            allowed_by,
            flags_json,
            score,
            medium_threshold,
            block_threshold,
            bypassed,
            duration_ms,
            title,
            query,
            request_id,
            trace_kind,
            search_rank
          FROM filtered_events
          ORDER BY created_at DESC, event_id ASC
          LIMIT ? OFFSET ?
        `,
      )
      .all(...params, query.limit, query.offset) as DashboardEventRow[]

    return {
      total: totalRow?.total ?? 0,
      events: rows.map((row) => this.mapDashboardEventRow(row)),
    }
  }

  getDashboardOverview(query: Omit<DashboardEventsQuery, "offset" | "limit">): DashboardOverview {
    const { cteSql, params } = this.buildDashboardFilteredDataset(query)
    const row = this.db
      .prepare(
        `
          ${cteSql}
          SELECT
            COUNT(*) AS total_events,
            SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) AS blocked_events,
            SUM(CASE WHEN source = 'fetch' THEN 1 ELSE 0 END) AS source_fetch_events,
            SUM(CASE WHEN source = 'search' THEN 1 ELSE 0 END) AS source_search_events,
            COUNT(DISTINCT CASE WHEN decision = 'block' THEN domain END) AS unique_blocked_domains
          FROM filtered_events
        `,
      )
      .get(...params) as
      | {
          total_events: number
          blocked_events: number | null
          source_fetch_events: number | null
          source_search_events: number | null
          unique_blocked_domains: number | null
        }
      | undefined

    const totalEvents = row?.total_events ?? 0
    const blockedEvents = row?.blocked_events ?? 0

    const topBlockedByRow = this.db
      .prepare(
        `
          ${cteSql}
          SELECT blocked_by AS value
          FROM filtered_events
          WHERE decision = 'block' AND blocked_by IS NOT NULL AND TRIM(blocked_by) <> ''
          GROUP BY blocked_by
          ORDER BY COUNT(*) DESC, blocked_by ASC
          LIMIT 1
        `,
      )
      .get(...params) as { value: string } | undefined

    const topAllowedByRow = this.db
      .prepare(
        `
          ${cteSql}
          SELECT allowed_by AS value
          FROM filtered_events
          WHERE decision = 'allow' AND allowed_by IS NOT NULL AND TRIM(allowed_by) <> ''
          GROUP BY allowed_by
          ORDER BY COUNT(*) DESC, allowed_by ASC
          LIMIT 1
        `,
      )
      .get(...params) as { value: string } | undefined

    const bySource = {
      fetch: row?.source_fetch_events ?? 0,
      search: row?.source_search_events ?? 0,
    }

    return {
      totalEvents,
      blockedEvents,
      allowedEvents: totalEvents - blockedEvents,
      blockedRate: totalEvents > 0 ? blockedEvents / totalEvents : 0,
      uniqueBlockedDomains: row?.unique_blocked_domains ?? 0,
      bySource,
      topBlockedBy: topBlockedByRow?.value ?? null,
      topAllowedBy: topAllowedByRow?.value ?? null,
    }
  }

  getDashboardTimeseries(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    bucketMs: number,
  ): DashboardTimeseriesPoint[] {
    const { cteSql, params } = this.buildDashboardFilteredDataset(query)
    const safeBucketMs = Math.max(1, Math.floor(bucketMs))
    const rows = this.db
      .prepare(
        `
          ${cteSql}
          SELECT
            CAST(created_at / ? AS INTEGER) * ? AS bucket_start,
            COUNT(*) AS total,
            SUM(CASE WHEN decision = 'block' THEN 1 ELSE 0 END) AS blocked,
            SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) AS allowed,
            SUM(CASE WHEN source = 'fetch' THEN 1 ELSE 0 END) AS fetch,
            SUM(CASE WHEN source = 'search' THEN 1 ELSE 0 END) AS search
          FROM filtered_events
          GROUP BY bucket_start
          ORDER BY bucket_start ASC
        `,
      )
      .all(...params, safeBucketMs, safeBucketMs) as Array<{
      bucket_start: number
      total: number
      blocked: number | null
      allowed: number | null
      fetch: number | null
      search: number | null
    }>

    return rows.map((row) => ({
      bucketStart: row.bucket_start,
      total: row.total,
      blocked: row.blocked ?? 0,
      allowed: row.allowed ?? 0,
      fetch: row.fetch ?? 0,
      search: row.search ?? 0,
    }))
  }

  getDashboardTopDomains(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    return this.getDashboardTopItemsByColumn(query, "domain", limit)
  }

  getDashboardTopReasons(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    return this.getDashboardTopItemsByColumn(query, "reason", limit)
  }

  getDashboardTopFlags(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    const { cteSql, params } = this.buildDashboardFilteredDataset(query)
    const rows = this.db
      .prepare(
        `
          ${cteSql}
          SELECT
            CAST(flags.value AS TEXT) AS value,
            COUNT(*) AS count
          FROM filtered_events
          JOIN json_each(filtered_events.flags_json) AS flags
          WHERE TRIM(CAST(flags.value AS TEXT)) <> ''
          GROUP BY CAST(flags.value AS TEXT)
          ORDER BY count DESC, value ASC
          LIMIT ?
        `,
      )
      .all(...params, limit) as Array<{ value: string; count: number }>

    return rows.map((row) => ({
      value: row.value,
      count: row.count,
    }))
  }

  getDashboardTopAllowedBy(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    const { cteSql, params } = this.buildDashboardFilteredDataset(query)
    const rows = this.db
      .prepare(
        `
          ${cteSql}
          SELECT
            allowed_by AS value,
            COUNT(*) AS count
          FROM filtered_events
          WHERE decision = 'allow' AND allowed_by IS NOT NULL AND TRIM(allowed_by) <> ''
          GROUP BY allowed_by
          ORDER BY count DESC, value ASC
          LIMIT ?
        `,
      )
      .all(...params, limit) as Array<{ value: string; count: number }>

    return rows.map((row) => ({
      value: row.value,
      count: row.count,
    }))
  }

  getDashboardEventDetail(eventId: string): DashboardEventDetail | null {
    const [source, rawId] = eventId.split(":", 2)
    const id = Number.parseInt(rawId ?? "", 10)
    if (Number.isNaN(id)) {
      return null
    }

    if (source === "fetch") {
      const fetchRow = this.db
        .prepare(
          `
            SELECT
              fe.id,
              fe.result_id,
              fe.domain,
              fe.url,
              fe.decision,
              fe.score,
              fe.flags_json,
              fe.reason,
              fe.blocked_by,
              fe.allowed_by,
              fe.trace_kind,
              fe.search_request_id,
              fe.search_query,
              fe.search_rank,
              fe.medium_threshold,
              fe.block_threshold,
              fe.bypassed,
              fe.duration_ms,
              fe.created_at,
              src.request_id AS fallback_request_id,
              src.query AS fallback_query,
              src.search_rank AS fallback_rank
            FROM fetch_events fe
            LEFT JOIN search_results_cache src ON src.result_id = fe.result_id
            WHERE fe.id = ?
          `,
        )
        .get(id) as
        | {
            id: number
            result_id: string
            domain: string
            url: string
            decision: "allow" | "block"
            score: number
            flags_json: string
            reason: string | null
            blocked_by: string | null
            allowed_by: string | null
            trace_kind: string | null
            search_request_id: string | null
            search_query: string | null
            search_rank: number | null
            medium_threshold: number | null
            block_threshold: number | null
            bypassed: number
            duration_ms: number
            created_at: number
            fallback_request_id: string | null
            fallback_query: string | null
            fallback_rank: number | null
          }
        | undefined

      if (!fetchRow) {
        return null
      }

      const payload = this.db
        .prepare(
          `
            SELECT content
                 , evidence_json
            FROM flagged_payloads
            WHERE fetch_event_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `,
        )
        .get(fetchRow.id) as { content: string; evidence_json: string | null } | undefined

      const fallbackPayload = payload
        ? null
        : (this.db
            .prepare(
              `
                SELECT content
                     , evidence_json
                FROM flagged_payloads
                WHERE result_id = ?
                ORDER BY created_at DESC
                LIMIT 1
              `,
            )
            .get(fetchRow.result_id) as
            | { content: string; evidence_json: string | null }
            | undefined)

      return {
        eventId: `fetch:${fetchRow.id}`,
        source: "fetch",
        createdAt: fetchRow.created_at,
        resultId: fetchRow.result_id,
        decision: fetchRow.decision,
        domain: fetchRow.domain,
        url: fetchRow.url || null,
        reason: fetchRow.reason,
        blockedBy: fetchRow.blocked_by,
        allowedBy: fetchRow.allowed_by,
        flags: parseFlags(fetchRow.flags_json),
        score: fetchRow.score,
        mediumThreshold: fetchRow.medium_threshold,
        blockThreshold: fetchRow.block_threshold,
        bypassed: fetchRow.bypassed === 1,
        durationMs: fetchRow.duration_ms,
        title: null,
        query: fetchRow.search_query ?? fetchRow.fallback_query ?? null,
        requestId: fetchRow.search_request_id ?? fetchRow.fallback_request_id ?? null,
        traceKind: normalizeTraceKind(fetchRow.trace_kind, fetchRow.fallback_request_id),
        searchRank: fetchRow.search_rank ?? fetchRow.fallback_rank ?? null,
        payloadContent: payload?.content ?? fallbackPayload?.content ?? null,
        evidence: parseEvidence(payload?.evidence_json ?? fallbackPayload?.evidence_json ?? null),
      }
    }

    if (source === "search") {
      const searchRow = this.db
        .prepare(
          `
            SELECT
              id,
              request_id,
              result_id,
              query,
              url,
              domain,
              title,
              reason,
              created_at
            FROM search_block_events
            WHERE id = ?
          `,
        )
        .get(id) as
        | {
            id: number
            request_id: string
            result_id: string
            query: string
            url: string
            domain: string
            title: string
            reason: string
            created_at: number
          }
        | undefined

      if (!searchRow) {
        return null
      }

      return {
        eventId: `search:${searchRow.id}`,
        source: "search",
        createdAt: searchRow.created_at,
        resultId: searchRow.result_id,
        decision: "block",
        domain: searchRow.domain,
        url: searchRow.url,
        reason: searchRow.reason,
        blockedBy: "domain-policy",
        allowedBy: null,
        flags: ["domain_blocklist"],
        score: 0,
        mediumThreshold: null,
        blockThreshold: null,
        bypassed: false,
        durationMs: null,
        title: searchRow.title,
        query: searchRow.query,
        requestId: searchRow.request_id,
        traceKind: "unknown",
        searchRank: null,
        payloadContent: null,
        evidence: [],
      }
    }

    return null
  }

  purgeExpiredData(retentionDays: number): void {
    const now = Date.now()
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000

    this.db.prepare(`DELETE FROM search_results_cache WHERE expires_at <= ?`).run(now)
    this.db.prepare(`DELETE FROM flagged_payloads WHERE created_at <= ?`).run(now - retentionMs)
    this.db.prepare(`DELETE FROM fetch_events WHERE created_at <= ?`).run(now - retentionMs)
    this.db.prepare(`DELETE FROM search_block_events WHERE created_at <= ?`).run(now - retentionMs)
    this.db.prepare(`DELETE FROM search_requests WHERE created_at <= ?`).run(now - retentionMs)
  }

  isHealthy(): boolean {
    try {
      this.db.query("SELECT 1").get()
      return true
    } catch {
      return false
    }
  }

  private ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
    if (this.hasColumn(tableName, columnName)) {
      return
    }

    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`)
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
    return rows.some((row) => row.name === columnName)
  }

  private getDashboardTopItemsByColumn(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    column: "domain" | "reason",
    limit: number,
  ): DashboardTopItem[] {
    const { cteSql, params } = this.buildDashboardFilteredDataset(query)
    const rows = this.db
      .prepare(
        `
          ${cteSql}
          SELECT
            ${column} AS value,
            COUNT(*) AS count
          FROM filtered_events
          WHERE ${column} IS NOT NULL AND TRIM(${column}) <> ''
          GROUP BY ${column}
          ORDER BY count DESC, value ASC
          LIMIT ?
        `,
      )
      .all(...params, limit) as Array<{ value: string; count: number }>

    return rows.map((row) => ({
      value: row.value,
      count: row.count,
    }))
  }

  private mapDashboardEventRow(row: DashboardEventRow): DashboardEventRecord {
    return {
      eventId: row.event_id,
      source: row.source,
      createdAt: row.created_at,
      resultId: row.result_id,
      decision: row.decision,
      domain: row.domain,
      url: row.url,
      reason: row.reason,
      blockedBy: row.blocked_by,
      allowedBy: row.allowed_by,
      flags: parseFlags(row.flags_json),
      score: row.score,
      mediumThreshold: row.medium_threshold,
      blockThreshold: row.block_threshold,
      bypassed: row.bypassed === 1,
      durationMs: row.duration_ms,
      title: row.title,
      query: row.query,
      requestId: row.request_id,
      traceKind: row.trace_kind,
      searchRank: row.search_rank,
    }
  }

  private buildDashboardFilteredDataset(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
  ): { cteSql: string; params: Array<string | number> } {
    const sourceSelects: string[] = []
    const params: Array<string | number> = []

    if (query.source !== "search") {
      sourceSelects.push(`
        SELECT
          'fetch:' || fe.id AS event_id,
          'fetch' AS source,
          fe.created_at,
          fe.result_id,
          fe.decision,
          fe.domain,
          NULLIF(fe.url, '') AS url,
          fe.reason,
          fe.blocked_by,
          fe.allowed_by,
          fe.flags_json,
          fe.score,
          fe.medium_threshold,
          fe.block_threshold,
          fe.bypassed,
          fe.duration_ms,
          NULL AS title,
          COALESCE(fe.search_query, src.query) AS query,
          COALESCE(fe.search_request_id, src.request_id) AS request_id,
          CASE
            WHEN fe.trace_kind = 'search-result-fetch' THEN 'search-result-fetch'
            WHEN fe.trace_kind = 'direct-web-fetch' THEN 'direct-web-fetch'
            WHEN src.request_id IS NOT NULL THEN 'search-result-fetch'
            ELSE 'unknown'
          END AS trace_kind,
          COALESCE(fe.search_rank, src.search_rank) AS search_rank
        FROM fetch_events fe
        LEFT JOIN search_results_cache src ON src.result_id = fe.result_id
        WHERE fe.created_at >= ? AND fe.created_at <= ?
      `)
      params.push(query.from, query.to)
    }

    if (query.source !== "fetch") {
      sourceSelects.push(`
        SELECT
          'search:' || sbe.id AS event_id,
          'search' AS source,
          sbe.created_at,
          sbe.result_id,
          'block' AS decision,
          sbe.domain,
          sbe.url,
          sbe.reason,
          'domain-policy' AS blocked_by,
          NULL AS allowed_by,
          '["domain_blocklist"]' AS flags_json,
          0 AS score,
          NULL AS medium_threshold,
          NULL AS block_threshold,
          0 AS bypassed,
          NULL AS duration_ms,
          sbe.title,
          sbe.query,
          sbe.request_id,
          'unknown' AS trace_kind,
          NULL AS search_rank
        FROM search_block_events sbe
        WHERE sbe.created_at >= ? AND sbe.created_at <= ?
      `)
      params.push(query.from, query.to)
    }

    const whereClauses: string[] = []

    if (query.decision !== "all") {
      whereClauses.push(`decision = ?`)
      params.push(query.decision)
    }

    if (query.domainContains) {
      whereClauses.push(`LOWER(domain) LIKE ?`)
      params.push(`%${query.domainContains.toLowerCase()}%`)
    }

    if (query.reasonContains) {
      whereClauses.push(`LOWER(COALESCE(reason, '')) LIKE ?`)
      params.push(`%${query.reasonContains.toLowerCase()}%`)
    }

    if (query.flagContains) {
      whereClauses.push(`
        EXISTS (
          SELECT 1
          FROM json_each(flags_json) AS flags
          WHERE LOWER(CAST(flags.value AS TEXT)) LIKE ?
        )
      `)
      params.push(`%${query.flagContains.toLowerCase()}%`)
    }

    if (query.allowedByContains) {
      whereClauses.push(`LOWER(COALESCE(allowed_by, '')) LIKE ?`)
      params.push(`%${query.allowedByContains.toLowerCase()}%`)
    }

    if (query.queryContains) {
      whereClauses.push(`LOWER(COALESCE(query, '')) LIKE ?`)
      params.push(`%${query.queryContains.toLowerCase()}%`)
    }

    if (query.traceKind) {
      whereClauses.push(`trace_kind = ?`)
      params.push(query.traceKind)
    }

    if (query.minSearchRank !== undefined) {
      whereClauses.push(`search_rank IS NOT NULL AND search_rank >= ?`)
      params.push(query.minSearchRank)
    }

    if (query.maxSearchRank !== undefined) {
      whereClauses.push(`search_rank IS NOT NULL AND search_rank <= ?`)
      params.push(query.maxSearchRank)
    }

    const filteredWhere =
      whereClauses.length > 0 ? `WHERE ${whereClauses.map((clause) => `(${clause.trim()})`).join(" AND ")}` : ""

    const cteSql = `
      WITH events AS (
        ${sourceSelects.join("\nUNION ALL\n")}
      ),
      filtered_events AS (
        SELECT *
        FROM events
        ${filteredWhere}
      )
    `

    return { cteSql, params }
  }
}

function parseFlags(input: string): string[] {
  try {
    const parsed = JSON.parse(input) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is string => typeof item === "string")
  } catch {
    return []
  }
}

function parseEvidence(input: string | null): EvidenceMatch[] {
  if (!input) {
    return []
  }

  try {
    const parsed = JSON.parse(input) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item, index) => {
        const start = typeof item.start === "number" ? item.start : null
        const end = typeof item.end === "number" ? item.end : null
        return {
          id: typeof item.id === "string" ? item.id : `evidence-${index}`,
          flag: typeof item.flag === "string" ? item.flag : "unknown",
          detector: toDetector(item.detector),
          basis: item.basis === "raw" || item.basis === "normalized" ? item.basis : "normalized",
          start,
          end,
          matchedText: typeof item.matchedText === "string" ? item.matchedText : "",
          excerpt: typeof item.excerpt === "string" ? item.excerpt : "",
          weight: typeof item.weight === "number" ? item.weight : 0,
          notes: typeof item.notes === "string" ? item.notes : undefined,
        } satisfies EvidenceMatch
      })
  } catch {
    return []
  }
}

function toDetector(value: unknown): EvidenceMatch["detector"] {
  if (
    value === "rule" ||
    value === "encoding" ||
    value === "typoglycemia" ||
    value === "normalization"
  ) {
    return value
  }

  return "rule"
}

function normalizeTraceKind(
  raw: string | null,
  fallbackRequestId: string | null,
): "search-result-fetch" | "direct-web-fetch" | "unknown" {
  if (raw === "search-result-fetch" || raw === "direct-web-fetch") {
    return raw
  }

  if (fallbackRequestId) {
    return "search-result-fetch"
  }

  return "unknown"
}

function isValidDomainEntry(domain: string): boolean {
  if (!domain || domain.length > 255) {
    return false
  }

  if (!/^[a-z0-9.-]+$/.test(domain)) {
    return false
  }

  if (domain.startsWith(".") || domain.endsWith(".")) {
    return false
  }

  const labels = domain.split(".")
  if (labels.length === 0) {
    return false
  }

  for (const label of labels) {
    if (!label || label.length > 63) {
      return false
    }

    if (label.startsWith("-") || label.endsWith("-")) {
      return false
    }
  }

  return true
}
