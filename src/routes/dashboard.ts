import { z } from "zod";
import { errorResponse, jsonResponse, readJsonBody } from "../lib/http";
import type { ServerContext } from "../server-context";

const AllowlistRequestSchema = z.object({
  domain: z.string().min(1).max(255),
  note: z.string().max(2000).optional(),
});

interface DashboardFilters {
  from: number;
  to: number;
  source: "fetch" | "search" | "all";
  decision: "allow" | "block" | "all";
  domainContains?: string;
  reasonContains?: string;
  flagContains?: string;
  allowedByContains?: string;
  queryContains?: string;
  traceKind?: "search-result-fetch" | "direct-web-fetch" | "unknown";
  minSearchRank?: number;
  maxSearchRank?: number;
}

export async function handleDashboardAllowlistGet(_request: Request, ctx: ServerContext): Promise<Response> {
  const runtimeAllowlist = ctx.db.listRuntimeAllowlistDomains();
  const envAllowlist = [...ctx.config.allowlistDomains];
  const effectiveAllowlist = ctx.db.getEffectiveAllowlist(ctx.config.allowlistDomains);

  return jsonResponse({
    envAllowlist,
    runtimeAllowlist,
    effectiveAllowlist,
    blocklistPrecedence: true,
  });
}

export async function handleDashboardAllowlistPost(request: Request, ctx: ServerContext): Promise<Response> {
  const payload = await readJsonBody(request);
  const parsed = AllowlistRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(400, "Invalid allowlist payload", parsed.error.flatten());
  }

  let entry;
  try {
    entry = ctx.db.addRuntimeAllowlistDomain(parsed.data.domain, parsed.data.note);
  } catch (error) {
    return errorResponse(400, "Invalid allowlist domain", {
      domain: parsed.data.domain,
      message: error instanceof Error ? error.message : "Invalid domain",
    });
  }

  const effectiveAllowlist = ctx.db.getEffectiveAllowlist(ctx.config.allowlistDomains);

  return jsonResponse({
    entry,
    effectiveAllowlist,
    blocklistPrecedence: true,
  });
}

export function handleDashboardOverview(request: Request, ctx: ServerContext): Response {
  const filters = parseFilters(request);
  const overview = ctx.db.getDashboardOverview({
    ...filters,
  });

  return jsonResponse({
    filters,
    overview,
  });
}

export function handleDashboardEvents(request: Request, ctx: ServerContext): Response {
  const url = new URL(request.url);
  const filters = parseFilters(request);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 500);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 1_000_000);
  const result = ctx.db.getDashboardEvents({
    ...filters,
    limit,
    offset,
  });

  return jsonResponse({
    filters,
    pagination: {
      limit,
      offset,
      total: result.total,
      hasMore: offset + limit < result.total,
    },
    events: result.events,
  });
}

export function handleDashboardTraces(request: Request, ctx: ServerContext): Response {
  return handleDashboardEvents(request, ctx);
}

export function handleDashboardEventDetail(request: Request, ctx: ServerContext): Response {
  const { pathname } = new URL(request.url);
  const eventId = decodeURIComponent(pathname.slice("/v1/dashboard/events/".length)).trim();
  if (!eventId) {
    return errorResponse(400, "Missing event id");
  }

  const detail = ctx.db.getDashboardEventDetail(eventId);
  if (!detail) {
    return errorResponse(404, "Dashboard event not found");
  }

  return jsonResponse({
    event: detail,
  });
}

export function handleDashboardTimeseries(request: Request, ctx: ServerContext): Response {
  const url = new URL(request.url);
  const filters = parseFilters(request);
  const bucketMinutes = clampInt(url.searchParams.get("bucket_minutes"), 60, 5, 1_440);
  const points = ctx.db.getDashboardTimeseries(filters, bucketMinutes * 60 * 1000);

  return jsonResponse({
    filters,
    bucketMinutes,
    points,
  });
}

export function handleDashboardTopDomains(request: Request, ctx: ServerContext): Response {
  const url = new URL(request.url);
  const filters = parseFilters(request);
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
  const items = ctx.db.getDashboardTopDomains(filters, limit);
  return jsonResponse({ filters, items });
}

export function handleDashboardTopFlags(request: Request, ctx: ServerContext): Response {
  const url = new URL(request.url);
  const filters = parseFilters(request);
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
  const items = ctx.db.getDashboardTopFlags(filters, limit);
  return jsonResponse({ filters, items });
}

export function handleDashboardTopReasons(request: Request, ctx: ServerContext): Response {
  const url = new URL(request.url);
  const filters = parseFilters(request);
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
  const items = ctx.db.getDashboardTopReasons(filters, limit);
  return jsonResponse({ filters, items });
}

export function handleDashboardTopAllowedBy(request: Request, ctx: ServerContext): Response {
  const url = new URL(request.url);
  const filters = parseFilters(request);
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, 100);
  const items = ctx.db.getDashboardTopAllowedBy(filters, limit);
  return jsonResponse({ filters, items });
}

function parseFilters(request: Request): DashboardFilters {
  const url = new URL(request.url);
  const now = Date.now();
  const defaultFrom = now - 24 * 60 * 60 * 1000;
  const from = clampInt(url.searchParams.get("from"), defaultFrom, 0, Number.MAX_SAFE_INTEGER);
  const to = clampInt(url.searchParams.get("to"), now, from, Number.MAX_SAFE_INTEGER);

  const sourceRaw = url.searchParams.get("source");
  const decisionRaw = url.searchParams.get("decision");

  const source = sourceRaw === "fetch" || sourceRaw === "search" ? sourceRaw : "fetch";
  const decision = decisionRaw === "allow" || decisionRaw === "block" ? decisionRaw : "all";

  const domainContains = cleanFilterValue(url.searchParams.get("domain"));
  const reasonContains = cleanFilterValue(url.searchParams.get("reason"));
  const flagContains = cleanFilterValue(url.searchParams.get("flag"));
  const allowedByContains = cleanFilterValue(url.searchParams.get("allowed_by"));
  const queryContains = cleanFilterValue(url.searchParams.get("query"));

  const traceKindRaw = cleanFilterValue(url.searchParams.get("trace_kind"));
  const traceKind = traceKindRaw === "search-result-fetch" || traceKindRaw === "direct-web-fetch" || traceKindRaw === "unknown"
    ? traceKindRaw
    : undefined;

  const minSearchRank = cleanPositiveInt(url.searchParams.get("rank_min"));
  const maxSearchRank = cleanPositiveInt(url.searchParams.get("rank_max"));

  return {
    from,
    to,
    source,
    decision,
    domainContains,
    reasonContains,
    flagContains,
    allowedByContains,
    queryContains,
    traceKind,
    minSearchRank,
    maxSearchRank,
  };
}

function cleanFilterValue(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return min;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

function cleanPositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return undefined;
  }
  return parsed;
}
