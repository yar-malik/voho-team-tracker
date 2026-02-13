import "server-only";

type EntryForHistory = {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  project_id?: number | null;
  workspace_id?: number | null;
  wid?: number | null;
  project_name?: string | null;
  tags?: string[] | null;
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

async function upsertRows(table: string, rows: unknown[], onConflict?: string) {
  if (!isSupabaseConfigured() || rows.length === 0) return;
  const base = process.env.SUPABASE_URL!;
  const conflictQuery = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";

  await fetch(`${base}/rest/v1/${table}${conflictQuery}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
    cache: "no-store",
  }).catch(() => undefined);
}

async function insertRows(table: string, rows: unknown[]) {
  if (!isSupabaseConfigured() || rows.length === 0) return;
  const base = process.env.SUPABASE_URL!;

  await fetch(`${base}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
    cache: "no-store",
  }).catch(() => undefined);
}

function getWorkspaceId(entry: Pick<EntryForHistory, "workspace_id" | "wid">) {
  if (typeof entry.workspace_id === "number") return entry.workspace_id;
  if (typeof entry.wid === "number") return entry.wid;
  return null;
}

function getProjectKey(entry: Pick<EntryForHistory, "project_id" | "workspace_id" | "wid">) {
  if (typeof entry.project_id !== "number") return null;
  const workspaceId = getWorkspaceId(entry);
  if (workspaceId === null) return null;
  return `${workspaceId}:${entry.project_id}`;
}

function normalizeDuration(entry: EntryForHistory) {
  if (entry.duration >= 0) return entry.duration;
  const startedAt = new Date(entry.start).getTime();
  if (Number.isNaN(startedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function getDateKey(iso: string) {
  return iso.slice(0, 10);
}

export async function persistHistoricalSnapshot(
  scope: "entries" | "team",
  memberName: string,
  requestedDate: string,
  entries: EntryForHistory[]
) {
  if (!isSupabaseConfigured()) return;

  const memberRows = [{ member_name: memberName }];
  const projectRows = new Map<string, { project_key: string; workspace_id: number; project_id: number; project_name: string }>();
  const entryRows = entries.map((entry) => {
    const projectKey = getProjectKey(entry);
    if (projectKey) {
      const workspaceId = getWorkspaceId(entry);
      if (workspaceId !== null && typeof entry.project_id === "number") {
        projectRows.set(projectKey, {
          project_key: projectKey,
          workspace_id: workspaceId,
          project_id: entry.project_id,
          project_name: entry.project_name?.trim() || "Unknown project",
        });
      }
    }

    return {
      toggl_entry_id: entry.id,
      entry_source: "toggl",
      source_entry_id: String(entry.id),
      member_name: memberName,
      project_key: projectKey,
      description: entry.description,
      start_at: entry.start,
      stop_at: entry.stop,
      duration_seconds: normalizeDuration(entry),
      is_running: entry.duration < 0 || !entry.stop,
      tags: entry.tags ?? [],
      source_date: requestedDate,
      synced_at: new Date().toISOString(),
      raw: entry,
    };
  });

  const totalSeconds = entryRows.reduce((acc, row) => acc + row.duration_seconds, 0);
  const statsRows = [
    {
      stat_date: requestedDate,
      member_name: memberName,
      total_seconds: totalSeconds,
      entry_count: entryRows.length,
    },
  ];

  const eventRows = [
    {
      scope,
      member_name: memberName,
      requested_date: requestedDate,
      fetched_entries: entryRows.length,
      status: "ok",
      error: null,
    },
  ];

  await Promise.all([
    upsertRows("members", memberRows, "member_name"),
    upsertRows("projects", Array.from(projectRows.values()), "project_key"),
    upsertRows("time_entries", entryRows, "toggl_entry_id"),
    upsertRows("daily_member_stats", statsRows, "stat_date,member_name"),
    insertRows("sync_events", eventRows),
  ]);
}

export async function persistHistoricalError(
  scope: "entries" | "team",
  memberName: string | null,
  requestedDate: string,
  message: string
) {
  if (!isSupabaseConfigured()) return;
  await insertRows("sync_events", [
    {
      scope,
      member_name: memberName,
      requested_date: requestedDate,
      fetched_entries: 0,
      status: "error",
      error: message.slice(0, 500),
    },
  ]);
}

export async function persistWeeklyRollup(
  requestedDate: string,
  members: Array<{ name: string; days: Array<{ date: string; seconds: number; entryCount: number }> }>
) {
  if (!isSupabaseConfigured()) return;

  const statRows: Array<{ stat_date: string; member_name: string; total_seconds: number; entry_count: number }> = [];
  const memberRows = members.map((member) => ({ member_name: member.name }));
  for (const member of members) {
    for (const day of member.days) {
      statRows.push({
        stat_date: day.date || requestedDate || getDateKey(new Date().toISOString()),
        member_name: member.name,
        total_seconds: day.seconds,
        entry_count: day.entryCount,
      });
    }
  }

  await Promise.all([
    upsertRows("members", memberRows, "member_name"),
    upsertRows("daily_member_stats", statRows, "stat_date,member_name"),
    insertRows("sync_events", [
      {
        scope: "team",
        member_name: null,
        requested_date: requestedDate,
        fetched_entries: statRows.length,
        status: "ok",
        error: null,
      },
    ]),
  ]);
}
