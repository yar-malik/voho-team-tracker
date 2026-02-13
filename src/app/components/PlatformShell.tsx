"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";

function navClass(active: boolean) {
  return `block w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
    active
      ? "border border-rose-200 bg-gradient-to-r from-rose-100 to-fuchsia-100 text-rose-900 shadow-sm"
      : "border border-transparent text-slate-700 hover:border-sky-100 hover:bg-sky-50"
  }`;
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

function buildTimerFaviconDataUrl(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#111827";
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = "#ffffff";
  context.font = "bold 10px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 32, 34);
  return canvas.toDataURL("image/png");
}

function setFaviconHref(href: string) {
  let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
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
  const [timerStartAt, setTimerStartAt] = useState<string | null>(null);
  const [fallbackDurationSeconds, setFallbackDurationSeconds] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const defaultTitleRef = useRef("Voho Platform");
  const defaultFaviconHrefRef = useRef("/favicon.ico");

  useEffect(() => {
    defaultTitleRef.current = document.title || "Voho Platform";
    const existingIcon = (document.querySelector("link[rel='icon']") as HTMLLinkElement | null)?.href;
    if (existingIcon) defaultFaviconHrefRef.current = existingIcon;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
          current?: { startAt: string; durationSeconds: number } | null;
          error?: string;
        };
        if (!currentResponse.ok || currentData.error || !active) return;
        setTimerStartAt(currentData.current?.startAt ?? null);
        setFallbackDurationSeconds(currentData.current?.durationSeconds ?? 0);
      } catch {
        // Keep last known timer state on polling errors.
      }
    }

    void loadTimerState();
    const refreshInterval = window.setInterval(() => void loadTimerState(), 60 * 1000);
    const onFocus = () => void loadTimerState();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", onFocus);
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
      setFaviconHref(defaultFaviconHrefRef.current);
      return;
    }
    document.title = `${runningLabel} • ${defaultTitleRef.current}`;
    const faviconDataUrl = buildTimerFaviconDataUrl(runningLabel);
    if (faviconDataUrl) setFaviconHref(faviconDataUrl);
  }, [isRunning, runningLabel]);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#fef7ff_0%,#f5fbff_35%,#f6fffb_100%)]">
      <div className="mx-auto flex w-full max-w-[1700px] gap-4 px-4 py-4 md:px-6">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[280px] shrink-0 rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-[0_20px_40px_rgba(15,23,42,0.08)] backdrop-blur lg:flex lg:flex-col">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-rose-50 via-sky-50 to-emerald-50 p-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Voho Platform</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-700">{currentUserEmail ?? "Signed in"}</p>
          </div>

          <nav className="mt-5 flex-1 space-y-4">
            <div>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Track</p>
              <div className="mt-2 space-y-1.5">
                <Link href="/track" className={navClass(isActive(pathname, "/track"))}>
                  {isRunning ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="relative inline-flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="tabular-nums">{runningLabel}</span>
                    </span>
                  ) : (
                    "Tracking"
                  )}
                </Link>
              </div>
            </div>

            <div>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Analyze</p>
              <div className="mt-2 space-y-1.5">
                <Link href="/reports" className={navClass(isActive(pathname, "/reports"))}>
                  Reports
                </Link>
                <Link href="/team-overview" className={navClass(isActive(pathname, "/team-overview"))}>
                  Team overview
                </Link>
              </div>
            </div>

            <div>
              <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Manage</p>
              <div className="mt-2 space-y-1.5">
                <Link href="/projects" className={navClass(isActive(pathname, "/projects"))}>
                  Projects
                </Link>
                <Link href="/members" className={navClass(isActive(pathname, "/members") || isActive(pathname, "/member"))}>
                  Members
                </Link>
                <Link href="/kpis" className={navClass(isActive(pathname, "/kpis"))}>
                  KPIs
                </Link>
              </div>
            </div>
          </nav>

          <div className="mt-4 rounded-xl border border-slate-200 bg-gradient-to-r from-sky-50 to-violet-50 p-3 text-xs text-slate-600">
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

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
