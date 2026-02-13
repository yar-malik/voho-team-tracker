import { NextRequest, NextResponse } from "next/server";
import {
  fetchProjectNames,
  fetchTimeEntries,
  getEntryProjectName,
  getTeamMembers,
  getTokenForMember,
} from "@/lib/toggl";
import { persistHistoricalError, persistHistoricalSnapshot } from "@/lib/historyStore";
import { getQuotaLockState, setQuotaLock } from "@/lib/quotaLockStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXCLUDED_PROJECT_NAME = "non-work-task";
const WORK_ITEM_LIMIT = 8;

type DaySummary = {
  date: string;
  seconds: number;
  entryCount: number;
};

type WorkItemSummary = {
  project: string;
  description: string;
  seconds: number;
  entryCount: number;
};

type KpiItem = {
  label: string;
  value: string;
  source: "sheet" | "auto";
};

type MemberProfile = {
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
  days: DaySummary[];
  workItems: WorkItemSummary[];
  kpis: KpiItem[];
  aiAnalysis: string | null;
};

type ProfileEntry = {
  memberName: string;
  description: string | null;
  start: string;
  durationSeconds: number;
  projectName: string | null;
};

type StoredTimeEntryRow = {
  member_name: string;
  description: string | null;
  start_at: string;
  duration_seconds: number;
  project_key: string | null;
  synced_at: string;
};

const KPI_CACHE_TTL_MS = 10 * 60 * 1000;
const KPI_FETCH_TIMEOUT_MS = 1800;

let kpiOverridesCache: { expiresAt: number; value: Map<string, KpiItem[]> } | null = null;
let kpiOverridesInFlight: Promise<Map<string, KpiItem[]>> | null = null;

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

