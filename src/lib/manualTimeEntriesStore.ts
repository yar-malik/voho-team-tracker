import "server-only";
import { canonicalizeMemberName, namesMatch } from "@/lib/memberNames";
import { DEFAULT_PROJECT_COLOR } from "@/lib/projectColors";

type StoredEntryRow = {
  toggl_entry_id: number;
  member_name: string;
  description: string | null;
  start_at: string;
  stop_at: string | null;
  duration_seconds: number;
  is_running: boolean;
  project_key: string | null;
  synced_at: string;
  source_date: string;
  entry_source: string;
  source_entry_id: string | null;
};

type RunningEntry = {
  id: number;
  member: string;
  description: string | null;
  projectName: string | null;
  startAt: string;
  durationSeconds: number;
  source: string;
};

type EnsureProjectResult = {
  projectKey: string | null;
  projectName: string | null;
};

export type StoredProject = {
  project_key: string;
  workspace_id: number;
  project_id: number;
  project_name: string;
  project_color: string;
  project_type: "work" | "non_work";
  total_seconds?: number;
  entry_count?: number;
};

export type StoredMember = {
  member_name: string;
  email?: string | null;
  role?: string | null;
};

export type StoredKpi = {
  id: number;
  member_name: string;
  kpi_label: string;
  kpi_value: string;
  notes: string | null;
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

function getBaseUrl() {
  return process.env.SUPABASE_URL!;
}

function parseTzOffsetMinutes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(-720, Math.min(840, Math.trunc(value)));
}

