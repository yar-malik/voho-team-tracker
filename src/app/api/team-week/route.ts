import { NextRequest, NextResponse } from "next/server";
import {
  fetchProjectNames,
  fetchTimeEntries,
  getEntryProjectName,
  getTeamMembers,
  getTokenForMember,
} from "@/lib/toggl";
import { persistHistoricalError, persistHistoricalSnapshot, persistWeeklyRollup } from "@/lib/historyStore";
import { getQuotaLockState, setQuotaLock } from "@/lib/quotaLockStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUDED_PROJECT_NAME = "non-work-task";

type DaySummary = {
  date: string;
  seconds: number;
  entryCount: number;
};

type MemberWeekPayload = {
  name: string;
  totalSeconds: number;
  entryCount: number;
  days: DaySummary[];
};

type StoredStatRow = {
  stat_date: string;
  member_name: string;
  total_seconds: number;
  entry_count: number;
  updated_at: string;
};

function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders() {
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: token,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getEntrySeconds(entry: Awaited<ReturnType<typeof fetchTimeEntries>>[number]) {
  if (entry.duration >= 0) return entry.duration;
  const startedAt = new Date(entry.start).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function getLastSevenDates(endDate: string) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function parseTzOffsetMinutes(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-720, Math.min(840, Math.trunc(parsed)));
}

function getDateKeyAtOffset(iso: string, tzOffsetMinutes: number) {
  const utcMs = new Date(iso).getTime();
  if (Number.isNaN(utcMs)) return null;
  const shifted = new Date(utcMs - tzOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function buildUtcRangeFromLocalDates(startDate: string, endDate: string, tzOffsetMinutes: number) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0) + tzOffsetMinutes * 60 * 1000;
  const endMs = Date.UTC(ey, em - 1, ed, 23, 59, 59, 999) + tzOffsetMinutes * 60 * 1000;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

function parseRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.ceil(parsed);
}

async function readStoredWeek(
  members: Array<{ name: string }>,
  startDate: string,
  endDate: string,
  weekDates: string[]
): Promise<{ members: MemberWeekPayload[]; cachedAt: string } | null> {
  if (!isSupabaseConfigured()) return null;
  if (members.length === 0) return { members: [], cachedAt: new Date().toISOString() };

  const base = process.env.SUPABASE_URL!;
  const quotedMembers = members
    .map((member) => `"${member.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  const memberFilter = `in.(${quotedMembers})`;
  const url =
    `${base}/rest/v1/daily_member_stats` +
    `?select=stat_date,member_name,total_seconds,entry_count,updated_at` +
    `&member_name=${encodeURIComponent(memberFilter)}` +
    `&stat_date=gte.${encodeURIComponent(startDate)}` +
    `&stat_date=lte.${encodeURIComponent(endDate)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as StoredStatRow[];

  const grouped = new Map<string, MemberWeekPayload>(
    members.map((member) => [
      member.name,
      {
        name: member.name,
        totalSeconds: 0,
        entryCount: 0,
        days: weekDates.map((date) => ({ date, seconds: 0, entryCount: 0 })),
      },
    ])
  );

  let latestUpdatedAt: string | null = null;
  for (const row of rows) {
    latestUpdatedAt = latestUpdatedAt ? (row.updated_at > latestUpdatedAt ? row.updated_at : latestUpdatedAt) : row.updated_at;
    const member = grouped.get(row.member_name);
    if (!member) continue;
    const day = member.days.find((item) => item.date === row.stat_date);
    if (!day) continue;
    day.seconds = row.total_seconds;
    day.entryCount = row.entry_count;
  }

  const resultMembers = Array.from(grouped.values()).map((member) => ({
    ...member,
    totalSeconds: member.days.reduce((acc, day) => acc + day.seconds, 0),
    entryCount: member.days.reduce((acc, day) => acc + day.entryCount, 0),
  }));

  return {
    members: resultMembers,
    cachedAt: latestUpdatedAt ?? new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const forceRefresh = searchParams.get("refresh") === "1";
  const tzOffsetMinutes = parseTzOffsetMinutes(searchParams.get("tzOffset"));

  const endDate = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(endDate)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const weekDates = getLastSevenDates(endDate);
  const startDate = weekDates[0];
  const members = getTeamMembers();
  if (members.length === 0) {
    return NextResponse.json({ error: "No members configured" }, { status: 400 });
  }

  if (!forceRefresh) {
    const stored = await readStoredWeek(members, startDate, endDate, weekDates);
    if (!stored) {
      return NextResponse.json({ error: "Supabase history is not configured" }, { status: 500 });
    }
    const hasData = stored.members.some((member) => member.totalSeconds > 0 || member.entryCount > 0);
    if (!hasData) {
      return NextResponse.json({
        startDate,
        endDate,
        weekDates,
        members: stored.members,
        cachedAt: stored.cachedAt,
        stale: true,
        warning: "No stored weekly history yet. Click Refresh now to import and save from Toggl.",
        source: "db",
        cooldownActive: false,
        retryAfterSeconds: 0,
      });
    }
    const sortedStored = [...stored.members].sort((a, b) => {
      if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
      if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json({
      startDate,
      endDate,
      weekDates,
      members: sortedStored,
      cachedAt: stored.cachedAt,
      stale: false,
      warning: null,
      source: "db",
      cooldownActive: false,
      retryAfterSeconds: 0,
    });
  }

  const quotaLock = await getQuotaLockState();
  if (quotaLock.active) {
    const stored = await readStoredWeek(members, startDate, endDate, weekDates);
    return NextResponse.json({
      startDate,
      endDate,
      weekDates,
      members:
        stored?.members ??
        members.map((member) => ({
          name: member.name,
          totalSeconds: 0,
          entryCount: 0,
          days: weekDates.map((date) => ({ date, seconds: 0, entryCount: 0 })),
        })),
      cachedAt: stored?.cachedAt ?? new Date().toISOString(),
      stale: true,
      warning: "Toggl quota cooldown active. Showing stored weekly data from Supabase.",
      source: "db_fallback",
      cooldownActive: true,
      retryAfterSeconds: quotaLock.retryAfterSeconds,
    });
  }

  try {
    const range = buildUtcRangeFromLocalDates(startDate, endDate, tzOffsetMinutes);
    const results = await Promise.all(
      members.map(async (member) => {
        const token = getTokenForMember(member.name);
        const emptyDays = weekDates.map((date) => ({ date, seconds: 0, entryCount: 0 }));
        if (!token) {
          return { name: member.name, totalSeconds: 0, entryCount: 0, days: emptyDays };
        }

        const entries = await fetchTimeEntries(token, range.startIso, range.endIso);
        const projectNames = await fetchProjectNames(token, entries);
        const dayMap = new Map<string, DaySummary>(weekDates.map((date) => [date, { date, seconds: 0, entryCount: 0 }]));
        const entriesByLocalDate = new Map<string, Array<Awaited<ReturnType<typeof fetchTimeEntries>>[number]>>();

        for (const entry of entries) {
          const projectName = getEntryProjectName(entry, projectNames);
          if ((projectName ?? "").trim().toLowerCase() === EXCLUDED_PROJECT_NAME) continue;
          const day = getDateKeyAtOffset(entry.start, tzOffsetMinutes);
          if (!day) continue;
          const bucket = dayMap.get(day);
          if (!bucket) continue;
          bucket.seconds += getEntrySeconds(entry);
          bucket.entryCount += 1;

          const current = entriesByLocalDate.get(day) ?? [];
          current.push({ ...entry, project_name: projectName ?? null } as Awaited<ReturnType<typeof fetchTimeEntries>>[number]);
          entriesByLocalDate.set(day, current);
        }

        await Promise.all(
          Array.from(entriesByLocalDate.entries()).map(([localDate, list]) =>
            persistHistoricalSnapshot("team", member.name, localDate, list)
          )
        );

        const days = weekDates.map((date) => dayMap.get(date) ?? { date, seconds: 0, entryCount: 0 });
        const totalSeconds = days.reduce((acc, day) => acc + day.seconds, 0);
        const entryCount = days.reduce((acc, day) => acc + day.entryCount, 0);
        return { name: member.name, totalSeconds, entryCount, days };
      })
    );

    const sorted = [...results].sort((a, b) => {
      if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
      if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
      return a.name.localeCompare(b.name);
    });

    await persistWeeklyRollup(endDate, sorted);

    return NextResponse.json({
      startDate,
      endDate,
      weekDates,
      members: sorted,
      cachedAt: new Date().toISOString(),
      stale: false,
      warning: null,
      source: "toggl_sync",
      cooldownActive: false,
      retryAfterSeconds: 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = (error as Error & { status?: number }).status ?? 502;
    const retryAfterSeconds = parseRetryAfterSeconds((error as Error & { retryAfter?: string | null }).retryAfter ?? null);
    const quotaRemaining = (error as Error & { quotaRemaining?: string | null }).quotaRemaining ?? null;
    const quotaResetsIn = (error as Error & { quotaResetsIn?: string | null }).quotaResetsIn ?? null;

    if (status === 402) {
      await setQuotaLock({
        status,
        lockForSeconds: retryAfterSeconds ?? 60 * 60,
        retryHintSeconds: retryAfterSeconds ?? null,
        reason: "Toggl 402 quota reached",
      });
    } else if (status === 429) {
      await setQuotaLock({
        status,
        lockForSeconds: retryAfterSeconds ?? 5 * 60,
        retryHintSeconds: retryAfterSeconds ?? null,
        reason: "Toggl 429 rate limited",
      });
    }

    const stored = await readStoredWeek(members, startDate, endDate, weekDates);
    if (stored) {
      await persistHistoricalError("team", null, endDate, message);
      const sortedStored = [...stored.members].sort((a, b) => {
        if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
        if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
        return a.name.localeCompare(b.name);
      });
      return NextResponse.json({
        startDate,
        endDate,
        weekDates,
        members: sortedStored,
        cachedAt: stored.cachedAt,
        stale: true,
        warning: "Toggl refresh failed. Showing stored weekly data from Supabase.",
        quotaRemaining,
        quotaResetsIn,
        source: "db_fallback",
        cooldownActive: status === 402 || status === 429,
        retryAfterSeconds: retryAfterSeconds ?? 0,
      });
    }

    await persistHistoricalError("team", null, endDate, message);
    return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
  }
}
