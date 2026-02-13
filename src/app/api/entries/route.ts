import { NextRequest, NextResponse } from "next/server";
import {
  fetchCurrentEntry,
  fetchProjectNames,
  fetchTimeEntries,
  getEntryProjectName,
  getTeamMembers,
  getTokenForMember,
  sortEntriesByStart,
} from "@/lib/toggl";
import { persistHistoricalError, persistHistoricalSnapshot } from "@/lib/historyStore";
import { getQuotaLockState, setQuotaLock } from "@/lib/quotaLockStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type EntriesPayload = {
  entries: Array<Awaited<ReturnType<typeof fetchTimeEntries>>[number] & { project_name?: string | null }>;
  current: (Awaited<ReturnType<typeof fetchCurrentEntry>> & { project_name?: string | null }) | null;
  totalSeconds: number;
  date: string;
  cachedAt: string;
  stale?: boolean;
  warning?: string | null;
  quotaRemaining?: string | null;
  quotaResetsIn?: string | null;
};

type StoredEntryRow = {
  toggl_entry_id: number;
  description: string | null;
  start_at: string;
  stop_at: string | null;
  duration_seconds: number;
  is_running: boolean;
  tags: string[] | null;
  project_key: string | null;
  synced_at: string;
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

function parseTzOffsetMinutes(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-720, Math.min(840, Math.trunc(parsed)));
}

function buildUtcDayRange(dateInput: string, tzOffsetMinutes: number) {
  const [yearStr, monthStr, dayStr] = dateInput.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1;
  const day = Number(dayStr);
  const startMs = Date.UTC(year, month, day, 0, 0, 0, 0) + tzOffsetMinutes * 60 * 1000;
  const endMs = Date.UTC(year, month, day, 23, 59, 59, 999) + tzOffsetMinutes * 60 * 1000;
  return { startDate: new Date(startMs).toISOString(), endDate: new Date(endMs).toISOString() };
}

function parseRetryAfterSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.ceil(parsed);
}

