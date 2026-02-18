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
  current: TimeEntry | null;
  totalSeconds: number;
  date: string;
  cachedAt?: string;
  warning?: string | null;
  error?: string;
};

type MemberProfileResponse = {
  members: Array<{
    name: string;
    totalSeconds: number;
    entryCount: number;
    activeDays: number;
    averageDailySeconds: number;
    averageEntrySeconds: number;
    uniqueProjects: number;
    topProject: string;
    topProjectSharePct: number;
    kpis?: Array<{ label: string; value: string; source: "sheet" | "auto" }>;
    aiAnalysis: string | null;
  }>;
  warning?: string | null;
  error?: string;
};

type TeamWeekResponse = {
  startDate: string;
  endDate: string;
  weekDates: string[];
  members: Array<{
    name: string;
    totalSeconds: number;
    entryCount: number;
    days: Array<{ date: string; seconds: number; entryCount: number }>;
  }>;
  error?: string;
};

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  const [entries, setEntries] = useState<EntriesResponse | null>(null);
  const [profilePayload, setProfilePayload] = useState<MemberProfileResponse | null>(null);
  const [weekData, setWeekData] = useState<TeamWeekResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      fetch(`/api/member-profiles?${params.toString()}`, { cache: "no-store" }).then(async (res) => {
        const data = (await res.json()) as MemberProfileResponse;
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load profile");
        return data;
      }),
      fetch(`/api/team-week?date=${encodeURIComponent(date)}&_req=${Date.now()}`, { cache: "no-store" }).then(async (res) => {
        const data = (await res.json()) as TeamWeekResponse;
        if (!res.ok || data.error) throw new Error(data.error || "Failed to load week data");
        return data;
      }),
    ])
      .then(([entriesData, profileData, weekDataResponse]) => {
        if (!active) return;
        setEntries(entriesData);
        setProfilePayload(profileData);
        setWeekData(weekDataResponse);
        setError(null);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
      });

    return () => {
      active = false;
    };
  }, [memberName, date]);

  const profile = profilePayload?.members[0] ?? null;

  const stats = useMemo(() => {
    if (!profile) {
      return { total: "0h 0m", count: 0, avgEntry: "0h 0m", activeDays: "0/7" };
    }
    return {
      total: formatDuration(profile.totalSeconds),
      count: profile.entryCount,
      avgEntry: formatDuration(profile.averageEntrySeconds),
      activeDays: `${profile.activeDays}/7`,
    };
  }, [profile]);

  const memberWeekSeries = useMemo(() => {
    if (!weekData || !memberName) return [] as Array<{ date: string; seconds: number }>;
    const memberData = weekData.members.find((m) => m.name.toLowerCase() === memberName.toLowerCase());
    if (!memberData) return [] as Array<{ date: string; seconds: number }>;
    return weekData.weekDates.map((day) => ({
      date: day,
      seconds: memberData.days.find((d) => d.date === day)?.seconds ?? 0,
    }));
  }, [weekData, memberName]);

  const memberWeekMaxSeconds = useMemo(
    () => memberWeekSeries.reduce((max, item) => Math.max(max, item.seconds), 0),
    [memberWeekSeries]
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-rose-50/40 p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Member details</p>
            <h1 className="text-2xl font-semibold text-slate-900">{memberName}</h1>
          </div>
          <div>
            <label className="text-xs text-slate-500">Date</label>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="ml-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {(entries?.warning || profilePayload?.warning) && (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-700">{entries?.warning || profilePayload?.warning}</p>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-rose-50/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-sky-50/50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Entries</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.count}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-emerald-50/50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Avg/entry</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.avgEntry}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-amber-50/60 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Active days</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{stats.activeDays}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Last 7 days</h2>
        <p className="mt-1 text-sm text-slate-600">Daily worked hours for {memberName}.</p>
        {memberWeekSeries.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No weekly data yet.</p>
        ) : (
          <div className="mt-4">
            <div className="flex h-48 items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {memberWeekSeries.map((item) => {
                const barHeight = memberWeekMaxSeconds > 0 ? Math.max(12, Math.round((item.seconds / memberWeekMaxSeconds) * 100)) : 12;
                return (
                  <div key={item.date} className="flex w-full flex-col items-center gap-2">
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-sky-600 to-cyan-400 transition-all duration-300 hover:from-sky-500 hover:to-cyan-300"
                      style={{ height: `${barHeight}%` }}
                      title={`${formatShortDateLabel(item.date)}: ${formatDuration(item.seconds)}`}
                    />
                    <p className="text-[11px] font-medium text-slate-600">{formatShortDateLabel(item.date)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Time entries</h2>
        <div className="mt-3 overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-2">Start</th>
                <th className="px-4 py-2">End</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {(entries?.entries ?? []).map((entry) => (
                <tr key={`${entry.id}-${entry.start}`} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-700">{formatTime(entry.start)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatTime(entry.stop)}</td>
                  <td className="px-4 py-2 text-slate-700">{formatDuration(Math.max(0, entry.duration))}</td>
                  <td className="px-4 py-2 text-slate-700">{entry.project_name || "No project"}</td>
                  <td className="px-4 py-2 text-slate-900">{entry.description || "(No description)"}</td>
                </tr>
              ))}
              {(entries?.entries ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                    No entries for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">KPIs</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {(profile?.kpis ?? []).map((kpi) => (
            <div key={kpi.label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">{kpi.label}</p>
              <p className="text-sm font-semibold text-slate-900">{kpi.value}</p>
            </div>
          ))}
          {(profile?.kpis ?? []).length === 0 && <p className="text-sm text-slate-500">No KPIs yet.</p>}
        </div>
        {profile?.aiAnalysis && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">AI analysis</p>
            <p className="whitespace-pre-line">{profile.aiAnalysis}</p>
          </div>
        )}
      </section>
    </div>
  );
}
