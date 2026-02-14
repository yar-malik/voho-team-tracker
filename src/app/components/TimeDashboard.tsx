"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { getProjectSurfaceColors } from "@/lib/projectColors";

type Member = { name: string };

type TimeEntry = {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  project_id?: number | null;
  project_name?: string | null;
  project_color?: string | null;
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
  source?: "db";
  cooldownActive?: boolean;
  retryAfterSeconds?: number;
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
  source?: "db";
  cooldownActive?: boolean;
  retryAfterSeconds?: number;
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
  source?: "db";
  cooldownActive?: boolean;
  retryAfterSeconds?: number;
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
const MEMBER_LINK_CLASS =
  "font-semibold text-sky-700 underline decoration-sky-400 decoration-2 underline-offset-2 hover:text-sky-800";

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatTimerClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
  projectColor: string | null;
  timeRange: string;
  durationLabel: string;
};

type TeamMemberData = {
  name: string;
  entries: TimeEntry[];
  current: TimeEntry | null;
  totalSeconds: number;
  lastActivityAt?: string | null;
};

type TeamRankingRow = {
  name: string;
  rankedSeconds: number;
  entryCount: number;
  firstStart: string | null;
  lastEnd: string | null;
  longestBreakSeconds: number;
};

type TaskProjectSummaryRow = {
  label: string;
  project: string;
  seconds: number;
};


type EntryModalData = {
  entryId: number;
  memberName: string;
  description: string;
  project: string;
  start: string | null;
  end: string | null;
  durationSeconds: number;
};

type HoverTooltipState = {
  text: string;
  left: number;
  top: number;
};