async function readStoredEntries(member: string, startIso: string, endIso: string): Promise<EntriesPayload | null> {
  if (!isSupabaseConfigured()) return null;
  const base = process.env.SUPABASE_URL!;

  const url =
    `${base}/rest/v1/time_entries` +
    `?select=toggl_entry_id,description,start_at,stop_at,duration_seconds,is_running,tags,project_key,synced_at` +
    `&member_name=eq.${encodeURIComponent(member)}` +
    `&start_at=gte.${encodeURIComponent(startIso)}` +
    `&start_at=lte.${encodeURIComponent(endIso)}` +
    `&order=start_at.asc`;

  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as StoredEntryRow[];
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const projectKeys = Array.from(
    new Set(rows.map((row) => row.project_key).filter((value): value is string => typeof value === "string" && value.length > 0))
  );
  const projectNameByKey = new Map<string, string>();
  if (projectKeys.length > 0) {
    const projectFilter = `in.(${projectKeys.map((key) => `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
    const projectsUrl = `${base}/rest/v1/projects?select=project_key,project_name&project_key=${encodeURIComponent(projectFilter)}`;
    const projectsResponse = await fetch(projectsUrl, {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (projectsResponse.ok) {
      const projectRows = (await projectsResponse.json()) as Array<{ project_key: string; project_name: string }>;
      for (const row of projectRows) {
        if (!row.project_key) continue;
        projectNameByKey.set(row.project_key, row.project_name);
      }
    }
  }

  const entries = rows.map((row) => ({
    id: row.toggl_entry_id,
    description: row.description,
    start: row.start_at,
    stop: row.stop_at,
    duration: row.duration_seconds,
    tags: row.tags ?? [],
    project_name: row.project_key ? projectNameByKey.get(row.project_key) ?? null : null,
  }));

  const current =
    rows
      .filter((row) => row.is_running)
      .sort((a, b) => (a.start_at < b.start_at ? 1 : -1))
      .map((row) => ({
        id: row.toggl_entry_id,
        description: row.description,
        start: row.start_at,
        stop: row.stop_at,
        duration: row.duration_seconds,
        tags: row.tags ?? [],
        project_name: row.project_key ? projectNameByKey.get(row.project_key) ?? null : null,
      }))[0] ?? null;

  const totalSeconds = entries.reduce((acc, entry) => acc + Math.max(0, entry.duration), 0);
  const cachedAt = rows.reduce((latest, row) => (row.synced_at > latest ? row.synced_at : latest), rows[0].synced_at);

  return {
    entries,
    current,
    totalSeconds,
    date: startIso.slice(0, 10),
    cachedAt,
    stale: false,
    warning: null,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const member = searchParams.get("member");
  const dateParam = searchParams.get("date");
  const forceRefresh = searchParams.get("refresh") === "1";
  const tzOffsetMinutes = parseTzOffsetMinutes(searchParams.get("tzOffset"));

  if (!member) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }

  const members = getTeamMembers();
  if (!members.some((item) => item.name.toLowerCase() === member.toLowerCase())) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  const dateInput = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(dateInput)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const { startDate, endDate } = buildUtcDayRange(dateInput, tzOffsetMinutes);

  if (!forceRefresh) {
    const stored = await readStoredEntries(member, startDate, endDate);
    if (stored) {
      return NextResponse.json({
        ...stored,
        date: dateInput,
        stale: false,
        warning: null,
        source: "db",
        cooldownActive: false,
        retryAfterSeconds: 0,
      });
    }
    return NextResponse.json({
      entries: [],
      current: null,
      totalSeconds: 0,
      date: dateInput,
      cachedAt: new Date().toISOString(),
      stale: true,
      warning: "No stored entries for this day yet. Click Refresh now to import and save from Toggl.",
      source: "db",
      cooldownActive: false,
      retryAfterSeconds: 0,
    });
  }

  const quotaLock = await getQuotaLockState();
  if (quotaLock.active) {
    const stored = await readStoredEntries(member, startDate, endDate);
    return NextResponse.json({
      ...(stored ?? {
        entries: [],
        current: null,
        totalSeconds: 0,
        date: dateInput,
        cachedAt: new Date().toISOString(),
      }),
      date: dateInput,
      stale: true,
      warning: "Toggl quota cooldown active. Showing stored data from Supabase.",
      source: "db_fallback",
      cooldownActive: true,
      retryAfterSeconds: quotaLock.retryAfterSeconds,
    });
  }

  const token = getTokenForMember(member);
  if (!token) {
    return NextResponse.json({ error: "Missing token for member" }, { status: 400 });
  }

  const nowMs = Date.now();
  const isCurrentWindow = nowMs >= new Date(startDate).getTime() && nowMs <= new Date(endDate).getTime();

  try {
    const [entries, current] = await Promise.all([
      fetchTimeEntries(token, startDate, endDate),
      isCurrentWindow ? fetchCurrentEntry(token) : Promise.resolve(null),
    ]);
    const projectNames = await fetchProjectNames(token, current ? [...entries, current] : entries);
    const sortedEntries = sortEntriesByStart(entries).map((entry) => ({
      ...entry,
      project_name: getEntryProjectName(entry, projectNames),
    }));
    const enrichedCurrent = current
      ? {
          ...current,
          project_name: getEntryProjectName(current, projectNames),
        }
      : null;

    const totalSeconds = sortedEntries.reduce((acc, entry) => {
      if (entry.duration >= 0) return acc + entry.duration;
      const startedAt = new Date(entry.start).getTime();
      if (Number.isNaN(startedAt)) return acc;
      return acc + Math.floor((Date.now() - startedAt) / 1000);
    }, 0);

    await persistHistoricalSnapshot("entries", member, dateInput, sortedEntries);

    const payload: EntriesPayload = {
      entries: sortedEntries,
      current: enrichedCurrent,
      totalSeconds,
      date: dateInput,
      cachedAt: new Date().toISOString(),
    };
    return NextResponse.json({
      ...payload,
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

    const stored = await readStoredEntries(member, startDate, endDate);
    if (stored) {
      await persistHistoricalError("entries", member, dateInput, message);
      return NextResponse.json({
        ...stored,
        date: dateInput,
        stale: true,
        warning: "Toggl refresh failed. Showing stored data from Supabase.",
        quotaRemaining,
        quotaResetsIn,
        source: "db_fallback",
        cooldownActive: status === 402 || status === 429,
        retryAfterSeconds: retryAfterSeconds ?? 0,
      });
    }

    await persistHistoricalError("entries", member, dateInput, message);
    return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
  }
}
