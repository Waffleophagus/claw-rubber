import {
  AlertTriangle,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Siren,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select } from "./components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";
import "./app.css";

interface DashboardEvent {
  eventId: string;
  source: "fetch" | "search";
  createdAt: number;
  resultId: string;
  decision: "allow" | "block";
  domain: string;
  url: string | null;
  reason: string | null;
  blockedBy: string | null;
  allowedBy: string | null;
  flags: string[];
  score: number;
  mediumThreshold: number | null;
  blockThreshold: number | null;
  bypassed: boolean;
  durationMs: number | null;
  title: string | null;
  query: string | null;
  requestId: string | null;
}

interface DashboardEventDetail extends DashboardEvent {
  payloadContent: string | null;
  evidence: EvidenceMatch[];
}

interface EvidenceMatch {
  id: string;
  flag: string;
  detector: "rule" | "encoding" | "typoglycemia" | "normalization";
  basis: "raw" | "normalized";
  start: number | null;
  end: number | null;
  matchedText: string;
  excerpt: string;
  weight: number;
  notes?: string;
}

interface OverviewPayload {
  totalEvents: number;
  blockedEvents: number;
  allowedEvents: number;
  blockedRate: number;
  uniqueBlockedDomains: number;
  bySource: {
    fetch: number;
    search: number;
  };
  topBlockedBy: string | null;
  topAllowedBy: string | null;
}

interface TimeseriesPoint {
  bucketStart: number;
  total: number;
  blocked: number;
  allowed: number;
  fetch: number;
  search: number;
}

interface TopItem {
  value: string;
  count: number;
}

interface FilterState {
  from: string;
  to: string;
  source: "fetch" | "search" | "all";
  decision: "allow" | "block" | "all";
  domain: string;
  reason: string;
  flag: string;
  allowedBy: string;
}

