#!/usr/bin/env bun
import { Database } from "bun:sqlite"
import { loadConfig } from "../src/config"
import { AppDb } from "../src/db"
import type { EvidenceMatch } from "../src/types.ts"

interface SeedOptions {
  dbPath: string
  reset: boolean
  fetchEvents: number
  searchBlockEvents: number
  seed: number
}

function printUsage(): void {
  console.log(`Usage: bun run db:seed [options]

Options:
  --db <path>             SQLite database path (default: CLAWRUBBER_DB_PATH or ./data/claw-rubber.db)
  --reset                 Clear existing dashboard tables before seeding
  --fetch-events <n>      Number of fetch events to generate (default: 140)
  --search-blocks <n>     Number of search block events to generate (default: 24)
  --seed <n>              RNG seed for deterministic data (default: 42)
  --help                  Show this message
`)
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function parseArgs(argv: string[]): SeedOptions {
  const config = loadConfig()
  const options: SeedOptions = {
    dbPath: config.dbPath,
    reset: false,
    fetchEvents: 140,
    searchBlockEvents: 24,
    seed: 42,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    }

    if (arg === "--reset") {
      options.reset = true
      continue
    }

    if (arg === "--db") {
      const next = argv[index + 1]
      if (!next) {
        throw new Error("--db requires a value")
      }
      options.dbPath = next
      index += 1
      continue
    }

    if (arg === "--fetch-events") {
      const next = argv[index + 1]
      if (!next) {
        throw new Error("--fetch-events requires a value")
      }
      options.fetchEvents = parsePositiveInteger(next, "--fetch-events")
      index += 1
      continue
    }

    if (arg === "--search-blocks") {
      const next = argv[index + 1]
      if (!next) {
        throw new Error("--search-blocks requires a value")
      }
      options.searchBlockEvents = parsePositiveInteger(next, "--search-blocks")
      index += 1
      continue
    }

    if (arg === "--seed") {
      const next = argv[index + 1]
      if (!next) {
        throw new Error("--seed requires a value")
      }
      options.seed = parsePositiveInteger(next, "--seed")
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!
}

function maybe(value: string, chance: number, rng: () => number): string | null {
  return rng() < chance ? value : null
}

function buildEvidence(flag: string, excerpt: string): EvidenceMatch[] {
  return [
    {
      id: `ev-${Math.random().toString(36).slice(2, 10)}`,
      flag,
      detector: flag.startsWith("typoglycemia") ? "typoglycemia" : "rule",
      basis: "normalized",
      start: null,
      end: null,
      matchedText: excerpt.slice(0, 70),
      excerpt,
      weight: 3,
    },
  ]
}

function jitteredTimestamp(
  start: number,
  spanMs: number,
  index: number,
  total: number,
  rng: () => number,
): number {
  const position = (index + 1) / (total + 1)
  const base = start + Math.floor(spanMs * position)
  const jitter = Math.floor((rng() - 0.5) * 22 * 60 * 1000)
  return base + jitter
}

function main(): void {
  const options = parseArgs(Bun.argv.slice(2))
  const runLabel = `seed-${Date.now()}`
  const rng = createRng(options.seed)

  // Initializes and migrates schema.
  new AppDb(options.dbPath)
  const db = new Database(options.dbPath, { create: true, strict: true })

  const now = Date.now()
  const windowMs = 23 * 60 * 60 * 1000
  const start = now - windowMs

  const domains = [
    "docs.bun.sh",
    "developer.mozilla.org",
    "github.com",
    "openai.com",
    "krebsonsecurity.com",
    "example.org",
    "archive.org",
    "news.ycombinator.com",
  ]

  const queries = [
    "bun sqlite best practices",
    "how to secure llm tool use",
    "incident response runbook template",
    "unicode confusable character reference",
    "prompt injection examples in the wild",
    "safe markdown rendering in browsers",
    "domain allowlist strategy",
  ]

  const blockFlags = [
    ["instruction_override", "role_hijack"],
    ["prompt_exfiltration", "secret_exfiltration"],
    ["tool_abuse", "urgent_manipulation"],
    ["unicode_invisible_or_bidi", "confusable_mixed_script"],
    ["encoding_obfuscation", "encoded_payload_candidate"],
    ["typoglycemia_high_risk_keyword", "typoglycemia_keyword:ignore"],
    ["jailbreak_marker", "instruction_override"],
  ]

  const blockedByValues = ["rule-threshold", "llm-judge", "fail-closed", "policy"]
  const blockReasons = [
    "Detected high-risk instruction override pattern.",
    "Potential prompt exfiltration sequence in fetched content.",
    "Encoded payload and decode context indicate abuse intent.",
    "Rule score exceeded block threshold due multi-signal evidence.",
  ]

  const allowReasons = [
    "No high-risk policy signals after normalization.",
    "Low risk text; score below medium threshold.",
    "Benign content with no jailbreak markers detected.",
  ]

  const insertSearchRequest = db.prepare(`
    INSERT INTO search_requests (request_id, query, created_at, response_json)
    VALUES (?, ?, ?, ?)
  `)

  const insertSearchResult = db.prepare(`
    INSERT INTO search_results_cache (
      result_id, request_id, query, search_rank, url, domain, title, snippet, source,
      availability, block_reason, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertFetchEvent = db.prepare(`
    INSERT INTO fetch_events (
      result_id, url, domain, decision, score, flags_json, reason, blocked_by, allowed_by,
      domain_action, trace_kind, search_request_id, search_query, search_rank, medium_threshold,
      block_threshold, bypassed, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertFlaggedPayload = db.prepare(`
    INSERT INTO flagged_payloads (
      fetch_event_id, result_id, url, domain, score, flags_json, evidence_json, reason, content, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertSearchBlockEvent = db.prepare(`
    INSERT INTO search_block_events (
      request_id, result_id, query, url, domain, title, source, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const upsertRuntimeAllowlist = db.prepare(`
    INSERT INTO runtime_allowlist_domains (domain, note, added_at)
    VALUES (?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      note = excluded.note,
      added_at = excluded.added_at
  `)

  const totalEvents = options.fetchEvents + options.searchBlockEvents
  let flaggedPayloadCount = 0

  db.exec("BEGIN IMMEDIATE")
  try {
    if (options.reset) {
      db.exec("DELETE FROM flagged_payloads")
      db.exec("DELETE FROM fetch_events")
      db.exec("DELETE FROM search_block_events")
      db.exec("DELETE FROM search_results_cache")
      db.exec("DELETE FROM search_requests")
      db.exec("DELETE FROM runtime_allowlist_domains")
    }

    for (let i = 0; i < options.fetchEvents; i += 1) {
      const createdAt = jitteredTimestamp(start, windowMs, i, totalEvents, rng)
      const domain = pick(domains, rng)
      const query = pick(queries, rng)
      const traceKind = rng() < 0.72 ? "search-result-fetch" : "direct-web-fetch"
      const decision = rng() < 0.34 ? "block" : "allow"
      const rank = traceKind === "search-result-fetch" ? 1 + Math.floor(rng() * 20) : null
      const requestId = traceKind === "search-result-fetch" ? `${runLabel}-req-${i}` : null
      const resultId = `${runLabel}-result-${i}`
      const url = `https://${domain}/article/${i + 1}`

      if (requestId) {
        insertSearchRequest.run(
          requestId,
          query,
          createdAt,
          JSON.stringify({ seeded: true, query, requestId }),
        )
      }

      insertSearchResult.run(
        resultId,
        requestId ?? `${runLabel}-direct-${i}`,
        query,
        rank ?? 0,
        url,
        domain,
        `Seeded search result ${i + 1}`,
        `Seeded snippet ${i + 1} for ${query}`,
        "brave",
        decision === "block" ? "blocked" : "allowed",
        decision === "block" ? "policy" : null,
        createdAt,
        createdAt + 7 * 24 * 60 * 60 * 1000,
      )

      if (decision === "block") {
        const flags = pick(blockFlags, rng)
        const reason = pick(blockReasons, rng)
        const blockedBy = pick(blockedByValues, rng)
        const score = 11 + Math.floor(rng() * 11)
        const durationMs = 80 + Math.floor(rng() * 1400)

        const fetchInsert = insertFetchEvent.run(
          resultId,
          url,
          domain,
          "block",
          score,
          JSON.stringify(flags),
          reason,
          blockedBy,
          null,
          "block",
          traceKind,
          requestId,
          traceKind === "search-result-fetch" ? query : null,
          rank,
          8,
          14,
          0,
          durationMs,
          createdAt,
        )

        const fetchEventId = Number(fetchInsert.lastInsertRowid)
        if (rng() < 0.7) {
          flaggedPayloadCount += 1
          const primaryFlag = flags[0] ?? "policy_violation"
          const content = `System prompt override attempt found in page content for ${domain}.`
          insertFlaggedPayload.run(
            fetchEventId,
            resultId,
            url,
            domain,
            score,
            JSON.stringify(flags),
            JSON.stringify(buildEvidence(primaryFlag, content)),
            reason,
            `${content}\n\nExample payload fragment ${i + 1}.`,
            createdAt + 50,
          )
        }
      } else {
        const allowedBy =
          maybe("language-exception", 0.16, rng) ?? maybe("domain-allowlist-bypass", 0.2, rng)
        const bypassed = allowedBy === "domain-allowlist-bypass"
        const flags = rng() < 0.2 ? ["confusable_mixed_script"] : []
        const score = 1 + Math.floor(rng() * 9)
        const durationMs = 70 + Math.floor(rng() * 900)

        insertFetchEvent.run(
          resultId,
          url,
          domain,
          "allow",
          score,
          JSON.stringify(flags),
          pick(allowReasons, rng),
          null,
          allowedBy,
          bypassed ? "allow-bypass" : "inspect",
          traceKind,
          requestId,
          traceKind === "search-result-fetch" ? query : null,
          rank,
          8,
          14,
          bypassed ? 1 : 0,
          durationMs,
          createdAt,
        )
      }
    }

    for (let i = 0; i < options.searchBlockEvents; i += 1) {
      const index = options.fetchEvents + i
      const createdAt = jitteredTimestamp(start, windowMs, index, totalEvents, rng)
      const domain = pick(domains, rng)
      const query = pick(queries, rng)
      const requestId = `${runLabel}-search-block-req-${i}`
      const resultId = `${runLabel}-search-block-result-${i}`
      const url = `https://${domain}/blocked/${i + 1}`

      insertSearchRequest.run(
        requestId,
        query,
        createdAt,
        JSON.stringify({ seeded: true, query, requestId }),
      )

      insertSearchResult.run(
        resultId,
        requestId,
        query,
        1 + Math.floor(rng() * 10),
        url,
        domain,
        `Blocked result ${i + 1}`,
        `Blocked due to domain policy: ${domain}`,
        "brave",
        "blocked",
        "domain blocklist policy",
        createdAt,
        createdAt + 7 * 24 * 60 * 60 * 1000,
      )

      insertSearchBlockEvent.run(
        requestId,
        resultId,
        query,
        url,
        domain,
        `Blocked search result ${i + 1}`,
        "brave",
        "Domain matched configured blocklist.",
        createdAt,
      )
    }

    upsertRuntimeAllowlist.run("docs.bun.sh", "Trusted docs domain", now - 2 * 60 * 60 * 1000)
    upsertRuntimeAllowlist.run(
      "developer.mozilla.org",
      "Manual exception for reference docs",
      now - 90 * 60 * 1000,
    )
    upsertRuntimeAllowlist.run("archive.org", "Historic research source", now - 45 * 60 * 1000)

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  const fetchCount = db.query(`SELECT COUNT(*) AS count FROM fetch_events`).get() as {
    count: number
  }
  const searchBlockCount = db.query(`SELECT COUNT(*) AS count FROM search_block_events`).get() as {
    count: number
  }
  const payloadCount = db.query(`SELECT COUNT(*) AS count FROM flagged_payloads`).get() as {
    count: number
  }

  console.log(`Seed complete for ${options.dbPath}`)
  console.log(`- fetch_events: ${fetchCount.count}`)
  console.log(`- search_block_events: ${searchBlockCount.count}`)
  console.log(`- flagged_payloads: ${payloadCount.count} (${flaggedPayloadCount} created this run)`)
  console.log(`- runtime_allowlist_domains: 3 upserted`)
}

main()
