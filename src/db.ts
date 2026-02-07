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

  getDashboardEvents(query: DashboardEventsQuery): {
    total: number
    events: DashboardEventRecord[]
  } {
    const all = this.getDashboardEventsUnpaginated(query)
    const events = all.slice(query.offset, query.offset + query.limit)
    return { total: all.length, events }
  }

  getDashboardOverview(query: Omit<DashboardEventsQuery, "offset" | "limit">): DashboardOverview {
    const events = this.getDashboardEventsUnpaginated({
      ...query,
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
    })
    const blocked = events.filter((event) => event.decision === "block")
    const allowed = events.filter((event) => event.decision === "allow")
    const uniqueBlockedDomains = new Set(blocked.map((event) => event.domain)).size

    const blockedByCounts = new Map<string, number>()
    for (const event of blocked) {
      if (!event.blockedBy) {
        continue
      }
      blockedByCounts.set(event.blockedBy, (blockedByCounts.get(event.blockedBy) ?? 0) + 1)
    }

    let topBlockedBy: string | null = null
    let topBlockedByCount = -1
    for (const [key, value] of blockedByCounts.entries()) {
      if (value > topBlockedByCount) {
        topBlockedBy = key
        topBlockedByCount = value
      }
    }

    const allowedByCounts = new Map<string, number>()
    for (const event of allowed) {
      if (!event.allowedBy) {
        continue
      }
      allowedByCounts.set(event.allowedBy, (allowedByCounts.get(event.allowedBy) ?? 0) + 1)
    }

    let topAllowedBy: string | null = null
    let topAllowedByCount = -1
    for (const [key, value] of allowedByCounts.entries()) {
      if (value > topAllowedByCount) {
        topAllowedBy = key
        topAllowedByCount = value
      }
    }

    const bySource = {
      fetch: events.filter((event) => event.source === "fetch").length,
      search: events.filter((event) => event.source === "search").length,
    }

    return {
      totalEvents: events.length,
      blockedEvents: blocked.length,
      allowedEvents: events.length - blocked.length,
      blockedRate: events.length > 0 ? blocked.length / events.length : 0,
      uniqueBlockedDomains,
      bySource,
      topBlockedBy,
      topAllowedBy,
    }
  }

  getDashboardTimeseries(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    bucketMs: number,
  ): DashboardTimeseriesPoint[] {
    const events = this.getDashboardEventsUnpaginated({
      ...query,
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
    })
    const buckets = new Map<number, DashboardTimeseriesPoint>()

    for (const event of events) {
      const bucketStart = Math.floor(event.createdAt / bucketMs) * bucketMs
      if (!buckets.has(bucketStart)) {
        buckets.set(bucketStart, {
          bucketStart,
          total: 0,
          blocked: 0,
          allowed: 0,
          fetch: 0,
          search: 0,
        })
      }

      const point = buckets.get(bucketStart)!
      point.total += 1
      if (event.decision === "block") {
        point.blocked += 1
      } else {
        point.allowed += 1
      }

      if (event.source === "fetch") {
        point.fetch += 1
      } else {
        point.search += 1
      }
    }

    return [...buckets.values()].sort((a, b) => a.bucketStart - b.bucketStart)
  }

  getDashboardTopDomains(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    return this.getTopItems(
      this.getDashboardEventsUnpaginated({
        ...query,
        offset: 0,
        limit: Number.MAX_SAFE_INTEGER,
      }),
      (event) => event.domain,
      limit,
    )
  }

  getDashboardTopReasons(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    return this.getTopItems(
      this.getDashboardEventsUnpaginated({
        ...query,
        offset: 0,
        limit: Number.MAX_SAFE_INTEGER,
      }),
      (event) => event.reason,
      limit,
    )
  }

  getDashboardTopFlags(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    const events = this.getDashboardEventsUnpaginated({
      ...query,
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
    })
    const counter = new Map<string, number>()
    for (const event of events) {
      for (const flag of event.flags) {
        counter.set(flag, (counter.get(flag) ?? 0) + 1)
      }
    }

    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }))
  }

  getDashboardTopAllowedBy(
    query: Omit<DashboardEventsQuery, "offset" | "limit">,
    limit: number,
  ): DashboardTopItem[] {
    return this.getTopItems(
      this.getDashboardEventsUnpaginated({
        ...query,
        offset: 0,
        limit: Number.MAX_SAFE_INTEGER,
      }).filter((event) => event.decision === "allow"),
      (event) => event.allowedBy,
      limit,
    )
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

  private getDashboardEventsUnpaginated(query: DashboardEventsQuery): DashboardEventRecord[] {
    const fetchEvents =
      query.source === "search" ? [] : this.getFetchEventsInRange(query.from, query.to)
    const searchEvents =
      query.source === "fetch" ? [] : this.getSearchBlockEventsInRange(query.from, query.to)

    const combined = [...fetchEvents, ...searchEvents].filter((event) =>
      this.matchesDashboardFilters(event, query),
    )
    combined.sort((a, b) => b.createdAt - a.createdAt || a.eventId.localeCompare(b.eventId))
    return combined
  }

  private getFetchEventsInRange(from: number, to: number): DashboardEventRecord[] {
    const rows = this.db
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
          WHERE fe.created_at >= ? AND fe.created_at <= ?
        `,
      )
      .all(from, to) as Array<{
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
    }>

    return rows.map((row) => ({
      eventId: `fetch:${row.id}`,
      source: "fetch",
      createdAt: row.created_at,
      resultId: row.result_id,
      decision: row.decision,
      domain: row.domain,
      url: row.url || null,
      reason: row.reason,
      blockedBy: row.blocked_by,
      allowedBy: row.allowed_by,
      flags: parseFlags(row.flags_json),
      score: row.score,
      mediumThreshold: row.medium_threshold,
      blockThreshold: row.block_threshold,
      bypassed: row.bypassed === 1,
      durationMs: row.duration_ms,
      title: null,
      query: row.search_query ?? row.fallback_query ?? null,
      requestId: row.search_request_id ?? row.fallback_request_id ?? null,
      traceKind: normalizeTraceKind(row.trace_kind, row.fallback_request_id),
      searchRank: row.search_rank ?? row.fallback_rank ?? null,
    }))
  }

  private getSearchBlockEventsInRange(from: number, to: number): DashboardEventRecord[] {
    const rows = this.db
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
          WHERE created_at >= ? AND created_at <= ?
        `,
      )
      .all(from, to) as Array<{
      id: number
      request_id: string
      result_id: string
      query: string
      url: string
      domain: string
      title: string
      reason: string
      created_at: number
    }>

    return rows.map((row) => ({
      eventId: `search:${row.id}`,
      source: "search",
      createdAt: row.created_at,
      resultId: row.result_id,
      decision: "block",
      domain: row.domain,
      url: row.url,
      reason: row.reason,
      blockedBy: "domain-policy",
      allowedBy: null,
      flags: ["domain_blocklist"],
      score: 0,
      mediumThreshold: null,
      blockThreshold: null,
      bypassed: false,
      durationMs: null,
      title: row.title,
      query: row.query,
      requestId: row.request_id,
      traceKind: "unknown",
      searchRank: null,
    }))
  }

  private matchesDashboardFilters(
    event: DashboardEventRecord,
    query: DashboardEventsQuery,
  ): boolean {
    if (query.decision !== "all" && event.decision !== query.decision) {
      return false
    }

    if (query.domainContains) {
      const needle = query.domainContains.toLowerCase()
      if (!event.domain.toLowerCase().includes(needle)) {
        return false
      }
    }

    if (query.reasonContains) {
      const needle = query.reasonContains.toLowerCase()
      if (!(event.reason ?? "").toLowerCase().includes(needle)) {
        return false
      }
    }

    if (query.flagContains) {
      const needle = query.flagContains.toLowerCase()
      const hasFlag = event.flags.some((flag) => flag.toLowerCase().includes(needle))
      if (!hasFlag) {
        return false
      }
    }

    if (query.allowedByContains) {
      const needle = query.allowedByContains.toLowerCase()
      if (!(event.allowedBy ?? "").toLowerCase().includes(needle)) {
        return false
      }
    }

    if (query.queryContains) {
      const needle = query.queryContains.toLowerCase()
      if (!(event.query ?? "").toLowerCase().includes(needle)) {
        return false
      }
    }

    if (query.traceKind && event.traceKind !== query.traceKind) {
      return false
    }

    if (query.minSearchRank !== undefined) {
      if (event.searchRank === null || event.searchRank < query.minSearchRank) {
        return false
      }
    }

    if (query.maxSearchRank !== undefined) {
      if (event.searchRank === null || event.searchRank > query.maxSearchRank) {
        return false
      }
    }

    return true
  }

  private getTopItems(
    events: DashboardEventRecord[],
    picker: (event: DashboardEventRecord) => string | null,
    limit: number,
  ): DashboardTopItem[] {
    const counter = new Map<string, number>()
    for (const event of events) {
      const value = picker(event)?.trim()
      if (!value) {
        continue
      }
      counter.set(value, (counter.get(value) ?? 0) + 1)
    }

    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }))
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

  return /^[a-z0-9.-]+$/.test(domain)
}
