"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getProjectBaseColor, getProjectSurfaceColors } from "@/lib/projectColors";

type TimeEntry = {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  project_name?: string | null;
  project_color?: string | null;
};

type EntriesResponse = {
  entries: TimeEntry[];
  totalSeconds: number;
  warning?: string | null;
  error?: string;
};

type CurrentTimerResponse = {
  current: {
    id: number;
    description: string | null;
    projectName: string | null;
    startAt: string;
    durationSeconds: number;
  } | null;
  error?: string;
};

type WeekTotalResponse = {
  totalSeconds: number;
  error?: string;
};

type ProjectItem = { key: string; name: string; color?: string | null };
type ProjectsResponse = { projects: ProjectItem[]; error?: string };
type TeamResponse = {
  date: string;
  members: Array<{ name: string; totalSeconds: number; entries?: TimeEntry[] }>;
  source?: "db";
  warning?: string | null;
  error?: string;
};

type CalendarDraft = { hour: number; minute: number };
type EntryEditorState = {
  entryId: number;
  description: string;
  project: string;
  startTime: string;
  stopTime: string;
  saving: boolean;
  error: string | null;
};

const CALENDAR_HOUR_HEIGHT = 56;
const MIN_ENTRY_MINUTES = 15;
const DRAG_SNAP_MINUTES = 5;
const ZOOM_LEVELS = [48, 56, 68, 80, 96, 112] as const;

function formatLocalDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDateInput(dateInput: string, deltaDays: number): string {
  const [year, month, day] = dateInput.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return formatLocalDateInput(new Date());
  }
  const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + deltaDays);
  return utc.toISOString().slice(0, 10);
}

function formatDurationShort(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return "--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTimeInputLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function buildIsoFromDateAndTime(dateInput: string, timeInput: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(timeInput)) return null;
  const [hour, minute] = timeInput.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return new Date(`${dateInput}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`).toISOString();
}

