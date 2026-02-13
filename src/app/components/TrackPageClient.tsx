"use client";

import { useEffect, useMemo, useState } from "react";

type TimeEntry = {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  project_name?: string | null;
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

const CALENDAR_HOUR_HEIGHT = 56;

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
    const value = d.toISOString().slice(0, 10);
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
  const durationMinutes = Math.max(15, (safeStopMs - startMs) / (60 * 1000));
  return {
    id: `${entry.id}-${startMs}`,
    top: (minutesFromStart / 60) * CALENDAR_HOUR_HEIGHT,
    height: (durationMinutes / 60) * CALENDAR_HOUR_HEIGHT,
    description: entry.description?.trim() || "(No description)",
    project: entry.project_name?.trim() || "No project",
    timeRange: `${formatClock(entry.start)} - ${formatClock(entry.stop)}`,
  };
}

function projectColorClass(project: string) {
  const key = project.trim().toLowerCase();
  if (key === "no project") return "border-slate-200 bg-slate-100";
  const palette = [
    "border-amber-200 bg-amber-100/70",
    "border-teal-200 bg-teal-100/70",
    "border-sky-200 bg-sky-100/70",
    "border-rose-200 bg-rose-100/70",
    "border-violet-200 bg-violet-100/70",
  ];
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export default function TrackPageClient({ memberName }: { memberName: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
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
  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [draftDurationMinutes, setDraftDurationMinutes] = useState("60");

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
    return (entries?.entries ?? [])
      .map((entry) => buildCalendarBlock(entry, dayStartMs))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.top - b.top);
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
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xl font-semibold text-slate-900 outline-none focus:border-fuchsia-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project"
              list="project-list"
              className="w-[180px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
            />
            <datalist id="project-list">
              {projects.map((project) => (
                <option key={project.key} value={project.name} />
              ))}
            </datalist>

            <p className="min-w-[95px] text-right text-3xl font-semibold tabular-nums text-slate-900">{formatTimer(runningSeconds)}</p>

            <button
              type="button"
              disabled={busy || Boolean(currentTimer)}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch("/api/time-entries/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ member: memberName, description, project: projectName, tzOffset: new Date().getTimezoneOffset() }),
                  });
                  const data = (await res.json()) as { error?: string };
                  if (!res.ok || data.error) throw new Error(data.error || "Failed to start timer");
                  setRefreshTick((v) => v + 1);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to start timer");
                } finally {
                  setBusy(false);
                }
              }}
              className="h-12 w-12 rounded-full bg-fuchsia-600 text-lg font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
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
                  setRefreshTick((v) => v + 1);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to stop timer");
                } finally {
                  setBusy(false);
                }
              }}
              className="h-12 w-12 rounded-full bg-rose-500 text-lg font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
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
              const d = new Date(`${date}T00:00:00`);
              d.setDate(d.getDate() - 1);
              setDate(d.toISOString().slice(0, 10));
            }}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setDate(new Date().toISOString().slice(0, 10))}
            className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1 text-sm text-slate-700"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(`${date}T00:00:00`);
              d.setDate(d.getDate() + 1);
              setDate(d.toISOString().slice(0, 10));
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
                  day.value === date ? "bg-fuchsia-100 text-fuchsia-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
                title={day.label}
              >
                {day.short}
              </button>
            ))}
          </div>

          <p className="ml-auto text-sm font-semibold text-slate-700">WEEK TOTAL {formatDurationShort(weekTotalSeconds)}</p>
          <div className="flex overflow-hidden rounded-md border border-slate-300">
            <span className="bg-fuchsia-100 px-3 py-1 text-sm font-medium text-fuchsia-800">Calendar</span>
            <span className="px-3 py-1 text-sm text-slate-700">List view</span>
            <span className="px-3 py-1 text-sm text-slate-700">Timesheet</span>
          </div>
        </div>
        {entries?.warning && <p className="mt-2 text-xs text-amber-700">{entries.warning}</p>}
        {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      </div>

      <div className="grid min-h-[620px] grid-cols-1 xl:grid-cols-[1fr_320px]">
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

              {calendarBlocks.map((block) => (
                <div
                  key={block.id}
                  className={`absolute left-24 right-8 overflow-hidden rounded-lg border px-2 py-1 text-xs shadow-sm ${projectColorClass(block.project)}`}
                  style={{ top: `${block.top}px`, height: `${Math.max(22, block.height)}px` }}
                >
                  <p className="truncate font-semibold text-slate-900">{block.description}</p>
                  <p className="truncate text-slate-700">{block.project}</p>
                  <p className="text-[11px] text-slate-600">{block.timeRange}</p>
                </div>
              ))}

              {nowMarkerTop !== null && (
                <div className="pointer-events-none absolute left-24 right-0 border-t-2 border-fuchsia-500" style={{ top: `${nowMarkerTop}px` }} />
              )}
            </div>
          </div>
        </section>

        <aside className="hidden bg-slate-50/70 p-4 xl:block">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-800">Goals</p>
            <p className="mt-3 text-sm text-slate-500">Create a goal</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
