import { NextRequest, NextResponse } from "next/server";
import { canonicalizeMemberName, expandMemberAliases } from "@/lib/memberNames";
import { listMemberProfiles } from "@/lib/manualTimeEntriesStore";
import { assignUniquePastelColors } from "@/lib/projectColors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type TimeEntry = {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  tags: string[];
  project_name: string | null;
  project_color: string | null;
  project_type: "work" | "non_work";
};

type MemberPayload = {
  name: string;
  entries: TimeEntry[];
  current: TimeEntry | null;
  totalSeconds: number;
  lastActivityAt: string | null;
};

type StoredEntryRow = {
  member_name: string;
  entry_id: number;
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

function isNonWorkProjectType(projectType: string | null | undefined) {
  return (projectType ?? "").toLowerCase() === "non_work";
}

function sortEntriesByStart(entries: TimeEntry[]) {
  return [...entries].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

async function readStoredTeam(
  members: Array<{ name: string }>,
  startIso: string,
  endIso: string
): Promise<{ members: MemberPayload[]; cachedAt: string } | null> {
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
    `?select=member_name,entry_id,description,start_at,stop_at,duration_seconds,tags,project_key,synced_at` +
    `&member_name=${encodeURIComponent(memberFilter)}` +
    `&start_at=lte.${encodeURIComponent(endIso)}` +
    `&or=${encodeURIComponent(`(stop_at.is.null,stop_at.gte.${startIso})`)}` +
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
  const projectMetaByKey = new Map<string, { name: string; color: string | null; type: "work" | "non_work" }>();
  if (projectKeys.length > 0) {
    const projectsUrl = `${base}/rest/v1/projects?select=project_key,project_name,project_color,project_type&order=project_name.asc`;
    const projectsResponse = await fetch(projectsUrl, {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (projectsResponse.ok) {
      const projectRows = (await projectsResponse.json()) as Array<{
        project_key: string;
        project_name: string;
        project_color?: string | null;
        project_type?: "work" | "non_work";
      }>;
      const colorByKey = assignUniquePastelColors(
        projectRows.map((row) => ({
          key: row.project_key,
          name: row.project_name,
          color: row.project_color ?? null,
        }))
      );
      const required = new Set(projectKeys);
      for (const row of projectRows) {
        if (!row.project_key || !required.has(row.project_key)) continue;
        projectMetaByKey.set(row.project_key, {
          name: row.project_name,
          color: colorByKey.get(row.project_key) ?? row.project_color ?? null,
          type: row.project_type === "non_work" ? "non_work" : "work",
        });
      }
    }
  }

  const grouped = new Map<string, MemberPayload>(
    members.map((member) => [member.name, { name: member.name, entries: [], current: null, totalSeconds: 0, lastActivityAt: null }])
  );

  let latestSyncedAt: string | null = null;
  for (const row of rows) {
    if (!latestSyncedAt || new Date(row.synced_at).getTime() > new Date(latestSyncedAt).getTime()) {
      latestSyncedAt = row.synced_at;
    }
    const bucket = grouped.get(canonicalizeMemberName(row.member_name));
    if (!bucket) continue;
    const projectMeta = row.project_key ? projectMetaByKey.get(row.project_key) : null;
    const entry: TimeEntry = {
      id: row.entry_id,
      description: row.description,
      start: row.start_at,
      stop: row.stop_at,
      duration: row.duration_seconds,
      tags: row.tags ?? [],
      project_name: projectMeta?.name ?? null,
      project_color: projectMeta?.color ?? null,
      project_type: projectMeta?.type ?? "work",
    };
    bucket.entries.push(entry);
    if (!row.stop_at) {
      const currentStart = bucket.current ? new Date(bucket.current.start).getTime() : Number.NEGATIVE_INFINITY;
      const entryStart = new Date(entry.start).getTime();
      if (!bucket.current || entryStart > currentStart) {
        bucket.current = entry;
      }
    }
    if (!isNonWorkProjectType(projectMeta?.type)) {
      bucket.totalSeconds += Math.max(0, row.duration_seconds);
    }
  }

  await Promise.all(
    members.map(async (member) => {
      const aliases = Array.from(new Set(expandMemberAliases(member.name)));
      if (aliases.length === 0) return;
      const aliasFilter = `in.(${aliases.map((alias) => `"${alias.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
      const latestUrl =
        `${base}/rest/v1/time_entries` +
        `?select=start_at,stop_at` +
        `&member_name=${encodeURIComponent(aliasFilter)}` +
        `&start_at=lte.${encodeURIComponent(endIso)}` +
        `&order=start_at.desc` +
        `&limit=1`;
      const latestResponse = await fetch(latestUrl, {
        method: "GET",
        headers: supabaseHeaders(),
        cache: "no-store",
      });
      if (!latestResponse.ok) return;
      const latestRows = (await latestResponse.json()) as Array<{ start_at: string; stop_at: string | null }>;
      const latestRow = latestRows[0];
      if (!latestRow) return;
      const bucket = grouped.get(member.name);
      if (!bucket) return;
      bucket.lastActivityAt = latestRow.stop_at ?? latestRow.start_at;
    })
  );

  return {
    members: Array.from(grouped.values()).map((member) => ({ ...member, entries: sortEntriesByStart(member.entries) })),
    cachedAt: latestSyncedAt ?? new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const tzOffsetMinutes = parseTzOffsetMinutes(searchParams.get("tzOffset"));

  const dateInput = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(dateInput)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const memberProfiles = await listMemberProfiles();
  const members = memberProfiles.map((member) => ({ name: member.name }));
  if (members.length === 0) {
    return NextResponse.json({ error: "No members configured in database" }, { status: 400 });
  }

  const { startDate, endDate } = buildUtcDayRange(dateInput, tzOffsetMinutes);
  const stored = await readStoredTeam(members, startDate, endDate);
  if (!stored) {
    return NextResponse.json({ error: "Supabase history is not configured" }, { status: 500 });
  }

  const hasData = stored.members.some((member) => member.entries.length > 0);
  return NextResponse.json({
    date: dateInput,
    members: stored.members,
    cachedAt: stored.cachedAt,
    stale: !hasData,
    warning: hasData ? null : "No stored team entries for this day yet.",
    source: "db",
    cooldownActive: false,
    retryAfterSeconds: 0,
  });
}
