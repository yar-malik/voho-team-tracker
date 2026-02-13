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

type ProjectItem = { key: string; name: string; source: "manual" | "external" };
type ProjectsResponse = { projects: ProjectItem[]; error?: string };

type CalendarDraft = { hour: number; minute: number };

const CALENDAR_HOUR_HEIGHT = 56;

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
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

export default function TrackPageClient({ memberName }: { memberName: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [refreshTick, setRefreshTick] = useState(0);
  const [entries, setEntries] = useState<EntriesResponse | null>(null);
  const [currentTimer, setCurrentTimer] = useState<CurrentTimerResponse["current"]>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
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

    Promise.all([
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
      fetch(`/api/projects?_req=${Date.now()}`, { cache: "no-store" }).then(async (res) => {
        const data = (await res.json()) as ProjectsResponse;
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load projects");
        return data;
      }),
    ])
      .then(([entriesData, timerData, projectsData]) => {
        if (!active) return;
        setEntries(entriesData);
        setCurrentTimer(timerData.current);
        setProjects(projectsData.projects);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      });

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

  const dayStartMs = useMemo(() => new Date(`${date}T00:00:00`).getTime(), [date]);
  const calendarBlocks = useMemo(() => {
    return (entries?.entries ?? [])
      .map((entry) => buildCalendarBlock(entry, dayStartMs))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.top - b.top);
  }, [entries?.entries, dayStartMs]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Tracking</p>
            <h1 className="text-2xl font-semibold text-slate-900">{memberName}</h1>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-wide text-slate-500">Timer</p>
            <p className="text-2xl font-semibold text-slate-900">{formatDuration(runningSeconds)}</p>
            <p className="text-xs text-slate-500">{currentTimer ? "Running" : "Stopped"}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_1fr_auto]">
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What are you working on?"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
          <div>
            <input
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project"
              list="project-list"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
            />
            <datalist id="project-list">
              {projects.map((project) => (
                <option key={project.key} value={project.name} />
              ))}
            </datalist>
          </div>
          <div className="flex gap-2">
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
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              Start
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
              className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Stop
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <label className="flex items-center gap-2">
            <span>Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-900"
            />
          </label>
          {entries?.warning && <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">{entries.warning}</span>}
        </div>
        {error && <p className="mt-2 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Day Calendar</h2>
            <p className="text-xs text-slate-500">Click hour rows to add entries.</p>
          </div>

          {calendarDraft && (
            <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-800">
                Draft at {String(calendarDraft.hour).padStart(2, "0")}:{String(calendarDraft.minute).padStart(2, "0")}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={draftDurationMinutes}
                  onChange={(event) => setDraftDurationMinutes(event.target.value)}
                  className="w-[110px] rounded border border-slate-300 px-2 py-1"
                />
                <span className="text-slate-600">minutes</span>
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
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  Add
                </button>
                <button type="button" onClick={() => setCalendarDraft(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="relative min-w-[760px]" style={{ height: `${24 * CALENDAR_HOUR_HEIGHT}px` }}>
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
                  className="absolute left-24 right-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs shadow-sm"
                  style={{ top: `${block.top}px`, height: `${Math.max(22, block.height)}px` }}
                >
                  <p className="truncate font-semibold text-slate-900">{block.description}</p>
                  <p className="truncate text-slate-700">{block.project}</p>
                  <p className="text-[11px] text-slate-600">{block.timeRange}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Projects</h2>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Create new project"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!newProjectName.trim()) return;
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch("/api/projects", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name: newProjectName }),
                  });
                  const data = (await res.json()) as { error?: string; project?: ProjectItem };
                  if (!res.ok || data.error) throw new Error(data.error || "Failed to create project");
                  if (data.project) {
                    setProjects((prev) => [...prev.filter((p) => p.key !== data.project!.key), data.project!].sort((a, b) => a.name.localeCompare(b.name)));
                    setProjectName(data.project.name);
                  }
                  setNewProjectName("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to create project");
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              Add
            </button>
          </div>

          <div className="mt-3 max-h-[560px] space-y-2 overflow-auto pr-1">
            {projects.map((project) => (
              <button
                key={project.key}
                type="button"
                onClick={() => setProjectName(project.name)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="truncate text-sm text-slate-900">{project.name}</span>
                <span className="ml-2 shrink-0 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{project.source}</span>
              </button>
            ))}
            {projects.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