function createEmptyProfile(name: string, weekDates: string[]): MemberProfile {
  return {
    name,
    totalSeconds: 0,
    entryCount: 0,
    activeDays: 0,
    averageDailySeconds: 0,
    averageEntrySeconds: 0,
    uniqueProjects: 0,
    uniqueDescriptions: 0,
    topProject: "No project",
    topProjectSharePct: 0,
    days: weekDates.map((date) => ({ date, seconds: 0, entryCount: 0 })),
    workItems: [],
    kpis: [
      { label: "Active days", value: "0/7", source: "auto" },
      { label: "Avg/day", value: "0h 0m", source: "auto" },
      { label: "Avg entry", value: "0h 0m", source: "auto" },
      { label: "Unique projects", value: "0", source: "auto" },
      { label: "Top project share", value: "No project (0%)", source: "auto" },
    ],
    aiAnalysis: null,
  };
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function buildAutoKpis(
  profile: Pick<
    MemberProfile,
    "activeDays" | "averageDailySeconds" | "averageEntrySeconds" | "uniqueProjects" | "topProject" | "topProjectSharePct"
  >
): KpiItem[] {
  return [
    { label: "Active days", value: `${profile.activeDays}/7`, source: "auto" },
    { label: "Avg/day", value: formatDuration(profile.averageDailySeconds), source: "auto" },
    { label: "Avg entry", value: formatDuration(profile.averageEntrySeconds), source: "auto" },
    { label: "Unique projects", value: String(profile.uniqueProjects), source: "auto" },
    { label: "Top project share", value: `${profile.topProject} (${profile.topProjectSharePct}%)`, source: "auto" },
  ];
}

function normalizeMemberKey(value: string) {
  return value.trim().toLowerCase();
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

async function fetchKpiOverridesFromCsvRemote(): Promise<Map<string, KpiItem[]> | null> {
  const url = resolveKpiCsvUrl();
  if (!url) return new Map();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), KPI_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const text = await response.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 2) return new Map();

    const header = parseCsvLine(lines[0]);
    const memberColumnIndex = header.findIndex((column) => {
      const name = column.trim().toLowerCase();
      return name === "member" || name === "name" || name === "teammate";
    });
    if (memberColumnIndex < 0) return null;

    const map = new Map<string, KpiItem[]>();
    for (let i = 1; i < lines.length; i += 1) {
      const row = parseCsvLine(lines[i]);
      const rawMember = row[memberColumnIndex]?.trim();
      if (!rawMember) continue;

      const kpis: KpiItem[] = [];
      for (let col = 0; col < header.length; col += 1) {
        if (col === memberColumnIndex) continue;
        const label = header[col]?.trim();
        const value = row[col]?.trim();
        if (!label || !value) continue;
        kpis.push({ label, value, source: "sheet" });
      }
      if (kpis.length > 0) {
        map.set(normalizeMemberKey(rawMember), kpis);
      }
    }
    return map;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKpiOverridesFromCsv(): Promise<Map<string, KpiItem[]>> {
  const now = Date.now();
  if (kpiOverridesCache && now < kpiOverridesCache.expiresAt) {
    return kpiOverridesCache.value;
  }
  if (kpiOverridesInFlight) {
    return kpiOverridesInFlight;
  }

  kpiOverridesInFlight = (async () => {
    const fresh = await fetchKpiOverridesFromCsvRemote();
    if (fresh) {
      kpiOverridesCache = {
        value: fresh,
        expiresAt: Date.now() + KPI_CACHE_TTL_MS,
      };
      return fresh;
    }
    return kpiOverridesCache?.value ?? new Map();
  })().finally(() => {
    kpiOverridesInFlight = null;
  });

  return kpiOverridesInFlight;
}

function resolveKpiCsvUrl(): string | null {
  const csvUrl = process.env.KPI_SHEET_CSV_URL?.trim();
  if (csvUrl) return csvUrl;

  const sheetUrl = process.env.KPI_SHEET_URL?.trim();
  if (!sheetUrl) return null;

  try {
    const parsed = new URL(sheetUrl);
    if (!parsed.hostname.includes("docs.google.com")) return null;
    const match = parsed.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    if (!match?.[1]) return null;
    const sheetId = match[1];

    // Prefer explicit gid if provided, otherwise default sheet gid 0.
    const gidFromQuery = parsed.searchParams.get("gid");
    const gid = gidFromQuery && /^-?\d+$/.test(gidFromQuery) ? gidFromQuery : "0";
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    return null;
  }
}

function parseTzOffsetMinutes(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-720, Math.min(840, Math.trunc(parsed)));
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

function getDateKeyAtOffset(iso: string, tzOffsetMinutes: number) {
  const utcMs = new Date(iso).getTime();
  if (Number.isNaN(utcMs)) return null;
  const shifted = new Date(utcMs - tzOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function normalizeDurationFromToggl(entry: Awaited<ReturnType<typeof fetchTimeEntries>>[number]) {
  if (entry.duration >= 0) return entry.duration;
  const startedAt = new Date(entry.start).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function parseAiText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const maybeText = (payload as { output_text?: unknown }).output_text;
  if (typeof maybeText === "string" && maybeText.trim().length > 0) {
    return maybeText.trim();
  }

  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text.trim();
      }
    }
  }
  return null;
}

