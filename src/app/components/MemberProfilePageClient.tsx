"use client";

import Link from "next/link";
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
  current: TimeEntry | null;
  totalSeconds: number;
  date: string;
  cachedAt?: string;
  warning?: string | null;
  error?: string;
};

type CurrentTimerResponse = {
  member: string;
  current: {
    id: number;
    description: string | null;
    projectName: string | null;
    startAt: string;
    durationSeconds: number;
    source: string;
  } | null;
  error?: string;
};

type ProjectItem = {
  key: string;
  name: string;
  source: "manual" | "external";
};

type ProjectsResponse = {
  projects: ProjectItem[];
  error?: string;
};

type MemberItem = { name: string };

type MembersResponse = {
  members: MemberItem[];
  error?: string;
};

type KpiItem = {
  id: number;
  member: string;
  label: string;
  value: string;
  notes: string | null;
  updatedAt: string;
};

type KpisResponse = {
  kpis: KpiItem[];
  error?: string;
};

type CalendarDraft = {
  hour: number;
  minute: number;
};

const AUTO_REFRESH_MS = 60 * 1000;
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

function formatDatePretty(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { weekday: "long", year: "numeric", month: "short", day: "numeric" });
}

function getRunningSeconds(current: CurrentTimerResponse["current"], nowMs: number): number {
  if (!current) return 0;
  const startedMs = new Date(current.startAt).getTime();
  if (Number.isNaN(startedMs)) return Math.max(0, current.durationSeconds);
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
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

export default function MemberProfilePageClient({
  memberName,
  initialDate,
}: {
  memberName: string;
  initialDate: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [refreshTick, setRefreshTick] = useState(0);
  const [entriesPayload, setEntriesPayload] = useState<EntriesResponse | null>(null);
  const [currentTimer, setCurrentTimer] = useState<CurrentTimerResponse["current"]>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [kpis, setKpis] = useState<KpiItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [kpiLabel, setKpiLabel] = useState("");
  const [kpiValue, setKpiValue] = useState("");
  const [kpiNotes, setKpiNotes] = useState("");

  const [calendarDraft, setCalendarDraft] = useState<CalendarDraft | null>(null);
  const [draftDurationMinutes, setDraftDurationMinutes] = useState("60");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setRefreshTick((v) => v + 1);
    }, AUTO_REFRESH_MS);
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
      fetch(`/api/time-entries/current?member=${encodeURIComponent(memberName)}&_req=${Date.now()}`, {
        cache: "no-store",
      }).then(async (res) => {
        const data = (await res.json()) as CurrentTimerResponse;
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load timer");
        return data;
      }),
      fetch(`/api/projects?_req=${Date.now()}`, { cache: "no-store" }).then(async (res) => {
        const data = (await res.json()) as ProjectsResponse;
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load projects");
        return data;
      }),
      fetch(`/api/members?_req=${Date.now()}`, { cache: "no-store" }).then(async (res) => {
        const data = (await res.json()) as MembersResponse;
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load members");
        return data;
      }),
      fetch(`/api/kpis?member=${encodeURIComponent(memberName)}&_req=${Date.now()}`, { cache: "no-store" }).then(async (res) => {
        const data = (await res.json()) as KpisResponse;
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load KPIs");
        return data;
      }),
    ])
      .then(([entriesData, timerData, projectsData, membersData, kpisData]) => {
        if (!active) return;
        setEntriesPayload(entriesData);
        setCurrentTimer(timerData.current);
        setProjects(projectsData.projects);
        setMembers(membersData.members);
        setKpis(kpisData.kpis);
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

  const runningSeconds = useMemo(() => getRunningSeconds(currentTimer, nowMs), [currentTimer, nowMs]);

  const dayStartMs = useMemo(() => {
    const dateObj = new Date(`${date}T00:00:00`);
    return dateObj.getTime();
  }, [date]);

  const calendarBlocks = useMemo(() => {
    const entries = entriesPayload?.entries ?? [];
    return entries
      .map((entry) => buildCalendarBlock(entry, dayStartMs))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .sort((a, b) => a.top - b.top);
  }, [entriesPayload?.entries, dayStartMs]);

  const summary = useMemo(() => {
    const totalSeconds = entriesPayload?.totalSeconds ?? 0;
    const count = entriesPayload?.entries.length ?? 0;
    return {
      totalSeconds,
      count,
      avgSeconds: count > 0 ? Math.floor(totalSeconds / count) : 0,
    };
  }, [entriesPayload]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, hour) => hour), []);

  const startTimer = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/time-entries/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member: memberName,
          description,
          project: projectName,
          tzOffset: new Date().getTimezoneOffset(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to start timer");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to start timer");
    } finally {
      setBusy(false);
    }
  };

  const stopTimer = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/time-entries/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member: memberName,
          tzOffset: new Date().getTimezoneOffset(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to stop timer");
      setRefreshTick((v) => v + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to stop timer");
    } finally {
      setBusy(false);
    }
  };

  const addCalendarEntry = async () => {
    if (!calendarDraft) {
      setActionError("Pick a time slot from calendar first");
      return;
    }
    const durationMinutes = Number(draftDurationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setActionError("Duration must be greater than 0 minutes");
      return;
    }

    setBusy(true);
    setActionError(null);
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
          durationMinutes,
          tzOffset: new Date().getTimezoneOffset(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to add calendar entry");
      setRefreshTick((v) => v + 1);
      setCalendarDraft(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to add calendar entry");
    } finally {
      setBusy(false);
    }
  };

  const createNewProject = async () => {
    const name = newProjectName.trim();
    if (!name) {
      setActionError("Project name is required");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { error?: string; project?: ProjectItem };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to create project");
      if (data.project) {
        setProjects((prev) => {
          if (prev.some((item) => item.key === data.project!.key)) return prev;
          return [...prev, data.project!].sort((a, b) => a.name.localeCompare(b.name));
        });
        setProjectName(data.project.name);
      }
      setNewProjectName("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  const createNewMember = async () => {
    const name = newMemberName.trim();
    if (!name) {
      setActionError("Member name is required");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { error?: string; member?: MemberItem };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to create member");
      if (data.member) {
        setMembers((prev) => {
          if (prev.some((item) => item.name.toLowerCase() === data.member!.name.toLowerCase())) return prev;
          return [...prev, data.member!].sort((a, b) => a.name.localeCompare(b.name));
        });
      }
      setNewMemberName("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create member");
    } finally {
      setBusy(false);
    }
  };

  const saveKpi = async () => {
    if (!kpiLabel.trim() || !kpiValue.trim()) {
      setActionError("KPI label and value are required");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/kpis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member: memberName,
          label: kpiLabel,
          value: kpiValue,
          notes: kpiNotes,
        }),
      });
      const data = (await res.json()) as { error?: string; kpi?: KpiItem };
      if (!res.ok || data.error) throw new Error(data.error || "Failed to save KPI");
      if (data.kpi) {
        setKpis((prev) => {
          const without = prev.filter((item) => item.label.toLowerCase() !== data.kpi!.label.toLowerCase());
          return [...without, data.kpi!].sort((a, b) => a.label.localeCompare(b.label));
        });
      }
      setKpiLabel("");
      setKpiValue("");
      setKpiNotes("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to save KPI");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
          <section id="track" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Live Tracker</p>
                <h1 className="text-2xl font-semibold text-slate-900 md:text-3xl">{memberName}</h1>
                <p className="text-sm text-slate-600">{formatDatePretty(date)}</p>
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
                  onClick={startTimer}
                  disabled={busy || Boolean(currentTimer)}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  Start
                </button>
                <button
                  type="button"
                  onClick={stopTimer}
                  disabled={busy || !currentTimer}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-rose-300"
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
              {entriesPayload?.warning && <span className="rounded bg-amber-100 px-2 py-1 text-amber-800">{entriesPayload.warning}</span>}
            </div>

            {actionError && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p>}
            {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          </section>

          <div className="grid gap-4 xl:grid-cols-[1fr_330px]">
            <section id="calendar" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
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
                      onClick={addCalendarEntry}
                      disabled={busy}
                      className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      Add to calendar
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalendarDraft(null)}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                    >
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
                      <span className="absolute left-3 top-1 text-xs font-medium text-slate-500">{String(hour).padStart(2, "0")}:00</span>
                    </button>
                  ))}

                  {calendarBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="absolute left-24 right-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs shadow-sm"
                      style={{ top: `${block.top}px`, height: `${Math.max(22, block.height)}px` }}
                      title={block.timeRange}
                    >
                      <p className="truncate font-semibold text-slate-900">{block.description}</p>
                      <p className="truncate text-slate-700">{block.project}</p>
                      <p className="text-[11px] text-slate-600">{block.timeRange}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <section id="projects" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
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
                    onClick={createNewProject}
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 max-h-[260px] space-y-2 overflow-auto pr-1">
                  {projects.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
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
                </div>
              </section>

              <section id="members" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
                <h2 className="text-lg font-semibold text-slate-900">Members</h2>
                <div className="mt-3 flex gap-2">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(event) => setNewMemberName(event.target.value)}
                    placeholder="Add member"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={createNewMember}
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-3 max-h-[170px] space-y-2 overflow-auto pr-1">
                  {members.length === 0 && <p className="text-sm text-slate-500">No members yet.</p>}
                  {members.map((member) => (
                    <Link
                      key={member.name}
                      href={`/member/${encodeURIComponent(member.name)}?date=${encodeURIComponent(date)}`}
                      className="block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
                    >
                      {member.name}
                    </Link>
                  ))}
                </div>
              </section>

              <section id="kpis" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
                <h2 className="text-lg font-semibold text-slate-900">KPIs ({memberName})</h2>
                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    value={kpiLabel}
                    onChange={(event) => setKpiLabel(event.target.value)}
                    placeholder="KPI label"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="text"
                    value={kpiValue}
                    onChange={(event) => setKpiValue(event.target.value)}
                    placeholder="KPI value"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={kpiNotes}
                    onChange={(event) => setKpiNotes(event.target.value)}
                    placeholder="Optional notes"
                    rows={2}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={saveKpi}
                    disabled={busy}
                    className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    Save KPI
                  </button>
                </div>
                <div className="mt-3 max-h-[180px] space-y-2 overflow-auto pr-1">
                  {kpis.length === 0 && <p className="text-sm text-slate-500">No KPIs yet for this member.</p>}
                  {kpis.map((kpi) => (
                    <div key={`${kpi.id}-${kpi.label}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">{kpi.label}</p>
                      <p className="text-sm font-semibold text-slate-900">{kpi.value}</p>
                      {kpi.notes && <p className="mt-1 text-xs text-slate-600">{kpi.notes}</p>}
                    </div>
                  ))}
                </div>
              </section>

              <section id="insights" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
                <h2 className="text-lg font-semibold text-slate-900">Today Insights</h2>
                <div className="mt-3 grid gap-2 text-sm">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Total tracked</p>
                    <p className="font-semibold text-slate-900">{formatDuration(summary.totalSeconds)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Entries</p>
                    <p className="font-semibold text-slate-900">{summary.count}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Avg per entry</p>
                    <p className="font-semibold text-slate-900">{formatDuration(summary.avgSeconds)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Snapshot</p>
                    <p className="font-semibold text-slate-900">{entriesPayload?.cachedAt ? formatClock(entriesPayload.cachedAt) : "--:--"}</p>
                  </div>
                </div>
              </section>
            </div>
          </div>
    </div>
  );
}
