import { NextRequest, NextResponse } from "next/server";
import {
  fetchProjectNames,
  fetchTimeEntries,
  getEntryProjectName,
  getTeamMembers,
  getTokenForMember,
  sortEntriesByStart,
} from "@/lib/toggl";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 10 * 60 * 1000;

type MemberPayload = {
  name: string;
  entries: Array<Awaited<ReturnType<typeof fetchTimeEntries>>[number] & { project_name?: string | null }>;
  current: null;
  totalSeconds: number;
};

type CacheEntry = {
  expiresAt: number;
  payload: {
    date: string;
    members: MemberPayload[];
    cachedAt: string;
    quotaRemaining?: string | null;
    quotaResetsIn?: string | null;
  };
};

const responseCache = new Map<string, CacheEntry>();

function getCached(key: string) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) return null;
  return cached.payload;
}

function getCachedAny(key: string) {
  return responseCache.get(key)?.payload ?? null;
}

function setCached(key: string, payload: CacheEntry["payload"]) {
  responseCache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const forceRefresh = searchParams.get("refresh") === "1";

  const dateInput = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(dateInput)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const cacheKey = `team::${dateInput}`;
  const cachedFresh = getCached(cacheKey);
  const cachedAny = getCachedAny(cacheKey);
  const members = getTeamMembers();
  if (members.length === 0) {
    return NextResponse.json({ error: "No members configured" }, { status: 400 });
  }
  if (!forceRefresh && cachedFresh) {
    return NextResponse.json({ ...cachedFresh, stale: false, warning: null });
  }
  if (!forceRefresh && cachedAny) {
    return NextResponse.json({
      ...cachedAny,
      stale: true,
      warning: "Showing last cached snapshot. Click Refresh view to fetch newer data.",
    });
  }
  if (!forceRefresh && !cachedAny) {
    return NextResponse.json({
      date: dateInput,
      members: members.map((member) => ({ name: member.name, entries: [], current: null, totalSeconds: 0 })),
      cachedAt: new Date().toISOString(),
      stale: true,
      warning: "No cached snapshot yet. Click Refresh view to load data.",
    });
  }

  const startDate = `${dateInput}T00:00:00Z`;
  const endDate = `${dateInput}T23:59:59Z`;

  try {
    const results = await Promise.all(
      members.map(async (member) => {
        const token = getTokenForMember(member.name);
        if (!token) {
          return { name: member.name, entries: [], current: null, totalSeconds: 0 };
        }

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
          const runningSeconds = Math.floor((Date.now() - startedAt) / 1000);
          return acc + runningSeconds;
        }, 0);

        return { name: member.name, entries: sortedEntries, current: null, totalSeconds };
      })
    );

    const payload = { date: dateInput, members: results, cachedAt: new Date().toISOString() };
    setCached(cacheKey, payload);
    return NextResponse.json({ ...payload, stale: false, warning: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = (error as Error & { status?: number }).status ?? 502;
    const retryAfter = (error as Error & { retryAfter?: string | null }).retryAfter ?? null;
    const quotaRemaining = (error as Error & { quotaRemaining?: string | null }).quotaRemaining ?? null;
    const quotaResetsIn = (error as Error & { quotaResetsIn?: string | null }).quotaResetsIn ?? null;

    if (status === 402) {
      if (cachedAny) {
        return NextResponse.json({
          ...cachedAny,
          stale: true,
          warning: "Quota reached. Showing last cached snapshot. Try refresh again after reset.",
          quotaRemaining,
          quotaResetsIn,
        });
      }
      return NextResponse.json(
        {
          error: "Toggl API quota reached. Please wait for reset before retrying.",
          quotaRemaining,
          quotaResetsIn,
        },
        { status: 402, headers: quotaResetsIn ? { "X-Toggl-Quota-Resets-In": quotaResetsIn } : undefined }
      );
    }

    if (status === 429) {
      if (cachedAny) {
        return NextResponse.json({
          ...cachedAny,
          stale: true,
          warning: "Rate limited. Showing last cached snapshot.",
          quotaRemaining,
          quotaResetsIn,
        });
      }
      return NextResponse.json(
        { error: "Rate limited by Toggl. Please retry shortly.", retryAfter, quotaRemaining, quotaResetsIn },
        { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : undefined }
      );
    }

    if (cachedAny) {
      return NextResponse.json({
        ...cachedAny,
        stale: true,
        warning: "Toggl is unavailable. Showing last cached snapshot.",
      });
    }

    return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
  }
}
