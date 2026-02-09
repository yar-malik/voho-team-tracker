import "server-only";

export type TeamMember = {
  name: string;
  token: string;
};

export type TogglTimeEntry = {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  project_id?: number | null;
  workspace_id?: number | null;
  wid?: number | null;
  tags?: string[] | null;
};

const TOGGL_API_BASE = "https://api.track.toggl.com/api/v9";

function parseTeamEnv(): TeamMember[] {
  const raw = process.env.TOGGL_TEAM;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as TeamMember[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item && typeof item.name === "string" && typeof item.token === "string")
      .map((item) => ({ name: item.name.trim(), token: item.token.trim() }))
      .filter((item) => item.name.length > 0 && item.token.length > 0);
  } catch {
    return [];
  }
}

export function getTeamMembers(): { name: string }[] {
  return parseTeamEnv().map((member) => ({ name: member.name }));
}

export function getTokenForMember(name: string): string | null {
  const team = parseTeamEnv();
  const member = team.find((item) => item.name.toLowerCase() === name.toLowerCase());
  return member?.token ?? null;
}

function authHeader(token: string): string {
  const basic = Buffer.from(`${token}:api_token`).toString("base64");
  return `Basic ${basic}`;
}

export async function fetchTimeEntries(token: string, startDate: string, endDate: string) {
  const url = new URL(`${TOGGL_API_BASE}/me/time_entries`);
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);

  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(token),
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const error = new Error(`Toggl request failed (${response.status})`);
    (error as Error & { status?: number; retryAfter?: string | null }).status = response.status;
    (error as Error & { status?: number; retryAfter?: string | null }).retryAfter =
      response.headers.get("Retry-After");
    throw error;
  }

  return (await response.json()) as TogglTimeEntry[];
}

export async function fetchCurrentEntry(token: string) {
  const url = `${TOGGL_API_BASE}/me/time_entries/current`;
  const response = await fetch(url, {
    headers: {
      Authorization: authHeader(token),
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const error = new Error(`Toggl current entry failed (${response.status})`);
    (error as Error & { status?: number; retryAfter?: string | null }).status = response.status;
    (error as Error & { status?: number; retryAfter?: string | null }).retryAfter =
      response.headers.get("Retry-After");
    throw error;
  }

  return (await response.json()) as TogglTimeEntry | null;
}

function getWorkspaceId(entry: Pick<TogglTimeEntry, "workspace_id" | "wid">): number | null {
  if (typeof entry.workspace_id === "number") return entry.workspace_id;
  if (typeof entry.wid === "number") return entry.wid;
  return null;
}

function projectKey(workspaceId: number, projectId: number): string {
  return `${workspaceId}:${projectId}`;
}

export async function fetchProjectNames(
  token: string,
  entries: Array<Pick<TogglTimeEntry, "project_id" | "workspace_id" | "wid">>
) {
  const projectMap = new Map<string, string>();
  const uniqueProjects = new Map<string, { workspaceId: number; projectId: number }>();

  for (const entry of entries) {
    if (typeof entry.project_id !== "number") continue;
    const workspaceId = getWorkspaceId(entry);
    if (workspaceId === null) continue;
    const key = projectKey(workspaceId, entry.project_id);
    if (!uniqueProjects.has(key)) {
      uniqueProjects.set(key, { workspaceId, projectId: entry.project_id });
    }
  }

  await Promise.all(
    Array.from(uniqueProjects.values()).map(async ({ workspaceId, projectId }) => {
      const url = `${TOGGL_API_BASE}/workspaces/${workspaceId}/projects/${projectId}`;
      const response = await fetch(url, {
        headers: {
          Authorization: authHeader(token),
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });

      if (!response.ok) return;
      const payload = (await response.json()) as { name?: unknown };
      if (typeof payload.name === "string" && payload.name.trim().length > 0) {
        projectMap.set(projectKey(workspaceId, projectId), payload.name.trim());
      }
    })
  );

  return projectMap;
}

export function getEntryProjectName(
  entry: Pick<TogglTimeEntry, "project_id" | "workspace_id" | "wid">,
  projectNames: Map<string, string>
) {
  if (typeof entry.project_id !== "number") return null;
  const workspaceId = getWorkspaceId(entry);
  if (workspaceId === null) return null;
  return projectNames.get(projectKey(workspaceId, entry.project_id)) ?? null;
}

export function sortEntriesByStart(entries: TogglTimeEntry[]) {
  return [...entries].sort((a, b) => {
    const aTime = new Date(a.start).getTime();
    const bTime = new Date(b.start).getTime();
    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return aTime - bTime;
  });
}
