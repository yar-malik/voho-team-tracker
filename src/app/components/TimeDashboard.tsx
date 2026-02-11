"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Member = { name: string };

type TimeEntry = {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  project_id?: number | null;
  project_name?: string | null;
  tags?: string[] | null;
};

type EntriesResponse = {
  entries: TimeEntry[];
  current: TimeEntry | null;
  totalSeconds: number;
  date: string;
  cachedAt?: string;
  stale?: boolean;
  warning?: string | null;
  error?: string;
  retryAfter?: string | null;
  quotaRemaining?: string | null;
  quotaResetsIn?: string | null;
};

type TeamResponse = {
  date: string;
  members: TeamMemberData[];
  cachedAt?: string;
  stale?: boolean;
  warning?: string | null;
  error?: string;
  retryAfter?: string | null;
  quotaRemaining?: string | null;
  quotaResetsIn?: string | null;
};

type TeamWeekResponse = {
  startDate: string;
  endDate: string;
  weekDates: string[];
  members: Array<{
    name: string;
    totalSeconds: number;
    entryCount: number;
    days: Array<{ date: string; seconds: number; entryCount: number }>;
  }>;
  cachedAt?: string;
  stale?: boolean;
  warning?: string | null;
  error?: string;
  quotaRemaining?: string | null;
  quotaResetsIn?: string | null;
};

type SavedFilter = {
  id: string;
  name: string;
  member: string;
  date: string;
};

