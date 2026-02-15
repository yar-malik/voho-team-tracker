import { NextRequest, NextResponse } from "next/server";
import { canonicalizeMemberName, expandMemberAliases } from "@/lib/memberNames";
import { listMemberProfiles } from "@/lib/manualTimeEntriesStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  member_name: string;
  start_at: string;
  duration_seconds: number;
  project_key: string | null;
  synced_at: string;
};

type StoredProjectRow = {
  project_key: string;
  project_type?: "work" | "non_work";
};

type ComputedRow = {
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

async function readStoredWeek(
  members: Array<{ name: string }>,
  startDate: string,
  endDate: string,
  weekDates: string[]
): Promise<{ members: MemberWeekPayload[]; cachedAt: string } | null> {
  if (!isSupabaseConfigured()) return null;
  if (members.length === 0) return { members: [], cachedAt: new Date().toISOString() };

  const base = process.env.SUPABASE_URL!;
  const memberNames = Array.from(new Set(members.flatMap((member) => expandMemberAliases(member.name))));
  const quotedMembers = memberNames
    .map((member) => `"${member.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  const memberFilter = `in.(${quotedMembers})`;
  const url =
    `${base}/rest/v1/time_entries` +
    `?select=member_name,start_at,duration_seconds,project_key,synced_at` +
    `&member_name=${encodeURIComponent(memberFilter)}` +
    `&source_date=gte.${encodeURIComponent(startDate)}` +
    `&source_date=lte.${encodeURIComponent(endDate)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as StoredStatRow[];

  const projectKeys = Array.from(
    new Set(rows.map((row) => row.project_key).filter((value): value is string => typeof value === "string" && value.length > 0))
  );
  const projectTypeByKey = new Map<string, "work" | "non_work">();
  if (projectKeys.length > 0) {
    const projectFilter = `in.(${projectKeys.map((key) => `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
    const projectsUrl =
      `${base}/rest/v1/projects?select=project_key,project_type` +
      `&project_key=${encodeURIComponent(projectFilter)}`;
    const projectsResponse = await fetch(projectsUrl, {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (projectsResponse.ok) {
      const projectRows = (await projectsResponse.json()) as StoredProjectRow[];
      for (const row of projectRows) {
        if (!row.project_key) continue;
        projectTypeByKey.set(row.project_key, row.project_type === "non_work" ? "non_work" : "work");
      }
    }
  }

  const computedMap = new Map<string, ComputedRow>();
  for (const row of rows) {
    const projectType = row.project_key ? projectTypeByKey.get(row.project_key) ?? "work" : "work";
    if (projectType === "non_work") continue;
    const statDate = row.start_at.slice(0, 10);
    const key = `${row.member_name}::${statDate}`;
    const existing = computedMap.get(key);
    if (existing) {
      existing.total_seconds += Math.max(0, Number(row.duration_seconds ?? 0));
      existing.entry_count += 1;
      if (row.synced_at > existing.updated_at) existing.updated_at = row.synced_at;
      continue;
    }
    computedMap.set(key, {
      stat_date: statDate,
      member_name: row.member_name,
      total_seconds: Math.max(0, Number(row.duration_seconds ?? 0)),
      entry_count: 1,
      updated_at: row.synced_at,
    });
  }
  const computedRows = Array.from(computedMap.values());

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
  for (const row of computedRows) {
    const updatedAt = row.updated_at;
    if (!latestUpdatedAt || new Date(updatedAt).getTime() > new Date(latestUpdatedAt).getTime()) {
      latestUpdatedAt = updatedAt;
    }
    const member = grouped.get(canonicalizeMemberName(row.member_name));
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

  const endDate = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(endDate)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const weekDates = getLastSevenDates(endDate);
  const startDate = weekDates[0];
  const memberProfiles = await listMemberProfiles();
  const members = memberProfiles.map((member) => ({ name: member.name }));
  if (members.length === 0) {
    return NextResponse.json({ error: "No members configured in database" }, { status: 400 });
  }

  const stored = await readStoredWeek(members, startDate, endDate, weekDates);
  if (!stored) {
    return NextResponse.json({ error: "Supabase history is not configured" }, { status: 500 });
  }

  const sorted = [...stored.members].sort((a, b) => {
    if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
    if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
    return a.name.localeCompare(b.name);
  });

  const hasData = sorted.some((member) => member.totalSeconds > 0 || member.entryCount > 0);
  return NextResponse.json({
    startDate,
    endDate,
    weekDates,
    members: sorted,
    cachedAt: stored.cachedAt,
    stale: !hasData,
    warning: hasData ? null : "No stored weekly history yet.",
    source: "db",
    cooldownActive: false,
    retryAfterSeconds: 0,
  });
}
