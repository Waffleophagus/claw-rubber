import {
  AlertTriangle,
  CalendarDays,
  CircleHelp,
  Globe,
  Layers,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

export type DashboardVariant = "v1" | "v2" | "v3" | "v4" | "v5";
type SignalForgeThemeMode = "system" | "light" | "dark";

interface TraceEvent {
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
  traceKind: "search-result-fetch" | "direct-web-fetch" | "unknown";
  searchRank: number | null;
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

interface TraceEventDetail extends TraceEvent {
  payloadContent: string | null;
  evidence: EvidenceMatch[];
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

interface TopItem {
  value: string;
  count: number;
}

interface FilterState {
  from: string;
  to: string;
  decision: "allow" | "block" | "all";
  domain: string;
  query: string;
  reason: string;
  flag: string;
  allowedBy: string;
  traceKind: "all" | "search-result-fetch" | "direct-web-fetch" | "unknown";
  rankMin: string;
  rankMax: string;
}

interface FlagFilterPreset {
  value: string;
  label: string;
  description: string;
}

const VARIANT_COPY: Record<DashboardVariant, { title: string; subtitle: string; tone: string }> = {
  v1: {
    title: "Signal Forge",
    subtitle: "Dense analyst cockpit for full fetch trace triage",
    tone: "Operational",
  },
  v2: {
    title: "Atlas Sweep",
    subtitle: "Visual monitoring board with ranked exploration traces",
    tone: "Exploratory",
  },
  v3: {
    title: "Ledger View",
    subtitle: "Editorial-style incident chronicle with fast forensics",
    tone: "Narrative",
  },
  v4: {
    title: "Runtime Terminal",
    subtitle: "High-contrast console aesthetic for rapid anomaly scanning",
    tone: "Command",
  },
  v5: {
    title: "Topography",
    subtitle: "Modern split-pane map of fetch behavior and exception flow",
    tone: "Discovery",
  },
};

const FLAG_FILTER_PRESETS: FlagFilterPreset[] = [
  { value: "", label: "Any flag", description: "No flag filter" },
  { value: "confusable_mixed_script", label: "Confusable mixed script", description: "Mixed-script confusable tokens" },
  { value: "unicode_invisible_or_bidi", label: "Invisible/BiDi unicode", description: "Invisible or directional control chars" },
  { value: "instruction_override", label: "Instruction override", description: "Attempts to override prior instructions" },
  { value: "role_hijack", label: "Role hijack", description: "Prompt tries to redefine assistant/system role" },
  { value: "prompt_exfiltration", label: "Prompt exfiltration", description: "Requests hidden prompt disclosure" },
  { value: "secret_exfiltration", label: "Secret exfiltration", description: "Requests keys, tokens, secrets, passwords" },
  { value: "tool_abuse", label: "Tool abuse", description: "Requests command/tool execution behavior" },
  { value: "jailbreak_marker", label: "Jailbreak marker", description: "Known jailbreak phrasing patterns" },
  { value: "urgent_manipulation", label: "Urgent manipulation", description: "Urgency language tied to bypass requests" },
  { value: "encoding_obfuscation", label: "Encoding obfuscation", description: "General encoding-obfuscation cue" },
  { value: "encoded_payload_candidate", label: "Encoded payload candidate", description: "Base64/hex/escape payload blocks" },
  { value: "escape_sequence_obfuscation", label: "Escape sequence obfuscation", description: "Heavy unicode/byte/percent escapes" },
  { value: "decode_instruction_context", label: "Decode instruction context", description: "Decode/deobfuscate + execute context" },
  { value: "typoglycemia_high_risk_keyword", label: "Typoglycemia high-risk", description: "Misspelled high-risk command terms" },
  { value: "typoglycemia_keyword:", label: "Typoglycemia keyword:*", description: "Any specific typoglycemia keyword flag" },
  { value: "llm_judge:", label: "LLM judge:*", description: "LLM-judge emitted safety label flag" },
];

export function DashboardApp({ variant }: { variant: DashboardVariant }) {
  const now = useMemo(() => new Date(), []);
  const isSignalForge = variant === "v1";
  const [themeMode, setThemeMode] = useState<SignalForgeThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [isFlagHelpOpen, setIsFlagHelpOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    from: toDatetimeLocalValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
    to: toDatetimeLocalValue(now),
    decision: "all",
    domain: "",
    query: "",
    reason: "",
    flag: "",
    allowedBy: "",
    traceKind: "all",
    rankMin: "",
    rankMax: "",
  });

  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [topDomains, setTopDomains] = useState<TopItem[]>([]);
  const [topFlags, setTopFlags] = useState<TopItem[]>([]);
  const [topReasons, setTopReasons] = useState<TopItem[]>([]);
  const [topAllowedBy, setTopAllowedBy] = useState<TopItem[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TraceEventDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = 50;
  const copy = VARIANT_COPY[variant];

  const baseParams = useMemo(() => buildParams(filters), [filters]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams(baseParams);
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const [overviewRes, tracesRes, domainsRes, flagsRes, reasonsRes, allowedByRes] = await Promise.all([
        fetchJson<{ overview: OverviewPayload }>(`/v1/dashboard/overview?${baseParams.toString()}`),
        fetchJson<{ events: TraceEvent[]; pagination: { total: number } }>(`/v1/dashboard/traces?${params.toString()}`),
        fetchJson<{ items: TopItem[] }>(`/v1/dashboard/top-domains?${baseParams.toString()}&limit=8`),
        fetchJson<{ items: TopItem[] }>(`/v1/dashboard/top-flags?${baseParams.toString()}&limit=8`),
        fetchJson<{ items: TopItem[] }>(`/v1/dashboard/top-reasons?${baseParams.toString()}&limit=8`),
        fetchJson<{ items: TopItem[] }>(`/v1/dashboard/top-allowed-by?${baseParams.toString()}&limit=8`),
      ]);

      setOverview(overviewRes.overview);
      setEvents(tracesRes.events);
      setTotalEvents(tracesRes.pagination.total);
      setTopDomains(domainsRes.items);
      setTopFlags(flagsRes.items);
      setTopReasons(reasonsRes.items);
      setTopAllowedBy(allowedByRes.items);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to load traces";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [baseParams, offset]);

  const loadDetail = useCallback(async (eventId: string) => {
    setDetailLoading(true);
    try {
      const response = await fetchJson<{ event: TraceEventDetail }>(
        `/v1/dashboard/events/${encodeURIComponent(eventId)}`,
      );
      setDetail(response.event);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load();
    }, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!isFlagHelpOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFlagHelpOpen(false);
      }
    };

    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, [isFlagHelpOpen]);

  useEffect(() => {
    if (!isSignalForge) {
      return;
    }

    const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    setSystemPrefersDark(media?.matches ?? false);

    if (!media) {
      return;
    }

    const listener = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    media.addEventListener("change", listener);
    return () => {
      media.removeEventListener("change", listener);
    };
  }, [isSignalForge]);

  useEffect(() => {
    if (!isSignalForge) {
      return;
    }

    const stored = globalThis.localStorage?.getItem("claw-rubber:signal-forge-theme");
    if (stored === "dark" || stored === "light" || stored === "system") {
      setThemeMode(stored);
      return;
    }

    setThemeMode("system");
  }, [isSignalForge]);

  function setThemeModeFromControl(next: string): void {
    if (next !== "system" && next !== "light" && next !== "dark") {
      return;
    }

    setThemeMode(next);
    globalThis.localStorage?.setItem("claw-rubber:signal-forge-theme", next);
  }

  function updateFilter<K extends keyof FilterState>(key: K, value: FilterState[K]): void {
    setOffset(0);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const pageStart = totalEvents === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + limit, totalEvents);

  const averageRank = useMemo(() => {
    const ranked = events.filter((event) => event.searchRank !== null);
    if (ranked.length === 0) {
      return "--";
    }
    const average = ranked.reduce((sum, event) => sum + (event.searchRank ?? 0), 0) / ranked.length;
    return average.toFixed(2);
  }, [events]);

  const effectiveTheme = isSignalForge
    ? (themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode)
    : "light";

  return (
    <div className={`trace-dashboard trace-dashboard-${variant}${isSignalForge ? ` trace-theme-${effectiveTheme}` : ""}`}>
      <header className="trace-hero">
        <div>
          <p className="trace-hero-kicker">{copy.tone} Trace Model</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        <div className="trace-hero-actions">
          {isSignalForge ? (
            <div className="trace-theme-toggle-wrap">
              <span>Theme</span>
              <ToggleGroup.Root
                type="single"
                value={themeMode}
                onValueChange={setThemeModeFromControl}
                className="trace-theme-toggle"
                aria-label="Signal Forge theme"
              >
                <ToggleGroup.Item value="system" className="trace-theme-item" aria-label="System theme">
                  <Monitor size={14} />
                  System
                </ToggleGroup.Item>
                <ToggleGroup.Item value="light" className="trace-theme-item" aria-label="Light theme">
                  <Sun size={14} />
                  Light
                </ToggleGroup.Item>
                <ToggleGroup.Item value="dark" className="trace-theme-item" aria-label="Dark theme">
                  <Moon size={14} />
                  Dark
                </ToggleGroup.Item>
              </ToggleGroup.Root>
            </div>
          ) : null}
          <button type="button" className="trace-btn ghost" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw size={16} className={isLoading ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="trace-error">{error}</div> : null}

      <section className="trace-metrics">
        <MetricCard icon={<Layers size={16} />} label="Fetch Traces" value={overview?.totalEvents ?? "--"} />
        <MetricCard icon={<ShieldAlert size={16} />} label="Blocked" value={overview?.blockedEvents ?? "--"} />
        <MetricCard icon={<ShieldCheck size={16} />} label="Allowed" value={overview?.allowedEvents ?? "--"} />
        <MetricCard
          icon={<AlertTriangle size={16} />}
          label="Exception Path"
          value={humanAllowedBy(overview?.topAllowedBy ?? null)}
        />
        <MetricCard icon={<Globe size={16} />} label="Unique Blocked Domains" value={overview?.uniqueBlockedDomains ?? "--"} />
        <MetricCard icon={<Timer size={16} />} label="Average Rank (page)" value={averageRank} />
      </section>

      <section className="trace-filters">
        <h2>
          <Search size={16} />
          Trace Filters
        </h2>
        <div className="trace-filter-grid">
          <DateTimePicker
            label="From"
            value={filters.from}
            onChange={(value) => updateFilter("from", value)}
          />
          <DateTimePicker
            label="To"
            value={filters.to}
            onChange={(value) => updateFilter("to", value)}
          />
          <label>
            <span>Decision</span>
            <select
              value={filters.decision}
              onChange={(event) => updateFilter("decision", event.target.value as FilterState["decision"])}
            >
              <option value="all">Allow + block</option>
              <option value="allow">Allowed only</option>
              <option value="block">Blocked only</option>
            </select>
          </label>
          <label>
            <span>Trace type</span>
            <select
              value={filters.traceKind}
              onChange={(event) => updateFilter("traceKind", event.target.value as FilterState["traceKind"])}
            >
              <option value="all">All trace kinds</option>
              <option value="search-result-fetch">Search result fetch</option>
              <option value="direct-web-fetch">Direct web fetch</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>Domain contains</span>
            <input
              type="text"
              value={filters.domain}
              placeholder="wikipedia.org"
              onChange={(event) => updateFilter("domain", event.target.value)}
            />
          </label>
          <label>
            <span>Search query contains</span>
            <input
              type="text"
              value={filters.query}
              placeholder="victorian architecture"
              onChange={(event) => updateFilter("query", event.target.value)}
            />
          </label>
          <div className="trace-filter-field trace-filter-flag-field">
            <span className="trace-filter-label-row">
              <span className="trace-filter-text">Flag contains</span>
              <button
                type="button"
                className="trace-help-launch"
                aria-label="Open flag filter help"
                onClick={() => setIsFlagHelpOpen(true)}
              >
                <CircleHelp size={12} aria-hidden="true" />
                Help ?
              </button>
            </span>
            <select
              value={filters.flag}
              onChange={(event) => updateFilter("flag", event.target.value)}
            >
              {FLAG_FILTER_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </div>
          <label>
            <span>Allowed-by contains</span>
            <input
              type="text"
              value={filters.allowedBy}
              placeholder="language"
              onChange={(event) => updateFilter("allowedBy", event.target.value)}
            />
          </label>
          <label>
            <span>Reason contains</span>
            <input
              type="text"
              value={filters.reason}
              placeholder="rule score"
              onChange={(event) => updateFilter("reason", event.target.value)}
            />
          </label>
          <label>
            <span>Rank min</span>
            <input
              type="number"
              min={1}
              value={filters.rankMin}
              onChange={(event) => updateFilter("rankMin", event.target.value)}
            />
          </label>
          <label>
            <span>Rank max</span>
            <input
              type="number"
              min={1}
              value={filters.rankMax}
              onChange={(event) => updateFilter("rankMax", event.target.value)}
            />
          </label>
          <button
            type="button"
            className="trace-btn subtle trace-reset-btn"
            onClick={() => {
              const current = new Date();
              updateFilter("from", toDatetimeLocalValue(new Date(current.getTime() - 24 * 60 * 60 * 1000)));
              updateFilter("to", toDatetimeLocalValue(current));
              updateFilter("decision", "all");
              updateFilter("domain", "");
              updateFilter("query", "");
              updateFilter("reason", "");
              updateFilter("flag", "");
              updateFilter("allowedBy", "");
              updateFilter("traceKind", "all");
              updateFilter("rankMin", "");
              updateFilter("rankMax", "");
            }}
          >
            Reset
          </button>
        </div>
      </section>

      <section className="trace-layout">
        <div className="trace-panel trace-stream">
          <div className="trace-panel-head">
            <h3>Fetch Trace Stream</h3>
            <p>
              Showing {pageStart}-{pageEnd} of {totalEvents}
            </p>
          </div>
          <TraceStream variant={variant} events={events} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="trace-pagination">
            <button
              type="button"
              className="trace-btn ghost"
              onClick={() => setOffset((current) => Math.max(0, current - limit))}
              disabled={offset === 0 || isLoading}
            >
              Previous
            </button>
            <button
              type="button"
              className="trace-btn ghost"
              onClick={() => setOffset((current) => current + limit)}
              disabled={offset + limit >= totalEvents || isLoading}
            >
              Next
            </button>
          </div>
        </div>

        <aside className="trace-panel trace-side">
          <TopList title="Top Domains" items={topDomains} />
          <TopList title="Top Flags" items={topFlags} mono />
          <TopList title="Top Block Reasons" items={topReasons} />
          <TopList
            title="Allowed by Exception"
            items={topAllowedBy}
            empty="No allow exceptions in this window"
            valueRenderer={humanAllowedBy}
          />
        </aside>
      </section>

      {selectedId ? (
        <div className="trace-drawer-overlay" onClick={() => setSelectedId(null)}>
          <section className="trace-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="trace-drawer-head">
              <h3>Trace Detail</h3>
              <button type="button" className="trace-btn ghost" onClick={() => setSelectedId(null)}>
                Close
              </button>
            </div>
            {detailLoading ? <p>Loading trace...</p> : null}
            {!detailLoading && !detail ? <p>Trace details unavailable.</p> : null}
            {detail ? <TraceDetail detail={detail} /> : null}
          </section>
        </div>
      ) : null}

      {isFlagHelpOpen ? (
        <div className="trace-help-overlay" onClick={() => setIsFlagHelpOpen(false)}>
          <section
            className="trace-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trace-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="trace-help-head">
              <h2 id="trace-help-title">Flag Filter Help</h2>
              <p>Use any value below in the `Flag contains` filter. Matching uses contains semantics.</p>
            </header>
            <div className="trace-help-grid">
              {FLAG_FILTER_PRESETS.filter((preset) => preset.value).map((preset) => (
                <article key={preset.value} className="trace-help-row">
                  <h4>{preset.label}</h4>
                  <p>{preset.description}</p>
                </article>
              ))}
            </div>
            <div className="trace-help-actions">
              <button type="button" className="trace-btn subtle" onClick={() => setIsFlagHelpOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="trace-footer">
        <Sparkles size={14} />
        Live view of full fetch traces, rankings, and allow-exception pathways.
      </footer>
    </div>
  );
}

function DateTimePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = parseDatetimeValue(value);
  const timeValue = toTimeInputValue(parsed);

  return (
    <label className="trace-date-control">
      <span>{label}</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="trace-date-trigger">
            <CalendarDays size={15} />
            <span>{formatDatePickerDateLabel(parsed)}</span>
            <strong>{toTimeInputValue(parsed)}</strong>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="trace-popover-content" align="start" sideOffset={6}>
            <DayPicker
              mode="single"
              showOutsideDays
              selected={parsed}
              onSelect={(nextDate) => {
                if (!nextDate) {
                  return;
                }
                onChange(toDatetimeLocalValue(mergeDatePart(parsed, nextDate)));
              }}
              className="trace-calendar"
            />
            <div className="trace-time-row">
              <span>Time</span>
              <input
                type="time"
                value={timeValue}
                onChange={(event) => {
                  const next = mergeTimePart(parsed, event.target.value);
                  if (next) {
                    onChange(toDatetimeLocalValue(next));
                  }
                }}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </label>
  );
}

function TraceStream({
  variant,
  events,
  selectedId,
  onSelect,
}: {
  variant: DashboardVariant;
  events: TraceEvent[];
  selectedId: string | null;
  onSelect: (eventId: string) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="trace-empty-state">
        <Search size={18} />
        <h4>No traces for this filter window</h4>
        <p>Try widening the time range, switching trace type, or clearing one of the text filters.</p>
      </div>
    );
  }

  if (variant === "v2" || variant === "v5") {
    return (
      <div className="trace-card-grid">
        {events.map((event) => (
          <button
            type="button"
            key={event.eventId}
            className={`trace-card ${selectedId === event.eventId ? "selected" : ""}`}
            onClick={() => onSelect(event.eventId)}
          >
            <div className="trace-card-head">
              <span>{formatDate(event.createdAt)}</span>
              <StatusPill event={event} />
            </div>
            <h4>{event.domain}</h4>
            <p>{event.query ?? event.reason ?? "No reason text"}</p>
            <div className="trace-card-meta">
              <span>{humanTraceKind(event.traceKind)}</span>
              <span>{formatRank(event)}</span>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="trace-table-wrap">
      <table className="trace-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Domain</th>
            <th>Decision</th>
            <th>Trace</th>
            <th>Rank</th>
            <th>Score</th>
            <th>Allowed by</th>
            <th>Query</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.eventId}
              className={selectedId === event.eventId ? "selected" : ""}
              onClick={() => onSelect(event.eventId)}
            >
              <td>{formatDate(event.createdAt)}</td>
              <td className="strong">{event.domain}</td>
              <td><StatusPill event={event} /></td>
              <td>{humanTraceKind(event.traceKind)}</td>
              <td>{formatRank(event)}</td>
              <td>{formatScore(event)}</td>
              <td>{humanAllowedBy(event.allowedBy)}</td>
              <td>{event.query ?? "--"}</td>
              <td>{event.reason ?? "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TraceDetail({ detail }: { detail: TraceEventDetail }) {
  return (
    <div className="trace-detail-grid">
      <DetailField label="Event" value={detail.eventId} mono />
      <DetailField label="Time" value={new Date(detail.createdAt).toLocaleString()} />
      <DetailField label="Domain" value={detail.domain} mono />
      <DetailField label="URL" value={detail.url ?? "--"} />
      <DetailField label="Decision" value={detail.decision} />
      <DetailField label="Blocked by" value={humanBlockedBy(detail.blockedBy)} />
      <DetailField label="Allowed by" value={humanAllowedBy(detail.allowedBy)} />
      <DetailField label="Trace kind" value={humanTraceKind(detail.traceKind)} />
      <DetailField label="Search rank" value={detail.searchRank !== null ? String(detail.searchRank) : "--"} />
      <DetailField label="Query" value={detail.query ?? "--"} />
      <DetailField label="Reason" value={detail.reason ?? "--"} />
      <DetailField label="Flags" value={detail.flags.join(", ") || "--"} mono />
      {detail.evidence.length > 0 ? (
        <div className="trace-evidence">
          <h4>Evidence</h4>
          {detail.evidence.map((item) => (
            <article key={item.id}>
              <p>
                <strong>{item.flag}</strong> via {item.detector} ({item.basis}) • weight {item.weight}
              </p>
              <code>{item.excerpt || item.matchedText || "--"}</code>
            </article>
          ))}
        </div>
      ) : null}
      {detail.payloadContent ? (
        <div className="trace-payload">
          <h4>Stored payload</h4>
          <pre>{detail.payloadContent}</pre>
        </div>
      ) : null}
    </div>
  );
}

function TopList({
  title,
  items,
  mono,
  empty,
  valueRenderer,
}: {
  title: string;
  items: TopItem[];
  mono?: boolean;
  empty?: string;
  valueRenderer?: (value: string | null) => string;
}) {
  return (
    <section className="trace-top-list">
      <h3>{title}</h3>
      {items.length === 0 ? <p>{empty ?? "No data"}</p> : null}
      {items.map((item) => (
        <div key={item.value} className="trace-top-row">
          <span className={mono ? "mono" : ""}>{valueRenderer ? valueRenderer(item.value) : item.value}</span>
          <strong>{item.count}</strong>
        </div>
      ))}
    </section>
  );
}

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <article className="trace-metric-card">
      <div className="trace-metric-head">
        <span>{label}</span>
        {icon}
      </div>
      <p>{value}</p>
    </article>
  );
}

function StatusPill({ event }: { event: TraceEvent }) {
  return (
    <span className={`trace-pill ${event.decision === "block" ? "danger" : "success"}`}>
      {event.decision === "block" ? humanBlockedBy(event.blockedBy) : humanAllowedBy(event.allowedBy)}
    </span>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="trace-detail-field">
      <span>{label}</span>
      <p className={mono ? "mono" : ""}>{value}</p>
    </div>
  );
}

function buildParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", String(Date.parse(filters.from)));
  params.set("to", String(Date.parse(filters.to)));
  params.set("source", "fetch");
  params.set("decision", filters.decision);

  if (filters.domain.trim()) {
    params.set("domain", filters.domain.trim());
  }
  if (filters.query.trim()) {
    params.set("query", filters.query.trim());
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
  if (filters.traceKind !== "all") {
    params.set("trace_kind", filters.traceKind);
  }
  if (filters.rankMin.trim()) {
    params.set("rank_min", filters.rankMin.trim());
  }
  if (filters.rankMax.trim()) {
    params.set("rank_max", filters.rankMax.trim());
  }

  return params;
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
      return "Blocked";
  }
}

function humanAllowedBy(value: string | null): string {
  switch (value) {
    case "domain-allowlist-bypass":
      return "Allowlist bypass";
    case "language-exception":
      return "Language exception";
    default:
      return "Standard allow";
  }
}

function humanTraceKind(value: TraceEvent["traceKind"]): string {
  switch (value) {
    case "search-result-fetch":
      return "Search result";
    case "direct-web-fetch":
      return "Direct fetch";
    default:
      return "Unknown";
  }
}

function formatRank(event: TraceEvent): string {
  if (event.searchRank === null) {
    return event.traceKind === "direct-web-fetch" ? "direct" : "--";
  }
  return String(event.searchRank);
}

function formatScore(event: TraceEvent): string {
  if (event.blockThreshold === null) {
    return String(event.score);
  }
  return `${event.score}/${event.blockThreshold}`;
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function parseDatetimeValue(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function toTimeInputValue(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function mergeDatePart(current: Date, pickedDate: Date): Date {
  const merged = new Date(pickedDate);
  merged.setHours(current.getHours(), current.getMinutes(), 0, 0);
  return merged;
}

function mergeTimePart(current: Date, timeValue: string): Date | null {
  const [hoursRaw, minutesRaw] = timeValue.split(":", 2);
  const hours = Number.parseInt(hoursRaw ?? "", 10);
  const minutes = Number.parseInt(minutesRaw ?? "", 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const merged = new Date(current);
  merged.setHours(hours, minutes, 0, 0);
  return merged;
}

function formatDatePickerDateLabel(value: Date): string {
  return value.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    const message = extractError(payload) ?? `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function extractError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const maybe = payload as { error?: { message?: unknown } };
  if (typeof maybe.error?.message === "string") {
    return maybe.error.message;
  }

  return null;
}
