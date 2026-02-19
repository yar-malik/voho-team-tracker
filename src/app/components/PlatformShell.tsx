"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import GlobalTimerBar from "@/app/components/GlobalTimerBar";
import {
  completePomodoro,
  formatPomodoroTimer,
  pausePomodoro,
  POMODORO_SYNC_EVENT,
  PomodoroState,
  readPomodoroState,
  startPomodoro,
  writePomodoroState,
} from "@/lib/pomodoroClient";
import { getRealtimeClient } from "@/lib/realtimeClient";

type IconProps = { className?: string };

function navClass(active: boolean) {
  return `block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all duration-200 ${
    active
      ? "bg-sky-50 text-sky-700 border-l-4 border-sky-600"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800 border-l-4 border-transparent"
  }`;
}

function iconClass(active: boolean) {
  return `h-5 w-5 shrink-0 ${active ? "text-sky-600" : "text-slate-400"}`;
}

function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v4.6l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PomodoroIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="13" r="6.8" />
      <path d="M9.5 3.8h5" strokeLinecap="round" />
      <path d="M12 9.5v3.5l2.2 1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m16.8 5.8 1.6-1.2" strokeLinecap="round" />
    </svg>
  );
}

function TeamIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="8" cy="9" r="3" />
      <circle cx="16.5" cy="8.5" r="2.5" />
      <path d="M3.5 18.5a4.5 4.5 0 0 1 9 0v1H3.5z" />
      <path d="M13 19a3.5 3.5 0 0 1 7 0v.5h-7z" />
    </svg>
  );
}

function ProjectsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l1.5 1.5h8.5A2.5 2.5 0 0 1 21 9v9.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5z" />
    </svg>
  );
}

function MembersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="9" cy="8.8" r="2.8" />
      <circle cx="16.8" cy="8.2" r="2.2" />
      <path d="M4 19a5 5 0 0 1 10 0v1H4z" />
      <path d="M14 19a3.8 3.8 0 0 1 7.6 0v1H14z" />
    </svg>
  );
}

function KpiIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4 18h16" strokeLinecap="round" />
      <path d="m5.5 15.5 4-4 3 2.8 5-6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 8.3h2.2v2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path
        d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 12a8.8 8.8 0 0 0-.1-1.3l2-1.5-2-3.5-2.5 1a8.9 8.9 0 0 0-2.2-1.2l-.4-2.6H9.2l-.4 2.6a8.9 8.9 0 0 0-2.2 1.2l-2.5-1-2 3.5 2 1.5A8.7 8.7 0 0 0 4 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.5 2.5-1c.7.5 1.4.9 2.2 1.2l.4 2.6h5.6l.4-2.6c.8-.3 1.5-.7 2.2-1.2l2.5 1 2-3.5-2-1.5c.1-.4.1-.9.1-1.3Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatTimer(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function sumPomodoroCompletions(state: PomodoroState) {
  return Object.values(state.completionsByDay).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function playPomodoroDoneSound() {
  try {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [880, 1174, 1568];
    notes.forEach((freq, index) => {
      const start = now + index * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.13);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    // Ignore audio failures in unsupported/restricted browsers.
  }
}

function setFaviconHref(href: string, stateKey: "idle" | "running") {
  const withVersion = `${href}?state=${stateKey}&v=20260216`;
  const relTargets = ["icon", "shortcut icon", "apple-touch-icon"];

  for (const rel of relTargets) {
    const links = Array.from(document.querySelectorAll(`link[rel='${rel}']`)) as HTMLLinkElement[];
    if (links.length === 0) {
      const created = document.createElement("link");
      created.rel = rel;
      created.href = withVersion;
      document.head.appendChild(created);
      continue;
    }
    for (const link of links) {
      link.href = withVersion;
    }
  }
}

export default function PlatformShell({
  children,
  currentUserEmail,
  currentMemberName,
}: {
  children: ReactNode;
  currentUserEmail: string | null;
  currentMemberName: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [timerStartAt, setTimerStartAt] = useState<string | null>(null);
  const [fallbackDurationSeconds, setFallbackDurationSeconds] = useState(0);
  const [currentTaskLabel, setCurrentTaskLabel] = useState<string>("");
  const [nowMs, setNowMs] = useState(0);
  const defaultTitleRef = useRef("Voho Tracker");
  const [pomodoroState, setPomodoroState] = useState<PomodoroState>({
    secondsLeft: 25 * 60,
    running: false,
    completionsByDay: {},
    sessions: [],
    activeSessionId: null,
    updatedAt: Date.now(),
  });
  const pomodoroReadyRef = useRef(false);
  const completionCountRef = useRef(0);

  useEffect(() => {
    defaultTitleRef.current = document.title || "Voho Tracker";
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const restored = readPomodoroState();
    completionCountRef.current = sumPomodoroCompletions(restored);
    pomodoroReadyRef.current = true;
    setPomodoroState(restored);
    writePomodoroState(restored, "platform-shell");
  }, []);

  useEffect(() => {
    if (!pomodoroReadyRef.current) return;
    const total = sumPomodoroCompletions(pomodoroState);
    if (total > completionCountRef.current) {
      playPomodoroDoneSound();
    }
    completionCountRef.current = total;
  }, [pomodoroState]);

  useEffect(() => {
    const syncListener = (event: Event) => {
      const custom = event as CustomEvent<{ source?: string; state?: PomodoroState }>;
      const incoming = custom.detail?.state;
      const source = custom.detail?.source ?? "";
      if (!incoming || source === "platform-shell") return;
      setPomodoroState(incoming);
    };
    window.addEventListener(POMODORO_SYNC_EVENT, syncListener as EventListener);
    return () => window.removeEventListener(POMODORO_SYNC_EVENT, syncListener as EventListener);
  }, []);

  useEffect(() => {
    if (!pomodoroState.running) return;
    const timer = window.setInterval(() => {
      setPomodoroState((prev) => {
        let next: PomodoroState;
        if (prev.secondsLeft <= 1) {
          next = completePomodoro(prev);
        } else {
          next = { ...prev, secondsLeft: prev.secondsLeft - 1 };
        }
        writePomodoroState(next, "platform-shell");
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pomodoroState.running]);

  useEffect(() => {
    let active = true;
    const member = currentMemberName;
    if (!member) return;
    const resolvedMember: string = member;

    async function loadTimerState() {
      try {
        const currentResponse = await fetch(
          `/api/time-entries/current?member=${encodeURIComponent(resolvedMember)}&_req=${Date.now()}`,
          { cache: "no-store" }
        );
        const currentData = (await currentResponse.json()) as {
          current?: { startAt: string; durationSeconds: number; description?: string | null; projectName?: string | null } | null;
          error?: string;
        };
        if (!currentResponse.ok || currentData.error || !active) return;
        setTimerStartAt(currentData.current?.startAt ?? null);
        setFallbackDurationSeconds(currentData.current?.durationSeconds ?? 0);
        const nextTaskLabel = (currentData.current?.description?.trim() || currentData.current?.projectName?.trim() || "").trim();
        setCurrentTaskLabel(nextTaskLabel);
      } catch {
        // Keep last known timer state on polling errors.
      }
    }

    const handleTimerChanged = (event: Event) => {
      const custom = event as CustomEvent<{
        memberName?: string;
        isRunning?: boolean;
        startAt?: string | null;
        durationSeconds?: number;
        description?: string | null;
        projectName?: string | null;
      }>;
      const detail = custom.detail;
      if (!detail) return;
      if ((detail.memberName ?? "").toLowerCase() !== resolvedMember.toLowerCase()) return;

      if (detail.isRunning) {
        setTimerStartAt(detail.startAt ?? new Date().toISOString());
        setFallbackDurationSeconds(Math.max(0, detail.durationSeconds ?? 0));
        setCurrentTaskLabel((prev) => (detail.description?.trim() || detail.projectName?.trim() || prev).trim());
      } else {
        setTimerStartAt(null);
        setFallbackDurationSeconds(0);
        setCurrentTaskLabel("");
      }
    };

    void loadTimerState();
    const refreshInterval = window.setInterval(() => void loadTimerState(), 60 * 1000);
    const onFocus = () => void loadTimerState();
    window.addEventListener("focus", onFocus);
    window.addEventListener("voho-timer-changed", handleTimerChanged as EventListener);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("voho-timer-changed", handleTimerChanged as EventListener);
    };
  }, [currentMemberName]);

  useEffect(() => {
    const realtime = getRealtimeClient();
    if (!realtime) return;

    const channel = realtime
      .channel(`voho-live-${Math.random().toString(36).slice(2, 10)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_entries" },
        (payload) => {
          const nextRow = (payload.new ?? null) as
            | {
                member_name?: string | null;
                is_running?: boolean | null;
                start_at?: string | null;
                duration_seconds?: number | null;
                description?: string | null;
              }
            | null;
          const prevRow = (payload.old ?? null) as
            | {
                member_name?: string | null;
                is_running?: boolean | null;
              }
            | null;

          const memberName = (nextRow?.member_name || prevRow?.member_name || "").trim();
          if (!memberName) return;

          window.dispatchEvent(new CustomEvent("voho-entries-changed", { detail: { memberName } }));

          const isRunningNow = Boolean(nextRow?.is_running);
          const wasRunning = Boolean(prevRow?.is_running);
          if (payload.eventType === "INSERT" && isRunningNow) {
            window.dispatchEvent(
              new CustomEvent("voho-timer-changed", {
                detail: {
                  memberName,
                  isRunning: true,
                  startAt: nextRow?.start_at ?? null,
                  durationSeconds: Math.max(0, Number(nextRow?.duration_seconds ?? 0)),
                  description: nextRow?.description ?? null,
                },
              })
            );
            return;
          }
          if (payload.eventType === "UPDATE") {
            if (isRunningNow) {
              window.dispatchEvent(
                new CustomEvent("voho-timer-changed", {
                  detail: {
                    memberName,
                    isRunning: true,
                    startAt: nextRow?.start_at ?? null,
                    durationSeconds: Math.max(0, Number(nextRow?.duration_seconds ?? 0)),
                    description: nextRow?.description ?? null,
                  },
                })
              );
              return;
            }
            if (wasRunning && !isRunningNow) {
              window.dispatchEvent(
                new CustomEvent("voho-timer-changed", {
                  detail: {
                    memberName,
                    isRunning: false,
                  },
                })
              );
            }
            return;
          }
          if (payload.eventType === "DELETE" && wasRunning) {
            window.dispatchEvent(
              new CustomEvent("voho-timer-changed", {
                detail: {
                  memberName,
                  isRunning: false,
                },
              })
            );
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_member_stats" },
        () => {
          window.dispatchEvent(new CustomEvent("voho-team-hours-changed"));
        }
      );

    channel.subscribe();
    return () => {
      void realtime.removeChannel(channel);
    };
  }, []);

  const runningSeconds = useMemo(() => {
    if (!timerStartAt) return 0;
    const startedAtMs = new Date(timerStartAt).getTime();
    if (Number.isNaN(startedAtMs)) return Math.max(0, fallbackDurationSeconds);
    return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  }, [timerStartAt, fallbackDurationSeconds, nowMs]);
  const runningLabel = useMemo(() => formatTimer(runningSeconds), [runningSeconds]);
  const isRunning = Boolean(timerStartAt);

  useEffect(() => {
    if (!isRunning) {
      document.title = defaultTitleRef.current;
      setFaviconHref("/favicon-idle-v2.svg", "idle");
      return;
    }
    document.title = currentTaskLabel ? `${runningLabel} • ${currentTaskLabel}` : runningLabel;
    setFaviconHref("/favicon-running-v2.svg", "running");
  }, [isRunning, runningLabel, currentTaskLabel]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex w-full max-w-[1800px] gap-6 px-6 py-5">
        {/* Sidebar */}
        <aside className="sticky top-5 hidden h-[calc(100vh-2.5rem)] w-64 shrink-0 lg:flex lg:flex-col">
          <div className="flex h-full flex-col rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            {/* Logo Area */}
            <div className="bg-gradient-to-r from-sky-600 to-sky-700 px-5 py-6">
              <p className="text-xs font-bold uppercase tracking-widest text-sky-100">Voho Tracker</p>
              <p className="mt-2 truncate text-lg font-semibold text-white">{currentMemberName ?? currentUserEmail ?? "Signed in"}</p>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-6">
              <div>
                <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Time</p>
                <div className="space-y-1">
                  <Link href="/track" prefetch className={navClass(isActive(pathname, "/track"))}>
                    {isRunning ? (
                      <span className="inline-flex items-center gap-3">
                        <span className="relative flex h-3 w-3">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                        </span>
                        <ClockIcon className={iconClass(isActive(pathname, "/track"))} />
                        <span className="tabular-nums font-mono text-emerald-600">{runningLabel}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <ClockIcon className={iconClass(isActive(pathname, "/track"))} />
                        <span>Time Tracking</span>
                      </span>
                    )}
                  </Link>
                </div>
              </div>

              <div>
                <p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Tools</p>
                <div className="space-y-1">
                  <Link href="/pomodoro" prefetch className={navClass(isActive(pathname, "/pomodoro"))}>
                    <span className="inline-flex items-center gap-3">
                      <PomodoroIcon className={iconClass(isActive(pathname, "/pomodoro"))} />
                      <span>Pomodoro</span>
                    </span>
                  </Link>
                  <Link href="/projects" prefetch className={navClass(isActive(pathname, "/projects"))}>
                    <span className="inline-flex items-center gap-3">
                      <ProjectsIcon className={iconClass(isActive(pathname, "/projects"))} />
                      <span>Projects</span>
                    </span>
                  </Link>
                  <Link
                    href="/members"
                    prefetch
                    className={navClass(isActive(pathname, "/members") || isActive(pathname, "/member"))}
                  >
                    <span className="inline-flex items-center gap-3">
                      <MembersIcon className={iconClass(isActive(pathname, "/members") || isActive(pathname, "/member"))} />
                      <span>Members</span>
                    </span>
                  </Link>
                  <Link href="/kpis" prefetch className={navClass(isActive(pathname, "/kpis"))}>
                    <span className="inline-flex items-center gap-3">
                      <KpiIcon className={iconClass(isActive(pathname, "/kpis"))} />
                      <span>KPIs</span>
                    </span>
                  </Link>
                </div>
              </div>
            </nav>

            {/* Footer */}
            <div className="border-t border-slate-200 p-3 space-y-2">
              <Link href="/settings" prefetch className={navClass(isActive(pathname, "/settings"))}>
                <span className="inline-flex items-center gap-3">
                  <SettingsIcon className={iconClass(isActive(pathname, "/settings"))} />
                  <span>Settings</span>
                </span>
              </Link>
              
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1">
          <GlobalTimerBar memberName={currentMemberName} />
          {children}
        </main>
      </div>
    </div>
  );
}
