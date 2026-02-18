"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { getProjectBaseColor, getProjectSurfaceColors } from "@/lib/projectColors";

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
  project_type?: "work" | "non_work";
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

type ProjectItem = { key: string; name: string; color?: string | null };
type ProjectsResponse = { projects: ProjectItem[]; error?: string };

type SavedFilter = {
  id: string;
  name: string;
  member: string;
  date: string;
};

const FILTERS_KEY = "voho-team-filters";
const LAST_KEY = "voho-team-last";
const HOURS_IN_DAY = 24;
const HOUR_HEIGHT = 88;
const MIN_BLOCK_HEIGHT = 24;
const DRAG_SNAP_MINUTES = 5;
const CLICK_CREATE_DEFAULT_MINUTES = 60;
const CLICK_CREATE_MIN_MINUTES = 5;
const CLICK_CREATE_MAX_MINUTES = 120;
const TEAM_LIVE_SYNC_MS = 1500;
const RANKING_ENTRY_CAP_SECONDS = 4 * 60 * 60;
const EXCLUDED_PROJECT_NAME = "non-work-task";
const ALL_CALENDAR_MEMBER_HEADER_HEIGHT = 34;
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getEntrySeconds(entry: TimeEntry, nowMs = Date.now()): number {
  if (entry.duration >= 0) return entry.duration;
  const startedAt = new Date(entry.start).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
}

