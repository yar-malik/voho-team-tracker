import { NextRequest, NextResponse } from "next/server";
import {
  fetchProjectNames,
  fetchTimeEntries,
  getEntryProjectName,
  getTeamMembers,
  getTokenForMember,
} from "@/lib/toggl";
import { getCacheSnapshot, setCacheSnapshot } from "@/lib/cacheStore";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 30 * 60 * 1000;
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

type CacheEntry = {
  startDate: string;
  endDate: string;
  weekDates: string[];
  members: MemberProfile[];
  cachedAt: string;
  aiEnabled: boolean;
  aiWarning?: string | null;
};

function createEmptyProfile(name: string, weekDates: string[]): MemberProfile {
  const kpis: KpiItem[] = [
    { label: "Active days", value: "0/7", source: "auto" },
    { label: "Avg/day", value: "0h 0m", source: "auto" },
    { label: "Avg entry", value: "0h 0m", source: "auto" },
    { label: "Unique projects", value: "0", source: "auto" },
    { label: "Top project share", value: "No project (0%)", source: "auto" },
  ];
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
    kpis,
    aiAnalysis: null,
  };
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function buildAutoKpis(profile: Pick<MemberProfile, "activeDays" | "averageDailySeconds" | "averageEntrySeconds" | "uniqueProjects" | "topProject" | "topProjectSharePct">): KpiItem[] {
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

async function fetchKpiOverridesFromCsv(): Promise<Map<string, KpiItem[]>> {
  const url = process.env.KPI_SHEET_CSV_URL?.trim();
  if (!url) return new Map();

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return new Map();
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
    if (memberColumnIndex < 0) return new Map();

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
    return new Map();
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

function getDateKeyAtOffset(iso: string, tzOffsetMinutes: number) {
  const utcMs = new Date(iso).getTime();
  if (Number.isNaN(utcMs)) return null;
  const shifted = new Date(utcMs - tzOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function getEntrySeconds(entry: Awaited<ReturnType<typeof fetchTimeEntries>>[number]) {
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
  const memberCachePart = memberParam ? memberParam.toLowerCase() : "all";
  const cacheKey = `member-profiles::${startDate}::${endDate}::${memberCachePart}`;
  const cachedFresh = await getCacheSnapshot<CacheEntry>(cacheKey, false);
  const cachedAny = await getCacheSnapshot<CacheEntry>(cacheKey, true);

  if (!forceRefresh && cachedFresh) {
    return NextResponse.json({ ...cachedFresh, stale: false, warning: null });
  }
  if (!forceRefresh && cachedAny) {
    return NextResponse.json({
      ...cachedAny,
      stale: true,
      warning: "Showing last cached profile snapshot. Click Refresh now for newer data.",
    });
  }

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
  if (!forceRefresh && !cachedAny) {
    return NextResponse.json({
      startDate,
      endDate,
      weekDates,
      members: members.map((member) => createEmptyProfile(member.name, weekDates)),
      cachedAt: new Date().toISOString(),
      stale: true,
      warning: "No cached profile snapshot yet. Click Refresh now to fetch and save latest data.",
      aiEnabled: Boolean(process.env.OPENAI_API_KEY),
      aiWarning: null,
    });
  }

  const range = buildUtcRangeFromLocalDates(startDate, endDate, tzOffsetMinutes);
  const aiEnabled = Boolean(process.env.OPENAI_API_KEY);
  const kpiOverrides = await fetchKpiOverridesFromCsv();

  try {
    const profiles = await Promise.all(
      members.map(async (member) => {
        const emptyDays = weekDates.map((date) => ({ date, seconds: 0, entryCount: 0 }));
        const token = getTokenForMember(member.name);
        if (!token) {
          return { ...createEmptyProfile(member.name, weekDates), days: emptyDays } satisfies MemberProfile;
        }

        const entries = await fetchTimeEntries(token, range.startIso, range.endIso);
        const projectNames = await fetchProjectNames(token, entries);
        const dayMap = new Map<string, DaySummary>(weekDates.map((date) => [date, { date, seconds: 0, entryCount: 0 }]));
        const workItemMap = new Map<string, WorkItemSummary>();
        const projectSecondsMap = new Map<string, number>();
        const projectSet = new Set<string>();
        const descriptionSet = new Set<string>();

        let totalSeconds = 0;
        let entryCount = 0;

        for (const entry of entries) {
          const project = normalizeLabel(getEntryProjectName(entry, projectNames), "No project");
          if (project.toLowerCase() === EXCLUDED_PROJECT_NAME) continue;

          const description = normalizeLabel(entry.description, "(No description)");
          const seconds = getEntrySeconds(entry);
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
        return {
          ...baseProfile,
          kpis: overrideKpis ?? buildAutoKpis(baseProfile),
        } satisfies MemberProfile;
      })
    );

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

    const payload: CacheEntry = {
      startDate,
      endDate,
      weekDates,
      members: sorted,
      cachedAt: new Date().toISOString(),
      aiEnabled,
      aiWarning,
    };
    await setCacheSnapshot(cacheKey, payload, CACHE_TTL_MS);
    return NextResponse.json({ ...payload, stale: false, warning: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = (error as Error & { status?: number }).status ?? 502;

    if (cachedAny) {
      return NextResponse.json({
        ...cachedAny,
        stale: true,
        warning: "Could not refresh member profiles. Showing cached snapshot.",
      });
    }

    return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
  }
}