function buildLocalDateTimeIso(dateInput: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateInput}T${hh}:${mm}:00`).toISOString();
}

function startOfWeekMonday(dateInput: string): Date {
  const date = new Date(`${dateInput}T00:00:00`);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  return date;
}

function buildWeekDays(dateInput: string) {
  const start = startOfWeekMonday(dateInput);
  return Array.from({ length: 7 }, (_, idx) => {
    const d = new Date(start);
    d.setDate(start.getDate() + idx);
    const value = formatLocalDateInput(d);
    return {
      value,
      short: d.toLocaleDateString([], { weekday: "short" }),
      label: d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }),
    };
  });
}

function buildCalendarBlock(entry: TimeEntry, dayStartMs: number, hourHeight: number, nowMs: number) {
  const startMs = new Date(entry.start).getTime();
  if (Number.isNaN(startMs)) return null;
  const stopMs = entry.stop ? new Date(entry.stop).getTime() : nowMs;
  const safeStopMs = Number.isNaN(stopMs) ? startMs + Math.max(0, entry.duration) * 1000 : stopMs;
  const minutesFromStart = (startMs - dayStartMs) / (60 * 1000);
  const durationMinutes = Math.max(MIN_ENTRY_MINUTES, (safeStopMs - startMs) / (60 * 1000));
  return {
    id: `${entry.id}-${startMs}`,
    entryId: entry.id,
    top: (minutesFromStart / 60) * hourHeight,
    height: (durationMinutes / 60) * hourHeight,
    description: entry.description?.trim() || "(No description)",
    project: entry.project_name?.trim() || "No project",
    projectColor: entry.project_color?.trim() || null,
    timeRange: `${formatClock(entry.start)} - ${formatClock(entry.stop)}`,
    startIso: entry.start,
    stopIso: entry.stop,
    durationSeconds: Math.max(0, entry.duration),
    startMinute: minutesFromStart,
    endMinute: minutesFromStart + durationMinutes,
    descriptionRaw: entry.description ?? "",
    projectRaw: entry.project_name ?? "",
    isRunning: entry.stop === null,
  };
}

type CalendarBlock = NonNullable<ReturnType<typeof buildCalendarBlock>>;
type DragMode = "move" | "resize-start" | "resize-end";
type BlockDragState = {
  mode: DragMode;
  block: CalendarBlock & { column: number; laneCount: number; groupId: number };
  startClientY: number;
  initialTop: number;
  initialHeight: number;
  previewTop: number;
  previewHeight: number;
  hasMoved: boolean;
};

function layoutCalendarBlocks(blocks: CalendarBlock[]) {
  const sorted = [...blocks].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const laidOut: Array<CalendarBlock & { column: number; laneCount: number; groupId: number }> = [];

  let active: Array<{ endMinute: number; column: number; index: number }> = [];
  let currentGroupId = -1;
  const groupMaxColumns = new Map<number, number>();

  for (const block of sorted) {
    active = active.filter((item) => item.endMinute > block.startMinute);

    if (active.length === 0) {
      currentGroupId += 1;
    }

    const usedColumns = new Set(active.map((item) => item.column));
    let column = 0;
    while (usedColumns.has(column)) column += 1;

    const index = laidOut.length;
    laidOut.push({ ...block, column, laneCount: 1, groupId: currentGroupId });
    active.push({ endMinute: block.endMinute, column, index });

    const maxColumnForGroup = groupMaxColumns.get(currentGroupId) ?? 0;
    groupMaxColumns.set(currentGroupId, Math.max(maxColumnForGroup, column + 1));
  }

  for (const block of laidOut) {
    block.laneCount = groupMaxColumns.get(block.groupId) ?? 1;
  }

  return laidOut;
}

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
  return buildLocalDateTimeIso(dateInput, hour, minute);
}

function getPastelProjectStyle(project: string, projectColor: string | null | undefined): CSSProperties {
  return getProjectSurfaceColors(project, projectColor);
}

function getProjectColorForName(projects: ProjectItem[], projectName: string): string | null {
  const normalized = projectName.trim().toLowerCase();
  if (!normalized) return null;
  const match = projects.find((project) => project.name.trim().toLowerCase() === normalized);
  return match?.color ?? null;
}

export default function TrackPageClient({ memberName }: { memberName: string }) {
  const [date, setDate] = useState(formatLocalDateInput(new Date()));
  const [refreshTick, setRefreshTick] = useState(0);
  const [entries, setEntries] = useState<EntriesResponse | null>(null);
  const [currentTimer, setCurrentTimer] = useState<CurrentTimerResponse["current"]>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [weekTotalSeconds, setWeekTotalSeconds] = useState(0);
  const [dailyRanking, setDailyRanking] = useState<Array<{ name: string; seconds: number }>>([]);
  const [teamHoursWarning, setTeamHoursWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  const [modalProjectPickerOpen, setModalProjectPickerOpen] = useState(false);
  const [modalProjectSearch, setModalProjectSearch] = useState("");
  const [zoomLevel, setZoomLevel] = useState(ZOOM_LEVELS.length - 2);
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [draftDurationMinutes, setDraftDurationMinutes] = useState("60");
  const [entryEditor, setEntryEditor] = useState<EntryEditorState | null>(null);
  const [blockDrag, setBlockDrag] = useState<BlockDragState | null>(null);
  const modalProjectPickerRef = useRef<HTMLDivElement | null>(null);
  const calendarScrollRef = useRef<HTMLDivElement | null>(null);
  const suppressBlockClickUntilRef = useRef(0);
  const hourHeight = ZOOM_LEVELS[zoomLevel];

  function openEntryEditor(block: CalendarBlock) {
    setEntryEditor({
      entryId: block.entryId,
      description: block.description === "(No description)" ? "" : block.description,
      project: block.project === "No project" ? "" : block.project,
      startTime: formatTimeInputLocal(block.startIso),
      // Running entries have null stop; default to current local time so user can quickly save correction.
      stopTime: formatTimeInputLocal(block.stopIso ?? new Date().toISOString()),
      saving: false,
      error: null,
    });
  }

  useEffect(() => {
    if (!entryEditor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEntryEditor(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entryEditor]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    if (!blockDrag) return;

    const handleMove = (event: MouseEvent) => {
      const deltaPx = event.clientY - blockDrag.startClientY;
      const deltaMinutes = snapMinutes((deltaPx / hourHeight) * 60);

      if (Math.abs(deltaPx) >= 3 && !blockDrag.hasMoved) {
        setBlockDrag((prev) => (prev ? { ...prev, hasMoved: true } : prev));
      }

      setBlockDrag((prev) => {
        if (!prev) return prev;

        if (prev.mode === "move") {
          const durationPx = prev.initialHeight;
          const rawTop = prev.initialTop + (deltaMinutes / 60) * hourHeight;
          const maxTop = 24 * hourHeight - durationPx;
          const nextTop = Math.max(0, Math.min(maxTop, rawTop));
          return { ...prev, previewTop: nextTop, previewHeight: durationPx };
        }

        if (prev.mode === "resize-start") {
          const endPx = prev.initialTop + prev.initialHeight;
          const rawTop = prev.initialTop + (deltaMinutes / 60) * hourHeight;
          const maxTop = endPx - (MIN_ENTRY_MINUTES / 60) * hourHeight;
          const nextTop = Math.max(0, Math.min(maxTop, rawTop));
          const nextHeight = Math.max((MIN_ENTRY_MINUTES / 60) * hourHeight, endPx - nextTop);
          return { ...prev, previewTop: nextTop, previewHeight: nextHeight };
        }

        const rawHeight = prev.initialHeight + (deltaMinutes / 60) * hourHeight;
        const maxHeight = 24 * hourHeight - prev.initialTop;
        const nextHeight = Math.max((MIN_ENTRY_MINUTES / 60) * hourHeight, Math.min(maxHeight, rawHeight));
        return { ...prev, previewTop: prev.initialTop, previewHeight: nextHeight };
      });
    };

    const handleUp = async () => {
      const finalDrag = blockDrag;
      setBlockDrag(null);
      if (!finalDrag) return;

      if (!finalDrag.hasMoved) {
        openEntryEditor(finalDrag.block);
        return;
      }
      suppressBlockClickUntilRef.current = Date.now() + 250;

      const nextStartMinute = Math.round((finalDrag.previewTop / hourHeight) * 60);
      const nextDurationMinutes = Math.max(
        MIN_ENTRY_MINUTES,
        Math.round((finalDrag.previewHeight / hourHeight) * 60)
      );
      const nextEndMinute = Math.min(24 * 60, nextStartMinute + nextDurationMinutes);

      const startAt = minuteToIso(date, nextStartMinute);
      const stopAt = minuteToIso(date, nextEndMinute);

      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/time-entries/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member: memberName,
            entryId: finalDrag.block.entryId,
            description: finalDrag.block.descriptionRaw,
            project: finalDrag.block.projectRaw,
            startAt,
            stopAt,
            tzOffset: new Date().getTimezoneOffset(),
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok || data.error) throw new Error(data.error || "Failed to update entry");
        setRefreshTick((v) => v + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update entry");
      } finally {
        setBusy(false);
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [blockDrag, date, hourHeight, memberName]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      member: memberName,
      date,
      tzOffset: String(new Date().getTimezoneOffset()),
      _req: String(Date.now()),
    });

    const loadPrimary = async () => {
      try {
        const [entriesData, timerData] = await Promise.all([
          fetch(`/api/entries?${params.toString()}`, { cache: "no-store" }).then(async (res) => {
            const data = (await res.json()) as EntriesResponse;
            if (!res.ok || data.error) throw new Error(data.error || "Failed to load entries");
            return data;
          }),
          fetch(`/api/time-entries/current?member=${encodeURIComponent(memberName)}&_req=${Date.now()}`, { cache: "no-store" }).then(
            async (res) => {
              const data = (await res.json()) as CurrentTimerResponse;
              if (!res.ok || data.error) throw new Error(data.error || "Failed to load timer");
              return data;
            }
          ),
        ]);
        if (!active) return;
        setEntries(entriesData);
        setCurrentTimer(timerData.current);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load tracking data");
      }
    };

    const loadProjects = async () => {
      try {
        const projectsData = await fetch(`/api/projects?_req=${Date.now()}`, { cache: "no-store" }).then(async (res) => {
          const data = (await res.json()) as ProjectsResponse;
          if (!res.ok || data.error) throw new Error(data.error || "Failed to load projects");
          return data;
        });
        if (!active) return;
        setProjects(projectsData.projects);
      } catch {
        // Non-blocking: tracker still works without project list.
      }
    };

    const loadWeekTotal = async () => {
      try {
        const weekData = await fetch(
          `/api/time-entries/week-total?member=${encodeURIComponent(memberName)}&date=${encodeURIComponent(date)}&_req=${Date.now()}`,
          {
            cache: "no-store",
          }
        ).then(async (res) => {
          const data = (await res.json()) as WeekTotalResponse;
          if (!res.ok || data.error) throw new Error(data.error || "Failed to load weekly summary");
          return data;
        });
        if (!active) return;
        setWeekTotalSeconds(weekData.totalSeconds ?? 0);
      } catch {
        // Non-blocking: week total can be empty while rest of page loads.
      }
    };

    const loadDailyRanking = async () => {
      const normalizeAndSort = (rows: Array<{ name: string; seconds: number }>) =>
        [...rows].sort((a, b) => {
          if (b.seconds !== a.seconds) return b.seconds - a.seconds;
          const aIsYar = a.name.trim().toLowerCase() === "yar";
          const bIsYar = b.name.trim().toLowerCase() === "yar";
          if (aIsYar && !bIsYar) return -1;
          if (!aIsYar && bIsYar) return 1;
          return a.name.localeCompare(b.name);
        });

      try {
        const rankingData = await fetch(
          `/api/team?date=${encodeURIComponent(date)}&tzOffset=${encodeURIComponent(
            String(new Date().getTimezoneOffset())
          )}&_req=${Date.now()}`,
          { cache: "no-store" }
        ).then(async (res) => {
          const data = (await res.json()) as TeamResponse;
          if (!res.ok || data.error) throw new Error(data.error || "Failed to load team hours");
          return data;
        });

        if (!active) return;
        const rows = (rankingData.members ?? []).map((member) => ({
          name: member.name,
          seconds: Math.max(0, Number(member.totalSeconds ?? 0)),
        }));

        // Always show at least the current member bar to avoid blank panel.
        if (rows.length === 0) {
          setDailyRanking([{ name: memberName, seconds: 0 }]);
          setTeamHoursWarning("No team members returned for this date.");
          return;
        }

        setDailyRanking(normalizeAndSort(rows));
        setTeamHoursWarning(rankingData.warning ?? null);
      } catch (err) {
        if (!active) return;
        setDailyRanking([{ name: memberName, seconds: Math.max(0, entries?.totalSeconds ?? 0) }]);
        setTeamHoursWarning(err instanceof Error ? err.message : "Failed to load team hours.");
      }
    };

    void loadPrimary();
    void loadProjects();
    void loadWeekTotal();
    void loadDailyRanking();

    return () => {
      active = false;
    };
  }, [memberName, date, refreshTick]);

  const dailyRankingMaxHours = useMemo(() => {
    const maxSeconds = dailyRanking.reduce((max, row) => Math.max(max, row.seconds), 0);
    return Math.max(1, Math.ceil(maxSeconds / 3600));
  }, [dailyRanking]);

  const weekDays = useMemo(() => buildWeekDays(date), [date]);
  const dayStartMs = useMemo(() => new Date(`${date}T00:00:00`).getTime(), [date]);
  const calendarBlocks = useMemo(() => {
    const blocks = (entries?.entries ?? [])
      .map((entry) => buildCalendarBlock(entry, dayStartMs, hourHeight, nowMs))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.top - b.top);
    return layoutCalendarBlocks(blocks);
  }, [entries?.entries, dayStartMs, hourHeight, nowMs]);

  const nowMarkerTop = useMemo(() => {
    const selectedDay = new Date(`${date}T00:00:00`);
    const now = new Date(nowMs);
    if (
      selectedDay.getFullYear() !== now.getFullYear() ||
      selectedDay.getMonth() !== now.getMonth() ||
      selectedDay.getDate() !== now.getDate()
    ) {
      return null;
    }
    const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    return (minutes / 60) * hourHeight;
  }, [date, hourHeight, nowMs]);

  useEffect(() => {
    if (nowMarkerTop === null) return;
    if (!calendarScrollRef.current) return;
    const target = Math.max(0, nowMarkerTop - 320);
    calendarScrollRef.current.scrollTop = target;
  }, [nowMarkerTop, date, hourHeight, calendarBlocks.length]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);
  const filteredModalProjects = useMemo(() => {
    const query = modalProjectSearch.trim().toLowerCase();
    const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
    if (!query) return sorted;
    return sorted.filter((project) => project.name.toLowerCase().includes(query));
  }, [modalProjectSearch, projects]);
  const modalSelectedProjectColor = useMemo(
    () => getProjectColorForName(projects, entryEditor?.project ?? ""),
    [projects, entryEditor?.project]
  );

  function emitTimerChanged(detail: {
    memberName: string;
    isRunning: boolean;
    startAt?: string | null;
    durationSeconds?: number;
    description?: string | null;
    projectName?: string | null;
  }) {
    window.dispatchEvent(new CustomEvent("voho-timer-changed", { detail }));
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setDate(shiftDateInput(date, -1));
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setDate(formatLocalDateInput(new Date()))}
            className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-sm text-slate-700"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              setDate(shiftDateInput(date, 1));
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700"
          >
            →
          </button>

          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          />

          <div className="ml-1 flex gap-1">
            {weekDays.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => setDate(day.value)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${
                  day.value === date ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
                title={day.label}
              >
                {day.short}
              </button>
            ))}
          </div>

          <p className="ml-auto text-sm font-semibold text-slate-700">WEEK TOTAL {formatDurationShort(weekTotalSeconds)}</p>
        </div>
        {entries?.warning && <p className="mt-2 text-xs text-amber-700">{entries.warning}</p>}
        {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      </div>

      <div className="border-b border-slate-200 bg-slate-50/40 px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Total hours worked by team member</p>
          <p className="text-xs text-slate-500">{date}</p>
        </div>
        {teamHoursWarning && <p className="mb-2 text-xs text-amber-700">{teamHoursWarning}</p>}
        {dailyRanking.length === 0 ? (
          <p className="text-sm text-slate-500">No team hours yet for this date.</p>
        ) : (
          <div className="grid grid-cols-[3.2rem_1fr] gap-2">
            <div className="relative h-40">
              {[0, 1, 2, 3, 4].map((step) => {
                const value = Math.round((dailyRankingMaxHours * (4 - step)) * 10) / 10;
                return (
                  <div
                    key={step}
                    className="absolute right-0 text-[10px] font-medium text-slate-500"
                    style={{ top: `${step * 25 - 6}%` }}
                  >
                    {value}h
                  </div>
                );
              })}
            </div>
            <div className="relative h-40 rounded-lg border border-slate-200 bg-white px-2 pt-2">
              {[0, 1, 2, 3, 4].map((step) => (
                <div
                  key={`daily-grid-${step}`}
                  className="absolute left-0 right-0 border-t border-slate-200"
                  style={{ top: `${step * 25}%` }}
                />
              ))}
              <div className="relative z-10 flex h-full items-end gap-2">
                {dailyRanking.map((row) => {
                  const hours = row.seconds / 3600;
                  const heightPercent = Math.max(6, (hours / dailyRankingMaxHours) * 100);
                  return (
                    <div key={row.name} className="flex min-w-[56px] flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-md bg-gradient-to-t from-[#0284c7] via-[#0BA5E9] to-[#7dd3fc] shadow-[0_4px_10px_rgba(2,132,199,0.2)]"
                        style={{ height: `${heightPercent}%` }}
                        title={`${row.name}: ${formatDurationShort(row.seconds)}`}
                      />
                      <p className="text-[10px] font-semibold text-slate-600">{hours.toFixed(1)}h</p>
                      <p className="w-full truncate text-center text-[11px] font-semibold text-slate-700">{row.name}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-[620px]">
        <section className="relative border-r border-slate-200">
          {calendarDraft && (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700">
                  Add entry at {String(calendarDraft.hour).padStart(2, "0")}:{String(calendarDraft.minute).padStart(2, "0")}
                </span>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={draftDurationMinutes}
                  onChange={(event) => setDraftDurationMinutes(event.target.value)}
                  className="w-[90px] rounded border border-slate-300 px-2 py-1"
                />
                <span className="text-slate-600">min</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const mins = Number(draftDurationMinutes);
                    if (!calendarDraft || !Number.isFinite(mins) || mins <= 0) {
                      setError("Pick slot and valid duration");
                      return;
                    }
                    setBusy(true);
                    setError(null);
                    try {
                      const startAt = buildLocalDateTimeIso(date, calendarDraft.hour, calendarDraft.minute);
                      const res = await fetch("/api/time-entries/manual", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          member: memberName,
                          description: "",
                          project: "",
                          startAt,
                          durationMinutes: mins,
                          tzOffset: new Date().getTimezoneOffset(),
                        }),
                      });
                      const data = (await res.json()) as { error?: string };
                      if (!res.ok || data.error) throw new Error(data.error || "Failed to add entry");
                      setCalendarDraft(null);
                      setRefreshTick((v) => v + 1);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to add entry");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-300"
                >
                  Add
                </button>
                <button type="button" onClick={() => setCalendarDraft(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div ref={calendarScrollRef} className="relative max-h-[72vh] overflow-auto">
            <div className="relative min-w-[820px]" style={{ height: `${24 * hourHeight}px` }}>
              <div className="absolute left-2 top-2 z-30 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setZoomLevel((value) => Math.max(0, value - 1))}
                  disabled={zoomLevel === 0}
                  className="h-7 w-7 rounded-md border border-slate-200 text-lg leading-none text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Zoom out"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel((value) => Math.min(ZOOM_LEVELS.length - 1, value + 1))}
                  disabled={zoomLevel === ZOOM_LEVELS.length - 1}
                  className="h-7 w-7 rounded-md border border-slate-200 text-lg leading-none text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Zoom in"
                >
                  +
                </button>
              </div>

              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  onClick={() => setCalendarDraft({ hour, minute: 0 })}
                  className="absolute left-0 right-0 border-b border-slate-100 text-left hover:bg-slate-50"
                  style={{ top: `${hour * hourHeight}px`, height: `${hourHeight}px` }}
                >
                  <span className="absolute left-3 top-1 text-xs text-slate-500">{String(hour).padStart(2, "0")}:00</span>
                </button>
              ))}

              {calendarBlocks.map((block) => {
                const isDraggingThis = blockDrag?.block.entryId === block.entryId;
                const top = isDraggingThis ? blockDrag.previewTop : block.top;
                const height = isDraggingThis ? blockDrag.previewHeight : Math.max(22, block.height);

                return (
                  <div
                    key={block.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openEntryEditor(block);
                    }}
                    onMouseDown={(event) => {
                      if (busy || block.isRunning) return;
                      if (event.button !== 0) return;
                      event.preventDefault();
                      setBlockDrag({
                        mode: "move",
                        block,
                        startClientY: event.clientY,
                        initialTop: block.top,
                        initialHeight: Math.max(22, block.height),
                        previewTop: block.top,
                        previewHeight: Math.max(22, block.height),
                        hasMoved: false,
                      });
                    }}
                    onClick={() => {
                      if (Date.now() < suppressBlockClickUntilRef.current) return;
                      openEntryEditor(block);
                    }}
                    className={`absolute overflow-hidden rounded-lg border px-2 py-1 text-left text-xs shadow-sm ${
                      block.isRunning ? "cursor-default" : "cursor-move"
                    } ${isDraggingThis ? "ring-2 ring-sky-300" : ""}`}
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                      left: `calc(6rem + ${block.column} * ((100% - 8rem) / ${block.laneCount}))`,
                      width: `calc(((100% - 8rem) / ${block.laneCount}) - 4px)`,
                      ...getPastelProjectStyle(block.project, block.projectColor),
                    }}
                  >
                    {!block.isRunning && (
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (busy) return;
                          setBlockDrag({
                            mode: "resize-start",
                            block,
                            startClientY: event.clientY,
                            initialTop: block.top,
                            initialHeight: Math.max(22, block.height),
                            previewTop: block.top,
                            previewHeight: Math.max(22, block.height),
                            hasMoved: false,
                          });
                        }}
                        className="absolute left-0 right-0 top-0 h-2 cursor-ns-resize bg-transparent"
                        aria-label="Resize start time"
                      />
                    )}

                    <p className="truncate font-semibold text-slate-900">{block.description}</p>
                    <p className="truncate text-slate-700">{block.project}</p>
                    <p className="text-[11px] text-slate-600">{block.timeRange}</p>

                    {!block.isRunning && (
                      <button
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (busy) return;
                          setBlockDrag({
                            mode: "resize-end",
                            block,
                            startClientY: event.clientY,
                            initialTop: block.top,
                            initialHeight: Math.max(22, block.height),
                            previewTop: block.top,
                            previewHeight: Math.max(22, block.height),
                            hasMoved: false,
                          });
                        }}
                        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize bg-transparent"
                        aria-label="Resize end time"
                      />
                    )}
                  </div>
                );
              })}

              {nowMarkerTop !== null && (
                <div className="pointer-events-none absolute left-24 right-0 border-t-2 border-sky-500" style={{ top: `${nowMarkerTop}px` }} />
              )}
            </div>
          </div>
        </section>
      </div>

      {entryEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
          onClick={() => setEntryEditor(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">
                <span className="inline-flex h-2 w-2 rounded-full bg-sky-500" />
                Edit time entry
              </div>
              <button type="button" onClick={() => setEntryEditor(null)} className="text-2xl leading-none text-slate-500">
                ×
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <input
                type="text"
                value={entryEditor.description}
                onChange={(event) => setEntryEditor((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                placeholder="Description"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xl font-semibold text-slate-900"
              />

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative" ref={modalProjectPickerRef}>
                  <button
                    type="button"
                    onClick={() => setModalProjectPickerOpen((open) => !open)}
                    className="inline-flex min-w-[220px] items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-left text-base font-semibold text-sky-900 shadow-sm"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-sky-700" fill="currentColor" aria-hidden="true">
                      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l1.5 1.5h8.5A2.5 2.5 0 0 1 21 9v9.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z" />
                    </svg>
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: getProjectBaseColor(entryEditor.project || "No project", modalSelectedProjectColor) }}
                    />
                    <span className="max-w-[150px] truncate">{entryEditor.project || "No project"}</span>
                  </button>

                  {modalProjectPickerOpen && (
                    <div className="absolute left-0 z-50 mt-2 w-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.24)]">
                      <div className="border-b border-slate-100 p-3">
                        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <circle cx="11" cy="11" r="7" />
                            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                          </svg>
                          <input
                            type="text"
                            value={modalProjectSearch}
                            onChange={(event) => setModalProjectSearch(event.target.value)}
                            placeholder="Search by project"
                            className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="max-h-[280px] overflow-y-auto p-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEntryEditor((prev) => (prev ? { ...prev, project: "" } : prev));
                            setModalProjectPickerOpen(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                          <span className="text-sm font-medium text-slate-700">No project</span>
                        </button>
                        {filteredModalProjects.map((project) => (
                          <button
                            key={project.key}
                            type="button"
                            onClick={() => {
                              setEntryEditor((prev) => (prev ? { ...prev, project: project.name } : prev));
                              setModalProjectPickerOpen(false);
                            }}
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                          >
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

                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={entryEditor.startTime}
                    onChange={(event) => setEntryEditor((prev) => (prev ? { ...prev, startTime: event.target.value } : prev))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xl"
                  />
                  <span className="text-2xl text-slate-400">→</span>
                  <input
                    type="time"
                    value={entryEditor.stopTime}
                    onChange={(event) => setEntryEditor((prev) => (prev ? { ...prev, stopTime: event.target.value } : prev))}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xl"
                  />
                </div>

                <button
                  type="button"
                  disabled={entryEditor.saving}
                  onClick={async () => {
                    setEntryEditor((prev) => (prev ? { ...prev, saving: true, error: null } : prev));
                    try {
                      if (currentTimer) {
                        const stopRes = await fetch("/api/time-entries/stop", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ member: memberName, tzOffset: new Date().getTimezoneOffset() }),
                        });
                        const stopData = (await stopRes.json()) as { error?: string };
                        if (!stopRes.ok || stopData.error) throw new Error(stopData.error || "Failed to stop current timer");
                      }

                      const startRes = await fetch("/api/time-entries/start", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          member: memberName,
                          description: entryEditor.description,
                          project: entryEditor.project,
                          tzOffset: new Date().getTimezoneOffset(),
                        }),
                      });
                      const startData = (await startRes.json()) as {
                        error?: string;
                        current?: { id: number; description: string | null; projectName: string | null; startAt: string; durationSeconds: number } | null;
                      };
                      if (!startRes.ok || startData.error) throw new Error(startData.error || "Failed to start timer");

                      if (startData.current) {
                        setCurrentTimer(startData.current);
                        emitTimerChanged({
                          memberName,
                          isRunning: true,
                          startAt: startData.current.startAt,
                          durationSeconds: startData.current.durationSeconds,
                          description: startData.current.description ?? entryEditor.description,
                          projectName: startData.current.projectName ?? entryEditor.project,
                        });
                      }

                      setEntryEditor(null);
                      setRefreshTick((v) => v + 1);
                    } catch (err) {
                      setEntryEditor((prev) => ({
                        ...(prev as EntryEditorState),
                        saving: false,
                        error: err instanceof Error ? err.message : "Failed to start timer from entry",
                      }));
                    }
                  }}
                  className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2.5 text-xl font-semibold text-sky-700 disabled:bg-slate-200 disabled:text-slate-500"
                  title="Start new timer now with this description and project"
                >
                  ▶
                </button>

                <button
                  type="button"
                  disabled={entryEditor.saving}
                  onClick={async () => {
                    const startAt = buildIsoFromDateAndTime(date, entryEditor.startTime);
                    const stopAt = buildIsoFromDateAndTime(date, entryEditor.stopTime);
                    if (!startAt || !stopAt) {
                      setEntryEditor((prev) => (prev ? { ...prev, error: "Please enter valid start and end times." } : prev));
                      return;
                    }
                    if (new Date(stopAt).getTime() <= new Date(startAt).getTime()) {
                      setEntryEditor((prev) => (prev ? { ...prev, error: "End time must be after start time." } : prev));
                      return;
                    }

                    setEntryEditor((prev) => (prev ? { ...prev, saving: true, error: null } : prev));
                    try {
                      const res = await fetch("/api/time-entries/update", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          member: memberName,
                          entryId: entryEditor.entryId,
                          description: entryEditor.description,
                          project: entryEditor.project,
                          startAt,
                          stopAt,
                          tzOffset: new Date().getTimezoneOffset(),
                        }),
                      });
                      const data = (await res.json()) as { error?: string };
                      if (!res.ok || data.error) throw new Error(data.error || "Failed to update entry");
                      setEntryEditor(null);
                      setRefreshTick((v) => v + 1);
                    } catch (err) {
                      setEntryEditor((prev) => ({
                        ...(prev as EntryEditorState),
                        saving: false,
                        error: err instanceof Error ? err.message : "Failed to update entry",
                      }));
                    }
                  }}
                  className="ml-auto rounded-lg bg-[#0BA5E9] px-6 py-2.5 text-xl font-semibold text-white hover:bg-[#0994cf] disabled:bg-slate-300"
                >
                  {entryEditor.saving ? "Saving..." : "Save"}
                </button>
              </div>

              {entryEditor.error && <p className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{entryEditor.error}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