async function buildAiAnalysis(member: MemberProfile): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const dayLines = member.days.map((day) => `${day.date}: ${Math.round(day.seconds / 60)} minutes`).join("\n");
  const workLines = member.workItems
    .slice(0, 5)
    .map((item) => `${item.project} | ${item.description}: ${Math.round(item.seconds / 60)} minutes`)
    .join("\n");

  const prompt = [
    `You are analyzing recent work patterns for ${member.name}.`,
    "Give a concise analysis with:",
    "1) What they focused on most",
    "2) One strength",
    "3) One risk to watch",
    "4) One actionable next step for tomorrow",
    "",
    `Total time: ${Math.round(member.totalSeconds / 60)} minutes`,
    `Entries: ${member.entryCount}`,
    `Active days: ${member.activeDays}/7`,
    `Top project: ${member.topProject} (${member.topProjectSharePct}%)`,
    "",
    "Daily totals (last 7 days):",
    dayLines || "No data",
    "",
    "Top work items (project | description):",
    workLines || "No data",
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_output_tokens: 260,
        input: [
          {
            role: "system",
            content: "You are a practical productivity coach. Keep advice concrete and non-judgmental.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return parseAiText(payload);
  } catch {
    return null;
  }
}

function buildProfilesFromEntries(
  members: Array<{ name: string }>,
  entries: ProfileEntry[],
  weekDates: string[],
  tzOffsetMinutes: number,
  kpiOverrides: Map<string, KpiItem[]>
): MemberProfile[] {
  return members.map((member) => {
    const dayMap = new Map<string, DaySummary>(weekDates.map((date) => [date, { date, seconds: 0, entryCount: 0 }]));
    const workItemMap = new Map<string, WorkItemSummary>();
    const projectSecondsMap = new Map<string, number>();
    const projectSet = new Set<string>();
    const descriptionSet = new Set<string>();

    let totalSeconds = 0;
    let entryCount = 0;

    for (const entry of entries) {
      if (entry.memberName !== member.name) continue;
      const project = normalizeLabel(entry.projectName, "No project");
      if (project.toLowerCase() === EXCLUDED_PROJECT_NAME) continue;
      const description = normalizeLabel(entry.description, "(No description)");
      const seconds = Math.max(0, entry.durationSeconds);
      const day = getDateKeyAtOffset(entry.start, tzOffsetMinutes);

      totalSeconds += seconds;
      entryCount += 1;
      projectSet.add(project);
      descriptionSet.add(description);
      projectSecondsMap.set(project, (projectSecondsMap.get(project) ?? 0) + seconds);

      if (day) {
        const bucket = dayMap.get(day);
        if (bucket) {
          bucket.seconds += seconds;
          bucket.entryCount += 1;
        }
      }

      const workKey = `${project}::${description}`;
      const existing = workItemMap.get(workKey);
      if (existing) {
        existing.seconds += seconds;
        existing.entryCount += 1;
      } else {
        workItemMap.set(workKey, { project, description, seconds, entryCount: 1 });
      }
    }

    const days = weekDates.map((date) => dayMap.get(date) ?? { date, seconds: 0, entryCount: 0 });
    const activeDays = days.filter((day) => day.seconds > 0).length;
    const averageDailySeconds = Math.floor(totalSeconds / 7);
    const averageEntrySeconds = entryCount > 0 ? Math.floor(totalSeconds / entryCount) : 0;
    const topProjectEntry = Array.from(projectSecondsMap.entries()).sort((a, b) => b[1] - a[1])[0];
    const topProject = topProjectEntry?.[0] ?? "No project";
    const topProjectSharePct =
      totalSeconds > 0 && topProjectEntry ? Math.round((topProjectEntry[1] / totalSeconds) * 100) : 0;
    const workItems = Array.from(workItemMap.values())
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, WORK_ITEM_LIMIT);

    const baseProfile = {
      name: member.name,
      totalSeconds,
      entryCount,
      activeDays,
      averageDailySeconds,
      averageEntrySeconds,
      uniqueProjects: projectSet.size,
      uniqueDescriptions: descriptionSet.size,
      topProject,
      topProjectSharePct,
      days,
      workItems,
      kpis: [],
      aiAnalysis: null,
    } satisfies MemberProfile;
    const overrideKpis = kpiOverrides.get(normalizeMemberKey(member.name)) ?? null;
    return { ...baseProfile, kpis: overrideKpis ?? buildAutoKpis(baseProfile) } satisfies MemberProfile;
  });
}