function App() {
  const defaultFilters = useMemo<FilterState>(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return {
      from: toDatetimeLocalValue(from),
      to: toDatetimeLocalValue(now),
      source: "fetch",
      decision: "block",
      domain: "",
      reason: "",
      flag: "",
      allowedBy: "",
    };
  }, []);

  const [draftFilters, setDraftFilters] = useState<FilterState>(defaultFilters);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [offset, setOffset] = useState(0);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [topDomains, setTopDomains] = useState<TopItem[]>([]);
  const [topFlags, setTopFlags] = useState<TopItem[]>([]);
  const [topReasons, setTopReasons] = useState<TopItem[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DashboardEventDetail | null>(null);
  const [selectedEventLoading, setSelectedEventLoading] = useState(false);
  const [allowlistingDomain, setAllowlistingDomain] = useState<string | null>(null);

  const limit = 30;

  const baseParams = useMemo(() => buildBaseParams(filters), [filters]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const paramsWithPagination = new URLSearchParams(baseParams);
      paramsWithPagination.set("limit", String(limit));
      paramsWithPagination.set("offset", String(offset));

      const [overviewData, eventsData, timeseriesData, topDomainsData, topFlagsData, topReasonsData] = await Promise.all([
        fetchJson<{ overview: OverviewPayload }>(`/v1/dashboard/overview?${baseParams.toString()}`),
        fetchJson<{ events: DashboardEvent[]; pagination: { total: number } }>(
          `/v1/dashboard/events?${paramsWithPagination.toString()}`,
        ),
        fetchJson<{ points: TimeseriesPoint[] }>(`/v1/dashboard/timeseries?${baseParams.toString()}`),
        fetchJson<{ items: TopItem[] }>(`/v1/dashboard/top-domains?${baseParams.toString()}&limit=8`),
        fetchJson<{ items: TopItem[] }>(`/v1/dashboard/top-flags?${baseParams.toString()}&limit=8`),
        fetchJson<{ items: TopItem[] }>(`/v1/dashboard/top-reasons?${baseParams.toString()}&limit=8`),
      ]);

      setOverview(overviewData.overview);
      setEvents(eventsData.events);
      setTotalEvents(eventsData.pagination.total);
      setTimeseries(timeseriesData.points);
      setTopDomains(topDomainsData.items);
      setTopFlags(topFlagsData.items);
      setTopReasons(topReasonsData.items);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load dashboard data";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [baseParams, offset]);

  const loadEventDetail = useCallback(async (eventId: string) => {
    setSelectedEventLoading(true);
    try {
      const data = await fetchJson<{ event: DashboardEventDetail }>(
        `/v1/dashboard/events/${encodeURIComponent(eventId)}`,
      );
      setSelectedEvent(data.event);
    } catch {
      setSelectedEvent(null);
    } finally {
      setSelectedEventLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadData();
    }, 30_000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (!selectedEventId) {
      setSelectedEvent(null);
      return;
    }
    void loadEventDetail(selectedEventId);
  }, [selectedEventId, loadEventDetail]);

  async function addDomainToAllowlist(domain: string): Promise<void> {
    if (!window.confirm(`Add "${domain}" to runtime allowlist now?`)) {
      return;
    }

    const note = window.prompt("Optional investigator note:");
    if (note === null) {
      return;
    }

    setAllowlistingDomain(domain);
    try {
      await fetchJson("/v1/dashboard/allowlist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain,
          note: note.trim() || undefined,
        }),
      });
      setFlash(`Allowlisted ${domain}. Blocklist rules still take precedence.`);
      void loadData();
      if (selectedEventId) {
        void loadEventDetail(selectedEventId);
      }
    } catch (allowError) {
      const message = allowError instanceof Error ? allowError.message : "Allowlist update failed";
      setFlash(message);
    } finally {
      setAllowlistingDomain(null);
    }
  }

  function applyFilters(): void {
    setFilters(draftFilters);
    setOffset(0);
  }

  function resetFilters(): void {
    setDraftFilters(defaultFilters);
    setFilters(defaultFilters);
    setOffset(0);
  }

  const blockedRatePercent = overview ? `${(overview.blockedRate * 100).toFixed(1)}%` : "--";
  const pageStart = totalEvents === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + limit, totalEvents);

  return (
    <div className="dashboard-shell">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-300/70 bg-[var(--surface)] p-5 shadow-sm md:flex-row md:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Claw-Rubber Investigator Dashboard</h1>
            <p className="mt-1 text-sm text-slate-600">
              Investigate blocked events, inspect rule signals, and quickly resolve false positives.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Badge variant="secondary">Auto-refresh 30s</Badge>
              <Badge variant="secondary">Default window: Last 24h</Badge>
              <Badge variant="secondary">Focus queue: Blocked fetch events</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void loadData()} disabled={isLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        {flash ? (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {flash}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-4 w-4 text-slate-600" />
              Investigation Filters
            </CardTitle>
            <CardDescription>Narrow the queue by time range, source, and rule indicators.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Input
              type="datetime-local"
              value={draftFilters.from}
              onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))}
            />
            <Input
              type="datetime-local"
              value={draftFilters.to}
              onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))}
            />
            <Select
              value={draftFilters.source}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  source: event.target.value as FilterState["source"],
                }))}
            >
              <option value="fetch">Fetch events</option>
              <option value="search">Search domain blocks</option>
              <option value="all">All sources</option>
            </Select>
            <Select
              value={draftFilters.decision}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  decision: event.target.value as FilterState["decision"],
                }))}
            >
              <option value="block">Blocked only</option>
              <option value="all">Allow + block</option>
              <option value="allow">Allowed only</option>
            </Select>
            <Input
              placeholder="Domain contains..."
              value={draftFilters.domain}
              onChange={(event) => setDraftFilters((current) => ({ ...current, domain: event.target.value }))}
            />
            <Input
              placeholder="Reason contains..."
              value={draftFilters.reason}
              onChange={(event) => setDraftFilters((current) => ({ ...current, reason: event.target.value }))}
            />
            <Input
              placeholder="Flag contains..."
              value={draftFilters.flag}
              onChange={(event) => setDraftFilters((current) => ({ ...current, flag: event.target.value }))}
            />
            <Input
              placeholder="Allowed-by contains..."
              value={draftFilters.allowedBy}
              onChange={(event) => setDraftFilters((current) => ({ ...current, allowedBy: event.target.value }))}
            />
            <div className="flex gap-2">
              <Button onClick={applyFilters}>Apply</Button>
              <Button variant="outline" onClick={resetFilters}>
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Blocked Events"
            value={overview?.blockedEvents ?? "--"}
            subtitle={`of ${overview?.totalEvents ?? "--"} total`}
            icon={<ShieldX className="h-4 w-4 text-rose-600" />}
          />
          <MetricCard
            title="Blocked Rate"
            value={blockedRatePercent}
            subtitle="current filtered window"
            icon={<Waves className="h-4 w-4 text-teal-700" />}
          />
          <MetricCard
            title="Unique Blocked Domains"
            value={overview?.uniqueBlockedDomains ?? "--"}
            subtitle="helps identify noisy sources"
            icon={<Siren className="h-4 w-4 text-orange-600" />}
          />
          <MetricCard
            title="Primary Block Cause"
            value={humanBlockedBy(overview?.topBlockedBy ?? null)}
            subtitle="most common block classification"
            icon={<AlertTriangle className="h-4 w-4 text-slate-700" />}
          />
          <MetricCard
            title="Primary Allow Exception"
            value={humanAllowedBy(overview?.topAllowedBy ?? null)}
            subtitle="most common allow-exception path"
            icon={<ShieldCheck className="h-4 w-4 text-emerald-700" />}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Blocked Trend Over Time</CardTitle>
              <CardDescription>Use this to spot sudden false-positive spikes after rule/config changes.</CardDescription>
            </CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeseries}>
                  <CartesianGrid stroke="#cbd5e1" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="bucketStart"
                    tickFormatter={(value) => formatBucket(Number(value))}
                    minTickGap={28}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip labelFormatter={(value) => formatDateTime(Number(value))} />
                  <Line type="monotone" dataKey="blocked" stroke="#be123c" strokeWidth={2.2} dot={false} />
                  <Line type="monotone" dataKey="total" stroke="#0f766e" strokeWidth={1.8} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Blocked Domains</CardTitle>
              <CardDescription>Domains most often flagged in the current filter window.</CardDescription>
            </CardHeader>
            <CardContent className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topDomains} layout="vertical" margin={{ left: 40, right: 8 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="value" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0f766e" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top Rule Flags</CardTitle>
              <CardDescription>Signals most associated with blocks.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topFlags.length === 0 ? (
                <p className="text-sm text-slate-500">No flag data in this filter window.</p>
              ) : (
                topFlags.map((item) => (
                  <div key={item.value} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="font-mono text-xs text-slate-700">{item.value}</span>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top Block Reasons</CardTitle>
              <CardDescription>Most common why-blocked explanations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {topReasons.length === 0 ? (
                <p className="text-sm text-slate-500">No reason data in this filter window.</p>
              ) : (
                topReasons.map((item) => (
                  <div key={item.value} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <span className="text-xs text-slate-700">{item.value}</span>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-700" />
              Investigator Queue
            </CardTitle>
            <CardDescription>
              Click an event to inspect full details, including block reason, score, thresholds, and payload.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead>Score / Level</TableHead>
                    <TableHead>Rule Signals</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-sm text-slate-500">
                        No events for this filter set.
                      </TableCell>
                    </TableRow>
                  ) : (
                    events.map((event) => (
                      <TableRow
                        key={event.eventId}
                        data-state={selectedEventId === event.eventId ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => setSelectedEventId(event.eventId)}
                      >
                        <TableCell className="whitespace-nowrap text-xs">{formatDateTime(event.createdAt)}</TableCell>
                        <TableCell className="max-w-[230px] truncate font-medium">{event.domain}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{event.source}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={event.decision === "block" ? "danger" : "success"}>
                            {humanEventCategory(event)}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatScore(event)}</TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-xs">{event.flags.join(", ") || "--"}</TableCell>
                        <TableCell className="max-w-[300px] truncate text-xs">{event.reason ?? "--"}</TableCell>
                        <TableCell className="text-right">
                          {event.decision === "block" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={allowlistingDomain === event.domain}
                              onClick={(clickEvent) => {
                                clickEvent.stopPropagation();
                                void addDomainToAllowlist(event.domain);
                              }}
                            >
                              {allowlistingDomain === event.domain ? "Adding..." : "Add to allowlist"}
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-500">Allowed</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
              <span>
                Showing {pageStart}-{pageEnd} of {totalEvents}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0 || isLoading}
                  onClick={() => setOffset((current) => Math.max(0, current - limit))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + limit >= totalEvents || isLoading}
                  onClick={() => setOffset((current) => current + limit)}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedEventId ? (
        <div className="drawer-overlay fixed inset-0 z-40 bg-slate-900/35" onClick={() => setSelectedEventId(null)}>
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-auto border-l border-slate-300 bg-[var(--surface-strong)] p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Event Detail</h2>
              <Button variant="secondary" size="sm" onClick={() => setSelectedEventId(null)}>
                Close
              </Button>
            </div>

            {selectedEventLoading ? (
              <p className="text-sm text-slate-500">Loading event details...</p>
            ) : selectedEvent ? (
              <div className="space-y-3">
                <DetailRow label="Event ID" value={selectedEvent.eventId} mono />
                <DetailRow label="Time" value={formatDateTime(selectedEvent.createdAt)} />
                <DetailRow label="Decision" value={selectedEvent.decision} />
                <DetailRow label="Classification" value={humanEventCategory(selectedEvent)} />
                <DetailRow label="Domain" value={selectedEvent.domain} mono />
                <DetailRow label="URL" value={selectedEvent.url ?? "--"} />
                <DetailRow label="Reason" value={selectedEvent.reason ?? "--"} />
                <DetailRow label="Score" value={String(selectedEvent.score)} />
                <DetailRow
                  label="Thresholds"
                  value={selectedEvent.blockThreshold
                    ? `${selectedEvent.mediumThreshold ?? "--"} / ${selectedEvent.blockThreshold}`
                    : "n/a"}
                />
                <DetailRow label="Rule flags" value={selectedEvent.flags.join(", ") || "--"} mono />
                {selectedEvent.evidence.length > 0 ? (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900">Why It Was Flagged</h3>
                    {selectedEvent.evidence.map((item) => (
                      <div key={item.id} className="rounded-lg border border-amber-300/80 bg-amber-50 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="warning">{item.flag}</Badge>
                          <Badge variant="secondary">{item.detector}</Badge>
                          <Badge variant="secondary">{item.basis}</Badge>
                          <span className="text-xs text-slate-600">weight {item.weight}</span>
                        </div>
                        <p className="mt-2 font-mono text-xs text-slate-800">{item.excerpt || item.matchedText || "--"}</p>
                        {item.notes ? <p className="mt-1 text-xs text-slate-600">{item.notes}</p> : null}
                        {item.basis === "normalized" ? (
                          <p className="mt-1 text-xs text-slate-500">
                            Matched in normalized text; raw payload span may not be exact.
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {selectedEvent.decision === "block" ? (
                  <div className="pt-2">
                    <Button
                      variant="default"
                      disabled={allowlistingDomain === selectedEvent.domain}
                      onClick={() => void addDomainToAllowlist(selectedEvent.domain)}
                    >
                      {allowlistingDomain === selectedEvent.domain ? "Adding..." : "Add Domain to Allowlist"}
                    </Button>
                  </div>
                ) : null}
                {selectedEvent.payloadContent ? (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-slate-900">Stored Payload Content</h3>
                    <pre className="code-block">
                      {renderHighlightedPayload(selectedEvent.payloadContent, selectedEvent.evidence)}
                    </pre>
                  </div>
                ) : (
                  <p className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    No stored payload content for this event.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Event details unavailable.</p>
            )}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription className="flex items-center justify-between text-xs uppercase tracking-wider">
          <span>{title}</span>
          {icon}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="metric-value">{value}</div>
        <p className="mt-1 text-xs text-slate-600">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-sm text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatBucket(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseDatetimeLocal(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function buildBaseParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", String(parseDatetimeLocal(filters.from)));
  params.set("to", String(parseDatetimeLocal(filters.to)));
  params.set("source", filters.source);
  params.set("decision", filters.decision);
  if (filters.domain.trim()) {
    params.set("domain", filters.domain.trim());
  }
  if (filters.reason.trim()) {
    params.set("reason", filters.reason.trim());
  }
  if (filters.flag.trim()) {
    params.set("flag", filters.flag.trim());
  }
  if (filters.allowedBy.trim()) {
    params.set("allowed_by", filters.allowedBy.trim());
  }
  return params;
}

function formatScore(event: DashboardEvent): string {
  if (event.blockThreshold == null) {
    return event.score === 0 ? "domain-policy" : String(event.score);
  }
  return `${event.score} / ${event.blockThreshold}`;
}

function humanBlockedBy(value: string | null): string {
  switch (value) {
    case "domain-policy":
      return "Domain policy";
    case "rule-threshold":
      return "Rule threshold";
    case "llm-judge":
      return "LLM judge";
    case "fail-closed":
      return "Fail closed";
    case "policy":
      return "Policy";
    default:
      return "n/a";
  }
}

function humanAllowedBy(value: string | null): string {
  switch (value) {
    case "domain-allowlist-bypass":
      return "Domain allowlist bypass";
    case "language-exception":
      return "Language exception";
    default:
      return "n/a";
  }
}

function humanEventCategory(event: Pick<DashboardEvent, "decision" | "blockedBy" | "allowedBy">): string {
  if (event.decision === "block") {
    return humanBlockedBy(event.blockedBy);
  }

  return humanAllowedBy(event.allowedBy);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const message = extractErrorMessage(payload) ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as { error?: { message?: unknown } };
  if (typeof record.error?.message === "string") {
    return record.error.message;
  }

  return null;
}

function renderHighlightedPayload(payload: string, evidence: EvidenceMatch[]): ReactNode {
  const rawMatches = evidence
    .filter((item) => item.basis === "raw" && item.start !== null && item.end !== null)
    .map((item) => ({
      start: item.start as number,
      end: item.end as number,
      flag: item.flag,
    }))
    .filter((item) => item.start >= 0 && item.end > item.start && item.end <= payload.length)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (rawMatches.length === 0) {
    return payload;
  }

  const merged: Array<{ start: number; end: number; flags: Set<string> }> = [];
  for (const match of rawMatches) {
    const last = merged[merged.length - 1];
    if (!last || match.start > last.end) {
      merged.push({
        start: match.start,
        end: match.end,
        flags: new Set([match.flag]),
      });
      continue;
    }

    last.end = Math.max(last.end, match.end);
    last.flags.add(match.flag);
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((range, index) => {
    if (cursor < range.start) {
      parts.push(
        <span key={`plain-${index}-${cursor}`}>
          {payload.slice(cursor, range.start)}
        </span>,
      );
    }

    parts.push(
      <mark
        key={`hit-${index}-${range.start}`}
        className="payload-highlight"
        title={[...range.flags].join(", ")}
      >
        {payload.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < payload.length) {
    parts.push(<span key={`plain-end-${cursor}`}>{payload.slice(cursor)}</span>);
  }

  return <>{parts}</>;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing root container");
}

createRoot(container).render(<App />);
