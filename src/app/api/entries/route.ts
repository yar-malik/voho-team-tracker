import { NextRequest, NextResponse } from "next/server";
import { canonicalizeMemberName, namesMatch } from "@/lib/memberNames";
import { listMembers } from "@/lib/manualTimeEntriesStore";
import { assignUniquePastelColors } from "@/lib/projectColors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type StoredEntry = {
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

type EntriesPayload = {
  entries: StoredEntry[];
  current: StoredEntry | null;
  totalSeconds: number;
  date: string;
  cachedAt: string;
  stale?: boolean;
  warning?: string | null;
};

type StoredEntryRow = {
  entry_id: number;
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

function isNonWorkProjectType(projectType: string | null | undefined) {
  return (projectType ?? "").toLowerCase() === "non_work";
}

async function readStoredEntries(member: string, startIso: string, endIso: string): Promise<EntriesPayload | null> {
  if (!isSupabaseConfigured()) return null;
  const base = process.env.SUPABASE_URL!;

  const url =
    `${base}/rest/v1/time_entries` +
    `?select=entry_id,description,start_at,stop_at,duration_seconds,is_running,tags,project_key,synced_at` +
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

  const entries: StoredEntry[] = rows.map((row) => {
    const projectMeta = row.project_key ? projectMetaByKey.get(row.project_key) : null;
    return {
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
  });

  const current =
    rows
      .filter((row) => row.is_running)
      .sort((a, b) => (a.start_at < b.start_at ? 1 : -1))
      .map((row) => ({
        id: row.entry_id,
        description: row.description,
        start: row.start_at,
        stop: row.stop_at,
        duration: row.duration_seconds,
        tags: row.tags ?? [],
        project_name: row.project_key ? projectMetaByKey.get(row.project_key)?.name ?? null : null,
        project_color: row.project_key ? projectMetaByKey.get(row.project_key)?.color ?? null : null,
        project_type: row.project_key ? projectMetaByKey.get(row.project_key)?.type ?? "work" : "work",
      }))[0] ?? null;

  const totalSeconds = entries
    .filter((entry) => !isNonWorkProjectType(entry.project_type))
    .reduce((acc, entry) => acc + Math.max(0, entry.duration), 0);
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
  const memberParam = searchParams.get("member");
  const dateParam = searchParams.get("date");
  const tzOffsetMinutes = parseTzOffsetMinutes(searchParams.get("tzOffset"));

  if (!memberParam) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }
  const member = canonicalizeMemberName(memberParam);

  const members = await listMembers();
  if (!members.some((item) => namesMatch(item, member))) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  const dateInput = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(dateInput)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const { startDate, endDate } = buildUtcDayRange(dateInput, tzOffsetMinutes);
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
    warning: "No stored entries for this day yet.",
    source: "db",
    cooldownActive: false,
    retryAfterSeconds: 0,
  });
}