function buildTimelineBlocks(entries: TimeEntry[], dateInput: string) {
  const { start, end } = getDayBoundsMs(dateInput);
  const pxPerMs = HOUR_HEIGHT / (60 * 60 * 1000);
  const minDurationMs = MIN_BLOCK_HEIGHT / pxPerMs;
  const dayHeightPx = HOURS_IN_DAY * HOUR_HEIGHT;
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
    const rawHeightPx = (displayEnd - visibleStart) * pxPerMs;
    const unclampedTopPx = Math.max(idealTopPx, lastBottomPx + 2);
    const topPx = Math.max(0, Math.min(dayHeightPx - MIN_BLOCK_HEIGHT, unclampedTopPx));
    const heightPx = Math.max(MIN_BLOCK_HEIGHT, Math.min(rawHeightPx, dayHeightPx - topPx));
    lastBottomPx = topPx + heightPx;

    blocks.push({
      id: `${entry.id}-${startMs}`,
      lane: 0,
      topPx,
      heightPx,
      title: entry.description?.trim() || "(No description)",
      project: entry.project_name?.trim() || "No project",
      projectColor: entry.project_color?.trim() || null,
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

function formatTimeInputLocal(iso: string | null): string {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function buildIsoFromDateAndTime(dateInput: string, timeInput: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(timeInput)) return null;
  const [hour, minute] = timeInput.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return new Date(`${dateInput}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString();
}

function getMemberPageHref(memberName: string, date: string) {
  return `/member/${encodeURIComponent(memberName)}?date=${encodeURIComponent(date)}`;
}

function getProjectBlockStyle(project: string, projectColor: string | null | undefined): CSSProperties {
  return getProjectSurfaceColors(project, projectColor);
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

function buildTaskProjectSummary(entries: TimeEntry[]) {
  const totals = new Map<string, TaskProjectSummaryRow>();
  entries.forEach((entry) => {
    const label = entry.description?.trim() || "(No description)";
    const project = entry.project_name?.trim() || "No project";
    const key = `${project}::${label}`;
    const existing = totals.get(key);
    if (existing) {
      existing.seconds += getEntrySeconds(entry);
      return;
    }
    totals.set(key, { label, project, seconds: getEntrySeconds(entry) });
  });
  return Array.from(totals.values()).sort((a, b) => b.seconds - a.seconds);
}

function formatAgoFromMs(timestampMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(timestampMs)) return "—";
  const diffMs = Math.max(0, nowMs - timestampMs);
  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${Math.max(1, minutes)}m ago`;
  if (minutes === 0) return `${hours}h ago`;
  return `${hours}h ${minutes}m ago`;
}

function getEntryTooltipText(entry: TimeEntry, memberName: string) {
  const description = entry.description?.trim() || "(No description)";
  const project = entry.project_name?.trim() || "No project";
  const start = formatDateTime(entry.start);
  const end = entry.stop ? formatDateTime(entry.stop) : "Running";
  const duration = formatDuration(getEntrySeconds(entry));
  return [
    memberName,
    "",
    `Description: ${description}`,
    `Project: ${project}`,
    `Start: ${start}`,
    `End: ${end}`,
    `Duration: ${duration}`,
  ].join("\n");
}

function getTaskSummaryTooltip(item: TaskProjectSummaryRow) {
  return [
    `Project: ${item.project}`,
    `Description: ${item.label}`,
    `Total: ${formatDuration(item.seconds)}`,
  ].join("\n");
}

export default function TimeDashboard({
  members,
  initialMode = "all",
  restrictToMember = null,
  allowAllCalendars = true,
  allowTeamOverview = true,
  selfMode = "member",
}: {
  members: Member[];
  initialMode?: "member" | "all" | "team";
  restrictToMember?: string | null;
  allowAllCalendars?: boolean;
  allowTeamOverview?: boolean;
  selfMode?: "member" | "all";
}) {
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
  const [mode, setMode] = useState<"member" | "team" | "all">("all");
  const [selectedEntry, setSelectedEntry] = useState<EntryModalData | null>(null);
  const [entryEditor, setEntryEditor] = useState<{
    description: string;
    project: string;
    startTime: string;
    stopTime: string;
    saving: boolean;
    error: string | null;
  } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdateMeta, setLastUpdateMeta] = useState<{
    at: string;
    dataSource: "db" | null;
  } | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<HoverTooltipState | null>(null);
  const [relativeNowMs, setRelativeNowMs] = useState(Date.now());
  const [lastStoppedAtByMember, setLastStoppedAtByMember] = useState<Record<string, number>>({});
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const dayCalendarScrollRef = useRef<HTMLDivElement | null>(null);
  const allCalendarsScrollRef = useRef<HTMLDivElement | null>(null);
  const memberPickerRef = useRef<HTMLDivElement | null>(null);

  const hasMembers = members.length > 0;
  const isSelfOnly = Boolean(restrictToMember);
  const sanitizeMode = useMemo(
    () =>
      (next: "member" | "team" | "all"): "member" | "team" | "all" => {
        if (isSelfOnly) return selfMode === "all" ? "all" : "member";
        if (!allowAllCalendars && next === "all") return "team";
        if (!allowTeamOverview && next === "team") return "all";
        return next;
      },
    [isSelfOnly, allowAllCalendars, allowTeamOverview, selfMode]
  );

  useEffect(() => {
    if (!restrictToMember) return;
    const exists = members.some((item) => item.name === restrictToMember);
    if (exists) {
      setMember(restrictToMember);
      setMode(selfMode === "all" ? "all" : "member");
    }
  }, [restrictToMember, members, selfMode]);

  useEffect(() => {
    if (isSelfOnly && restrictToMember && selfMode === "member") {
      setSelectedMembers([restrictToMember]);
      return;
    }
    setSelectedMembers((prev) => {
      if (prev.length > 0) return prev.filter((name) => members.some((item) => item.name === name));
      return members.map((item) => item.name);
    });
  }, [members, isSelfOnly, restrictToMember, selfMode]);

  useEffect(() => {
    if (!memberPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!memberPickerRef.current) return;
      if (memberPickerRef.current.contains(event.target as Node)) return;
      setMemberPickerOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMemberPickerOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [memberPickerOpen]);

  useEffect(() => {
    setMode(sanitizeMode(initialMode));
  }, [initialMode, sanitizeMode]);

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
        if (parsed.mode && !isSelfOnly) {
          setMode(sanitizeMode(parsed.mode === "member" ? "all" : parsed.mode));
        }
      } catch {
        // ignore
      }
    }
  }, [isSelfOnly, members, sanitizeMode]);

  useEffect(() => {
    if (!member) return;

    localStorage.setItem(LAST_KEY, JSON.stringify({ member, date, mode }));
  }, [member, date, mode]);

  useEffect(() => {
    if (!member && mode === "member") return;

    let active = true;
    const requestNonce = String(Date.now());
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ date, tzOffset: String(new Date().getTimezoneOffset()) });
    params.set("_req", requestNonce);
    const url =
      mode === "team" || mode === "all"
        ? `/api/team?${params.toString()}`
        : `/api/entries?${new URLSearchParams({
            member,
            date,
            tzOffset: String(new Date().getTimezoneOffset()),
            _req: requestNonce,
          }).toString()}`;

    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const payload = (await res.json()) as EntriesResponse | TeamResponse;
        if (!res.ok || payload.error) {
          throw new Error(payload.error || "Request failed");
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        if (mode === "team" || mode === "all") {
          setTeamData(payload as TeamResponse);
          setData(null);
          const payloadCachedAt = (payload as TeamResponse).cachedAt;
          if (payloadCachedAt) {
            setLastUpdateMeta({
              at: payloadCachedAt,
              dataSource: "db",
            });
          }
        } else {
          setData(payload as EntriesResponse);
          setTeamData(null);
          const payloadCachedAt = (payload as EntriesResponse).cachedAt;
          if (payloadCachedAt) {
            setLastUpdateMeta({
              at: payloadCachedAt,
              dataSource: "db",
            });
          }
        }
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [member, date, mode, refreshTick]);

  useEffect(() => {
    if (!(mode === "team" || mode === "all" || mode === "member")) return;
    let active = true;
    const requestNonce = String(Date.now());
    const params = new URLSearchParams({ date, tzOffset: String(new Date().getTimezoneOffset()) });
    params.set("_req", requestNonce);

    fetch(`/api/team-week?${params.toString()}`, { cache: "no-store" })
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
  }, [mode, date, refreshTick]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRelativeNowMs(Date.now());
    }, 30 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const onTimerChanged = (
      event: Event
    ) => {
      const custom = event as CustomEvent<{
        memberName?: string;
        isRunning?: boolean;
        startAt?: string | null;
        durationSeconds?: number;
        description?: string | null;
        projectName?: string | null;
      }>;
      const detail = custom.detail;
      if (!detail?.memberName) return;
      const targetMember = detail.memberName.trim().toLowerCase();

      setTeamData((prev) => {
        if (!prev) return prev;
        const nextMembers = prev.members.map((memberData) => {
          if (memberData.name.trim().toLowerCase() !== targetMember) return memberData;
          if (detail.isRunning) {
            return {
              ...memberData,
              current: {
                id: Number(detail.durationSeconds ?? 0) + Date.now(),
                description: detail.description ?? memberData.current?.description ?? null,
                start: detail.startAt ?? new Date().toISOString(),
                stop: null,
                duration: -1,
                project_name: detail.projectName ?? memberData.current?.project_name ?? null,
              },
            };
          }
          return {
            ...memberData,
            current: null,
          };
        });
        return { ...prev, members: nextMembers };
      });

      if (!detail.isRunning) {
        setLastStoppedAtByMember((prev) => ({ ...prev, [targetMember]: Date.now() }));
      }
    };

    window.addEventListener("voho-timer-changed", onTimerChanged as EventListener);
    return () => {
      window.removeEventListener("voho-timer-changed", onTimerChanged as EventListener);
    };
  }, []);

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

  const dailyRankingBars = useMemo(() => {
    if (!teamData) return [] as Array<{ name: string; seconds: number }>;
    return [...teamData.members]
      .map((item) => ({
        name: item.name,
        seconds: Math.max(0, item.totalSeconds ?? 0),
      }))
      .sort((a, b) => {
        if (b.seconds !== a.seconds) return b.seconds - a.seconds;
        return a.name.localeCompare(b.name);
      });
  }, [teamData]);

  const teamTimeline = useMemo(() => {
    if (!teamData) return [] as Array<{ name: string; blocks: TimelineBlock[]; maxLanes: number }>;
    const allowed = new Set(selectedMembers);
    const orderedMembers = [...teamData.members]
      .filter((item) => allowed.has(item.name))
      .sort((a, b) => {
      const aIsYar = a.name.trim().toLowerCase() === "yar";
      const bIsYar = b.name.trim().toLowerCase() === "yar";
      if (aIsYar && !bIsYar) return -1;
      if (!aIsYar && bIsYar) return 1;
      return a.name.localeCompare(b.name);
      });
    return orderedMembers.map((memberData) => ({
      name: memberData.name,
      ...buildTimelineBlocks(memberData.entries, date),
    }));
  }, [teamData, date, selectedMembers]);

  const memberWeekSeries = useMemo(() => {
    if (!teamWeekData || !member) return [] as Array<{ date: string; seconds: number }>;
    const row = teamWeekData.members.find((item) => item.name.toLowerCase() === member.toLowerCase());
    if (!row) return [] as Array<{ date: string; seconds: number }>;
    return teamWeekData.weekDates.map((day) => ({
      date: day,
      seconds: row.days.find((d) => d.date === day)?.seconds ?? 0,
    }));
  }, [teamWeekData, member]);

  const memberWeekMaxSeconds = useMemo(
    () => memberWeekSeries.reduce((max, item) => Math.max(max, item.seconds), 0),
    [memberWeekSeries]
  );

  const nowLineOffsetPx = useMemo(() => {
    const [yearStr, monthStr, dayStr] = date.split("-");
    const selected = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
    const today = new Date();
    if (
      selected.getFullYear() !== today.getFullYear() ||
      selected.getMonth() !== today.getMonth() ||
      selected.getDate() !== today.getDate()
    ) {
      return null;
    }
    const minutesIntoDay = today.getHours() * 60 + today.getMinutes();
    return (minutesIntoDay / 60) * HOUR_HEIGHT;
  }, [date]);

  const openEntryModal = (entry: TimeEntry, memberName: string) => {
    setSelectedEntry({
      entryId: entry.id,
      memberName,
      description: entry.description?.trim() || "(No description)",
      project: entry.project_name?.trim() || "No project",
      start: entry.start,
      end: entry.stop,
      durationSeconds: getEntrySeconds(entry),
    });
    setEntryEditor({
      description: entry.description?.trim() || "",
      project: entry.project_name?.trim() || "",
      startTime: formatTimeInputLocal(entry.start),
      stopTime: formatTimeInputLocal(entry.stop),
      saving: false,
      error: null,
    });
  };

  const hideHoverTooltip = () => setHoverTooltip(null);

  const placeHoverTooltip = (event: ReactMouseEvent<HTMLElement>, text: string) => {
    const tooltipWidth = 300;
    const lineCount = text.split("\n").length;
    const tooltipHeight = 16 + lineCount * 18;
    const margin = 12;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = event.clientX + 14;
    let top = event.clientY + 14;
    if (left + tooltipWidth > viewportWidth - margin) {
      left = Math.max(margin, event.clientX - tooltipWidth - 14);
    }
    if (top + tooltipHeight > viewportHeight - margin) {
      top = Math.max(margin, viewportHeight - tooltipHeight - margin);
    }

    setHoverTooltip({ text, left, top });
  };

  useEffect(() => {
    if (nowLineOffsetPx == null) return;
    const target = Math.max(0, nowLineOffsetPx - 220);
    if (mode === "member" && dayCalendarScrollRef.current) {
      dayCalendarScrollRef.current.scrollTop = target;
    }
    if (mode === "all" && allCalendarsScrollRef.current) {
      allCalendarsScrollRef.current.scrollTop = target;
    }
  }, [mode, date, nowLineOffsetPx, timeline.blocks.length, teamTimeline.length]);

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
    if (!isSelfOnly) setMember(filter.member);
    setDate(filter.date);
    setMode(sanitizeMode("all"));
  };

  if (!hasMembers) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h2 className="text-lg font-semibold">No team members configured</h2>
        <p className="mt-2 text-sm">
          Add members in the Members section so reports can load from your database history.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!isSelfOnly ? (
          <div className="flex flex-wrap items-center gap-3">
            {allowAllCalendars && (
              <button
                type="button"
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                  mode === "all"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
                onClick={() => setMode("all")}
              >
                All calendars
              </button>
            )}
            {allowTeamOverview && (
              <button
                type="button"
                className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                  mode === "team"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600"
                }`}
                onClick={() => setMode("team")}
              >
                Team overview
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-700">Your calendar dashboard</p>
        )}
        <p className="text-xs text-slate-500">
          Last updated: {lastUpdateMeta ? `${formatDateTime(lastUpdateMeta.at)} (DB snapshot)` : "—"}
        </p>
      </div>
      {!isSelfOnly && mode !== "member" && (
        <p className="text-xs font-medium text-slate-600">
          Tip: Team member names are clickable and open their dedicated profile pages.
        </p>
      )}

      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/40 p-6 md:grid-cols-4">
        {mode === "member" && !isSelfOnly && (
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
        {(mode === "all" || mode === "team") && (
          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Daily ranking</span>
              <span className="text-xs text-slate-500">{date}</span>
            </div>
            {teamRanking.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No ranking data yet.</p>
            ) : (
            <div className="mt-3 flex h-32 items-end gap-2">
                {dailyRankingBars.slice(0, 8).map((row) => {
                  const maxSeconds = dailyRankingBars[0]?.seconds ?? 0;
                  const barHeight = maxSeconds > 0 ? Math.max(14, Math.round((row.seconds / maxSeconds) * 100)) : 14;
                  return (
                    <div key={row.name} className="flex min-w-[64px] flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-[#0BA5E9] to-[#67D0F8]"
                        style={{ height: `${barHeight}%` }}
                        title={`${row.name}: ${formatDuration(row.seconds)}`}
                      />
                      <p className="w-full truncate text-center text-[11px] font-semibold text-slate-700">{row.name}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {mode === "member" && (
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
            <span className="text-xs uppercase tracking-wide text-slate-500">Total logged</span>
            <span className="text-2xl font-semibold text-slate-900">
              {data ? formatDuration(data.totalSeconds) : "—"}
            </span>
          </div>
        )}
      </div>

      {mode === "member" && !isSelfOnly && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Saved filters
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {savedFilters.length === 0 && (
              <span className="text-sm text-slate-500">No saved filters yet.</span>
            )}
            {savedFilters.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1">
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
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
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
                <div ref={dayCalendarScrollRef} className="max-h-[72vh] overflow-auto">
                  <div className="grid min-w-[620px] grid-cols-[3.5rem_1fr] gap-2">
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
                      {nowLineOffsetPx != null && (
                        <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: `${nowLineOffsetPx}px` }}>
                          <div className="border-t-2 border-rose-500/90" />
                          <span className="absolute -top-2 right-2 rounded bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            Now
                          </span>
                        </div>
                      )}
                      {Array.from({ length: HOURS_IN_DAY + 1 }).map((_, hour) => (
                        <div
                          key={hour}
                          className="absolute left-0 right-0 border-t border-slate-200/90"
                          style={{ top: `${hour * HOUR_HEIGHT}px` }}
                        />
                      ))}

                      {timeline.blocks.map((block) => {
                        const sourceEntry = data.entries.find((entry) => `${entry.id}-${new Date(entry.start).getTime()}` === block.id);
                        const blockStyle = getProjectBlockStyle(block.project, block.projectColor);
                        return (
                        <button
                          key={block.id}
                          type="button"
                          className="absolute overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm"
                          style={{
                            top: `${block.topPx}px`,
                            height: `${block.heightPx}px`,
                            left: `calc(${(block.lane / timeline.maxLanes) * 100}% + 0.25rem)`,
                            width: `calc(${100 / timeline.maxLanes}% - 0.5rem)`,
                            ...blockStyle,
                          }}
                          title={sourceEntry ? getEntryTooltipText(sourceEntry, member) : undefined}
                          onMouseEnter={(event) => {
                            if (!sourceEntry) return;
                            placeHoverTooltip(event, getEntryTooltipText(sourceEntry, member));
                          }}
                          onMouseMove={(event) => {
                            if (!sourceEntry) return;
                            placeHoverTooltip(event, getEntryTooltipText(sourceEntry, member));
                          }}
                          onMouseLeave={hideHoverTooltip}
                          onClick={() => {
                            if (!sourceEntry) return;
                            openEntryModal(sourceEntry, member);
                          }}
                        >
                          <div className="overflow-hidden">
                            <p className="truncate text-xs font-semibold text-slate-900">{block.title}</p>
                          </div>
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
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Last 7 days</h3>
              <p className="mt-1 text-sm text-slate-500">Daily worked time for {member}.</p>
              {memberWeekSeries.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No weekly data yet.</p>
              ) : (
                <div className="mt-4">
                  <div className="flex h-44 items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    {memberWeekSeries.map((item) => {
                      const barHeight = memberWeekMaxSeconds > 0 ? Math.max(10, Math.round((item.seconds / memberWeekMaxSeconds) * 100)) : 10;
                      return (
                        <div key={item.date} className="flex w-full flex-col items-center gap-2">
                          <div
                            className="w-full rounded-t-md bg-gradient-to-t from-sky-600 to-cyan-400"
                            style={{ height: `${barHeight}%` }}
                            title={`${formatShortDateLabel(item.date)}: ${formatDuration(item.seconds)}`}
                          />
                          <p className="text-[11px] font-medium text-slate-600">{formatShortDateLabel(item.date)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

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
                Entries auto-refresh from your database when you change filters and every 15 minutes.
              </p>
            </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && (mode === "team" || mode === "all") && teamData && (
        <div className="space-y-4">
          {mode === "team" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                    <div className="flex h-56 items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      {teamRanking.map((row, index) => {
                        const topScore = teamRanking[0]?.rankedSeconds ?? 0;
                        const barHeight = topScore > 0 ? Math.max(16, Math.round((row.rankedSeconds / topScore) * 140)) : 16;
                        return (
                          <div key={row.name} className="flex w-[90px] flex-col items-center gap-2">
                            <p className="text-[11px] font-semibold text-slate-800">#{index + 1}</p>
                            <div
                              className="w-6 rounded-t-md bg-gradient-to-t from-sky-600 to-cyan-400"
                              style={{ height: `${barHeight}px` }}
                              title={`${row.name}: ${formatDuration(row.rankedSeconds)}`}
                            />
                            <Link
                              href={getMemberPageHref(row.name, date)}
                              className={`truncate text-center text-xs ${MEMBER_LINK_CLASS}`}
                            >
                              {row.name}
                            </Link>
                            <p className="text-center text-[11px] text-slate-600">{formatDuration(row.rankedSeconds)}</p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {teamRanking.map((row) => (
                        <p key={`${row.name}-meta`} className="text-xs text-slate-600">
                          <Link
                            href={getMemberPageHref(row.name, date)}
                            className={MEMBER_LINK_CLASS}
                          >
                            {row.name}
                          </Link>
                          : Start {formatTime(row.firstStart)} | End {formatTime(row.lastEnd)} | Longest break {formatDuration(row.longestBreakSeconds)} | {row.entryCount} entries
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "all" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Member task cards</h2>
              <p className="text-sm text-slate-500">
                Compact per-member task split for the selected day.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[...teamData.members]
                  .sort((a, b) => {
                    const aIsYar = a.name.trim().toLowerCase() === "yar";
                    const bIsYar = b.name.trim().toLowerCase() === "yar";
                    if (aIsYar && !bIsYar) return -1;
                    if (!aIsYar && bIsYar) return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((memberData) => {
                  const cardEntries = memberData.entries.filter((entry) => !isExcludedFromRanking(entry.project_name));
                  const running = memberData.current ?? cardEntries.find((entry) => entry.stop === null) ?? null;
                  const memberSummary = buildTaskProjectSummary(cardEntries).slice(0, 4);
                  const lastActivityMs = cardEntries.reduce((latest, entry) => {
                    const endMs = getEntryEndMs(entry);
                    if (Number.isNaN(endMs)) return latest;
                    return Math.max(latest, endMs);
                  }, Number.NEGATIVE_INFINITY);
                  const historicalLastActivityMs = memberData.lastActivityAt
                    ? new Date(memberData.lastActivityAt).getTime()
                    : Number.NEGATIVE_INFINITY;
                  const trackedStopMs = lastStoppedAtByMember[memberData.name.trim().toLowerCase()] ?? Number.NEGATIVE_INFINITY;
                  const displayLastActivityMs = Math.max(lastActivityMs, historicalLastActivityMs, trackedStopMs);
                  const cardTotalSeconds = cardEntries.reduce((total, entry) => total + getEntrySeconds(entry), 0);
                  const maxTaskSeconds = memberSummary[0]?.seconds ?? 0;
                  return (
                    <div key={memberData.name} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900">
                            <Link href={getMemberPageHref(memberData.name, date)} className={MEMBER_LINK_CLASS}>
                              {memberData.name}
                            </Link>
                          </h3>
                          <p className="text-sm text-slate-500">Total {formatDuration(cardTotalSeconds)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${
                              running ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {running ? "Running" : "Idle"}
                          </span>
                          {!running && (
                            <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                              Idle since {formatAgoFromMs(displayLastActivityMs, relativeNowMs)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 space-y-1">
                        {running ? (
                          <p className="text-xs text-emerald-700">
                            Now: {running.description?.trim() || "(No description)"} | Project: {running.project_name?.trim() || "No project"}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500">Now: no active timer</p>
                        )}
                      </div>
                      <div className="mt-3 space-y-2">
                        {memberSummary.length === 0 && (
                          <p className="text-sm text-slate-500">No entries yet.</p>
                        )}
                        {memberSummary.map((item) => {
                          const widthPercent =
                            maxTaskSeconds > 0 ? Math.max(10, Math.round((item.seconds / maxTaskSeconds) * 100)) : 10;
                          return (
                            <div
                              key={`${item.project}-${item.label}`}
                              title={getTaskSummaryTooltip(item)}
                              onMouseEnter={(event) => placeHoverTooltip(event, getTaskSummaryTooltip(item))}
                              onMouseMove={(event) => placeHoverTooltip(event, getTaskSummaryTooltip(item))}
                              onMouseLeave={hideHoverTooltip}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                                <span className="truncate text-slate-700">
                                  {item.label} | {item.project}
                                </span>
                                <span className="font-medium text-slate-900">{formatDuration(item.seconds)}</span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400"
                                  style={{ width: `${widthPercent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {mode === "team" && teamWeekData && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">
                Ranking by total worked time over the last seven days (from stored DB rollups).
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
                        <td className="px-2 py-2 text-slate-800">
                          <Link href={getMemberPageHref(row.name, date)} className={MEMBER_LINK_CLASS}>
                            {row.name}
                          </Link>
                        </td>
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
            <p className="text-sm text-slate-500">
              One shared daily timeline for everyone. Matching vertical positions indicate overlap.
            </p>
            <div className="mt-3 relative max-w-xs" ref={memberPickerRef}>
              <button
                type="button"
                onClick={() => setMemberPickerOpen((open) => !open)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900"
              >
                Visible calendars: {selectedMembers.length}
              </button>
              {memberPickerOpen && (
                <div className="absolute z-40 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <button
                      type="button"
                      className="text-xs font-semibold text-sky-700"
                      onClick={() => setSelectedMembers(members.map((item) => item.name))}
                    >
                      Select all
                    </button>
                    {restrictToMember && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-sky-700"
                        onClick={() => setSelectedMembers([restrictToMember])}
                      >
                        Only mine
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs font-semibold text-sky-700"
                      onClick={() => setSelectedMembers([])}
                    >
                      Clear
                    </button>
                  </div>
                  {members.map((item) => {
                    const checked = selectedMembers.includes(item.name);
                    return (
                      <label key={item.name} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedMembers((prev) =>
                              prev.includes(item.name) ? prev.filter((name) => name !== item.name) : [...prev, item.name]
                            )
                          }
                        />
                        <span className="text-sm text-slate-700">{item.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div ref={allCalendarsScrollRef} className="mt-4 max-h-[72vh] overflow-auto">
              <div className="grid min-w-[760px] grid-cols-[3.5rem_1fr] gap-2">
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
                  style={{ gridTemplateColumns: `repeat(${Math.max(1, teamTimeline.length)}, minmax(160px, 1fr))` }}
                >
                  {teamTimeline.map((memberTimeline) => (
                    <div key={memberTimeline.name} className="space-y-2">
                      <p className="sticky top-0 z-30 rounded-md bg-white/95 px-1 py-1 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur">
                        <Link href={getMemberPageHref(memberTimeline.name, date)} className={MEMBER_LINK_CLASS}>
                          {memberTimeline.name}
                        </Link>
                      </p>
                      <div
                        className="relative rounded-xl border border-slate-200 bg-slate-50"
                        style={{ height: `${HOURS_IN_DAY * HOUR_HEIGHT}px` }}
                      >
                        {nowLineOffsetPx != null && (
                          <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: `${nowLineOffsetPx}px` }}>
                            <div className="border-t-2 border-rose-500/90" />
                          </div>
                        )}
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
                          const blockStyle = getProjectBlockStyle(block.project, block.projectColor);
                          return (
                            <button
                              key={block.id}
                              type="button"
                              className="absolute overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm"
                              style={{
                                top: `${block.topPx}px`,
                                height: `${block.heightPx}px`,
                                left: `calc(${(block.lane / memberTimeline.maxLanes) * 100}% + 0.25rem)`,
                                width: `calc(${100 / memberTimeline.maxLanes}% - 0.5rem)`,
                                ...blockStyle,
                              }}
                              title={sourceEntry ? getEntryTooltipText(sourceEntry, memberTimeline.name) : undefined}
                              onMouseEnter={(event) => {
                                if (!sourceEntry) return;
                                placeHoverTooltip(event, getEntryTooltipText(sourceEntry, memberTimeline.name));
                              }}
                              onMouseMove={(event) => {
                                if (!sourceEntry) return;
                                placeHoverTooltip(event, getEntryTooltipText(sourceEntry, memberTimeline.name));
                              }}
                              onMouseLeave={hideHoverTooltip}
                              onClick={() => {
                                if (!sourceEntry) return;
                                openEntryModal(sourceEntry, memberTimeline.name);
                              }}
                            >
                              <div className="overflow-hidden">
                                <p className="truncate text-xs font-semibold text-slate-900">{block.title}</p>
                              </div>
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

        </div>
      )}

      {hoverTooltip && (
        <div
          className="pointer-events-none fixed z-[70] max-w-[300px] whitespace-pre-line rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-xl"
          style={{ left: `${hoverTooltip.left}px`, top: `${hoverTooltip.top}px` }}
        >
          {hoverTooltip.text}
        </div>
      )}

      {selectedEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={() => {
            setSelectedEntry(null);
            setEntryEditor(null);
          }}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-[#0BA5E9] hover:bg-sky-200"
                  title="Start new timer with this entry"
                  onClick={async () => {
                    if (!selectedEntry || !entryEditor) return;
                    const res = await fetch("/api/time-entries/start", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        member: selectedEntry.memberName,
                        description: entryEditor.description || selectedEntry.description,
                        project: entryEditor.project || selectedEntry.project,
                        tzOffset: new Date().getTimezoneOffset(),
                      }),
                    });
                    if (res.ok) {
                      setSelectedEntry(null);
                      setEntryEditor(null);
                      setRefreshTick((value) => value + 1);
                      window.dispatchEvent(
                        new CustomEvent("voho-timer-changed", {
                          detail: {
                            memberName: selectedEntry.memberName,
                            isRunning: true,
                            description: entryEditor.description || selectedEntry.description,
                            projectName: entryEditor.project || selectedEntry.project,
                          },
                        })
                      );
                    }
                  }}
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                  title="Duplicate values"
                  onClick={() => {
                    if (!entryEditor || !selectedEntry) return;
                    setEntryEditor({
                      ...entryEditor,
                      description: selectedEntry.description === "(No description)" ? "" : selectedEntry.description,
                      project: selectedEntry.project === "No project" ? "" : selectedEntry.project,
                    });
                  }}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                  title="Entry actions"
                >
                  ⋮
                </button>
              </div>
              <button
                type="button"
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600"
                onClick={() => {
                  setSelectedEntry(null);
                  setEntryEditor(null);
                }}
              >
                x
              </button>
            </div>
            {entryEditor && (
              <div className="mt-5 space-y-4">
                <input
                  type="text"
                  value={entryEditor.description}
                  onChange={(event) =>
                    setEntryEditor((prev) => (prev ? { ...prev, description: event.target.value, error: null } : prev))
                  }
                  placeholder="Description"
                  className="w-full rounded-lg border border-slate-300 px-4 py-3 text-2xl font-semibold"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="text"
                    value={entryEditor.project}
                    onChange={(event) =>
                      setEntryEditor((prev) => (prev ? { ...prev, project: event.target.value, error: null } : prev))
                    }
                    placeholder="Project"
                    className="min-w-[220px] rounded-full border border-amber-200 bg-amber-50 px-5 py-2 text-3xl font-medium text-amber-700"
                  />
                  <span className="text-2xl text-slate-400">🏷</span>
                  <span className="text-3xl text-slate-300">$</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="time"
                    value={entryEditor.startTime}
                    onChange={(event) =>
                      setEntryEditor((prev) => (prev ? { ...prev, startTime: event.target.value, error: null } : prev))
                    }
                    className="w-[180px] rounded-xl border border-slate-300 px-4 py-2 text-4xl font-medium text-center"
                  />
                  <span className="text-4xl text-slate-400">→</span>
                  <input
                    type="time"
                    value={entryEditor.stopTime}
                    onChange={(event) =>
                      setEntryEditor((prev) => (prev ? { ...prev, stopTime: event.target.value, error: null } : prev))
                    }
                    className="w-[180px] rounded-xl border border-slate-300 px-4 py-2 text-4xl font-medium text-center"
                  />
                  <span className="min-w-[120px] text-4xl font-medium tabular-nums text-slate-900">
                    {(() => {
                      const startIso = buildIsoFromDateAndTime(date, entryEditor.startTime);
                      const stopIso = buildIsoFromDateAndTime(date, entryEditor.stopTime);
                      if (!startIso || !stopIso) return formatTimerClock(selectedEntry.durationSeconds);
                      const seconds = Math.max(0, Math.floor((new Date(stopIso).getTime() - new Date(startIso).getTime()) / 1000));
                      return formatTimerClock(seconds);
                    })()}
                  </span>
                </div>
                {entryEditor.error && <p className="text-xs text-rose-600">{entryEditor.error}</p>}
                <button
                  type="button"
                  disabled={entryEditor.saving}
                  onClick={async () => {
                    if (!selectedEntry) return;
                    const startIso = buildIsoFromDateAndTime(date, entryEditor.startTime);
                    const stopIso = buildIsoFromDateAndTime(date, entryEditor.stopTime);
                    if (!startIso || !stopIso || new Date(stopIso).getTime() <= new Date(startIso).getTime()) {
                      setEntryEditor((prev) =>
                        prev ? { ...prev, error: "Choose a valid start and end time (end must be after start)." } : prev
                      );
                      return;
                    }
                    setEntryEditor((prev) => (prev ? { ...prev, saving: true, error: null } : prev));
                    try {
                      const res = await fetch("/api/time-entries/update", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          member: selectedEntry.memberName,
                          entryId: selectedEntry.entryId,
                          description: entryEditor.description,
                          project: entryEditor.project,
                          startAt: startIso,
                          stopAt: stopIso,
                          tzOffset: new Date().getTimezoneOffset(),
                        }),
                      });
                      const payload = (await res.json()) as { error?: string };
                      if (!res.ok || payload.error) {
                        setEntryEditor((prev) =>
                          prev ? { ...prev, saving: false, error: payload.error || "Failed to update entry." } : prev
                        );
                        return;
                      }
                      setSelectedEntry(null);
                      setEntryEditor(null);
                      setRefreshTick((value) => value + 1);
                      window.dispatchEvent(
                        new CustomEvent("voho-entries-changed", { detail: { memberName: selectedEntry.memberName } })
                      );
                    } catch {
                      setEntryEditor((prev) => (prev ? { ...prev, saving: false, error: "Failed to update entry." } : prev));
                    }
                  }}
                  className="w-[220px] rounded-xl bg-[#0BA5E9] px-6 py-3 text-3xl font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {entryEditor.saving ? "Saving..." : "Save changes"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