function toLocalDateKey(date: Date, tzOffsetMinutes: number) {
  const shifted = new Date(date.getTime() - tzOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function normalizeProjectName(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDescription(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function stablePositiveHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1;
}

async function ensureManualProject(projectName: string | null): Promise<EnsureProjectResult> {
  const normalized = normalizeProjectName(projectName);
  if (!normalized) return { projectKey: null, projectName: null };

  const keySlug = slugify(normalized) || `manual-${stablePositiveHash(normalized)}`;
  const projectKey = `manual:${keySlug}`;
  const nowIso = new Date().toISOString();
  const workspaceId = 0;
  const projectId = stablePositiveHash(normalized);

  const payload = [
    {
      project_key: projectKey,
      workspace_id: workspaceId,
      project_id: projectId,
      project_name: normalized,
      project_color: DEFAULT_PROJECT_COLOR,
      project_type: "work",
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];

  const response = await fetch(`${getBaseUrl()}/rest/v1/projects?on_conflict=project_key`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to save project");
  }
  return { projectKey, projectName: normalized };
}

export async function listProjects(): Promise<StoredProject[]> {
  if (!isSupabaseConfigured()) return [];
  const [projectsResponse, aliasesResponse, rollupsResponse] = await Promise.all([
    fetch(
      `${getBaseUrl()}/rest/v1/projects?select=project_key,workspace_id,project_id,project_name,project_color,project_type&order=project_name.asc`,
      {
        method: "GET",
        headers: supabaseHeaders(),
        cache: "no-store",
      }
    ),
    fetch(`${getBaseUrl()}/rest/v1/project_aliases?select=source_project_key,canonical_project_key`, {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    }).catch(() => null),
    fetch(`${getBaseUrl()}/rest/v1/project_rollups?select=project_key,total_seconds,entry_count`, {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    }).catch(() => null),
  ]);

  if (!projectsResponse.ok) return [];
  const rows = (await projectsResponse.json()) as StoredProject[];
  if (!Array.isArray(rows)) return [];

  const aliasMap = new Map<string, string>();
  if (aliasesResponse && aliasesResponse.ok) {
    const aliasRows = (await aliasesResponse.json()) as Array<{ source_project_key?: string; canonical_project_key?: string }>;
    for (const row of aliasRows) {
      if (!row.source_project_key || !row.canonical_project_key) continue;
      aliasMap.set(row.source_project_key, row.canonical_project_key);
    }
  }

  const rollupMap = new Map<string, { totalSeconds: number; entryCount: number }>();
  if (rollupsResponse && rollupsResponse.ok) {
    const rollupRows = (await rollupsResponse.json()) as Array<{
      project_key?: string;
      total_seconds?: number;
      entry_count?: number;
    }>;
    for (const row of rollupRows) {
      if (!row.project_key) continue;
      rollupMap.set(row.project_key, {
        totalSeconds: Math.max(0, Number(row.total_seconds ?? 0)),
        entryCount: Math.max(0, Number(row.entry_count ?? 0)),
      });
    }
  }

  const projectByKey = new Map(rows.map((row) => [row.project_key, row] as const));
  const canonical = new Map<string, StoredProject>();
  for (const row of rows) {
    const canonicalKey = aliasMap.get(row.project_key) ?? row.project_key;
      const canonicalRow = projectByKey.get(canonicalKey) ?? row;
      if (!canonical.has(canonicalKey)) {
        const rollup = rollupMap.get(canonicalKey);
        canonical.set(canonicalKey, {
          ...canonicalRow,
          project_color: canonicalRow.project_color || DEFAULT_PROJECT_COLOR,
          project_type: canonicalRow.project_type === "non_work" ? "non_work" : "work",
          total_seconds: rollup?.totalSeconds ?? 0,
          entry_count: rollup?.entryCount ?? 0,
        });
      }
    }

  const byName = new Map<string, StoredProject>();
  for (const project of canonical.values()) {
    const normalizedName = (project.project_name ?? "").trim().toLowerCase();
    const key = normalizedName || project.project_key;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...project });
      continue;
    }
    existing.total_seconds = (existing.total_seconds ?? 0) + (project.total_seconds ?? 0);
    existing.entry_count = (existing.entry_count ?? 0) + (project.entry_count ?? 0);
    if (existing.project_type !== "work" && project.project_type === "work") {
      existing.project_type = "work";
    }
    if (!existing.project_color && project.project_color) {
      existing.project_color = project.project_color;
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.project_name.localeCompare(b.project_name));
}

export async function createProject(
  projectName: string,
  projectColor?: string | null,
  projectType: "work" | "non_work" = "work"
) {
  const normalized = normalizeProjectName(projectName);
  if (!normalized) {
    throw new Error("Project name is required");
  }
  const { projectKey, projectName: savedName } = await ensureManualProject(normalized);
  if (!projectKey || !savedName) {
    throw new Error("Failed to save project");
  }
  let finalColor: string = DEFAULT_PROJECT_COLOR;
  if (typeof projectColor === "string") {
    const normalizedColor = projectColor.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(normalizedColor)) {
      throw new Error("Invalid project color");
    }
    if (normalizedColor !== finalColor) {
      const updated = await updateProject({ key: projectKey, color: normalizedColor });
      finalColor = updated.projectColor;
    } else {
      finalColor = normalizedColor;
    }
  }
  let finalType: "work" | "non_work" = "work";
  if (projectType === "non_work") {
    const updated = await updateProject({ key: projectKey, projectType: "non_work" });
    finalType = updated.projectType;
  }
  return {
    projectKey,
    projectName: savedName,
    projectColor: finalColor,
    projectType: finalType,
  };
}

export async function updateProject(input: {
  key: string;
  name?: string | null;
  color?: string | null;
  projectType?: "work" | "non_work" | null;
}): Promise<{
  projectKey: string;
  projectName: string;
  projectColor: string;
  projectType: "work" | "non_work";
}> {
  const key = input.key.trim();
  if (!key) throw new Error("Project key is required");

  const patch: Record<string, string> = {};
  if (typeof input.name === "string") {
    const normalizedName = normalizeProjectName(input.name);
    if (!normalizedName) throw new Error("Project name is required");
    patch.project_name = normalizedName;
  }
  if (typeof input.color === "string") {
    const normalizedColor = input.color.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(normalizedColor)) {
      throw new Error("Invalid project color");
    }
    patch.project_color = normalizedColor.toUpperCase();
  }
  if (typeof input.projectType === "string") {
    if (input.projectType !== "work" && input.projectType !== "non_work") {
      throw new Error("Invalid project type");
    }
    patch.project_type = input.projectType;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("Nothing to update");
  }

  const response = await fetch(`${getBaseUrl()}/rest/v1/projects?project_key=eq.${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Failed to update project");
  const rows = (await response.json()) as Array<{
    project_key: string;
    project_name: string;
    project_color?: string;
    project_type?: "work" | "non_work";
  }>;
  const row = rows[0];
  if (!row) throw new Error("Project not found");
  return {
    projectKey: row.project_key,
    projectName: row.project_name,
    projectColor: row.project_color ?? DEFAULT_PROJECT_COLOR,
    projectType: row.project_type === "non_work" ? "non_work" : "work",
  };
}

export async function listMemberKpis(memberName?: string | null): Promise<StoredKpi[]> {
  if (!isSupabaseConfigured()) return [];
  const canonicalMember = memberName?.trim() ? canonicalizeMemberName(memberName.trim()) : "";
  const memberFilter = canonicalMember ? `&member_name=eq.${encodeURIComponent(canonicalMember)}` : "";
  const url =
    `${getBaseUrl()}/rest/v1/member_kpis` +
    `?select=id,member_name,kpi_label,kpi_value,notes,updated_at` +
    `${memberFilter}` +
    `&order=member_name.asc&order=kpi_label.asc`;
  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return [];
  const rows = (await response.json()) as StoredKpi[];
  return Array.isArray(rows) ? rows : [];
}

export async function upsertMemberKpi(input: {
  memberName: string;
  label: string;
  value: string;
  notes?: string | null;
}) {
  const memberName = canonicalizeMemberName(input.memberName.trim());
  const label = input.label.trim();
  const value = input.value.trim();
  const notes = input.notes?.trim() ?? null;
  if (!memberName) throw new Error("Member name is required");
  if (!label) throw new Error("KPI label is required");
  if (!value) throw new Error("KPI value is required");

  await ensureMember(memberName);

  const payload = [
    {
      member_name: memberName,
      kpi_label: label,
      kpi_value: value,
      notes,
    },
  ];
  const response = await fetch(`${getBaseUrl()}/rest/v1/member_kpis?on_conflict=member_name,kpi_label`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Failed to save KPI");
  const rows = (await response.json()) as StoredKpi[];
  return rows[0] ?? null;
}

async function ensureMember(memberName: string) {
  const payload = [{ member_name: canonicalizeMemberName(memberName) }];
  const response = await fetch(`${getBaseUrl()}/rest/v1/members?on_conflict=member_name`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to ensure member");
  }
}

export async function listMembers(): Promise<string[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const response = await fetch(`${getBaseUrl()}/rest/v1/members?select=member_name&order=member_name.asc`, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as StoredMember[];
  return rows
    .map((row) => canonicalizeMemberName(row.member_name))
    .filter((value) => value && value.trim().length > 0)
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => a.localeCompare(b));
}

export async function listMemberProfiles(): Promise<Array<{ name: string; email: string | null; role: string | null }>> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const response = await fetch(`${getBaseUrl()}/rest/v1/members?select=member_name,email,role&order=member_name.asc`, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    return [];
  }
  const rows = (await response.json()) as StoredMember[];
  const map = new Map<string, { name: string; email: string | null; role: string | null }>();
  for (const row of rows) {
    if (!row.member_name) continue;
    const canonicalName = canonicalizeMemberName(row.member_name);
    const existing = map.get(canonicalName);
    map.set(canonicalName, {
      name: canonicalName,
      email: existing?.email ?? row.email ?? null,
      role: existing?.role ?? row.role ?? "member",
    });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMemberNameByEmail(email: string): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  if (isSupabaseConfigured()) {
    const operators = ["eq", "ilike"] as const;
    for (const operator of operators) {
      const url =
        `${getBaseUrl()}/rest/v1/members` +
        `?select=member_name` +
        `&email=${operator}.${encodeURIComponent(normalizedEmail)}` +
        `&limit=1`;
      const response = await fetch(url, {
        method: "GET",
        headers: supabaseHeaders(),
        cache: "no-store",
      });
      if (!response.ok) continue;
      const rows = (await response.json()) as Array<{ member_name?: string }>;
      const memberName = rows[0]?.member_name?.trim() ?? "";
      if (memberName.length > 0) return canonicalizeMemberName(memberName);
    }

    const allResponse = await fetch(`${getBaseUrl()}/rest/v1/members?select=member_name,email`, {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    });
    if (allResponse.ok) {
      const rows = (await allResponse.json()) as Array<{ member_name?: string; email?: string | null }>;
      const exact = rows.find((row) => (row.email ?? "").trim().toLowerCase() === normalizedEmail);
      if (exact?.member_name) return canonicalizeMemberName(exact.member_name);
    }
  }

  const [localPartRaw] = normalizedEmail.split("@");
  const localPart = localPartRaw ?? "";
  const plusIdx = localPart.indexOf("+");
  const candidateFromTag = plusIdx >= 0 ? localPart.slice(plusIdx + 1) : "";
  const candidateFromLocal = plusIdx >= 0 ? localPart.slice(0, plusIdx) : localPart;
  const candidates = [candidateFromTag, candidateFromLocal]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => canonicalizeMemberName(value));

  if (candidates.length === 0) return null;
  const members = await listMembers();
  const match = members.find((member) => candidates.some((candidate) => member.toLowerCase() === candidate.toLowerCase()));
  return match ?? null;
}

function getLastSevenLocalDates(endDate: string) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export async function getMemberWeekTotalSeconds(memberName: string, endDate: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const canonicalMember = canonicalizeMemberName(memberName);
  const weekDates = getLastSevenLocalDates(endDate);
  const startDate = weekDates[0];
  const url =
    `${getBaseUrl()}/rest/v1/daily_member_stats` +
    `?select=total_seconds` +
    `&member_name=eq.${encodeURIComponent(canonicalMember)}` +
    `&stat_date=gte.${encodeURIComponent(startDate)}` +
    `&stat_date=lte.${encodeURIComponent(endDate)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return 0;
  const rows = (await response.json()) as Array<{ total_seconds?: number }>;
  return rows.reduce((acc, row) => acc + Math.max(0, Number(row.total_seconds ?? 0)), 0);
}

export async function resolveCanonicalMemberName(inputName: string): Promise<string | null> {
  const normalized = canonicalizeMemberName(inputName).trim().toLowerCase();
  if (!normalized) return null;
  const members = await listMembers();
  const matched = members.find((name) => name.toLowerCase() === normalized || namesMatch(name, normalized));
  return matched ?? null;
}

export async function createMember(memberName: string): Promise<string> {
  const normalized = canonicalizeMemberName(memberName);
  if (!normalized) throw new Error("Member name is required");
  await ensureMember(normalized);
  return normalized;
}

export async function upsertMemberProfile(input: {
  name: string;
  email?: string | null;
  role?: string | null;
}) {
  const name = canonicalizeMemberName(input.name);
  if (!name) throw new Error("Member name is required");
  const email = input.email?.trim() || null;
  const role = input.role?.trim() || "member";
  const payload = [{ member_name: name, email, role }];
  const response = await fetch(`${getBaseUrl()}/rest/v1/members?on_conflict=member_name`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Failed to save member profile");
  const rows = (await response.json()) as Array<{ member_name: string; email: string | null; role: string | null }>;
  return rows[0] ?? { member_name: name, email, role };
}

export async function getRunningEntry(memberName: string): Promise<RunningEntry | null> {
  if (!isSupabaseConfigured()) return null;

  const url =
    `${getBaseUrl()}/rest/v1/time_entries` +
    `?select=toggl_entry_id,member_name,description,start_at,duration_seconds,project_key,entry_source` +
    `&member_name=eq.${encodeURIComponent(memberName)}` +
    `&is_running=eq.true` +
    `&order=start_at.desc&limit=1`;

  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return null;

  const rows = (await response.json()) as StoredEntryRow[];
  const row = rows[0];
  if (!row) return null;

  let projectName: string | null = null;
  if (row.project_key) {
    const projectResponse = await fetch(
      `${getBaseUrl()}/rest/v1/projects?select=project_name&project_key=eq.${encodeURIComponent(row.project_key)}&limit=1`,
      {
        method: "GET",
        headers: supabaseHeaders(),
        cache: "no-store",
      }
    );
    if (projectResponse.ok) {
      const projectRows = (await projectResponse.json()) as Array<{ project_name?: string }>;
      projectName = projectRows[0]?.project_name ?? null;
    }
  }

  return {
    id: row.toggl_entry_id,
    member: row.member_name,
    description: row.description,
    projectName,
    startAt: row.start_at,
    durationSeconds: Math.max(0, row.duration_seconds),
    source: row.entry_source || "manual",
  };
}

export async function startManualTimer(input: {
  memberName: string;
  description: string | null;
  projectName: string | null;
  tzOffsetMinutes?: number | null;
  elapsedSeconds?: number | null;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history is not configured");
  }

  const existing = await getRunningEntry(input.memberName);
  if (existing) {
    return { started: false, runningEntry: existing };
  }

  const tzOffsetMinutes = parseTzOffsetMinutes(input.tzOffsetMinutes);
  const elapsedSeconds = Math.max(0, Math.floor(Number(input.elapsedSeconds ?? 0)));
  const now = new Date();
  const startAt = new Date(now.getTime() - elapsedSeconds * 1000);
  const nowIso = now.toISOString();
  const sourceDate = toLocalDateKey(startAt, tzOffsetMinutes);
  await ensureMember(input.memberName);
  const { projectKey, projectName } = await ensureManualProject(input.projectName);
  const sourceEntryId = `manual:${input.memberName}:${startAt.getTime()}:${elapsedSeconds}`;

  const payload = [
    {
      entry_source: "manual",
      source_entry_id: sourceEntryId,
      member_name: input.memberName,
      project_key: projectKey,
      description: normalizeDescription(input.description),
      start_at: startAt.toISOString(),
      stop_at: null,
      duration_seconds: elapsedSeconds,
      is_running: true,
      tags: [],
      source_date: sourceDate,
      synced_at: nowIso,
      raw: {
        source: "manual",
        action: "start",
        created_at: nowIso,
      },
    },
  ];

  const response = await fetch(`${getBaseUrl()}/rest/v1/time_entries`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to start timer");
  }

  const rows = (await response.json()) as StoredEntryRow[];
  const created = rows[0];
  if (!created) {
    throw new Error("Timer start returned no entry");
  }

  return {
    started: true,
    runningEntry: {
      id: created.toggl_entry_id,
      member: created.member_name,
      description: created.description,
      projectName,
      startAt: created.start_at,
      durationSeconds: 0,
      source: created.entry_source || "manual",
    } satisfies RunningEntry,
  };
}

export async function stopManualTimer(input: { memberName: string; tzOffsetMinutes?: number | null }) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history is not configured");
  }

  const running = await getRunningEntry(input.memberName);
  if (!running) {
    return { stopped: false, runningEntry: null as RunningEntry | null };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const tzOffsetMinutes = parseTzOffsetMinutes(input.tzOffsetMinutes);
  const rowsResponse = await fetch(
    `${getBaseUrl()}/rest/v1/time_entries?select=toggl_entry_id,start_at&member_name=eq.${encodeURIComponent(
      input.memberName
    )}&is_running=eq.true&order=start_at.desc`,
    {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    }
  );
  if (!rowsResponse.ok) {
    throw new Error("Failed to load running timer rows");
  }
  const runningRows = (await rowsResponse.json()) as Array<{ toggl_entry_id: number; start_at: string }>;
  if (runningRows.length === 0) {
    return { stopped: false, runningEntry: null as RunningEntry | null };
  }

  for (const row of runningRows) {
    const startedAtMs = new Date(row.start_at).getTime();
    const durationSeconds = Number.isNaN(startedAtMs) ? 0 : Math.max(0, Math.floor((now.getTime() - startedAtMs) / 1000));
    const sourceDate = toLocalDateKey(new Date(row.start_at), tzOffsetMinutes);
    const response = await fetch(`${getBaseUrl()}/rest/v1/time_entries?toggl_entry_id=eq.${row.toggl_entry_id}`, {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        stop_at: nowIso,
        duration_seconds: durationSeconds,
        is_running: false,
        source_date: sourceDate,
        synced_at: nowIso,
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Failed to stop timer");
    }
  }

  const runningStartedAtMs = new Date(running.startAt).getTime();
  const runningDurationSeconds = Number.isNaN(runningStartedAtMs)
    ? 0
    : Math.max(0, Math.floor((now.getTime() - runningStartedAtMs) / 1000));

  return {
    stopped: true,
    stoppedEntry: {
      ...running,
      durationSeconds: runningDurationSeconds,
    },
  };
}

export async function updateRunningEntryMetadata(input: {
  memberName: string;
  description: string | null;
  projectName: string | null;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history is not configured");
  }

  const running = await getRunningEntry(input.memberName);
  if (!running) {
    return null;
  }

  await ensureMember(input.memberName);
  const { projectKey, projectName } = await ensureManualProject(input.projectName);
  const nowIso = new Date().toISOString();

  const response = await fetch(`${getBaseUrl()}/rest/v1/time_entries?toggl_entry_id=eq.${running.id}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      project_key: projectKey,
      description: normalizeDescription(input.description),
      synced_at: nowIso,
      raw: {
        source: "manual",
        action: "running_metadata_update",
        edited_at: nowIso,
      },
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to update running entry");
  }

  const rows = (await response.json()) as StoredEntryRow[];
  const updated = rows[0];
  if (!updated) {
    throw new Error("Running entry update returned no row");
  }

  return {
    id: updated.toggl_entry_id,
    member: updated.member_name,
    description: updated.description,
    projectName,
    startAt: updated.start_at,
    durationSeconds: Math.max(0, updated.duration_seconds),
    source: updated.entry_source || "manual",
  } satisfies RunningEntry;
}

export async function backdateRunningEntry(input: {
  memberName: string;
  elapsedSeconds: number;
  description: string | null;
  projectName: string | null;
  tzOffsetMinutes?: number | null;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history is not configured");
  }

  const running = await getRunningEntry(input.memberName);
  if (!running) return null;

  const elapsedSeconds = Math.max(0, Math.floor(input.elapsedSeconds));
  const startAt = new Date(Date.now() - elapsedSeconds * 1000);
  const tzOffsetMinutes = parseTzOffsetMinutes(input.tzOffsetMinutes);
  const sourceDate = toLocalDateKey(startAt, tzOffsetMinutes);
  const { projectKey, projectName } = await ensureManualProject(input.projectName);
  const nowIso = new Date().toISOString();

  const response = await fetch(`${getBaseUrl()}/rest/v1/time_entries?toggl_entry_id=eq.${running.id}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      start_at: startAt.toISOString(),
      duration_seconds: elapsedSeconds,
      source_date: sourceDate,
      project_key: projectKey,
      description: normalizeDescription(input.description),
      synced_at: nowIso,
      raw: {
        source: "manual",
        action: "backdate_running",
        edited_at: nowIso,
      },
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to backdate running timer");
  }

  const rows = (await response.json()) as StoredEntryRow[];
  const updated = rows[0];
  if (!updated) {
    throw new Error("Backdate running timer returned no row");
  }

  return {
    id: updated.toggl_entry_id,
    member: updated.member_name,
    description: updated.description,
    projectName,
    startAt: updated.start_at,
    durationSeconds: Math.max(0, updated.duration_seconds),
    source: updated.entry_source || "manual",
  } satisfies RunningEntry;
}

export async function createManualTimeEntry(input: {
  memberName: string;
  description: string | null;
  projectName: string | null;
  startAtIso: string;
  durationSeconds: number;
  tzOffsetMinutes?: number | null;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history is not configured");
  }

  const startAt = new Date(input.startAtIso);
  if (Number.isNaN(startAt.getTime())) {
    throw new Error("Invalid start time");
  }
  const durationSeconds = Math.max(0, Math.floor(input.durationSeconds));
  const stopAt = new Date(startAt.getTime() + durationSeconds * 1000);
  const nowIso = new Date().toISOString();
  const tzOffsetMinutes = parseTzOffsetMinutes(input.tzOffsetMinutes);
  const sourceDate = toLocalDateKey(startAt, tzOffsetMinutes);
  await ensureMember(input.memberName);
  const { projectKey, projectName } = await ensureManualProject(input.projectName);
  const sourceEntryId = `manual:${input.memberName}:${startAt.getTime()}:${durationSeconds}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const payload = [
    {
      entry_source: "manual",
      source_entry_id: sourceEntryId,
      member_name: input.memberName,
      project_key: projectKey,
      description: normalizeDescription(input.description),
      start_at: startAt.toISOString(),
      stop_at: stopAt.toISOString(),
      duration_seconds: durationSeconds,
      is_running: false,
      tags: [],
      source_date: sourceDate,
      synced_at: nowIso,
      raw: {
        source: "manual",
        action: "manual_entry",
        created_at: nowIso,
      },
    },
  ];

  const response = await fetch(`${getBaseUrl()}/rest/v1/time_entries`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Failed to create manual entry");
  }

  const rows = (await response.json()) as StoredEntryRow[];
  const created = rows[0];
  if (!created) {
    throw new Error("Manual entry create returned no row");
  }

  return {
    id: created.toggl_entry_id,
    member: created.member_name,
    description: created.description,
    projectName,
    startAt: created.start_at,
    stopAt: created.stop_at,
    durationSeconds: created.duration_seconds,
    source: created.entry_source || "manual",
  };
}

export async function updateStoredTimeEntry(input: {
  memberName: string;
  entryId: number;
  description: string | null;
  projectName: string | null;
  startAtIso: string;
  stopAtIso: string;
  tzOffsetMinutes?: number | null;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history is not configured");
  }

  const startAt = new Date(input.startAtIso);
  const stopAt = new Date(input.stopAtIso);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(stopAt.getTime())) {
    throw new Error("Invalid start/stop time");
  }
  if (stopAt.getTime() <= startAt.getTime()) {
    throw new Error("Stop time must be after start time");
  }

  const existingResponse = await fetch(
    `${getBaseUrl()}/rest/v1/time_entries?select=toggl_entry_id,member_name,entry_source,source_entry_id&toggl_entry_id=eq.${input.entryId}&limit=1`,
    {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    }
  );
  if (!existingResponse.ok) {
    throw new Error("Failed to read existing entry");
  }
  const existingRows = (await existingResponse.json()) as Array<{
    toggl_entry_id: number;
    member_name: string;
    entry_source: string;
    source_entry_id: string | null;
  }>;
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Entry not found");
  }
  if (existing.member_name.toLowerCase() !== input.memberName.toLowerCase()) {
    throw new Error("Entry does not belong to member");
  }

  await ensureMember(input.memberName);
  const { projectKey, projectName } = await ensureManualProject(input.projectName);
  const durationSeconds = Math.max(0, Math.floor((stopAt.getTime() - startAt.getTime()) / 1000));
  const tzOffsetMinutes = parseTzOffsetMinutes(input.tzOffsetMinutes);
  const sourceDate = toLocalDateKey(startAt, tzOffsetMinutes);
  const nowIso = new Date().toISOString();

  const updateResponse = await fetch(`${getBaseUrl()}/rest/v1/time_entries?toggl_entry_id=eq.${input.entryId}`, {
    method: "PATCH",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      description: normalizeDescription(input.description),
      project_key: projectKey,
      start_at: startAt.toISOString(),
      stop_at: stopAt.toISOString(),
      duration_seconds: durationSeconds,
      is_running: false,
      source_date: sourceDate,
      synced_at: nowIso,
      raw: {
        source: existing.entry_source || "manual",
        action: "edited",
        edited_at: nowIso,
      },
    }),
    cache: "no-store",
  });
  if (!updateResponse.ok) {
    throw new Error("Failed to update entry");
  }
  const rows = (await updateResponse.json()) as StoredEntryRow[];
  const updated = rows[0];
  if (!updated) {
    throw new Error("Update returned no entry");
  }

  return {
    id: updated.toggl_entry_id,
    member: updated.member_name,
    description: updated.description,
    projectName,
    startAt: updated.start_at,
    stopAt: updated.stop_at,
    durationSeconds: updated.duration_seconds,
    source: updated.entry_source || "manual",
  };
}

export async function deleteStoredTimeEntry(input: {
  memberName: string;
  entryId: number;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase history is not configured");
  }

  const existingResponse = await fetch(
    `${getBaseUrl()}/rest/v1/time_entries?select=toggl_entry_id,member_name,is_running&toggl_entry_id=eq.${input.entryId}&limit=1`,
    {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    }
  );
  if (!existingResponse.ok) {
    throw new Error("Failed to read existing entry");
  }
  const existingRows = (await existingResponse.json()) as Array<{
    toggl_entry_id: number;
    member_name: string;
    is_running: boolean;
  }>;
  const existing = existingRows[0];
  if (!existing) {
    throw new Error("Entry not found");
  }
  if (!namesMatch(existing.member_name, input.memberName)) {
    throw new Error("Entry does not belong to member");
  }

  const deleteResponse = await fetch(`${getBaseUrl()}/rest/v1/time_entries?toggl_entry_id=eq.${input.entryId}`, {
    method: "DELETE",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=minimal",
    },
    cache: "no-store",
  });
  if (!deleteResponse.ok) {
    throw new Error("Failed to delete entry");
  }

  return {
    deleted: true,
    wasRunning: Boolean(existing.is_running),
  };
}
