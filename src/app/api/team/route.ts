import { NextRequest, NextResponse } from "next/server";
import {
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

type MemberPayload = {
  name: string;
  entries: Array<Awaited<ReturnType<typeof fetchTimeEntries>>[number] & { project_name?: string | null }>;
  current: null;
  totalSeconds: number;
};

type StoredEntryRow = {
  member_name: string;
  toggl_entry_id: number;
  description: string | null;
  start_at: string;
  stop_at: string | null;
  duration_seconds: number;
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

async function readStoredTeam(
  members: Array<{ name: string }>,
  startIso: string,
  endIso: string
): Promise<{ members: MemberPayload[]; cachedAt: string } | null> {
  if (!isSupabaseConfigured()) return null;
  if (members.length === 0) return { members: [], cachedAt: new Date().toISOString() };

  const base = process.env.SUPABASE_URL!;
  const quotedMembers = members
    .map((member) => `"${member.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  const memberFilter = `in.(${quotedMembers})`;
  const url =
    `${base}/rest/v1/time_entries` +
    `?select=member_name,toggl_entry_id,description,start_at,stop_at,duration_seconds,tags,project_key,synced_at` +
    `&member_name=${encodeURIComponent(memberFilter)}` +
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

  const grouped = new Map<string, MemberPayload>(
    members.map((member) => [member.name, { name: member.name, entries: [], current: null, totalSeconds: 0 }])
  );

  let latestSyncedAt: string | null = null;
  for (const row of rows) {
    const syncedAt = row.synced_at;
    if (
      !latestSyncedAt ||
      new Date(syncedAt).getTime() > new Date(latestSyncedAt).getTime()
    ) {
      latestSyncedAt = syncedAt;
    }
    const bucket = grouped.get(row.member_name);
    if (!bucket) continue;
    const entry = {
      id: row.toggl_entry_id,
      description: row.description,
      start: row.start_at,
      stop: row.stop_at,
      duration: row.duration_seconds,
      tags: row.tags ?? [],
      project_name: row.project_key ? projectNameByKey.get(row.project_key) ?? null : null,
    };
    bucket.entries.push(entry);
    bucket.totalSeconds += Math.max(0, row.duration_seconds);
  }

  const payloadMembers = Array.from(grouped.values()).map((member) => ({
    ...member,
    entries: sortEntriesByStart(member.entries),
  }));
  if (rows.length === 0) {
    return {
      members: payloadMembers,
      cachedAt: new Date().toISOString(),
    };
  }

  return {
    members: payloadMembers,
    cachedAt: latestSyncedAt ?? new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const forceRefresh = searchParams.get("refresh") === "1";
  const tzOffsetMinutes = parseTzOffsetMinutes(searchParams.get("tzOffset"));

  const dateInput = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(dateInput)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const members = getTeamMembers();
  if (members.length === 0) {
    return NextResponse.json({ error: "No members configured" }, { status: 400 });
  }

  const { startDate, endDate } = buildUtcDayRange(dateInput, tzOffsetMinutes);

  if (!forceRefresh) {
    const stored = await readStoredTeam(members, startDate, endDate);
    if (!stored) {
      return NextResponse.json({ error: "Supabase history is not configured" }, { status: 500 });
    }
    const hasData = stored.members.some((member) => member.entries.length > 0);
    if (!hasData) {
      return NextResponse.json({
        date: dateInput,
        members: stored.members,
        cachedAt: stored.cachedAt,
        stale: true,
        warning: "No stored team entries for this day yet. Click Refresh now to import and save from Toggl.",
        source: "db",
        cooldownActive: false,
        retryAfterSeconds: 0,
      });
    }
    return NextResponse.json({
      date: dateInput,
      members: stored.members,
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
    const stored = await readStoredTeam(members, startDate, endDate);
    return NextResponse.json({
      date: dateInput,
      members: stored?.members ?? members.map((member) => ({ name: member.name, entries: [], current: null, totalSeconds: 0 })),
      cachedAt: stored?.cachedAt ?? new Date().toISOString(),
      stale: true,
      warning: "Toggl quota cooldown active. Showing stored data from Supabase.",
      source: "db_fallback",
      cooldownActive: true,
      retryAfterSeconds: quotaLock.retryAfterSeconds,
    });
  }

  const storedBeforeRefresh = await readStoredTeam(members, startDate, endDate);
  const storedMemberByName = new Map<string, MemberPayload>(
    (storedBeforeRefresh?.members ?? []).map((member) => [member.name, member])
  );

  try {
    const refreshErrors: string[] = [];
    const results = await Promise.all(
      members.map(async (member) => {
        const token = getTokenForMember(member.name);
        if (!token) {
          const fallback = storedMemberByName.get(member.name);
          if (fallback) return fallback;
          return { name: member.name, entries: [], current: null, totalSeconds: 0 };
        }

        try {
          const entries = await fetchTimeEntries(token, startDate, endDate);
          const projectNames = await fetchProjectNames(token, entries);
          const sortedEntries = sortEntriesByStart(entries).map((entry) => ({
            ...entry,
            project_name: getEntryProjectName(entry, projectNames),
          }));

          const totalSeconds = sortedEntries.reduce((acc, entry) => {
            if (entry.duration >= 0) return acc + entry.duration;
            const startedAt = new Date(entry.start).getTime();
            if (Number.isNaN(startedAt)) return acc;
            return acc + Math.floor((Date.now() - startedAt) / 1000);
          }, 0);

          await persistHistoricalSnapshot("team", member.name, dateInput, sortedEntries);
          return { name: member.name, entries: sortedEntries, current: null, totalSeconds };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown refresh error";
          refreshErrors.push(`${member.name}: ${message}`);
          const fallback = storedMemberByName.get(member.name);
          if (fallback) return fallback;
          return { name: member.name, entries: [], current: null, totalSeconds: 0 };
        }
      })
    );

    const warning =
      refreshErrors.length > 0
        ? `Partial refresh completed. ${refreshErrors.length} member(s) used stored data: ${refreshErrors.join(" | ")}`
        : null;
    const allMembersFailed = refreshErrors.length === members.length;
    const responseCachedAt =
      allMembersFailed && storedBeforeRefresh?.cachedAt ? storedBeforeRefresh.cachedAt : new Date().toISOString();

    if (refreshErrors.length > 0) {
      await persistHistoricalError("team", null, dateInput, warning ?? "Partial refresh used stored data");
    }

    return NextResponse.json({
      date: dateInput,
      members: results,
      cachedAt: responseCachedAt,
      stale: refreshErrors.length > 0,
      warning,
      source: refreshErrors.length > 0 ? "db_fallback" : "toggl_sync",
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

    const stored = await readStoredTeam(members, startDate, endDate);
    if (stored) {
      await persistHistoricalError("team", null, dateInput, message);
      return NextResponse.json({
        date: dateInput,
        members: stored.members,
        cachedAt: stored.cachedAt,
        stale: true,
        warning: "Toggl refresh failed. Showing stored team data from Supabase.",
        quotaRemaining,
        quotaResetsIn,
        source: "db_fallback",
        cooldownActive: status === 402 || status === 429,
        retryAfterSeconds: retryAfterSeconds ?? 0,
      });
    }

    await persistHistoricalError("team", null, dateInput, message);
    return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
  }
}
