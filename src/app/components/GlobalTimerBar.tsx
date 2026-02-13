"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProjectBaseColor } from "@/lib/projectColors";

type RunningTimer = {
  id: number;
  description: string | null;
  projectName: string | null;
  startAt: string;
  durationSeconds: number;
};

type ProjectItem = {
  key: string;
  name: string;
  color?: string | null;
};

function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function GlobalTimerBar({ memberName }: { memberName: string | null }) {
  const [current, setCurrent] = useState<RunningTimer | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [description, setDescription] = useState("");
  const [projectName, setProjectName] = useState("");
  const [nowMs, setNowMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const latestDraftRef = useRef({ description: "", projectName: "" });
  const saveControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!memberName) return;
    let active = true;
    const load = async () => {
      try {
        const [timerRes, projectsRes] = await Promise.all([
          fetch(`/api/time-entries/current?member=${encodeURIComponent(memberName)}&_req=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/projects?_req=${Date.now()}`, { cache: "no-store" }),
        ]);
        const timerData = (await timerRes.json()) as { current?: RunningTimer | null };
        const projectsData = (await projectsRes.json()) as { projects?: ProjectItem[] };
        if (!active) return;
        setCurrent(timerData.current ?? null);
        setProjects(projectsData.projects ?? []);
        if (timerData.current) {
          setDescription(timerData.current.description ?? "");
          setProjectName(timerData.current.projectName ?? "");
        }
      } catch {
        // Non-blocking.
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [memberName]);

  useEffect(() => {
    latestDraftRef.current = { description, projectName };
  }, [description, projectName]);

  const persistRunningDraft = useCallback(
    async (nextDescription: string, nextProjectName: string, options?: { keepalive?: boolean }) => {
      if (!current || !memberName) return;
      const keepalive = options?.keepalive ?? false;
      if (!keepalive) {
        saveControllerRef.current?.abort();
        saveControllerRef.current = new AbortController();
      }
      const controller = saveControllerRef.current;

      try {
        await fetch("/api/time-entries/current", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            member: memberName,
            description: nextDescription,
            project: nextProjectName,
          }),
          signal: keepalive ? undefined : controller?.signal,
          keepalive,
          cache: "no-store",
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        // Best-effort.
      } finally {
        if (!keepalive && controller && saveControllerRef.current === controller) {
          saveControllerRef.current = null;
        }
      }
    },
    [current, memberName]
  );

  useEffect(() => {
    const flushOnLeave = () => {
      if (!current || !memberName) return;
      const draft = latestDraftRef.current;
      void persistRunningDraft(draft.description, draft.projectName, { keepalive: true });
    };
    window.addEventListener("pagehide", flushOnLeave);
    return () => window.removeEventListener("pagehide", flushOnLeave);
  }, [current, memberName, persistRunningDraft]);

  useEffect(() => {
    return () => saveControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!pickerRef.current) return;
      if (pickerRef.current.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [pickerOpen]);

  const runningSeconds = useMemo(() => {
    if (!current) return 0;
    const startedAtMs = new Date(current.startAt).getTime();
    if (Number.isNaN(startedAtMs)) return Math.max(0, current.durationSeconds);
    return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  }, [current, nowMs]);

  const selectedProjectColor = useMemo(() => {
    const normalized = projectName.trim().toLowerCase();
    if (!normalized) return null;
    const found = projects.find((project) => project.name.trim().toLowerCase() === normalized);
    return found?.color ?? null;
  }, [projectName, projects]);

  const filteredProjects = useMemo(() => {
    const query = pickerSearch.trim().toLowerCase();
    const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name));
    if (!query) return sorted;
    return sorted.filter((project) => project.name.toLowerCase().includes(query));
  }, [projects, pickerSearch]);

  if (!memberName) return null;

  return (
    <div className="sticky top-0 z-30 mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={description}
          onChange={(event) => {
            const next = event.target.value;
            setDescription(next);
            void persistRunningDraft(next, projectName);
          }}
          placeholder="What are you working on?"
          className="min-w-[280px] flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-xl font-semibold text-slate-900 outline-none focus:border-sky-400"
        />

        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="inline-flex h-11 min-w-[210px] items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm font-semibold text-sky-900 shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-sky-700" fill="currentColor" aria-hidden="true">
              <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l1.5 1.5h8.5A2.5 2.5 0 0 1 21 9v9.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z" />
            </svg>
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: getProjectBaseColor(projectName || "No project", selectedProjectColor) }}
            />
            <span className="max-w-[140px] truncate">{projectName || "No project"}</span>
          </button>

          {pickerOpen && (
            <div className="absolute right-0 z-50 mt-2 w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.24)]">
              <div className="border-b border-slate-100 p-3">
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(event) => setPickerSearch(event.target.value)}
                  placeholder="Search by project"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none"
                  autoFocus
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto p-2">
                <button
                  type="button"
                  onClick={() => {
                    setProjectName("");
                    void persistRunningDraft(description, "");
                    setPickerOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                  <span className="text-sm font-medium text-slate-700">No project</span>
                </button>
                {filteredProjects.map((project) => (
                  <button
                    key={project.key}
                    type="button"
                    onClick={() => {
                      setProjectName(project.name);
                      void persistRunningDraft(description, project.name);
                      setPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getProjectBaseColor(project.name, project.color) }} />
                    <span className="truncate text-sm font-semibold text-slate-800">{project.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="min-w-[95px] text-right text-3xl font-semibold tabular-nums text-slate-900">{formatTimer(runningSeconds)}</p>

        <button
          type="button"
          disabled={busy || Boolean(current)}
          onClick={async () => {
            if (!memberName) return;
            setBusy(true);
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
              const data = (await res.json()) as { current?: RunningTimer | null };
              if (res.ok && data.current) {
                setCurrent(data.current);
                window.dispatchEvent(
                  new CustomEvent("voho-timer-changed", {
                    detail: {
                      memberName,
                      isRunning: true,
                      startAt: data.current.startAt,
                      durationSeconds: data.current.durationSeconds,
                    },
                  })
                );
              }
            } finally {
              setBusy(false);
            }
          }}
          className="h-12 w-12 rounded-full bg-[#0BA5E9] text-lg font-bold text-white shadow-sm transition hover:bg-[#0994cf] disabled:cursor-not-allowed disabled:bg-slate-300"
          title="Start timer"
        >
          ▶
        </button>

        <button
          type="button"
          disabled={busy || !current}
          onClick={async () => {
            if (!memberName) return;
            setBusy(true);
            try {
              const res = await fetch("/api/time-entries/stop", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ member: memberName, tzOffset: new Date().getTimezoneOffset() }),
              });
              if (res.ok) {
                setCurrent(null);
                window.dispatchEvent(
                  new CustomEvent("voho-timer-changed", {
                    detail: { memberName, isRunning: false, startAt: null, durationSeconds: 0 },
                  })
                );
              }
            } finally {
              setBusy(false);
            }
          }}
          className="h-12 w-12 rounded-full bg-[#0BA5E9] text-lg font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          title="Stop timer"
        >
          ■
        </button>
      </div>
    </div>
  );
}
