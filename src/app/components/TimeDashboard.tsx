"use client";

import { useEffect, useMemo, useState } from "react";

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
  error?: string;
  retryAfter?: string | null;
};

type TeamResponse = {
  date: string;
  members: TeamMemberData[];
  error?: string;
  retryAfter?: string | null;
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
const HOUR_HEIGHT = 56;
const MIN_BLOCK_HEIGHT = 24;
const RANKING_ENTRY_CAP_SECONDS = 4 * 60 * 60;

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

function buildTimelineBlocks(entries: TimeEntry[], dateInput: string) {
  const { start, end } = getDayBoundsMs(dateInput);
  const pxPerMs = HOUR_HEIGHT / (60 * 60 * 1000);
  const sorted = [...entries].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const active: Array<{ lane: number; endMs: number }> = [];
  const blocks: TimelineBlock[] = [];
  let maxLanes = 1;

  for (const entry of sorted) {
    const startMs = new Date(entry.start).getTime();
    const endMs = getEntryEndMs(entry);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

    const visibleStart = Math.max(startMs, start);
    const visibleEnd = Math.min(endMs, end);
    if (visibleEnd <= visibleStart) continue;

    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].endMs <= visibleStart) {
        active.splice(i, 1);
      }
    }

    const usedLanes = new Set(active.map((item) => item.lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane += 1;

    active.push({ lane, endMs: visibleEnd });
    maxLanes = Math.max(maxLanes, lane + 1);

    blocks.push({
      id: `${entry.id}-${startMs}`,
      lane,
      topPx: (visibleStart - start) * pxPerMs,
      heightPx: Math.max(MIN_BLOCK_HEIGHT, (visibleEnd - visibleStart) * pxPerMs),
      title: entry.description?.trim() || "(No description)",
      project: entry.project_name?.trim() || "No project",
      timeRange: `${formatTime(entry.start)} → ${formatTime(entry.stop)}`,
      durationLabel: formatDuration(getEntrySeconds(entry)),
    });
  }

  return { blocks, maxLanes };
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

function buildTeamRanking(members: TeamMemberData[]): TeamRankingRow[] {
  const rows = members.map((member) => {
    const closedRanges = member.entries
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<string | null>(null);
  const [mode, setMode] = useState<"member" | "team">("member");

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
        const parsed = JSON.parse(lastSelection) as { member?: string; date?: string; mode?: "member" | "team" };
        if (parsed.member && members.some((item) => item.name === parsed.member)) {
          setMember(parsed.member);
        }
        if (parsed.date) {
          setDate(parsed.date);
        }
        if (parsed.mode) {
          setMode(parsed.mode);
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
    if (!member && mode === "member") return;

    let active = true;
    setLoading(true);
    setError(null);
    setRetryAfter(null);

    const params = new URLSearchParams({ date });
    const url = mode === "team" ? `/api/team?${params.toString()}` : `/api/entries?${new URLSearchParams({ member, date }).toString()}`;

    fetch(url)
      .then(async (res) => {
        const payload = (await res.json()) as EntriesResponse | TeamResponse;
        if (!res.ok || payload.error) {
          const err = new Error(payload.error || "Request failed") as Error & {
            retryAfter?: string | null;
          };
          err.retryAfter = (payload as EntriesResponse).retryAfter ?? (payload as TeamResponse).retryAfter ?? null;
          throw err;
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        if (mode === "team") {
          setTeamData(payload as TeamResponse);
          setData(null);
        } else {
          setData(payload as EntriesResponse);
          setTeamData(null);
        }
      })
      .catch((err: Error & { retryAfter?: string | null }) => {
        if (!active) return;
        setError(err.message);
        setRetryAfter(err.retryAfter ?? null);
        setData(null);
        setTeamData(null);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [member, date, mode]);

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
    setMode("member");
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
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`rounded-full px-4 py-2 text-sm font-semibold ${
            mode === "member" ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200"
          }`}
          onClick={() => setMode("member")}
        >
          Member view
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
          {retryAfter && (
            <p className="mt-2 text-sm text-rose-700">Retry after {retryAfter} seconds.</p>
          )}
        </div>
      )}

      {!loading && !error && mode === "member" && data && (
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
                          {formatHourLabel(hour % 24)}
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

                      {timeline.blocks.map((block) => (
                        <article
                          key={block.id}
                          className="absolute overflow-hidden rounded-lg border border-sky-300 bg-sky-100/90 px-2 py-1 shadow-sm"
                          style={{
                            top: `${block.topPx}px`,
                            height: `${block.heightPx}px`,
                            left: `calc(${(block.lane / timeline.maxLanes) * 100}% + 0.25rem)`,
                            width: `calc(${100 / timeline.maxLanes}% - 0.5rem)`,
                          }}
                        >
                          <p className="truncate text-xs font-semibold text-slate-900">{block.title}</p>
                          <p className="truncate text-[11px] text-slate-700">Project: {block.project}</p>
                          <p className="truncate text-[11px] text-slate-600">{block.timeRange}</p>
                          <p className="truncate text-[11px] text-slate-600">{block.durationLabel}</p>
                        </article>
                      ))}
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
      )}

      {!loading && !error && mode === "team" && teamData && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Team ranking</h2>
                <p className="text-sm text-slate-500">
                  Ranking uses closed entries only. Each entry is capped at 4h, so nonstop timers do not dominate.
                </p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="px-2 py-2 font-semibold">Rank</th>
                    <th className="px-2 py-2 font-semibold">Member</th>
                    <th className="px-2 py-2 font-semibold">Ranked hours</th>
                    <th className="px-2 py-2 font-semibold">Entries</th>
                    <th className="px-2 py-2 font-semibold">Started</th>
                    <th className="px-2 py-2 font-semibold">Ended</th>
                    <th className="px-2 py-2 font-semibold">Longest break</th>
                  </tr>
                </thead>
                <tbody>
                  {teamRanking.length === 0 && (
                    <tr>
                      <td className="px-2 py-3 text-slate-500" colSpan={7}>
                        No entries yet.
                      </td>
                    </tr>
                  )}
                  {teamRanking.map((row, index) => (
                    <tr key={row.name} className="border-b border-slate-100">
                      <td className="px-2 py-2 font-semibold text-slate-900">{index + 1}</td>
                      <td className="px-2 py-2 text-slate-800">{row.name}</td>
                      <td className="px-2 py-2 text-slate-800">{formatDuration(row.rankedSeconds)}</td>
                      <td className="px-2 py-2 text-slate-800">{row.entryCount}</td>
                      <td className="px-2 py-2 text-slate-700">{formatTime(row.firstStart)}</td>
                      <td className="px-2 py-2 text-slate-700">{formatTime(row.lastEnd)}</td>
                      <td className="px-2 py-2 text-slate-700">{formatDuration(row.longestBreakSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {teamData.members.map((memberData) => {
              const running = memberData.current && memberData.current.duration < 0 ? memberData.current : null;
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
        </div>
      )}
    </div>
  );
}