const FILTERS_KEY = "toggl-team-filters";
const LAST_KEY = "toggl-team-last";
const HOURS_IN_DAY = 24;
const HOUR_HEIGHT = 72;
const MIN_BLOCK_HEIGHT = 24;
const RANKING_ENTRY_CAP_SECONDS = 4 * 60 * 60;
const EXCLUDED_PROJECT_NAME = "non-work-task";

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getEntrySeconds(entry: TimeEntry): number {
  if (entry.duration >= 0) return entry.duration;
  const startedAt = new Date(entry.start).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function getEntryEndMs(entry: TimeEntry): number {
  if (entry.stop) {
    const stoppedAt = new Date(entry.stop).getTime();
    if (!Number.isNaN(stoppedAt)) return stoppedAt;
  }
  const startedAt = new Date(entry.start).getTime();
  if (Number.isNaN(startedAt)) return Number.NaN;
  if (entry.duration >= 0) return startedAt + entry.duration * 1000;
  return Date.now();
}

function getDayBoundsMs(dateInput: string) {
  const [yearStr, monthStr, dayStr] = dateInput.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  const start = new Date(year, monthIndex, day, 0, 0, 0, 0).getTime();
  const end = new Date(year, monthIndex, day, 23, 59, 59, 999).getTime();
  return { start, end };
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

type TimelineBlock = {
  id: string;
  lane: number;
  topPx: number;
  heightPx: number;
  title: string;
  project: string;
  timeRange: string;
  durationLabel: string;
};

type TeamMemberData = {
  name: string;
  entries: TimeEntry[];
  current: TimeEntry | null;
  totalSeconds: number;
};

type TeamRankingRow = {
  name: string;
  rankedSeconds: number;
  entryCount: number;
  firstStart: string | null;
  lastEnd: string | null;
  longestBreakSeconds: number;
};


type EntryModalData = {
  memberName: string;
  description: string;
  project: string;
  start: string | null;
  end: string | null;
  durationSeconds: number;
};

function buildTimelineBlocks(entries: TimeEntry[], dateInput: string) {
  const { start, end } = getDayBoundsMs(dateInput);
  const pxPerMs = HOUR_HEIGHT / (60 * 60 * 1000);
  const minDurationMs = MIN_BLOCK_HEIGHT / pxPerMs;
  const sorted = [...entries].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const blocks: TimelineBlock[] = [];
  let lastBottomPx = -Infinity;

  for (const entry of sorted) {
    const startMs = new Date(entry.start).getTime();
    const endMs = getEntryEndMs(entry);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

    const visibleStart = Math.max(startMs, start);
    const visibleEnd = Math.min(endMs, end);
    if (visibleEnd <= visibleStart) continue;
    const displayEnd = Math.min(end, Math.max(visibleEnd, visibleStart + minDurationMs));
    const idealTopPx = (visibleStart - start) * pxPerMs;
    const heightPx = (displayEnd - visibleStart) * pxPerMs;
    const topPx = Math.max(idealTopPx, lastBottomPx + 2);
    lastBottomPx = topPx + heightPx;

    blocks.push({
      id: `${entry.id}-${startMs}`,
      lane: 0,
      topPx,
      heightPx,
      title: entry.description?.trim() || "(No description)",
      project: entry.project_name?.trim() || "No project",
      timeRange: `${formatTime(entry.start)} → ${formatTime(entry.stop)}`,
      durationLabel: formatDuration(getEntrySeconds(entry)),
    });
  }

  return { blocks, maxLanes: 1 };
}

function getClosedEntryRange(entry: TimeEntry): { startMs: number; endMs: number; seconds: number } | null {
  const startMs = new Date(entry.start).getTime();
  if (Number.isNaN(startMs)) return null;

  const endMs = getEntryEndMs(entry);
  if (Number.isNaN(endMs) || endMs <= startMs) return null;

  const isClosed = entry.duration >= 0 || Boolean(entry.stop);
  if (!isClosed) return null;

  const secondsFromRange = Math.floor((endMs - startMs) / 1000);
  const seconds = entry.duration >= 0 ? entry.duration : secondsFromRange;
  return { startMs, endMs, seconds: Math.max(0, seconds) };
}

function isExcludedFromRanking(projectName: string | null | undefined) {
  return (projectName ?? "").trim().toLowerCase() === EXCLUDED_PROJECT_NAME;
}

function buildTeamRanking(members: TeamMemberData[]): TeamRankingRow[] {
  const rows = members.map((member) => {
    const closedRanges = member.entries
      .filter((entry) => !isExcludedFromRanking(entry.project_name))
      .map(getClosedEntryRange)
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.startMs - b.startMs);

    let rankedSeconds = 0;
    let longestBreakSeconds = 0;
    for (let i = 0; i < closedRanges.length; i += 1) {
      rankedSeconds += Math.min(closedRanges[i].seconds, RANKING_ENTRY_CAP_SECONDS);
      if (i === 0) continue;
      const breakSeconds = Math.max(0, Math.floor((closedRanges[i].startMs - closedRanges[i - 1].endMs) / 1000));
      longestBreakSeconds = Math.max(longestBreakSeconds, breakSeconds);
    }

    return {
      name: member.name,
      rankedSeconds,
      entryCount: closedRanges.length,
      firstStart: closedRanges[0] ? new Date(closedRanges[0].startMs).toISOString() : null,
      lastEnd: closedRanges[closedRanges.length - 1]
        ? new Date(closedRanges[closedRanges.length - 1].endMs).toISOString()
        : null,
      longestBreakSeconds,
    };
  });

  return rows.sort((a, b) => {
    if (b.rankedSeconds !== a.rankedSeconds) return b.rankedSeconds - a.rankedSeconds;
    if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
    return a.name.localeCompare(b.name);
  });
}


function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDateLabel(dateInput: string): string {
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  return date.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
}

function formatWaitMinutes(secondsRaw: string | null): string | null {
  if (!secondsRaw) return null;
  const seconds = Number(secondsRaw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} min`;
}

function getProjectColorClass(project: string): string {
  if (!project || project === "No project") {
    return "border-slate-300 bg-slate-100/90";
  }

  const palette = [
    "border-rose-300 bg-rose-100/90",
    "border-amber-300 bg-amber-100/90",
    "border-emerald-300 bg-emerald-100/90",
    "border-cyan-300 bg-cyan-100/90",
    "border-sky-300 bg-sky-100/90",
    "border-indigo-300 bg-indigo-100/90",
    "border-lime-300 bg-lime-100/90",
    "border-orange-300 bg-orange-100/90",
    "border-teal-300 bg-teal-100/90",
  ];

  let hash = 0;
  for (let i = 0; i < project.length; i += 1) {
    hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

function getAvatarPalette(name: string): string {
  const palettes = [
    "from-sky-400 to-blue-500",
    "from-emerald-400 to-teal-500",
    "from-amber-400 to-orange-500",
    "from-indigo-400 to-violet-500",
    "from-cyan-400 to-sky-500",
    "from-lime-400 to-green-500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return palettes[hash % palettes.length];
}

function getBarPalette(index: number): string {
  if (index === 0) return "from-amber-400 to-yellow-500";
  if (index === 1) return "from-slate-300 to-slate-500";
  if (index === 2) return "from-orange-400 to-amber-500";
  return "from-sky-500 to-cyan-500";
}

function buildSummary(entries: TimeEntry[]) {
  const totals = new Map<string, number>();
  entries.forEach((entry) => {
    const label = entry.description?.trim() || "(No description)";
    totals.set(label, (totals.get(label) ?? 0) + getEntrySeconds(entry));
  });
  return Array.from(totals.entries())
    .map(([label, seconds]) => ({ label, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

export default function TimeDashboard({ members }: { members: Member[] }) {
  const defaultMember = members[0]?.name ?? "";
  const [member, setMember] = useState(defaultMember);
  const [date, setDate] = useState(formatDateInput(new Date()));
  const [search, setSearch] = useState("");
  const [filterName, setFilterName] = useState("");
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [data, setData] = useState<EntriesResponse | null>(null);
  const [teamData, setTeamData] = useState<TeamResponse | null>(null);
  const [teamWeekData, setTeamWeekData] = useState<TeamWeekResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<string | null>(null);
  const [quotaRemaining, setQuotaRemaining] = useState<string | null>(null);
  const [quotaResetsIn, setQuotaResetsIn] = useState<string | null>(null);
  const [mode, setMode] = useState<"member" | "team" | "all">("all");
  const [selectedEntry, setSelectedEntry] = useState<EntryModalData | null>(null);
  const [manualRefreshTick, setManualRefreshTick] = useState(0);
  const forceRefreshRef = useRef(false);

  const hasMembers = members.length > 0;

  useEffect(() => {
    const storedFilters = localStorage.getItem(FILTERS_KEY);
    if (storedFilters) {
      try {
        const parsed = JSON.parse(storedFilters) as SavedFilter[];
        if (Array.isArray(parsed)) {
          setSavedFilters(parsed);
        }
      } catch {
        setSavedFilters([]);
      }
    }

    const lastSelection = localStorage.getItem(LAST_KEY);
    if (lastSelection) {
      try {
        const parsed = JSON.parse(lastSelection) as { member?: string; date?: string; mode?: "member" | "team" | "all" };
        if (parsed.member && members.some((item) => item.name === parsed.member)) {
          setMember(parsed.member);
        }
        if (parsed.date) {
          setDate(parsed.date);
        }
        if (parsed.mode) {
          setMode(parsed.mode === "member" ? "all" : parsed.mode);
        }
      } catch {
        // ignore
      }
    }
  }, [members]);

  useEffect(() => {
    if (!member) return;

    localStorage.setItem(LAST_KEY, JSON.stringify({ member, date, mode }));
  }, [member, date, mode]);

  useEffect(() => {
    if (!forceRefreshRef.current) return;
    if (!member && mode === "member") return;

    let active = true;
    setLoading(true);
    setError(null);
    setRetryAfter(null);
    setQuotaRemaining(null);
    setQuotaResetsIn(null);

    const params = new URLSearchParams({ date, tzOffset: String(new Date().getTimezoneOffset()) });
    if (forceRefreshRef.current) {
      params.set("refresh", "1");
    }
    const url =
      mode === "team" || mode === "all"
        ? `/api/team?${params.toString()}`
        : `/api/entries?${new URLSearchParams({ member, date, tzOffset: String(new Date().getTimezoneOffset()) }).toString()}`;

    fetch(url)
      .then(async (res) => {
        const payload = (await res.json()) as EntriesResponse | TeamResponse;
        if (!res.ok || payload.error) {
          const err = new Error(payload.error || "Request failed") as Error & {
            retryAfter?: string | null;
            quotaRemaining?: string | null;
            quotaResetsIn?: string | null;
          };
          err.retryAfter = (payload as EntriesResponse).retryAfter ?? (payload as TeamResponse).retryAfter ?? null;
          err.quotaRemaining =
            (payload as EntriesResponse).quotaRemaining ?? (payload as TeamResponse).quotaRemaining ?? null;
          err.quotaResetsIn =
            (payload as EntriesResponse).quotaResetsIn ?? (payload as TeamResponse).quotaResetsIn ?? null;
          throw err;
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        if (mode === "team" || mode === "all") {
          setTeamData(payload as TeamResponse);
          setData(null);
        } else {
          setData(payload as EntriesResponse);
          setTeamData(null);
        }
      })
      .catch((err: Error & { retryAfter?: string | null; quotaRemaining?: string | null; quotaResetsIn?: string | null }) => {
        if (!active) return;
        setError(err.message);
        setRetryAfter(err.retryAfter ?? null);
        setQuotaRemaining(err.quotaRemaining ?? null);
        setQuotaResetsIn(err.quotaResetsIn ?? null);
        setData(null);
        setTeamData(null);
      })
      .finally(() => {
        if (!active) return;
        forceRefreshRef.current = false;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [member, date, mode, manualRefreshTick]);

  useEffect(() => {
    if (!forceRefreshRef.current) return;
    if (!(mode === "team" || mode === "all")) return;
    let active = true;

    const params = new URLSearchParams({ date, tzOffset: String(new Date().getTimezoneOffset()) });
    if (forceRefreshRef.current) {
      params.set("refresh", "1");
    }

    fetch(`/api/team-week?${params.toString()}`)
      .then(async (res) => {
        const payload = (await res.json()) as TeamWeekResponse;
        if (!res.ok || payload.error) {
          throw new Error(payload.error || "Failed to load 7-day summary");
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setTeamWeekData(payload);
      })
      .catch(() => {
        if (!active) return;
        // keep previous weekly snapshot if fetch fails
      });

    return () => {
      active = false;
    };
  }, [mode, date, manualRefreshTick]);

  const runningEntry = useMemo(() => {
    if (!data?.current) return null;
    if (data.current.duration >= 0) return null;
    return data.current;
  }, [data]);

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const term = search.toLowerCase();
    return members.filter((item) => item.name.toLowerCase().includes(term));
  }, [members, search]);

  const summary = useMemo(() => {
    if (!data) return [] as { label: string; seconds: number }[];
    return buildSummary(data.entries);
  }, [data]);

  const timeline = useMemo(() => {
    if (!data) return { blocks: [] as TimelineBlock[], maxLanes: 1 };
    return buildTimelineBlocks(data.entries, date);
  }, [data, date]);

  const teamRanking = useMemo(() => {
    if (!teamData) return [] as TeamRankingRow[];
    return buildTeamRanking(teamData.members);
  }, [teamData]);

  const teamTimeline = useMemo(() => {
    if (!teamData) return [] as Array<{ name: string; blocks: TimelineBlock[]; maxLanes: number }>;
    return teamData.members.map((memberData) => ({
      name: memberData.name,
      ...buildTimelineBlocks(memberData.entries, date),
    }));
  }, [teamData, date]);

  const openEntryModal = (entry: TimeEntry, memberName: string) => {
    setSelectedEntry({
      memberName,
      description: entry.description?.trim() || "(No description)",
      project: entry.project_name?.trim() || "No project",
      start: entry.start,
      end: entry.stop,
      durationSeconds: getEntrySeconds(entry),
    });
  };

  const handleManualRefresh = () => {
    forceRefreshRef.current = true;
    setManualRefreshTick((value) => value + 1);
  };

  useEffect(() => {
    if (!selectedEntry) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedEntry(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedEntry]);

  const handleSaveFilter = () => {
    if (!member) return;
    const name = filterName.trim() || `${member} ${date}`;
    const newFilter: SavedFilter = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      member,
      date,
    };
    const nextFilters = [newFilter, ...savedFilters].slice(0, 10);
    setSavedFilters(nextFilters);
    localStorage.setItem(FILTERS_KEY, JSON.stringify(nextFilters));
    setFilterName("");
  };

  const handleRemoveFilter = (id: string) => {
    const nextFilters = savedFilters.filter((item) => item.id !== id);
    setSavedFilters(nextFilters);
    localStorage.setItem(FILTERS_KEY, JSON.stringify(nextFilters));
  };

  const handleApplyFilter = (filter: SavedFilter) => {
    setMember(filter.member);
    setDate(filter.date);
    setMode("all");
  };

  if (!hasMembers) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="text-lg font-semibold">No team members configured</h2>
        <p className="mt-2 text-sm">
          Add teammate tokens to the <span className="font-mono">TOGGL_TEAM</span> environment
          variable, then restart the dev server.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              mode === "all" ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
            }`}
            onClick={() => setMode("all")}
          >
            All calendars
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              mode === "team" ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
            }`}
            onClick={() => setMode("team")}
          >
            Team overview
          </button>
        </div>
        <button
          type="button"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
          onClick={handleManualRefresh}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh view"}
        </button>
      </div>

      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-4">
        {mode === "member" && (
          <div className="md:col-span-2">
            <label className="text-sm font-medium text-slate-600">Team member</label>
            <div className="mt-2 flex flex-col gap-2 md:flex-row">
              <input
                type="text"
                placeholder="Search teammate"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
                value={member}
                onChange={(event) => setMember(event.target.value)}
              >
                {filteredMembers.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-slate-600">Date</label>
          <input
            type="date"
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        {mode === "member" && (
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-slate-500">Total logged</span>
            <span className="text-2xl font-semibold text-slate-900">
              {data ? formatDuration(data.totalSeconds) : "—"}
            </span>
          </div>
        )}
      </div>

      {mode === "member" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Saved filters
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {savedFilters.length === 0 && (
              <span className="text-sm text-slate-500">No saved filters yet.</span>
            )}
            {savedFilters.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                <button
                  type="button"
                  className="text-sm font-medium text-slate-700"
                  onClick={() => handleApplyFilter(item)}
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  className="text-xs text-slate-400"
                  onClick={() => handleRemoveFilter(item.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 md:flex-row">
            <input
              type="text"
              placeholder="Filter name (optional)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
              value={filterName}
              onChange={(event) => setFilterName(event.target.value)}
            />
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              onClick={handleSaveFilter}
            >
              Save current view
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">
          Loading entries…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <p>{error}</p>
          {formatWaitMinutes(retryAfter) && (
            <p className="mt-2 text-sm text-rose-700">Retry after {formatWaitMinutes(retryAfter)}.</p>
          )}
          {(quotaRemaining || quotaResetsIn) && (
            <div className="mt-2 text-sm text-rose-700">
              {quotaRemaining && <p>Quota remaining: {quotaRemaining}</p>}
              {formatWaitMinutes(quotaResetsIn) && <p>Quota resets in: {formatWaitMinutes(quotaResetsIn)}.</p>}
            </div>
          )}
        </div>
      )}

      {!loading && !error && mode === "member" && data && (
        <div className="space-y-4">
          {(data.warning || data.stale) && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <p className="text-sm font-semibold">{data.warning || "Showing cached snapshot."}</p>
              {data.cachedAt && (
                <p className="mt-1 text-sm text-amber-800">Snapshot time: {formatDateTime(data.cachedAt)}</p>
              )}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Day view</h2>
            <p className="mt-1 text-sm text-slate-500">
              Entries are ordered from start of day to end of day.
            </p>
            <div className="mt-4">
              {data.entries.length === 0 && (
                <p className="text-sm text-slate-500">No entries for this day.</p>
              )}
              {data.entries.length > 0 && (
                <div className="overflow-x-auto">
                  <div className="grid min-w-[700px] grid-cols-[4.5rem_1fr] gap-3">
                    <div className="relative" style={{ height: `${HOURS_IN_DAY * HOUR_HEIGHT}px` }}>
                      {Array.from({ length: HOURS_IN_DAY + 1 }).map((_, hour) => (
                        <div
                          key={hour}
                          className="absolute right-0 pr-2 text-[11px] font-medium text-slate-400"
                          style={{ top: `${hour * HOUR_HEIGHT - 8}px` }}
                        >
                          {formatHourLabel(hour)}
                        </div>
                      ))}
                    </div>

                    <div
                      className="relative rounded-xl border border-slate-200 bg-slate-50"
                      style={{ height: `${HOURS_IN_DAY * HOUR_HEIGHT}px` }}
                    >
                      {Array.from({ length: HOURS_IN_DAY + 1 }).map((_, hour) => (
                        <div
                          key={hour}
                          className="absolute left-0 right-0 border-t border-slate-200/90"
                          style={{ top: `${hour * HOUR_HEIGHT}px` }}
                        />
                      ))}

                      {timeline.blocks.map((block) => {
                        const sourceEntry = data.entries.find((entry) => `${entry.id}-${new Date(entry.start).getTime()}` === block.id);
                        const colorClass = getProjectColorClass(block.project);
                        return (
                        <button
                          key={block.id}
                          type="button"
                          className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm ${colorClass}`}
                          style={{
                            top: `${block.topPx}px`,
                            height: `${block.heightPx}px`,
                            left: `calc(${(block.lane / timeline.maxLanes) * 100}% + 0.25rem)`,
                            width: `calc(${100 / timeline.maxLanes}% - 0.5rem)`,
                          }}
                          onClick={() => {
                            if (!sourceEntry) return;
                            openEntryModal(sourceEntry, member);
                          }}
                        >
                          <p className="truncate text-xs font-semibold text-slate-900">{block.title}</p>
                          <p className="truncate text-[11px] text-slate-700">Project: {block.project}</p>
                          <p className="truncate text-[11px] text-slate-600">{block.timeRange}</p>
                          <p className="truncate text-[11px] text-slate-600">{block.durationLabel}</p>
                        </button>
                      );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>

            <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
              <h3 className="text-sm font-semibold uppercase tracking-wide">Currently running</h3>
              {runningEntry ? (
                <div className="mt-2">
                  <p className="text-lg font-semibold">
                    {runningEntry.description || "(No description)"}
                  </p>
                  <p className="text-sm text-emerald-700">
                    Project: {runningEntry.project_name?.trim() || "No project"}
                  </p>
                  <p className="text-sm text-emerald-700">
                    Started at {formatTime(runningEntry.start)}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-emerald-700">No active timer.</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                Daily summary
              </h3>
              <div className="mt-3 space-y-2">
                {summary.length === 0 && (
                  <p className="text-sm text-slate-500">No summary data yet.</p>
                )}
                {summary.map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">{item.label}</span>
                    <span className="text-sm font-medium text-slate-900">
                      {formatDuration(item.seconds)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                Notes
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Entries refresh when you change the date or teammate. Data stays on the server, and
                requests are lightly cached to reduce rate limits.
              </p>
            </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && (mode === "team" || mode === "all") && teamData && (
        <div className="space-y-4">
          {mode === "all" && (
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Team ranking</h2>
                  <p className="text-sm text-slate-500">
                    Closed-entry leaderboard. Project <span className="font-semibold">Non-Work-Task</span> is excluded.
                  </p>
                </div>
              </div>
              {teamRanking.length === 0 && (
                <p className="mt-4 text-sm text-slate-500">No entries yet.</p>
              )}
              {teamRanking.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <div className="min-w-[760px]">
                    <div className="flex h-[320px] items-end gap-4 rounded-xl border border-slate-200 bg-white px-4 py-4">
                      {teamRanking.map((row, index) => {
                        const topScore = teamRanking[0]?.rankedSeconds ?? 0;
                        const barHeight = topScore > 0 ? Math.max(36, Math.round((row.rankedSeconds / topScore) * 220)) : 36;
                        const avatarPalette = getAvatarPalette(row.name);
                        const barPalette = getBarPalette(index);
                        return (
                          <div key={row.name} className="flex w-[92px] flex-col items-center gap-2">
                            <div className={`relative flex h-12 w-12 items-center justify-center rounded-full border border-white bg-gradient-to-br text-lg shadow ${avatarPalette}`}>
                              <span className="text-white">♂</span>
                              <span className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[10px] font-bold text-slate-700">
                                {row.name.slice(0, 1).toUpperCase()}
                              </span>
                            </div>
                            <div
                              className={`w-full rounded-t-xl bg-gradient-to-t ${barPalette} shadow-sm`}
                              style={{ height: `${barHeight}px` }}
                              title={`${row.name}: ${formatDuration(row.rankedSeconds)}`}
                            />
                            <p className="truncate text-center text-xs font-semibold text-slate-800">{row.name}</p>
                            <p className="text-center text-[11px] text-slate-600">{formatDuration(row.rankedSeconds)}</p>
                            <p className="text-center text-[11px] text-slate-500">#{index + 1}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {teamRanking.map((row) => (
                        <p key={`${row.name}-meta`} className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-800">{row.name}</span>: Start {formatTime(row.firstStart)} | End {formatTime(row.lastEnd)} | Longest break {formatDuration(row.longestBreakSeconds)} | {row.entryCount} entries
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {teamWeekData && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Last 7 days overview</h2>
              <p className="text-sm text-slate-500">
                Ranking by total worked time over the last seven days.
              </p>
              {(teamWeekData.warning || teamWeekData.stale) && (
                <p className="mt-2 text-sm text-amber-700">
                  {teamWeekData.warning || "Showing cached 7-day snapshot."}
                </p>
              )}
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="px-2 py-2 font-semibold">Rank</th>
                      <th className="px-2 py-2 font-semibold">Member</th>
                      <th className="px-2 py-2 font-semibold">Total</th>
                      <th className="px-2 py-2 font-semibold">Entries</th>
                      {teamWeekData.weekDates.map((d) => (
                        <th key={d} className="px-2 py-2 font-semibold">
                          {formatShortDateLabel(d)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {teamWeekData.members.map((row, index) => (
                      <tr key={row.name} className="border-b border-slate-100">
                        <td className="px-2 py-2 font-semibold text-slate-900">{index + 1}</td>
                        <td className="px-2 py-2 text-slate-800">{row.name}</td>
                        <td className="px-2 py-2 text-slate-800">{formatDuration(row.totalSeconds)}</td>
                        <td className="px-2 py-2 text-slate-800">{row.entryCount}</td>
                        {teamWeekData.weekDates.map((d) => {
                          const day = row.days.find((item) => item.date === d);
                          return (
                            <td key={`${row.name}-${d}`} className="px-2 py-2 text-slate-700">
                              {formatDuration(day?.seconds ?? 0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(teamData.warning || teamData.stale) && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
              <p className="text-sm font-semibold">
                {teamData.warning || "Showing cached snapshot."}
              </p>
              {teamData.cachedAt && (
                <p className="mt-1 text-sm text-amber-800">Snapshot time: {formatDateTime(teamData.cachedAt)}</p>
              )}
            </div>
          )}

          {mode === "all" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">All team calendars</h2>
            <p className="text-sm text-slate-500">
              One shared daily timeline for everyone. Matching vertical positions indicate overlap.
            </p>
            <div className="mt-4 overflow-x-auto">
              <div className="grid min-w-[950px] grid-cols-[4.5rem_1fr] gap-3">
                <div className="relative" style={{ height: `${HOURS_IN_DAY * HOUR_HEIGHT}px` }}>
                  {Array.from({ length: HOURS_IN_DAY + 1 }).map((_, hour) => (
                    <div
                      key={hour}
                      className="absolute right-0 pr-2 text-[11px] font-medium text-slate-400"
                      style={{ top: `${hour * HOUR_HEIGHT - 8}px` }}
                    >
                      {formatHourLabel(hour)}
                    </div>
                  ))}
                </div>

                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, teamTimeline.length)}, minmax(180px, 1fr))` }}
                >
                  {teamTimeline.map((memberTimeline) => (
                    <div key={memberTimeline.name} className="space-y-2">
                      <p className="text-sm font-semibold text-slate-700">{memberTimeline.name}</p>
                      <div
                        className="relative rounded-xl border border-slate-200 bg-slate-50"
                        style={{ height: `${HOURS_IN_DAY * HOUR_HEIGHT}px` }}
                      >
                        {Array.from({ length: HOURS_IN_DAY + 1 }).map((_, hour) => (
                          <div
                            key={hour}
                            className="absolute left-0 right-0 border-t border-slate-200/90"
                            style={{ top: `${hour * HOUR_HEIGHT}px` }}
                          />
                        ))}

                        {memberTimeline.blocks.map((block) => {
                          const sourceEntry = teamData.members
                            .find((item) => item.name === memberTimeline.name)
                            ?.entries.find(
                              (entry) => `${entry.id}-${new Date(entry.start).getTime()}` === block.id
                            );
                          const colorClass = getProjectColorClass(block.project);
                          return (
                            <button
                              key={block.id}
                              type="button"
                              className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm ${colorClass}`}
                              style={{
                                top: `${block.topPx}px`,
                                height: `${block.heightPx}px`,
                                left: `calc(${(block.lane / memberTimeline.maxLanes) * 100}% + 0.25rem)`,
                                width: `calc(${100 / memberTimeline.maxLanes}% - 0.5rem)`,
                              }}
                              onClick={() => {
                                if (!sourceEntry) return;
                                openEntryModal(sourceEntry, memberTimeline.name);
                              }}
                            >
                              <p className="truncate text-xs font-semibold text-slate-900">{block.title}</p>
                              <p className="truncate text-[11px] text-slate-700">Project: {block.project}</p>
                              <p className="truncate text-[11px] text-slate-700">{block.timeRange}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          )}

          {mode === "team" && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {teamData.members.map((memberData) => {
                const running = memberData.entries.find((entry) => entry.duration < 0) ?? null;
                const memberSummary = buildSummary(memberData.entries).slice(0, 3);
                return (
                  <div key={memberData.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{memberData.name}</h3>
                        <p className="text-sm text-slate-500">Total {formatDuration(memberData.totalSeconds)}</p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          running ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {running ? "Running" : "Idle"}
                      </span>
                    </div>
                    <div className="mt-4">
                      {running ? (
                        <p className="text-sm text-emerald-700">Now: {running.description || "(No description)"}</p>
                      ) : (
                        <p className="text-sm text-slate-500">No active timer.</p>
                      )}
                    </div>
                    <div className="mt-4 space-y-1">
                      {memberSummary.length === 0 && (
                        <p className="text-sm text-slate-500">No entries yet.</p>
                      )}
                      {memberSummary.map((item) => (
                        <div key={item.label} className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">{item.label}</span>
                          <span className="font-medium text-slate-900">{formatDuration(item.seconds)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={() => setSelectedEntry(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Entry details</p>
                <h3 className="text-lg font-semibold text-slate-900">{selectedEntry.memberName}</h3>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600"
                onClick={() => setSelectedEntry(null)}
              >
                x
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p>
                <span className="font-semibold text-slate-900">Description:</span>{" "}
                {selectedEntry.description}
              </p>
              <p>
                <span className="font-semibold text-slate-900">Project:</span> {selectedEntry.project}
              </p>
              <p>
                <span className="font-semibold text-slate-900">Start:</span>{" "}
                {formatDateTime(selectedEntry.start)}
              </p>
              <p>
                <span className="font-semibold text-slate-900">End:</span>{" "}
                {selectedEntry.end ? formatDateTime(selectedEntry.end) : "Running"}
              </p>
              <p>
                <span className="font-semibold text-slate-900">Duration:</span>{" "}
                {formatDuration(selectedEntry.durationSeconds)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
