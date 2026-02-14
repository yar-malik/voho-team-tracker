"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import GlobalTimerBar from "@/app/components/GlobalTimerBar";
import {
  DEFAULT_POMODORO_SECONDS,
  formatPomodoroTimer,
  incrementPomodoroForToday,
  POMODORO_SYNC_EVENT,
  PomodoroState,
  readPomodoroState,
  writePomodoroState,
} from "@/lib/pomodoroClient";

type IconProps = { className?: string };

function navClass(active: boolean) {
  return `block w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
    active
      ? "border border-sky-200 bg-sky-100 text-sky-900 shadow-sm"
      : "border border-transparent text-slate-700 hover:border-sky-100 hover:bg-sky-50"
  }`;
}

function iconClass() {
  return "h-4 w-4 shrink-0 text-slate-500";
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

function ReportsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="4" y="11" width="3.5" height="9" rx="1.5" />
      <rect x="10.25" y="6.5" width="3.5" height="13.5" rx="1.5" />
      <rect x="16.5" y="14" width="3.5" height="6" rx="1.5" />
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

function setFaviconHref(href: string, stateKey: "idle" | "running") {
  const withVersion = `${href}?state=${stateKey}&v=20260214`;
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
  const defaultTitleRef = useRef("Voho Track");
  const [pomodoroState, setPomodoroState] = useState<PomodoroState>({
    secondsLeft: DEFAULT_POMODORO_SECONDS,
    running: false,
    completionsByDay: {},
    updatedAt: Date.now(),
  });

  useEffect(() => {
    defaultTitleRef.current = document.title || "Voho Track";
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const restored = readPomodoroState();
    setPomodoroState(restored);
    writePomodoroState(restored, "platform-shell");
  }, []);

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
          next = incrementPomodoroForToday({
            ...prev,
            running: false,
            secondsLeft: 0,
          });
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
    <div className="min-h-screen bg-[linear-gradient(180deg,#f7fcff_0%,#f8fbff_100%)]">
      <div className="mx-auto flex w-full max-w-[1700px] gap-4 px-4 py-4 md:px-6">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[280px] shrink-0 rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-[0_20px_40px_rgba(15,23,42,0.08)] backdrop-blur lg:flex lg:flex-col">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-sky-50 to-cyan-50 p-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Voho Track</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-700">{currentMemberName ?? currentUserEmail ?? "Signed in"}</p>
          </div>

          <nav className="mt-5 flex-1 space-y-4">
            <div>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Track</p>
              <div className="mt-2 space-y-1.5">
                <Link href="/track" prefetch className={navClass(isActive(pathname, "/track"))}>
                  {isRunning ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="relative inline-flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
                      </span>
                      <ClockIcon className={iconClass()} />
                      <span className="tabular-nums">{runningLabel}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <ClockIcon className={iconClass()} />
                      <span>Tracking</span>
                    </span>
                  )}
                </Link>
              </div>
            </div>

            <div>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Analyze</p>
              <div className="mt-2 space-y-1.5">
                <Link href="/reports" prefetch className={navClass(isActive(pathname, "/reports"))}>
                  <span className="inline-flex items-center gap-2">
                    <ReportsIcon className={iconClass()} />
                    <span>Reports</span>
                  </span>
                </Link>
                <Link href="/team-overview" prefetch className={navClass(isActive(pathname, "/team-overview"))}>
                  <span className="inline-flex items-center gap-2">
                    <TeamIcon className={iconClass()} />
                    <span>Team overview</span>
                  </span>
                </Link>
              </div>
            </div>

            <div>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Manage</p>
              <div className="mt-2 space-y-1.5">
                <Link href="/projects" prefetch className={navClass(isActive(pathname, "/projects"))}>
                  <span className="inline-flex items-center gap-2">
                    <ProjectsIcon className={iconClass()} />
                    <span>Projects</span>
                  </span>
                </Link>
                <Link
                  href="/members"
                  prefetch
                  className={navClass(isActive(pathname, "/members") || isActive(pathname, "/member"))}
                >
                  <span className="inline-flex items-center gap-2">
                    <MembersIcon className={iconClass()} />
                    <span>Members</span>
                  </span>
                </Link>
                <Link href="/kpis" prefetch className={navClass(isActive(pathname, "/kpis"))}>
                  <span className="inline-flex items-center gap-2">
                    <KpiIcon className={iconClass()} />
                    <span>KPIs</span>
                  </span>
                </Link>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push("/pomodoro")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push("/pomodoro");
                    }
                  }}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                    isActive(pathname, "/pomodoro")
                      ? "border-sky-300 bg-sky-100 text-sky-900"
                      : "border-sky-200 bg-sky-50 text-slate-700"
                  }`}
                >
                  <span className="inline-flex items-center gap-2 font-medium tabular-nums">
                    <PomodoroIcon className={iconClass()} />
                    <span>Pomodoro {formatPomodoroTimer(pomodoroState.secondsLeft)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPomodoroState((prev) => {
                        const next: PomodoroState = {
                          ...prev,
                          secondsLeft: prev.secondsLeft <= 0 ? DEFAULT_POMODORO_SECONDS : prev.secondsLeft,
                          running: !prev.running,
                        };
                        writePomodoroState(next, "platform-shell");
                        return next;
                      });
                    }}
                    aria-label={pomodoroState.running ? "Stop pomodoro timer" : "Start pomodoro timer"}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#0BA5E9] text-white hover:bg-[#0994cf]"
                  >
                    {pomodoroState.running ? (
                      <span className="h-2.5 w-2.5 rounded-sm bg-white" />
                    ) : (
                      <span className="ml-[1px] h-0 w-0 border-y-[5px] border-y-transparent border-l-[7px] border-l-white" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </nav>

          <Link href="/settings" prefetch className={navClass(isActive(pathname, "/settings"))}>
            <span className="inline-flex items-center gap-2">
              <SettingsIcon className={iconClass()} />
              <span>Settings</span>
            </span>
          </Link>

          <div className="mt-4 rounded-xl border border-slate-200 bg-sky-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Tip</p>
            <p className="mt-1">Use Tracking daily and review outcomes in Reports.</p>
          </div>

          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1">
          <GlobalTimerBar memberName={currentMemberName} />
          {children}
        </main>
      </div>
    </div>
  );
}
