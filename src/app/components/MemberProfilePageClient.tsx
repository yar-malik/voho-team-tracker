"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type MemberProfileResponse = {
  startDate: string;
  endDate: string;
  weekDates: string[];
  members: Array<{
    name: string;
    totalSeconds: number;
    entryCount: number;
    activeDays: number;
    averageDailySeconds: number;
    averageEntrySeconds: number;
    uniqueProjects: number;
    uniqueDescriptions: number;
    topProject: string;
    topProjectSharePct: number;
    days: Array<{ date: string; seconds: number; entryCount: number }>;
    workItems: Array<{ project: string; description: string; seconds: number; entryCount: number }>;
    kpis: Array<{ label: string; value: string; source: "sheet" | "auto" }>;
    aiAnalysis: string | null;
  }>;
  cachedAt?: string;
  stale?: boolean;
  warning?: string | null;
  error?: string;
  aiEnabled?: boolean;
  aiWarning?: string | null;
};

const AUTO_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatDateTime(iso: string | null | undefined): string {
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

export default function MemberProfilePageClient({
  memberName,
  initialDate,
}: {
  memberName: string;
  initialDate: string;
}) {
  const [date, setDate] = useState(initialDate);
  const [refreshTick, setRefreshTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<MemberProfileResponse | null>(null);
  const forceRefreshRef = useRef(false);

  useEffect(() => {
    let active = true;

    const params = new URLSearchParams({
      member: memberName,
      date,
      tzOffset: String(new Date().getTimezoneOffset()),
    });
    if (forceRefreshRef.current) {
      params.set("refresh", "1");
    }

    fetch(`/api/member-profiles?${params.toString()}`)
      .then(async (res) => {
        const data = (await res.json()) as MemberProfileResponse;
        if (!res.ok || data.error) {
          throw new Error(data.error || "Failed to load member profile");
        }
        return data;
      })
      .then((data) => {
        if (!active) return;
        setPayload(data);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
        setPayload(null);
      })
      .finally(() => {
        forceRefreshRef.current = false;
      });

    return () => {
      active = false;
    };
  }, [memberName, date, refreshTick]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setRefreshTick((value) => value + 1);
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  const profile = payload?.members[0] ?? null;
  const maxDaySeconds = useMemo(() => {
    if (!profile) return 1;
    return profile.days.reduce((max, day) => Math.max(max, day.seconds), 1);
  }, [profile]);

  return (
    <div className="min-h-screen bg-[#EDFDF5]">
      <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-8 py-8 md:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-700">Member Profile</p>
            <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">{memberName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              Back to dashboard
            </Link>
            <button
              type="button"
              onClick={() => {
                forceRefreshRef.current = true;
                setRefreshTick((value) => value + 1);
              }}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Refresh now
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="text-sm font-medium text-slate-600">End date</label>
          <input
            type="date"
            className="mt-2 w-full max-w-[220px] rounded-xl border border-slate-300 px-3 py-2 text-slate-900"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <p className="mt-2 text-xs text-slate-500">
            Auto-refresh checks cached data every 15 minutes. Toggl is called only when you click Refresh now.
          </p>
        </div>

        {!payload && !error && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">Loading profile…</div>
        )}
        {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-800">{error}</div>}

        {payload && !error && !profile && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
            No profile data found for this member.
          </div>
        )}

        {payload && !error && profile && (
          <div className="space-y-4">
            {(payload?.warning || payload?.stale) && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {payload.warning || "Showing cached snapshot."}
              </p>
            )}
            {payload?.aiWarning && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {payload.aiWarning}
              </p>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">7-day total</p>
                <p className="text-sm font-semibold text-slate-900">{formatDuration(profile.totalSeconds)}</p>
              </div>
              {profile.kpis.map((kpi) => (
                <div key={kpi.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{kpi.label}</p>
                  <p className="text-sm font-semibold text-slate-900">{kpi.value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-slate-800">Last 7 days</h2>
                <div className="mt-3 flex h-52 items-end gap-2">
                  {profile.days.map((day) => {
                    const height = Math.max(10, Math.round((day.seconds / maxDaySeconds) * 170));
                    return (
                      <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-cyan-600 to-sky-400"
                          style={{ height: `${height}px` }}
                          title={`${formatShortDateLabel(day.date)}: ${formatDuration(day.seconds)} (${day.entryCount} entries)`}
                        />
                        <p className="text-[10px] text-slate-500">{formatShortDateLabel(day.date)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-semibold text-slate-800">Project + description breakdown</h2>
                {profile.workItems.length === 0 && (
                  <p className="mt-2 text-sm text-slate-500">No work items in this range.</p>
                )}
                {profile.workItems.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {profile.workItems.map((item) => (
                      <div key={`${item.project}-${item.description}`} className="rounded-md bg-slate-50 px-2 py-1">
                        <p className="truncate text-sm text-slate-800">
                          {item.project} | {item.description}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDuration(item.seconds)} | {item.entryCount} entries
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-800">AI analysis</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
                {profile.aiAnalysis || "AI analysis is unavailable for this profile right now."}
              </p>
              <p className="mt-3 text-xs text-slate-500">Snapshot time: {formatDateTime(payload?.cachedAt)}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