async function readStoredEntries(
  members: Array<{ name: string }>,
  startIso: string,
  endIso: string
): Promise<{ entries: ProfileEntry[]; latestSyncedAt: string | null }> {
  if (!isSupabaseConfigured()) return { entries: [], latestSyncedAt: null };
  if (members.length === 0) return { entries: [], latestSyncedAt: null };

  const base = process.env.SUPABASE_URL!;
  const quotedMembers = members
    .map((member) => `"${member.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  const memberFilter = `in.(${quotedMembers})`;
  const timeEntriesUrl =
    `${base}/rest/v1/time_entries` +
    `?select=member_name,description,start_at,duration_seconds,project_key,synced_at` +
    `&member_name=${encodeURIComponent(memberFilter)}` +
    `&start_at=gte.${encodeURIComponent(startIso)}` +
    `&start_at=lte.${encodeURIComponent(endIso)}` +
    `&order=start_at.asc`;

  const timeEntriesResponse = await fetch(timeEntriesUrl, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!timeEntriesResponse.ok) return { entries: [], latestSyncedAt: null };
  const rows = (await timeEntriesResponse.json()) as StoredTimeEntryRow[];
  if (!Array.isArray(rows) || rows.length === 0) return { entries: [], latestSyncedAt: null };

  const latestSyncedAt = rows.reduce<string | null>((latest, row) => {
    if (!latest) return row.synced_at;
    return row.synced_at > latest ? row.synced_at : latest;
  }, null);

  const uniqueProjectKeys = Array.from(
    new Set(rows.map((row) => row.project_key).filter((value): value is string => typeof value === "string" && value.length > 0))
  );
  const projectNameByKey = new Map<string, string>();
  if (uniqueProjectKeys.length > 0) {
    const projectFilter = `in.(${uniqueProjectKeys.map((key) => `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
    const projectsUrl =
      `${base}/rest/v1/projects?select=project_key,project_name` +
      `&project_key=${encodeURIComponent(projectFilter)}`;
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

  const entries: ProfileEntry[] = rows.map((row) => ({
    memberName: row.member_name,
    description: row.description,
    start: row.start_at,
    durationSeconds: row.duration_seconds,
    projectName: row.project_key ? projectNameByKey.get(row.project_key) ?? null : null,
  }));
  return { entries, latestSyncedAt };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const memberParam = searchParams.get("member")?.trim() ?? "";
  const forceRefresh = searchParams.get("refresh") === "1";
  const tzOffsetMinutes = parseTzOffsetMinutes(searchParams.get("tzOffset"));

  const endDate = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(endDate)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const weekDates = getLastSevenDates(endDate);
  const startDate = weekDates[0];
  const teamMembers = getTeamMembers();
  if (teamMembers.length === 0) {
    return NextResponse.json({ error: "No members configured" }, { status: 400 });
  }
  const members = memberParam
    ? teamMembers.filter((member) => member.name.toLowerCase() === memberParam.toLowerCase())
    : teamMembers;
  if (memberParam && members.length === 0) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  const range = buildUtcRangeFromLocalDates(startDate, endDate, tzOffsetMinutes);
  const aiEnabled = Boolean(process.env.OPENAI_API_KEY);
  const kpiOverridesPromise = fetchKpiOverridesFromCsv();

  if (!forceRefresh) {
    const [stored, kpiOverrides] = await Promise.all([
      readStoredEntries(members, range.startIso, range.endIso),
      kpiOverridesPromise,
    ]);
    if (stored.entries.length === 0) {
      return NextResponse.json({
        startDate,
        endDate,
        weekDates,
        members: members.map((member) => createEmptyProfile(member.name, weekDates)),
        cachedAt: new Date().toISOString(),
        stale: true,
        warning: "No stored history yet. Click Refresh now once to import and save this range.",
        aiEnabled,
        aiWarning: null,
        source: "db",
        cooldownActive: false,
        retryAfterSeconds: 0,
      });
    }

    const profiles = buildProfilesFromEntries(members, stored.entries, weekDates, tzOffsetMinutes, kpiOverrides);
    const sorted = [...profiles].sort((a, b) => {
      if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
      if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json({
      startDate,
      endDate,
      weekDates,
      members: sorted,
      cachedAt: stored.latestSyncedAt ?? new Date().toISOString(),
      stale: false,
      warning: null,
      aiEnabled,
      aiWarning: aiEnabled ? "AI analysis is generated on manual refresh to avoid unnecessary API usage." : null,
      source: "db",
      cooldownActive: false,
      retryAfterSeconds: 0,
    });
  }

  const quotaLock = await getQuotaLockState();
  if (quotaLock.active) {
    const [stored, kpiOverrides] = await Promise.all([
      readStoredEntries(members, range.startIso, range.endIso),
      kpiOverridesPromise,
    ]);
    const profiles =
      stored.entries.length > 0
        ? buildProfilesFromEntries(members, stored.entries, weekDates, tzOffsetMinutes, kpiOverrides)
        : members.map((member) => createEmptyProfile(member.name, weekDates));
    return NextResponse.json({
      startDate,
      endDate,
      weekDates,
      members: profiles,
      cachedAt: stored.latestSyncedAt ?? new Date().toISOString(),
      stale: true,
      warning: "Toggl quota cooldown active. Showing stored data from Supabase.",
      aiEnabled,
      aiWarning: aiEnabled ? "AI analysis is generated on manual refresh to avoid unnecessary API usage." : null,
      source: "db_fallback",
      cooldownActive: true,
      retryAfterSeconds: quotaLock.retryAfterSeconds,
    });
  }

  try {
    const entriesForProfiles = await Promise.all(
      members.map(async (member) => {
        const token = getTokenForMember(member.name);
        if (!token) {
          return [] as ProfileEntry[];
        }

        const entries = await fetchTimeEntries(token, range.startIso, range.endIso);
        const projectNames = await fetchProjectNames(token, entries);
        const profileEntries: ProfileEntry[] = entries.map((entry) => ({
          memberName: member.name,
          description: entry.description,
          start: entry.start,
          durationSeconds: normalizeDurationFromToggl(entry),
          projectName: getEntryProjectName(entry, projectNames),
        }));

        const entriesByLocalDate = new Map<string, Array<Awaited<ReturnType<typeof fetchTimeEntries>>[number]>>();
        for (const entry of entries) {
          const localDate = getDateKeyAtOffset(entry.start, tzOffsetMinutes) ?? endDate;
          const current = entriesByLocalDate.get(localDate) ?? [];
          current.push({
            ...entry,
            project_name: getEntryProjectName(entry, projectNames) ?? null,
          } as Awaited<ReturnType<typeof fetchTimeEntries>>[number]);
          entriesByLocalDate.set(localDate, current);
        }

        await Promise.all(
          Array.from(entriesByLocalDate.entries()).map(([localDate, list]) =>
            persistHistoricalSnapshot(
              "team",
              member.name,
              localDate,
              list.map((entry) => ({
                ...entry,
                project_name: getEntryProjectName(entry, projectNames) ?? null,
              }))
            )
          )
        );

        return profileEntries;
      })
    );

    const mergedEntries = entriesForProfiles.flat();
    const kpiOverrides = await kpiOverridesPromise;
    const profiles = buildProfilesFromEntries(members, mergedEntries, weekDates, tzOffsetMinutes, kpiOverrides);

    let aiWarning: string | null = null;
    const profilesWithAi = await Promise.all(
      profiles.map(async (profile) => {
        if (!aiEnabled) return profile;
        const aiAnalysis = await buildAiAnalysis(profile);
        if (!aiAnalysis) {
          aiWarning = "AI analysis is enabled, but one or more summaries could not be generated.";
        }
        return { ...profile, aiAnalysis };
      })
    );

    const sorted = [...profilesWithAi].sort((a, b) => {
      if (b.totalSeconds !== a.totalSeconds) return b.totalSeconds - a.totalSeconds;
      if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      startDate,
      endDate,
      weekDates,
      members: sorted,
      cachedAt: new Date().toISOString(),
      aiEnabled,
      aiWarning,
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
    await persistHistoricalError("team", memberParam || null, endDate, message);
    const [stored, kpiOverrides] = await Promise.all([
      readStoredEntries(members, range.startIso, range.endIso),
      kpiOverridesPromise,
    ]);
    if (stored.entries.length > 0) {
      const profiles = buildProfilesFromEntries(members, stored.entries, weekDates, tzOffsetMinutes, kpiOverrides);
      return NextResponse.json({
        startDate,
        endDate,
        weekDates,
        members: profiles,
        cachedAt: stored.latestSyncedAt ?? new Date().toISOString(),
        stale: true,
        warning: "Toggl refresh failed. Showing stored data from Supabase.",
        aiEnabled,
        aiWarning: aiEnabled ? "AI analysis is generated on manual refresh to avoid unnecessary API usage." : null,
        source: "db_fallback",
        cooldownActive: status === 402 || status === 429,
        retryAfterSeconds: retryAfterSeconds ?? 0,
      });
    }
    return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
  }
}