function getEntryEndMs(entry: TimeEntry, nowMs = Date.now()): number {
  if (entry.stop) {
    const stoppedAt = new Date(entry.stop).getTime();
    if (!Number.isNaN(stoppedAt)) return stoppedAt;
  }
  const startedAt = new Date(entry.start).getTime();
  if (Number.isNaN(startedAt)) return Number.NaN;
  if (entry.duration >= 0) return startedAt + entry.duration * 1000;
  return nowMs;
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
  if (hour === 24) return "12 AM";
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function getHourLabelPositionStyle(hour: number): CSSProperties {
  if (hour <= 0) {
    return { top: "0px" };
  }
  if (hour >= HOURS_IN_DAY) {
    return { top: `${HOURS_IN_DAY * HOUR_HEIGHT}px`, transform: "translateY(-100%)" };
  }
  return { top: `${hour * HOUR_HEIGHT}px`, transform: "translateY(-50%)" };
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

type DragMode = "move" | "resize-start" | "resize-end";

type BlockDragState = {
  mode: DragMode;
  memberName: string;
  entry: TimeEntry;
  startClientY: number;
  initialTopPx: number;
  initialHeightPx: number;
  previewTopPx: number;
  previewHeightPx: number;
  hasMoved: boolean;
};

function snapMinutes(value: number) {
  return Math.round(value / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
}

function minuteToIso(dateInput: string, minuteOfDay: number) {
  const clamped = Math.max(0, Math.min(24 * 60, minuteOfDay));
  if (clamped === 24 * 60) {
    const next = new Date(`${dateInput}T00:00:00`);
    next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  const hour = Math.floor(clamped / 60);
  const minute = Math.floor(clamped % 60);
  return new Date(
    `${dateInput}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`
  ).toISOString();
}

function buildTimelineBlocks(entries: TimeEntry[], dateInput: string, nowMs = Date.now()) {
  const { start, end } = getDayBoundsMs(dateInput);
  const pxPerMs = HOUR_HEIGHT / (60 * 60 * 1000);
  const minDurationMs = MIN_BLOCK_HEIGHT / pxPerMs;
  const dayHeightPx = HOURS_IN_DAY * HOUR_HEIGHT;
  const sorted = [...entries].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  const blocks: TimelineBlock[] = [];

  for (const entry of sorted) {
    const startMs = new Date(entry.start).getTime();
    const endMs = getEntryEndMs(entry, nowMs);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;

    const visibleStart = Math.max(startMs, start);
    const visibleEnd = Math.min(endMs, end);
    if (visibleEnd <= visibleStart) continue;
    const displayEnd = Math.min(end, Math.max(visibleEnd, visibleStart + minDurationMs));
    const idealTopPx = (visibleStart - start) * pxPerMs;
    const rawHeightPx = (displayEnd - visibleStart) * pxPerMs;
    const topPx = Math.max(0, Math.min(dayHeightPx - MIN_BLOCK_HEIGHT, idealTopPx));
    const heightPx = Math.max(MIN_BLOCK_HEIGHT, Math.min(rawHeightPx, dayHeightPx - topPx));

    blocks.push({
      id: `${entry.id}-${startMs}`,
      lane: 0,
      topPx,
      heightPx,
      title: entry.description?.trim() || "(No description)",
      project: entry.project_name?.trim() || "No project",
      projectColor: entry.project_color?.trim() || null,
      timeRange: `${formatTime(entry.start)} → ${formatTime(entry.stop)}`,
      durationLabel: formatDuration(getEntrySeconds(entry, nowMs)),
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

function isExcludedFromRanking(projectType: string | null | undefined, projectName: string | null | undefined) {
  if ((projectType ?? "").toLowerCase() === "non_work") return true;
  return (projectName ?? "").trim().toLowerCase() === EXCLUDED_PROJECT_NAME;
}

function buildTeamRanking(members: TeamMemberData[]): TeamRankingRow[] {
  const rows = members.map((member) => {
    const closedRanges = member.entries
      .filter((entry) => !isExcludedFromRanking(entry.project_type, entry.project_name))
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

const MEMBER_CHART_PALETTE = [
  "#0EA5E9",
  "#22C55E",
  "#F97316",
  "#A855F7",
  "#14B8A6",
  "#E11D48",
  "#F59E0B",
  "#6366F1",
  "#10B981",
  "#EC4899",
  "#3B82F6",
  "#84CC16",
] as const;

function buildMemberColorMap(memberNames: string[]) {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(memberNames.map((name) => name.trim()).filter((name) => name.length > 0)));
  unique.forEach((name, index) => {
    if (index < MEMBER_CHART_PALETTE.length) {
      map.set(name, MEMBER_CHART_PALETTE[index]);
      return;
    }
    const overflow = index - MEMBER_CHART_PALETTE.length;
    const hue = (overflow * 47) % 360;
    map.set(name, `hsl(${hue} 72% 50%)`);
  });
  return map;
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
  const [teamMonthData, setTeamMonthData] = useState<TeamWeekResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"member" | "team" | "all">("all");
  const [allCalendarView, setAllCalendarView] = useState<"calendar" | "list" | "timesheet">("calendar");
  const [selectedEntry, setSelectedEntry] = useState<EntryModalData | null>(null);
  const [entryEditor, setEntryEditor] = useState<{
    description: string;
    project: string;
    startTime: string;
    stopTime: string;
    saving: boolean;
    deleting: boolean;
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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [modalProjectPickerOpen, setModalProjectPickerOpen] = useState(false);
  const [modalProjectSearch, setModalProjectSearch] = useState("");
  const [rankingView, setRankingView] = useState<"daily" | "weekly" | "monthly">("daily");
  const [selectedAnomalyMember, setSelectedAnomalyMember] = useState<string | null>(null);
  const [blockDrag, setBlockDrag] = useState<BlockDragState | null>(null);
  const dayCalendarScrollRef = useRef<HTMLDivElement | null>(null);
  const allCalendarsScrollRef = useRef<HTMLDivElement | null>(null);
  const memberPickerRef = useRef<HTMLDivElement | null>(null);
  const allCalendarsDatePickerRef = useRef<HTMLInputElement | null>(null);
  const modalProjectPickerRef = useRef<HTMLDivElement | null>(null);
  const suppressBlockClickUntilRef = useRef(0);
  const autoScrolledKeyRef = useRef<string | null>(null);

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
    if (!modalProjectPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!modalProjectPickerRef.current) return;
      if (modalProjectPickerRef.current.contains(event.target as Node)) return;
      setModalProjectPickerOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalProjectPickerOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onEscape);
    };
  }, [modalProjectPickerOpen]);

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
    let active = true;
    fetch(`/api/projects?_req=${Date.now()}`, { cache: "no-store" })
      .then(async (res) => {
        const payload = (await res.json()) as ProjectsResponse;
        if (!res.ok || payload.error) throw new Error(payload.error || "Failed to load projects");
        return payload.projects ?? [];
      })
      .then((rows) => {
        if (!active) return;
        setProjects(rows);
      })
      .catch(() => {
        if (!active) return;
        setProjects([]);
      });
    return () => {
      active = false;
    };
  }, []);

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

    fetch(`/api/team-month?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const payload = (await res.json()) as TeamWeekResponse;
        if (!res.ok || payload.error) {
          throw new Error(payload.error || "Failed to load 30-day summary");
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setTeamMonthData(payload);
      })
      .catch(() => {
        if (!active) return;
        // keep previous monthly snapshot if fetch fails
      });

    return () => {
      active = false;
    };
  }, [mode, date, refreshTick]);

  useEffect(() => {
    if (!(mode === "team" || mode === "all")) return;
    let active = true;

    const loadTeamLive = async () => {
      try {
        const params = new URLSearchParams({
          date,
          tzOffset: String(new Date().getTimezoneOffset()),
          _req: String(Date.now()),
        });
        const res = await fetch(`/api/team?${params.toString()}`, { cache: "no-store" });
        const payload = (await res.json()) as TeamResponse;
        if (!res.ok || payload.error || !active) return;
        setTeamData(payload);
        if (payload.cachedAt) {
          setLastUpdateMeta({
            at: payload.cachedAt,
            dataSource: "db",
          });
        }
      } catch {
        // Silent: keep existing state when background live fetch fails.
      }
    };

    void loadTeamLive();

    const interval = window.setInterval(() => {
      void loadTeamLive();
    }, TEAM_LIVE_SYNC_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [mode, date]);

  const openAllCalendarsDatePicker = () => {
    const input = allCalendarsDatePickerRef.current;
    if (!input) return;
    if ("showPicker" in input && typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.focus();
    input.click();
  };

  const startBlockDrag = (
    event: ReactMouseEvent<HTMLElement>,
    mode: DragMode,
    sourceEntry: TimeEntry,
    memberName: string
  ) => {
    if (event.button !== 0) return;
    if (sourceEntry.stop === null) return;
    event.preventDefault();
    event.stopPropagation();
    const dayBounds = getDayBoundsMs(date);
    const startMs = new Date(sourceEntry.start).getTime();
    const endMs = getEntryEndMs(sourceEntry);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return;

    const entryStartMinute = Math.max(0, (startMs - dayBounds.start) / (60 * 1000));
    const entryEndMinute = Math.min(24 * 60, (endMs - dayBounds.start) / (60 * 1000));
    const initialTopPx = (entryStartMinute / 60) * HOUR_HEIGHT;
    const initialHeightPx = Math.max(MIN_BLOCK_HEIGHT, ((entryEndMinute - entryStartMinute) / 60) * HOUR_HEIGHT);

    setBlockDrag({
      mode,
      memberName,
      entry: sourceEntry,
      startClientY: event.clientY,
      initialTopPx,
      initialHeightPx,
      previewTopPx: initialTopPx,
      previewHeightPx: initialHeightPx,
      hasMoved: false,
    });
  };

  useEffect(() => {
    if (!blockDrag) return;

    const handleMove = (event: MouseEvent) => {
      const deltaPx = event.clientY - blockDrag.startClientY;
      const deltaMinutes = snapMinutes((deltaPx / HOUR_HEIGHT) * 60);
      if (Math.abs(deltaPx) >= 3 && !blockDrag.hasMoved) {
        setBlockDrag((prev) => (prev ? { ...prev, hasMoved: true } : prev));
      }

      setBlockDrag((prev) => {
        if (!prev) return prev;
        if (prev.mode === "move") {
          const rawTop = prev.initialTopPx + (deltaMinutes / 60) * HOUR_HEIGHT;
          const maxTop = HOURS_IN_DAY * HOUR_HEIGHT - prev.initialHeightPx;
          const nextTop = Math.max(0, Math.min(maxTop, rawTop));
          return { ...prev, previewTopPx: nextTop, previewHeightPx: prev.initialHeightPx };
        }
        if (prev.mode === "resize-start") {
          const endPx = prev.initialTopPx + prev.initialHeightPx;
          const rawTop = prev.initialTopPx + (deltaMinutes / 60) * HOUR_HEIGHT;
          const maxTop = endPx - MIN_BLOCK_HEIGHT;
          const nextTop = Math.max(0, Math.min(maxTop, rawTop));
          const nextHeight = Math.max(MIN_BLOCK_HEIGHT, endPx - nextTop);
          return { ...prev, previewTopPx: nextTop, previewHeightPx: nextHeight };
        }
        const rawHeight = prev.initialHeightPx + (deltaMinutes / 60) * HOUR_HEIGHT;
        const maxHeight = HOURS_IN_DAY * HOUR_HEIGHT - prev.initialTopPx;
        const nextHeight = Math.max(MIN_BLOCK_HEIGHT, Math.min(maxHeight, rawHeight));
        return { ...prev, previewTopPx: prev.initialTopPx, previewHeightPx: nextHeight };
      });
    };

    const handleUp = async () => {
      const finalDrag = blockDrag;
      setBlockDrag(null);
      if (!finalDrag) return;
      if (!finalDrag.hasMoved) {
        openEntryModal(finalDrag.entry, finalDrag.memberName);
        return;
      }
      suppressBlockClickUntilRef.current = Date.now() + 250;

      const nextStartMinute = Math.max(0, Math.round((finalDrag.previewTopPx / HOUR_HEIGHT) * 60));
      const nextDurationMinutes = Math.max(
        Math.ceil((MIN_BLOCK_HEIGHT / HOUR_HEIGHT) * 60),
        Math.round((finalDrag.previewHeightPx / HOUR_HEIGHT) * 60)
      );
      const nextEndMinute = Math.min(24 * 60, nextStartMinute + nextDurationMinutes);
      const startAt = minuteToIso(date, nextStartMinute);
      const stopAt = minuteToIso(date, nextEndMinute);

      try {
        const res = await fetch("/api/time-entries/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member: finalDrag.memberName,
            entryId: finalDrag.entry.id,
            description: finalDrag.entry.description ?? "",
            project: finalDrag.entry.project_name ?? "",
            startAt,
            stopAt,
            tzOffset: new Date().getTimezoneOffset(),
          }),
        });
        const payload = (await res.json()) as { error?: string };
        if (!res.ok || payload.error) throw new Error(payload.error || "Failed to update entry");
        setRefreshTick((value) => value + 1);
        window.dispatchEvent(
          new CustomEvent("voho-entries-changed", { detail: { memberName: finalDrag.memberName } })
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update entry");
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [blockDrag, date]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setRelativeNowMs(Date.now());
    }, 1000);
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
      const optimisticStart = detail.startAt ?? new Date().toISOString();
      const optimisticId = -Math.max(1, Math.floor(new Date(optimisticStart).getTime() / 1000));

      setTeamData((prev) => {
        if (!prev) return prev;
        const nextMembers = prev.members.map((memberData) => {
          if (memberData.name.trim().toLowerCase() !== targetMember) return memberData;
          if (detail.isRunning) {
            const optimisticRunningEntry: TimeEntry = {
              id: optimisticId,
              description: detail.description ?? null,
              start: optimisticStart,
              stop: null,
              duration: -1,
              project_name: detail.projectName ?? null,
              project_color: null,
              project_type: "work",
              tags: [],
            };
            const nextEntries = [
              ...memberData.entries.filter((entry) => entry.stop !== null),
              optimisticRunningEntry,
            ].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
            return {
              ...memberData,
              entries: nextEntries,
              current: {
                id: optimisticRunningEntry.id,
                description: optimisticRunningEntry.description,
                start: optimisticRunningEntry.start,
                stop: null,
                duration: -1,
                project_name: optimisticRunningEntry.project_name,
                project_color: optimisticRunningEntry.project_color,
                project_type: optimisticRunningEntry.project_type,
              },
            };
          }
          const withoutRunning = memberData.entries.filter((entry) => entry.stop !== null);
          return {
            ...memberData,
            entries: withoutRunning,
            current: null,
          };
        });
        return { ...prev, members: nextMembers };
      });

      setData((prev) => {
        if (!prev) return prev;
        if (member.trim().toLowerCase() !== targetMember) return prev;
        if (detail.isRunning) {
          const optimisticRunningEntry: TimeEntry = {
            id: optimisticId,
            description: detail.description ?? null,
            start: optimisticStart,
            stop: null,
            duration: -1,
            project_name: detail.projectName ?? null,
            project_color: null,
            project_type: "work",
            tags: [],
          };
          return {
            ...prev,
            entries: [...prev.entries.filter((entry) => entry.stop !== null), optimisticRunningEntry].sort(
              (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
            ),
            current: optimisticRunningEntry,
          };
        }
        return {
          ...prev,
          entries: prev.entries.filter((entry) => entry.stop !== null),
          current: null,
        };
      });

      if (!detail.isRunning) {
        setLastStoppedAtByMember((prev) => ({ ...prev, [targetMember]: Date.now() }));
      }
    };

    window.addEventListener("voho-timer-changed", onTimerChanged as EventListener);
    return () => {
      window.removeEventListener("voho-timer-changed", onTimerChanged as EventListener);
    };
  }, [member]);

  useEffect(() => {
    const onEntriesChanged = (event: Event) => {
      const custom = event as CustomEvent<{ memberName?: string }>;
      const changedMemberName = custom.detail?.memberName?.trim();
      if (!changedMemberName) {
        setRefreshTick((value) => value + 1);
        return;
      }

      const requestParams = new URLSearchParams({
        member: changedMemberName,
        date,
        tzOffset: String(new Date().getTimezoneOffset()),
        _req: String(Date.now()),
      });

      fetch(`/api/entries?${requestParams.toString()}`, { cache: "no-store" })
        .then(async (res) => {
          const payload = (await res.json()) as EntriesResponse;
          if (!res.ok || payload.error) throw new Error(payload.error || "Failed to refresh member entries");
          return payload;
        })
        .then((payload) => {
          const changedLower = changedMemberName.toLowerCase();

          setTeamData((prev) => {
            if (!prev) return prev;
            const nextMembers = prev.members.map((memberData) => {
              if (memberData.name.trim().toLowerCase() !== changedLower) return memberData;
              const latestEndMs = payload.entries.reduce((latest, entry) => {
                const endMs = getEntryEndMs(entry);
                if (Number.isNaN(endMs)) return latest;
                return Math.max(latest, endMs);
              }, Number.NEGATIVE_INFINITY);
              return {
                ...memberData,
                entries: payload.entries,
                current: payload.current,
                totalSeconds: payload.totalSeconds,
                lastActivityAt: Number.isFinite(latestEndMs) ? new Date(latestEndMs).toISOString() : memberData.lastActivityAt,
              };
            });
            return { ...prev, members: nextMembers };
          });

          setData((prev) => {
            if (!prev) return prev;
            if (member.trim().toLowerCase() !== changedLower) return prev;
            return payload;
          });
        })
        .catch(() => {
          // Fallback to full refresh when targeted patch fails.
          setRefreshTick((value) => value + 1);
        });
    };
    window.addEventListener("voho-entries-changed", onEntriesChanged as EventListener);
    return () => {
      window.removeEventListener("voho-entries-changed", onEntriesChanged as EventListener);
    };
  }, [date, member]);

  useEffect(() => {
    const onTeamHoursChanged = () => {
      setRefreshTick((value) => value + 1);
    };
    window.addEventListener("voho-team-hours-changed", onTeamHoursChanged as EventListener);
    return () => {
      window.removeEventListener("voho-team-hours-changed", onTeamHoursChanged as EventListener);
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
  const selectedMembersLower = useMemo(
    () => new Set(selectedMembers.map((name) => name.trim().toLowerCase())),
    [selectedMembers]
  );
  const memberColorMap = useMemo(
    () => buildMemberColorMap([...members.map((item) => item.name)].sort((a, b) => a.localeCompare(b))),
    [members]
  );

  const summary = useMemo(() => {
    if (!data) return [] as { label: string; seconds: number }[];
    return buildSummary(
      data.entries.map((entry) => ({
        ...entry,
        duration: entry.duration >= 0 ? entry.duration : getEntrySeconds(entry, relativeNowMs),
      }))
    );
  }, [data, relativeNowMs]);

  const timeline = useMemo(() => {
    if (!data) return { blocks: [] as TimelineBlock[], maxLanes: 1 };
    return buildTimelineBlocks(data.entries, date, relativeNowMs);
  }, [data, date, relativeNowMs]);

  const teamRanking = useMemo(() => {
    if (!teamData) return [] as TeamRankingRow[];
    return buildTeamRanking(teamData.members);
  }, [teamData]);

  const dailyRankingSeries = useMemo(() => {
    if (!teamData) return [] as Array<{ name: string; seconds: number; isRunning: boolean }>;
    return teamData.members
      .filter((memberData) => {
        if (selectedMembersLower.size === 0) return true;
        return selectedMembersLower.has(memberData.name.trim().toLowerCase());
      })
      .map((memberData) => {
        const cardEntries = memberData.entries.filter((entry) => !isExcludedFromRanking(entry.project_type, entry.project_name));
        const cardTotalSeconds = cardEntries.reduce((sum, entry) => sum + getEntrySeconds(entry, relativeNowMs), 0);
        const isRunning = Boolean(memberData.current ?? cardEntries.find((entry) => entry.stop === null));
        return {
          name: memberData.name,
          seconds: cardTotalSeconds,
          isRunning,
        };
      })
      .sort((a, b) => {
        if (b.seconds !== a.seconds) return b.seconds - a.seconds;
        return a.name.localeCompare(b.name);
      });
  }, [teamData, selectedMembersLower, relativeNowMs]);

  const dailyRankingMaxHours = useMemo(() => {
    const maxSeconds = dailyRankingSeries.reduce((max, row) => Math.max(max, row.seconds), 0);
    const maxHours = maxSeconds / 3600;
    return Math.max(1, Math.ceil(maxHours));
  }, [dailyRankingSeries]);
  const dailyRankingAxisTicks = useMemo(() => {
    return [4, 3, 2, 1, 0].map((step) => ({
      step,
      value: Math.round((dailyRankingMaxHours * step) / 4),
    }));
  }, [dailyRankingMaxHours]);
  const weeklyRankingSeries = useMemo(() => {
    if (!teamWeekData) return [] as Array<{ name: string; seconds: number; isRunning: boolean }>;
    const runningMemberSet = new Set(
      (teamData?.members ?? [])
        .filter((memberData) => Boolean(memberData.current ?? memberData.entries.find((entry) => entry.stop === null)))
        .map((memberData) => memberData.name.trim().toLowerCase())
    );
    return teamWeekData.members
      .filter((row) => {
        if (selectedMembersLower.size === 0) return true;
        return selectedMembersLower.has(row.name.trim().toLowerCase());
      })
      .map((row) => ({
        name: row.name,
        seconds: row.totalSeconds,
        isRunning: runningMemberSet.has(row.name.trim().toLowerCase()),
      }))
      .sort((a, b) => {
        if (b.seconds !== a.seconds) return b.seconds - a.seconds;
        return a.name.localeCompare(b.name);
      });
  }, [teamWeekData, teamData, selectedMembersLower]);

  const weeklyRankingMaxHours = useMemo(() => {
    const maxSeconds = weeklyRankingSeries.reduce((max, row) => Math.max(max, row.seconds), 0);
    const maxHours = maxSeconds / 3600;
    return Math.max(1, Math.ceil(maxHours));
  }, [weeklyRankingSeries]);

  const weeklyRankingAxisTicks = useMemo(() => {
    return [4, 3, 2, 1, 0].map((step) => ({
      step,
      value: Math.round((weeklyRankingMaxHours * step) / 4),
    }));
  }, [weeklyRankingMaxHours]);
  const monthlyRankingSeries = useMemo(() => {
    if (!teamMonthData) return [] as Array<{ name: string; seconds: number; isRunning: boolean }>;
    const runningMemberSet = new Set(
      (teamData?.members ?? [])
        .filter((memberData) => Boolean(memberData.current ?? memberData.entries.find((entry) => entry.stop === null)))
        .map((memberData) => memberData.name.trim().toLowerCase())
    );
    return teamMonthData.members
      .filter((row) => {
        if (selectedMembersLower.size === 0) return true;
        return selectedMembersLower.has(row.name.trim().toLowerCase());
      })
      .map((row) => ({
        name: row.name,
        seconds: row.totalSeconds,
        isRunning: runningMemberSet.has(row.name.trim().toLowerCase()),
      }))
      .sort((a, b) => {
        if (b.seconds !== a.seconds) return b.seconds - a.seconds;
        return a.name.localeCompare(b.name);
      });
  }, [teamMonthData, teamData, selectedMembersLower]);

  const monthlyRankingMaxHours = useMemo(() => {
    const maxSeconds = monthlyRankingSeries.reduce((max, row) => Math.max(max, row.seconds), 0);
    const maxHours = maxSeconds / 3600;
    return Math.max(1, Math.ceil(maxHours));
  }, [monthlyRankingSeries]);

  const monthlyRankingAxisTicks = useMemo(() => {
    return [4, 3, 2, 1, 0].map((step) => ({
      step,
      value: Math.round((monthlyRankingMaxHours * step) / 4),
    }));
  }, [monthlyRankingMaxHours]);
  const rankingMemberTabs = useMemo(() => {
    if (!teamData) return [] as string[];
    return [...teamData.members]
      .filter((memberData) => {
        if (selectedMembersLower.size === 0) return true;
        return selectedMembersLower.has(memberData.name.trim().toLowerCase());
      })
      .map((memberData) => memberData.name)
      .sort((a, b) => {
        const aIsYar = a.trim().toLowerCase() === "yar";
        const bIsYar = b.trim().toLowerCase() === "yar";
        if (aIsYar && !bIsYar) return -1;
        if (!aIsYar && bIsYar) return 1;
        return a.localeCompare(b);
      });
  }, [teamData, selectedMembersLower]);

  useEffect(() => {
    if (rankingMemberTabs.length === 0) {
      setSelectedAnomalyMember(null);
      return;
    }
    setSelectedAnomalyMember((previous) => {
      if (previous && rankingMemberTabs.includes(previous)) return previous;
      return null;
    });
  }, [rankingMemberTabs]);

  const filteredDailyRankingSeries = useMemo(() => {
    if (!selectedAnomalyMember) return dailyRankingSeries;
    return dailyRankingSeries.filter((row) => row.name === selectedAnomalyMember);
  }, [dailyRankingSeries, selectedAnomalyMember]);

  const filteredWeeklyRankingSeries = useMemo(() => {
    if (!selectedAnomalyMember) return weeklyRankingSeries;
    return weeklyRankingSeries.filter((row) => row.name === selectedAnomalyMember);
  }, [weeklyRankingSeries, selectedAnomalyMember]);

  const filteredMonthlyRankingSeries = useMemo(() => {
    if (!selectedAnomalyMember) return monthlyRankingSeries;
    return monthlyRankingSeries.filter((row) => row.name === selectedAnomalyMember);
  }, [monthlyRankingSeries, selectedAnomalyMember]);

  const activeRankingSeries = useMemo(() => {
    if (rankingView === "daily") return filteredDailyRankingSeries;
    if (rankingView === "weekly") return filteredWeeklyRankingSeries;
    return filteredMonthlyRankingSeries;
  }, [rankingView, filteredDailyRankingSeries, filteredWeeklyRankingSeries, filteredMonthlyRankingSeries]);

  const activeRankingMaxHours = useMemo(() => {
    const maxSeconds = activeRankingSeries.reduce((max, row) => Math.max(max, row.seconds), 0);
    return Math.max(1, Math.ceil(maxSeconds / 3600));
  }, [activeRankingSeries]);

  const activeRankingAxisTicks = useMemo(() => {
    return [4, 3, 2, 1, 0].map((step) => ({
      step,
      value: Math.round((activeRankingMaxHours * step) / 4),
    }));
  }, [activeRankingMaxHours]);
  const anomalyMembers = useMemo(() => {
    if (!teamWeekData) return [] as Array<{ name: string; days: Array<{ date: string; seconds: number; entryCount: number }> }>;
    return teamWeekData.members
      .filter((member) => {
        if (selectedMembersLower.size === 0) return true;
        return selectedMembersLower.has(member.name.trim().toLowerCase());
      })
      .sort((a, b) => {
        const aIsYar = a.name.trim().toLowerCase() === "yar";
        const bIsYar = b.name.trim().toLowerCase() === "yar";
        if (aIsYar && !bIsYar) return -1;
        if (!aIsYar && bIsYar) return 1;
        return a.name.localeCompare(b.name);
      })
      .map((member) => ({ name: member.name, days: member.days }));
  }, [teamWeekData, selectedMembersLower]);

  const anomalyMember = useMemo(
    () => anomalyMembers.find((member) => member.name === selectedAnomalyMember) ?? null,
    [anomalyMembers, selectedAnomalyMember]
  );

  const anomalyMaxHours = useMemo(() => {
    if (!anomalyMember) return 1;
    const maxSeconds = anomalyMember.days.reduce((innerMax, day) => Math.max(innerMax, day.seconds), 0);
    return Math.max(1, Math.ceil(maxSeconds / 3600));
  }, [anomalyMember]);

  const anomalyAxisTicks = useMemo(() => {
    return [4, 3, 2, 1, 0].map((step) => ({
      step,
      value: Math.round((anomalyMaxHours * step) / 4),
    }));
  }, [anomalyMaxHours]);
  const anomalyMemberColors = useMemo(() => {
    const map = new Map<string, string>();
    anomalyMembers.forEach((member) => {
      map.set(member.name, memberColorMap.get(member.name) ?? "#64748b");
    });
    return map;
  }, [anomalyMembers, memberColorMap]);
  const anomalyBarWidthPx = useMemo(() => {
    return 42;
  }, []);

  const teamTimeline = useMemo(() => {
    if (!teamData) return [] as Array<{ name: string; blocks: TimelineBlock[]; maxLanes: number }>;
    const orderedMembers = [...teamData.members]
      .filter((item) => {
        if (selectedMembersLower.size === 0) return true;
        return selectedMembersLower.has(item.name.trim().toLowerCase());
      })
      .sort((a, b) => {
      const aIsYar = a.name.trim().toLowerCase() === "yar";
      const bIsYar = b.name.trim().toLowerCase() === "yar";
      if (aIsYar && !bIsYar) return -1;
      if (!aIsYar && bIsYar) return 1;
      return a.name.localeCompare(b.name);
      });
    return orderedMembers.map((memberData) => ({
      name: memberData.name,
      ...buildTimelineBlocks(memberData.entries, date, relativeNowMs),
    }));
  }, [teamData, date, selectedMembersLower, relativeNowMs]);

  const visibleTeamEntries = useMemo(() => {
    if (!teamData) return [] as Array<{ memberName: string; entry: TimeEntry }>;
    const rows: Array<{ memberName: string; entry: TimeEntry }> = [];
    for (const memberData of teamData.members) {
      if (selectedMembersLower.size > 0 && !selectedMembersLower.has(memberData.name.trim().toLowerCase())) continue;
      for (const entry of memberData.entries) {
        rows.push({ memberName: memberData.name, entry });
      }
    }
    return rows.sort((a, b) => new Date(a.entry.start).getTime() - new Date(b.entry.start).getTime());
  }, [teamData, selectedMembersLower]);

  const visibleTeamTotals = useMemo(() => {
    if (!teamData) return [] as Array<{ memberName: string; seconds: number; entries: number }>;
    const rows = teamData.members
      .filter((memberData) => {
        if (selectedMembersLower.size === 0) return true;
        return selectedMembersLower.has(memberData.name.trim().toLowerCase());
      })
      .map((memberData) => ({
        memberName: memberData.name,
        seconds: memberData.entries.reduce((sum, entry) => sum + getEntrySeconds(entry, relativeNowMs), 0),
        entries: memberData.entries.length,
      }));
    return rows.sort((a, b) => b.seconds - a.seconds);
  }, [teamData, selectedMembersLower, relativeNowMs]);

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
    const today = new Date(relativeNowMs);
    if (
      selected.getFullYear() !== today.getFullYear() ||
      selected.getMonth() !== today.getMonth() ||
      selected.getDate() !== today.getDate()
    ) {
      return null;
    }
    const minutesIntoDay = today.getHours() * 60 + today.getMinutes() + today.getSeconds() / 60;
    return (minutesIntoDay / 60) * HOUR_HEIGHT;
  }, [date, relativeNowMs]);

  const selectedDayHeadline = useMemo(() => {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }, [date]);
  const selectedDayDate = useMemo(() => {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, [date]);
  const selectedDayNumber = selectedDayDate ? String(selectedDayDate.getDate()) : "--";
  const selectedDayWeekday = selectedDayDate
    ? selectedDayDate.toLocaleDateString([], { weekday: "long" }).toUpperCase()
    : "DAY";

  const liveClockLabel = useMemo(
    () => new Date(relativeNowMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [relativeNowMs]
  );
  const allModeWeekTotalSeconds = useMemo(() => {
    if (!teamWeekData) return 0;
    return teamWeekData.members.reduce((sum, row) => {
      if (selectedMembersLower.size > 0 && !selectedMembersLower.has(row.name.trim().toLowerCase())) return sum;
      return sum + row.totalSeconds;
    }, 0);
  }, [teamWeekData, selectedMembersLower]);

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
      deleting: false,
      error: null,
    });
    setModalProjectPickerOpen(false);
    setModalProjectSearch("");
  };

  const hideHoverTooltip = () => setHoverTooltip(null);

  const createEntryAtCalendarPosition = async (
    memberName: string,
    clientY: number,
    containerEl: HTMLElement
  ) => {
    const bounds = containerEl.getBoundingClientRect();
    const relativeY = Math.max(0, Math.min(bounds.height, clientY - bounds.top));
    const clickedMinute = Math.max(0, Math.min(24 * 60 - 1, snapMinutes((relativeY / HOUR_HEIGHT) * 60)));
    const remainingMinutes = Math.max(1, 24 * 60 - clickedMinute);
    const durationMinutes = Math.min(
      CLICK_CREATE_MAX_MINUTES,
      Math.max(CLICK_CREATE_MIN_MINUTES, Math.min(CLICK_CREATE_DEFAULT_MINUTES, remainingMinutes))
    );

    try {
      const res = await fetch("/api/time-entries/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member: memberName,
          description: "",
          project: "",
          startAt: minuteToIso(date, clickedMinute),
          durationMinutes,
          tzOffset: new Date().getTimezoneOffset(),
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok || payload.error) throw new Error(payload.error || "Failed to create time slot");
      window.dispatchEvent(new CustomEvent("voho-entries-changed", { detail: { memberName } }));
      window.dispatchEvent(new CustomEvent("voho-team-hours-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create time slot");
    }
  };

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
    const key = `${mode}:${date}`;
    if (autoScrolledKeyRef.current === key) return;
    autoScrolledKeyRef.current = key;
    const target = Math.max(0, nowLineOffsetPx - 220);
    if (mode === "member" && dayCalendarScrollRef.current) {
      dayCalendarScrollRef.current.scrollTop = target;
    }
    if (mode === "all" && allCalendarsScrollRef.current) {
      allCalendarsScrollRef.current.scrollTop = target;
    }
  }, [mode, date, nowLineOffsetPx]);

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

  const filteredModalProjects = useMemo(() => {
    const query = modalProjectSearch.trim().toLowerCase();
    const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
    if (!query) return sorted;
    return sorted.filter((project) => project.name.toLowerCase().includes(query));
  }, [projects, modalProjectSearch]);

  const modalSelectedProjectColor = useMemo(() => {
    const normalized = entryEditor?.project.trim().toLowerCase() ?? "";
    if (!normalized) return null;
    const found = projects.find((project) => project.name.trim().toLowerCase() === normalized);
    return found?.color ?? null;
  }, [entryEditor?.project, projects]);

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
          <div className="relative w-full" ref={memberPickerRef}>
            <label className="text-sm font-medium text-slate-600">Visible members</label>
            <button
              type="button"
              onClick={() => setMemberPickerOpen((open) => !open)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900"
            >
              {selectedMembers.length === 0 ? "None selected" : `Visible members: ${selectedMembers.length}`}
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
        )}
        {(mode === "all" || mode === "team") && (
          <div className="md:col-span-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setRankingView("daily")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    rankingView === "daily" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  Daily
                </button>
                <button
                  type="button"
                  onClick={() => setRankingView("weekly")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    rankingView === "weekly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  Weekly
                </button>
                <button
                  type="button"
                  onClick={() => setRankingView("monthly")}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    rankingView === "monthly" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedAnomalyMember(null)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    selectedAnomalyMember === null ? "bg-sky-100 text-sky-800 shadow-sm" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  All
                </button>
                {rankingMemberTabs.map((memberName) => (
                  <button
                    key={`ranking-member-tab-${memberName}`}
                    type="button"
                    onClick={() => setSelectedAnomalyMember(memberName)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                      selectedAnomalyMember === memberName
                        ? "bg-sky-100 text-sky-800 shadow-sm"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {memberName}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-500">
                {rankingView === "daily"
                  ? date
                  : rankingView === "weekly"
                  ? teamWeekData
                    ? `${teamWeekData.startDate} → ${teamWeekData.endDate}`
                    : "Last 7 days"
                  : teamMonthData
                  ? `${teamMonthData.startDate} → ${teamMonthData.endDate}`
                  : "Last 30 days"}
              </span>
            </div>
            {(rankingView === "daily"
              ? filteredDailyRankingSeries.length === 0
              : rankingView === "weekly"
              ? filteredWeeklyRankingSeries.length === 0
              : filteredMonthlyRankingSeries.length === 0) ? (
              <p className="mt-3 text-sm text-slate-500">
                No {rankingView} data yet.
              </p>
            ) : (
              <div className="mt-3 grid grid-cols-[3.2rem_1fr] gap-2">
                <div className="relative h-40">
                  {activeRankingAxisTicks.map((tick) => (
                    <div
                      key={`${rankingView}-${tick.step}`}
                      className="absolute right-0 text-[10px] font-medium text-slate-500"
                      style={{ top: `${(4 - tick.step) * 25}%`, transform: "translateY(-50%)" }}
                    >
                      {tick.value}h
                    </div>
                  ))}
                </div>
                <div className="relative h-40 rounded-lg border border-slate-200 bg-slate-50 px-2 pt-2">
                  {[0, 1, 2, 3, 4].map((step) => (
                    <div
                      key={`${rankingView}-grid-${step}`}
                      className="absolute left-0 right-0 border-t border-slate-200"
                      style={{ top: `${step * 25}%` }}
                    />
                  ))}
                  <div className="relative z-10 flex h-full items-end gap-2">
                    {activeRankingSeries.map((row) => {
                      const hours = row.seconds / 3600;
                      const heightPercent = Math.max(6, (hours / activeRankingMaxHours) * 100);
                      const label =
                        rankingView === "daily"
                          ? "Total hours worked"
                          : rankingView === "weekly"
                          ? "Total hours worked this week"
                          : "Total hours worked this month";
                      return (
                        <div key={`${rankingView}-${row.name}`} className="flex h-full min-w-[56px] flex-1 flex-col items-center justify-end gap-1">
                          <div
                            className={`w-full rounded-t-md ${
                              row.isRunning
                                ? "bg-gradient-to-t from-emerald-500 to-emerald-300"
                                : "bg-gradient-to-t from-[#0BA5E9] to-[#67D0F8]"
                            }`}
                            style={{ height: `${heightPercent}%` }}
                            title={`${row.name} • ${label}: ${formatDuration(row.seconds)}${row.isRunning ? " • Running now" : ""}`}
                            onMouseEnter={(event) =>
                              placeHoverTooltip(
                                event,
                                `${row.name}\n${label}: ${formatDuration(row.seconds)}${row.isRunning ? "\nStatus: Running" : ""}`
                              )
                            }
                            onMouseMove={(event) =>
                              placeHoverTooltip(
                                event,
                                `${row.name}\n${label}: ${formatDuration(row.seconds)}${row.isRunning ? "\nStatus: Running" : ""}`
                              )
                            }
                            onMouseLeave={hideHoverTooltip}
                          />
                          <p className="w-full truncate text-center text-[11px] font-semibold text-slate-700">{row.name}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                          style={getHourLabelPositionStyle(hour)}
                        >
                          {formatHourLabel(hour)}
                        </div>
                      ))}
                    </div>

                    <div
                      className="relative rounded-xl border border-slate-200 bg-slate-50"
                      style={{ height: `${HOURS_IN_DAY * HOUR_HEIGHT}px` }}
                      onClick={(event) => {
                        if (event.target !== event.currentTarget) return;
                        void createEntryAtCalendarPosition(member, event.clientY, event.currentTarget);
                      }}
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
                          className="pointer-events-none absolute left-0 right-0 border-t border-slate-200/90"
                          style={{ top: `${hour * HOUR_HEIGHT}px` }}
                        />
                      ))}

                      {timeline.blocks.map((block) => {
                        const sourceEntry = data.entries.find((entry) => `${entry.id}-${new Date(entry.start).getTime()}` === block.id);
                        const blockStyle = getProjectBlockStyle(block.project, block.projectColor);
                        const isDraggingThis =
                          !!sourceEntry &&
                          blockDrag?.entry.id === sourceEntry.id &&
                          blockDrag.memberName.toLowerCase() === member.toLowerCase();
                        const topPx = isDraggingThis ? blockDrag.previewTopPx : block.topPx;
                        const heightPx = isDraggingThis ? blockDrag.previewHeightPx : block.heightPx;
                        return (
                        <div
                          key={block.id}
                          role="button"
                          tabIndex={0}
                          className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm ${
                            sourceEntry?.stop === null ? "cursor-default" : "cursor-move"
                          } ${isDraggingThis ? "ring-2 ring-sky-300" : ""}`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            left: `calc(${(block.lane / timeline.maxLanes) * 100}% + 0.25rem)`,
                            width: `calc(${100 / timeline.maxLanes}% - 0.5rem)`,
                            ...blockStyle,
                          }}
                          title={sourceEntry ? getEntryTooltipText(sourceEntry, member) : undefined}
                          onKeyDown={(event) => {
                            if (!sourceEntry) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openEntryModal(sourceEntry, member);
                            }
                          }}
                          onMouseEnter={(event) => {
                            if (!sourceEntry) return;
                            placeHoverTooltip(event, getEntryTooltipText(sourceEntry, member));
                          }}
                          onMouseMove={(event) => {
                            if (!sourceEntry) return;
                            placeHoverTooltip(event, getEntryTooltipText(sourceEntry, member));
                          }}
                          onMouseLeave={hideHoverTooltip}
                          onMouseDown={(event) => {
                            if (!sourceEntry) return;
                            startBlockDrag(event, "move", sourceEntry, member);
                          }}
                          onClick={() => {
                            if (Date.now() < suppressBlockClickUntilRef.current) return;
                            if (!sourceEntry) return;
                            openEntryModal(sourceEntry, member);
                          }}
                        >
                          {sourceEntry?.stop !== null && (
                            <div
                              className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
                              onMouseDown={(event) => {
                                if (!sourceEntry) return;
                                startBlockDrag(event, "resize-start", sourceEntry, member);
                              }}
                            />
                          )}
                          <div className="overflow-hidden">
                            <p className="truncate text-xs font-semibold text-slate-900">{block.title}</p>
                          </div>
                          {sourceEntry?.stop !== null && (
                            <div
                              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                              onMouseDown={(event) => {
                                if (!sourceEntry) return;
                                startBlockDrag(event, "resize-end", sourceEntry, member);
                              }}
                            />
                          )}
                        </div>
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
          {mode === "all" && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Member task cards</h2>
              <p className="text-sm text-slate-500">
                Compact per-member task split for the selected day.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[...teamData.members]
                  .filter((memberData) => {
                    if (selectedMembersLower.size === 0) return true;
                    return selectedMembersLower.has(memberData.name.trim().toLowerCase());
                  })
                  .sort((a, b) => {
                    const aIsYar = a.name.trim().toLowerCase() === "yar";
                    const bIsYar = b.name.trim().toLowerCase() === "yar";
                    if (aIsYar && !bIsYar) return -1;
                    if (!aIsYar && bIsYar) return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((memberData) => {
                  const cardEntries = memberData.entries.filter((entry) => !isExcludedFromRanking(entry.project_type, entry.project_name));
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
                    {teamWeekData.members
                      .filter((row) => {
                        if (selectedMembersLower.size === 0) return true;
                        return selectedMembersLower.has(row.name.trim().toLowerCase());
                      })
                      .map((row, index) => (
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDate(formatDateInput(new Date()))}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Today
              </button>
              <button
                type="button"
                onClick={openAllCalendarsDatePicker}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                title="Choose date"
              >
                {formatShortDateLabel(date)}
              </button>
              <input
                ref={allCalendarsDatePickerRef}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              </div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-700">
                  Week total <span className="text-slate-900">{formatDuration(allModeWeekTotalSeconds)}</span>
                </p>
                <button
                  type="button"
                  className="rounded-xl border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-white"
                >
                  Day view ▾
                </button>
              <div className="inline-flex rounded-xl border border-slate-300 bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setAllCalendarView("calendar")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    allCalendarView === "calendar" ? "bg-sky-100 text-sky-800" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Calendar
                </button>
                <button
                  type="button"
                  onClick={() => setAllCalendarView("list")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    allCalendarView === "list" ? "bg-sky-100 text-sky-800" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  List view
                </button>
                <button
                  type="button"
                  onClick={() => setAllCalendarView("timesheet")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    allCalendarView === "timesheet" ? "bg-sky-100 text-sky-800" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Timesheet
                </button>
              </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[3.5rem_1fr] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Activity</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-100 text-2xl font-semibold text-fuchsia-500">
                    {selectedDayNumber}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-fuchsia-500">{selectedDayWeekday}</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">{liveClockLabel}</p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-700">{selectedDayHeadline}</p>
              </div>
            </div>
            {allCalendarView === "calendar" && (
            <div className="mt-4">
            <div ref={allCalendarsScrollRef} className="max-h-[72vh] overflow-auto">
              <div className="grid min-w-[760px] grid-cols-[3.5rem_1fr] gap-2">
                <div className="space-y-2">
                  <div aria-hidden style={{ height: `${ALL_CALENDAR_MEMBER_HEADER_HEIGHT}px` }} />
                  <div className="relative" style={{ height: `${HOURS_IN_DAY * HOUR_HEIGHT}px` }}>
                    {Array.from({ length: HOURS_IN_DAY + 1 }).map((_, hour) => (
                      <div
                        key={hour}
                        className="absolute right-0 pr-2 text-[11px] font-medium text-slate-400"
                        style={getHourLabelPositionStyle(hour)}
                      >
                        {formatHourLabel(hour)}
                      </div>
                    ))}
                  </div>
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
                        onClick={(event) => {
                          if (event.target !== event.currentTarget) return;
                          void createEntryAtCalendarPosition(memberTimeline.name, event.clientY, event.currentTarget);
                        }}
                      >
                        {nowLineOffsetPx != null && (
                          <div className="pointer-events-none absolute left-0 right-0 z-20" style={{ top: `${nowLineOffsetPx}px` }}>
                            <div className="border-t-2 border-rose-500/90" />
                            <span className="absolute -left-2 -top-[9px] inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] leading-none text-white">
                              ▶
                            </span>
                          </div>
                        )}
                        {Array.from({ length: HOURS_IN_DAY * 4 + 1 }).map((_, quarter) => {
                          if (quarter % 4 === 0) return null;
                          return (
                            <div
                              key={`quarter-${quarter}`}
                              className="pointer-events-none absolute left-0 right-0 border-t border-slate-200/55"
                              style={{ top: `${(quarter * HOUR_HEIGHT) / 4}px` }}
                            />
                          );
                        })}
                        {Array.from({ length: HOURS_IN_DAY + 1 }).map((_, hour) => (
                          <div
                            key={hour}
                            className="pointer-events-none absolute left-0 right-0 border-t border-slate-200/90"
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
                          const isDraggingThis =
                            !!sourceEntry &&
                            blockDrag?.entry.id === sourceEntry.id &&
                            blockDrag.memberName.toLowerCase() === memberTimeline.name.toLowerCase();
                          const topPx = isDraggingThis ? blockDrag.previewTopPx : block.topPx;
                          const heightPx = isDraggingThis ? blockDrag.previewHeightPx : block.heightPx;
                          return (
                            <div
                              key={block.id}
                              role="button"
                              tabIndex={0}
                              className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left shadow-sm ${
                                sourceEntry?.stop === null ? "cursor-default" : "cursor-move"
                              } ${isDraggingThis ? "ring-2 ring-sky-300" : ""}`}
                              style={{
                                top: `${topPx}px`,
                                height: `${heightPx}px`,
                                left: `calc(${(block.lane / memberTimeline.maxLanes) * 100}% + 0.25rem)`,
                                width: `calc(${100 / memberTimeline.maxLanes}% - 0.5rem)`,
                                ...blockStyle,
                              }}
                              title={sourceEntry ? getEntryTooltipText(sourceEntry, memberTimeline.name) : undefined}
                              onKeyDown={(event) => {
                                if (!sourceEntry) return;
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openEntryModal(sourceEntry, memberTimeline.name);
                                }
                              }}
                              onMouseEnter={(event) => {
                                if (!sourceEntry) return;
                                placeHoverTooltip(event, getEntryTooltipText(sourceEntry, memberTimeline.name));
                              }}
                              onMouseMove={(event) => {
                                if (!sourceEntry) return;
                                placeHoverTooltip(event, getEntryTooltipText(sourceEntry, memberTimeline.name));
                              }}
                              onMouseLeave={hideHoverTooltip}
                              onMouseDown={(event) => {
                                if (!sourceEntry) return;
                                startBlockDrag(event, "move", sourceEntry, memberTimeline.name);
                              }}
                              onClick={() => {
                                if (Date.now() < suppressBlockClickUntilRef.current) return;
                                if (!sourceEntry) return;
                                openEntryModal(sourceEntry, memberTimeline.name);
                              }}
                            >
                              {sourceEntry?.stop !== null && (
                                <div
                                  className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
                                  onMouseDown={(event) => {
                                    if (!sourceEntry) return;
                                    startBlockDrag(event, "resize-start", sourceEntry, memberTimeline.name);
                                  }}
                                />
                              )}
                              <div className="overflow-hidden">
                                <p className="truncate text-xs font-semibold text-slate-900">{block.title}</p>
                              </div>
                              {sourceEntry?.stop !== null && (
                                <div
                                  className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                                  onMouseDown={(event) => {
                                    if (!sourceEntry) return;
                                    startBlockDrag(event, "resize-end", sourceEntry, memberTimeline.name);
                                  }}
                                />
                              )}
                            </div>
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
            {allCalendarView === "list" && (
              <div className="mt-4 max-h-[72vh] overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="px-3 py-2 font-semibold">Member</th>
                      <th className="px-3 py-2 font-semibold">Description</th>
                      <th className="px-3 py-2 font-semibold">Project</th>
                      <th className="px-3 py-2 font-semibold">Time</th>
                      <th className="px-3 py-2 font-semibold">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTeamEntries.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-slate-500">
                          No entries for selected calendars.
                        </td>
                      </tr>
                    )}
                    {visibleTeamEntries.map(({ memberName, entry }) => (
                      <tr key={`${memberName}-${entry.id}-${entry.start}`} className="border-b border-slate-100">
                        <td className="px-3 py-2 text-slate-800">{memberName}</td>
                        <td className="px-3 py-2 text-slate-800">{entry.description?.trim() || "(No description)"}</td>
                        <td className="px-3 py-2 text-slate-700">{entry.project_name?.trim() || "No project"}</td>
                        <td className="px-3 py-2 text-slate-700">
                          {formatTime(entry.start)} - {formatTime(entry.stop)}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900">{formatDuration(getEntrySeconds(entry))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {allCalendarView === "timesheet" && (
              <div className="mt-4 max-h-[72vh] overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200 text-left text-slate-600">
                      <th className="px-3 py-2 font-semibold">Member</th>
                      <th className="px-3 py-2 font-semibold">Entries</th>
                      <th className="px-3 py-2 font-semibold">Total time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTeamTotals.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-slate-500">
                          No data for selected calendars.
                        </td>
                      </tr>
                    )}
                    {visibleTeamTotals.map((row) => (
                      <tr key={row.memberName} className="border-b border-slate-100">
                        <td className="px-3 py-2 text-slate-800">{row.memberName}</td>
                        <td className="px-3 py-2 text-slate-700">{row.entries}</td>
                        <td className="px-3 py-2 font-semibold text-slate-900">{formatDuration(row.seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-100 text-[#0BA5E9] hover:bg-sky-200"
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
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
              <div className="mt-4 space-y-3">
                <input
                  type="text"
                  value={entryEditor.description}
                  onChange={(event) =>
                    setEntryEditor((prev) => (prev ? { ...prev, description: event.target.value, error: null } : prev))
                  }
                  placeholder="Description"
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-xl font-semibold"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative" ref={modalProjectPickerRef}>
                    <button
                      type="button"
                      onClick={() => setModalProjectPickerOpen((open) => !open)}
                      className="inline-flex min-w-[220px] items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-left text-xl font-medium text-amber-700"
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-700" fill="currentColor" aria-hidden="true">
                        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l1.5 1.5h8.5A2.5 2.5 0 0 1 21 9v9.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z" />
                      </svg>
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: getProjectBaseColor(entryEditor.project || "No project", modalSelectedProjectColor) }}
                      />
                      <span className="max-w-[160px] truncate">{entryEditor.project || "No project"}</span>
                    </button>
                    {modalProjectPickerOpen && (
                      <div className="absolute left-0 z-50 mt-2 w-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.24)]">
                        <div className="border-b border-slate-100 p-3">
                          <input
                            type="text"
                            value={modalProjectSearch}
                            onChange={(event) => setModalProjectSearch(event.target.value)}
                            placeholder="Search by project"
                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none"
                            autoFocus
                          />
                        </div>
                        <div className="max-h-[280px] overflow-y-auto p-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEntryEditor((prev) => (prev ? { ...prev, project: "", error: null } : prev));
                              setModalProjectPickerOpen(false);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" fill="currentColor" aria-hidden="true">
                              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l1.5 1.5h8.5A2.5 2.5 0 0 1 21 9v9.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z" />
                            </svg>
                            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                            <span className="text-sm font-medium text-slate-700">No project</span>
                          </button>
                          {filteredModalProjects.map((project) => (
                            <button
                              key={project.key}
                              type="button"
                              onClick={() => {
                                setEntryEditor((prev) => (prev ? { ...prev, project: project.name, error: null } : prev));
                                setModalProjectPickerOpen(false);
                              }}
                              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-600" fill="currentColor" aria-hidden="true">
                                <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l1.5 1.5h8.5A2.5 2.5 0 0 1 21 9v9.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z" />
                              </svg>
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: getProjectBaseColor(project.name, project.color) }}
                              />
                              <span className="truncate text-sm font-semibold text-slate-800">{project.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <span className="text-xl text-slate-400">🏷</span>
                  <span className="text-2xl text-slate-300">$</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="time"
                    value={entryEditor.startTime}
                    onChange={(event) =>
                      setEntryEditor((prev) => (prev ? { ...prev, startTime: event.target.value, error: null } : prev))
                    }
                    className="w-[150px] rounded-xl border border-slate-300 px-3 py-2 text-2xl font-medium text-center"
                  />
                  <span className="text-2xl text-slate-400">→</span>
                  <input
                    type="time"
                    value={entryEditor.stopTime}
                    onChange={(event) =>
                      setEntryEditor((prev) => (prev ? { ...prev, stopTime: event.target.value, error: null } : prev))
                    }
                    className="w-[150px] rounded-xl border border-slate-300 px-3 py-2 text-2xl font-medium text-center"
                  />
                  <span className="min-w-[96px] text-2xl font-medium tabular-nums text-slate-900">
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={entryEditor.saving || entryEditor.deleting}
                    onClick={async () => {
                      if (!selectedEntry) return;
                      const shouldDelete = window.confirm("Delete this time entry?");
                      if (!shouldDelete) return;
                      setEntryEditor((prev) => (prev ? { ...prev, deleting: true, error: null } : prev));
                      try {
                        const res = await fetch("/api/time-entries/delete", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            member: selectedEntry.memberName,
                            entryId: selectedEntry.entryId,
                          }),
                        });
                        const payload = (await res.json()) as { error?: string; wasRunning?: boolean };
                        if (!res.ok || payload.error) {
                          setEntryEditor((prev) =>
                            prev ? { ...prev, deleting: false, error: payload.error || "Failed to delete entry." } : prev
                          );
                          return;
                        }
                        setSelectedEntry(null);
                        setEntryEditor(null);
                        setRefreshTick((value) => value + 1);
                        window.dispatchEvent(
                          new CustomEvent("voho-entries-changed", { detail: { memberName: selectedEntry.memberName } })
                        );
                        if (payload.wasRunning) {
                          window.dispatchEvent(
                            new CustomEvent("voho-timer-changed", {
                              detail: { memberName: selectedEntry.memberName, isRunning: false },
                            })
                          );
                        }
                      } catch {
                        setEntryEditor((prev) => (prev ? { ...prev, deleting: false, error: "Failed to delete entry." } : prev));
                      }
                    }}
                    className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    aria-label={entryEditor.deleting ? "Deleting entry" : "Delete entry"}
                  >
                    <span className="inline-flex items-center gap-2">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M3 6h18" strokeLinecap="round" />
                        <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                        <path d="M6 6l1 14a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 6" />
                        <path d="M10 11v6M14 11v6" strokeLinecap="round" />
                      </svg>
                      <span>{entryEditor.deleting ? "Deleting..." : "Delete"}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={entryEditor.saving || entryEditor.deleting}
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
                    className="w-[180px] rounded-xl bg-[#0BA5E9] px-4 py-2.5 text-xl font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {entryEditor.saving ? "Saving..." : "Save changes"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
