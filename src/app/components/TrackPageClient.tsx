"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

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

type ProjectItem = { key: string; name: string; source: "manual" | "external" };
type ProjectsResponse = { projects: ProjectItem[]; error?: string };

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

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseDurationInputToMinutes(input: string): number | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }

  if (/^\d{1,2}:\d{1,2}$/.test(value)) {
    const [h, m] = value.split(":").map(Number);
    const minutes = h * 60 + m;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }

  let totalMinutes = 0;
  const hourMatches = value.match(/(\d+)\s*h(?:our|ours)?/g) ?? [];
  const minuteMatches = value.match(/(\d+)\s*m(?:in|ins|inute|inutes)?/g) ?? [];

  for (const match of hourMatches) {
    const parsed = Number(match.match(/\d+/)?.[0] ?? 0);
    totalMinutes += parsed * 60;
  }
  for (const match of minuteMatches) {
    const parsed = Number(match.match(/\d+/)?.[0] ?? 0);
    totalMinutes += parsed;
  }

  if (totalMinutes > 0) return totalMinutes;
  return null;
}

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

function buildCalendarBlock(entry: TimeEntry, dayStartMs: number) {
  const startMs = new Date(entry.start).getTime();
  if (Number.isNaN(startMs)) return null;
  const stopMs = entry.stop ? new Date(entry.stop).getTime() : startMs + Math.max(0, entry.duration) * 1000;
  const safeStopMs = Number.isNaN(stopMs) ? startMs + Math.max(0, entry.duration) * 1000 : stopMs;
  const minutesFromStart = (startMs - dayStartMs) / (60 * 1000);
  const durationMinutes = Math.max(MIN_ENTRY_MINUTES, (safeStopMs - startMs) / (60 * 1000));
  return {
    id: `${entry.id}-${startMs}`,
    entryId: entry.id,
    top: (minutesFromStart / 60) * CALENDAR_HOUR_HEIGHT,
    height: (durationMinutes / 60) * CALENDAR_HOUR_HEIGHT,
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

function getPastelProjectStyle(project: string, projectColor: string | null | undefined): CSSProperties {
  const rgb = projectColor ? hexToRgb(projectColor) : null;
  if (rgb) {
    return {
      borderColor: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.75)`,
      backgroundColor: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.20)`,
    };
  }

  if (project.trim().toLowerCase() === "no project") {
    return {
      borderColor: "rgb(203 213 225 / 0.8)",
      backgroundColor: "rgb(241 245 249 / 0.9)",
    };
  }

  const fallback = [
    { border: "rgb(167 139 250 / 0.72)", bg: "rgb(237 233 254 / 0.90)" }, // lavender
    { border: "rgb(96 165 250 / 0.72)", bg: "rgb(219 234 254 / 0.90)" }, // sky
    { border: "rgb(45 212 191 / 0.72)", bg: "rgb(204 251 241 / 0.90)" }, // mint
    { border: "rgb(249 168 212 / 0.72)", bg: "rgb(252 231 243 / 0.92)" }, // rose
    { border: "rgb(251 191 36 / 0.72)", bg: "rgb(254 243 199 / 0.92)" }, // amber
    { border: "rgb(134 239 172 / 0.72)", bg: "rgb(220 252 231 / 0.92)" }, // green
    { border: "rgb(147 197 253 / 0.72)", bg: "rgb(224 242 254 / 0.92)" }, // cyan
  ];

  let hash = 0;
  for (let i = 0; i < project.length; i += 1) {
    hash = (hash * 31 + project.charCodeAt(i)) >>> 0;
  }
  const color = fallback[hash % fallback.length];
  return { borderColor: color.border, backgroundColor: color.bg };
}

export default function TrackPageClient({ memberName }: { memberName: string }) {
  const [date, setDate] = useState(formatLocalDateInput(new Date()));
  const [refreshTick, setRefreshTick] = useState(0);
  const [entries, setEntries] = useState<EntriesResponse | null>(null);
  const [currentTimer, setCurrentTimer] = useState<CurrentTimerResponse["current"]>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [weekTotalSeconds, setWeekTotalSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [quickDurationInput, setQuickDurationInput] = useState("");
  const [quickDurationMode, setQuickDurationMode] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [draftDurationMinutes, setDraftDurationMinutes] = useState("60");
  const [entryEditor, setEntryEditor] = useState<EntryEditorState | null>(null);
  const [blockDrag, setBlockDrag] = useState<BlockDragState | null>(null);

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
    if (!currentTimer) {
      setQuickDurationMode(false);
    }
  }, [currentTimer]);

  useEffect(() => {
    if (!blockDrag) return;

    const handleMove = (event: MouseEvent) => {
      const deltaPx = event.clientY - blockDrag.startClientY;
      const deltaMinutes = snapMinutes((deltaPx / CALENDAR_HOUR_HEIGHT) * 60);

      if (Math.abs(deltaPx) >= 3 && !blockDrag.hasMoved) {
        setBlockDrag((prev) => (prev ? { ...prev, hasMoved: true } : prev));
      }

      setBlockDrag((prev) => {
        if (!prev) return prev;

        if (prev.mode === "move") {
          const durationPx = prev.initialHeight;
          const rawTop = prev.initialTop + (deltaMinutes / 60) * CALENDAR_HOUR_HEIGHT;
          const maxTop = 24 * CALENDAR_HOUR_HEIGHT - durationPx;
          const nextTop = Math.max(0, Math.min(maxTop, rawTop));
          return { ...prev, previewTop: nextTop, previewHeight: durationPx };
        }

        if (prev.mode === "resize-start") {
          const endPx = prev.initialTop + prev.initialHeight;
          const rawTop = prev.initialTop + (deltaMinutes / 60) * CALENDAR_HOUR_HEIGHT;
          const maxTop = endPx - (MIN_ENTRY_MINUTES / 60) * CALENDAR_HOUR_HEIGHT;
          const nextTop = Math.max(0, Math.min(maxTop, rawTop));
          const nextHeight = Math.max((MIN_ENTRY_MINUTES / 60) * CALENDAR_HOUR_HEIGHT, endPx - nextTop);
          return { ...prev, previewTop: nextTop, previewHeight: nextHeight };
        }

        const rawHeight = prev.initialHeight + (deltaMinutes / 60) * CALENDAR_HOUR_HEIGHT;
        const maxHeight = 24 * CALENDAR_HOUR_HEIGHT - prev.initialTop;
        const nextHeight = Math.max((MIN_ENTRY_MINUTES / 60) * CALENDAR_HOUR_HEIGHT, Math.min(maxHeight, rawHeight));
        return { ...prev, previewTop: prev.initialTop, previewHeight: nextHeight };
      });
    };

    const handleUp = async () => {
      const finalDrag = blockDrag;
      setBlockDrag(null);
      if (!finalDrag) return;

      if (!finalDrag.hasMoved) {
        setEntryEditor({
          entryId: finalDrag.block.entryId,
          description: finalDrag.block.description === "(No description)" ? "" : finalDrag.block.description,
          project: finalDrag.block.project === "No project" ? "" : finalDrag.block.project,
          startTime: formatTimeInputLocal(finalDrag.block.startIso),
          stopTime: formatTimeInputLocal(finalDrag.block.stopIso),
          saving: false,
          error: null,
        });
        return;
      }

      const nextStartMinute = Math.round((finalDrag.previewTop / CALENDAR_HOUR_HEIGHT) * 60);
      const nextDurationMinutes = Math.max(
        MIN_ENTRY_MINUTES,
        Math.round((finalDrag.previewHeight / CALENDAR_HOUR_HEIGHT) * 60)
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
  }, [blockDrag, date, memberName]);

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

    void loadPrimary();
    void loadProjects();
    void loadWeekTotal();

    return () => {
      active = false;
    };
  }, [memberName, date, refreshTick]);

  const runningSeconds = useMemo(() => {
    if (!currentTimer) return 0;
    const startedAtMs = new Date(currentTimer.startAt).getTime();
    if (Number.isNaN(startedAtMs)) return Math.max(0, currentTimer.durationSeconds);
    return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  }, [currentTimer, nowMs]);

  const weekDays = useMemo(() => buildWeekDays(date), [date]);
  const dayStartMs = useMemo(() => new Date(`${date}T00:00:00`).getTime(), [date]);
  const calendarBlocks = useMemo(() => {
    const blocks = (entries?.entries ?? [])
      .map((entry) => buildCalendarBlock(entry, dayStartMs))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.top - b.top);
    return layoutCalendarBlocks(blocks);
  }, [entries?.entries, dayStartMs]);

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
    const minutes = now.getHours() * 60 + now.getMinutes();
    return (minutes / 60) * CALENDAR_HOUR_HEIGHT;
  }, [date, nowMs]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);

  function emitTimerChanged(detail: { memberName: string; isRunning: boolean; startAt?: string | null; durationSeconds?: number }) {
    window.dispatchEvent(new CustomEvent("voho-timer-changed", { detail }));
  }

  async function createQuickDurationEntry(rawDuration: string) {
    const minutes = parseDurationInputToMinutes(rawDuration);
    if (!minutes || minutes <= 0) {
      throw new Error("Use a valid duration like 15m, 20 min, 1h 30m, or 1:15");
    }
    const now = new Date();
    const startAt = new Date(now.getTime() - minutes * 60 * 1000).toISOString();

    const res = await fetch("/api/time-entries/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member: memberName,
        description,
        project: projectName,
        startAt,
        durationMinutes: minutes,
        tzOffset: new Date().getTimezoneOffset(),
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to add entry");
    }
    setQuickDurationInput("");
    setRefreshTick((v) => v + 1);
  }

  async function handleQuickDurationSubmit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createQuickDurationEntry(quickDurationInput);
      setQuickDurationMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What are you working on?"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xl font-semibold text-slate-900 outline-none focus:border-sky-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project"
              list="project-list"
              className="w-[180px] rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900"
            />
            <datalist id="project-list">
              {projects.map((project) => (
                <option key={project.key} value={project.name} />
              ))}
            </datalist>

            {!currentTimer || quickDurationMode ? (
              <input
                type="text"
                value={quickDurationInput}
                onChange={(event) => setQuickDurationInput(event.target.value)}
                onKeyDown={async (event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  await handleQuickDurationSubmit();
                }}
                onBlur={() => {
                  if (currentTimer) setQuickDurationMode(false);
                }}
                autoFocus={quickDurationMode}
                placeholder="15m"
                className="w-[110px] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right text-2xl font-semibold tabular-nums text-slate-900 outline-none focus:border-sky-400"
                title="Type duration: 15m, 20 min, 1h 30m, 1:15, or 90"
              />
            ) : (
              <button
                type="button"
                onClick={() => setQuickDurationMode(true)}
                className="min-w-[95px] text-right text-3xl font-semibold tabular-nums text-slate-900 transition hover:text-blue-700"
                title="Click to type duration like 15m or 1h 20m"
              >
                {formatTimer(runningSeconds)}
              </button>
            )}

            <button
              type="button"
              disabled={busy || Boolean(currentTimer)}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const smartDuration = parseDurationInputToMinutes(quickDurationInput);
                  if (smartDuration && smartDuration > 0) {
                    await createQuickDurationEntry(quickDurationInput);
                    return;
                  }
                  const res = await fetch("/api/time-entries/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ member: memberName, description, project: projectName, tzOffset: new Date().getTimezoneOffset() }),
                  });
                  const data = (await res.json()) as {
                    error?: string;
                    current?: { id: number; description: string | null; projectName: string | null; startAt: string; durationSeconds: number } | null;
                  };
                  if (!res.ok || data.error) throw new Error(data.error || "Failed to start timer");
                  if (data.current) {
                    setCurrentTimer(data.current);
                    emitTimerChanged({
                      memberName,
                      isRunning: true,
                      startAt: data.current.startAt,
                      durationSeconds: data.current.durationSeconds,
                    });
                  }
                  setRefreshTick((v) => v + 1);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to start timer");
                } finally {
                  setBusy(false);
                }
              }}
              className="h-12 w-12 rounded-full bg-blue-700 text-lg font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              title="Start timer"
            >
              ▶
            </button>
            <button
              type="button"
              disabled={busy || !currentTimer}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch("/api/time-entries/stop", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ member: memberName, tzOffset: new Date().getTimezoneOffset() }),
                  });
                  const data = (await res.json()) as { error?: string };
                  if (!res.ok || data.error) throw new Error(data.error || "Failed to stop timer");
                  setCurrentTimer(null);
                  emitTimerChanged({ memberName, isRunning: false, startAt: null, durationSeconds: 0 });
                  setRefreshTick((v) => v + 1);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to stop timer");
                } finally {
                  setBusy(false);
                }
              }}
              className="h-12 w-12 rounded-full bg-sky-700 text-lg font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              title="Stop timer"
            >
              ■
            </button>
          </div>
        </div>
      </div>

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
                          description,
                          project: projectName,
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

          <div className="relative overflow-x-auto">
            <div className="relative min-w-[820px]" style={{ height: `${24 * CALENDAR_HOUR_HEIGHT}px` }}>
              {hours.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  onClick={() => setCalendarDraft({ hour, minute: 0 })}
                  className="absolute left-0 right-0 border-b border-slate-100 text-left hover:bg-slate-50"
                  style={{ top: `${hour * CALENDAR_HOUR_HEIGHT}px`, height: `${CALENDAR_HOUR_HEIGHT}px` }}
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
                      setEntryEditor({
                        entryId: block.entryId,
                        description: block.description === "(No description)" ? "" : block.description,
                        project: block.project === "No project" ? "" : block.project,
                        startTime: formatTimeInputLocal(block.startIso),
                        stopTime: formatTimeInputLocal(block.stopIso),
                        saving: false,
                        error: null,
                      });
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
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
                <input
                  type="text"
                  value={entryEditor.project}
                  onChange={(event) => setEntryEditor((prev) => (prev ? { ...prev, project: event.target.value } : prev))}
                  placeholder="Project"
                  list="project-list"
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-lg text-sky-900"
                />

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
                  className="ml-auto rounded-lg bg-sky-600 px-6 py-2.5 text-xl font-semibold text-white disabled:bg-slate-300"
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
