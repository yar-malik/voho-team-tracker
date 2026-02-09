import { NextRequest, NextResponse } from "next/server";
import {
  fetchCurrentEntry,
  fetchProjectNames,
  fetchTimeEntries,
  getEntryProjectName,
  getTokenForMember,
  sortEntriesByStart,
} from "@/lib/toggl";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  payload: {
    entries: Array<Awaited<ReturnType<typeof fetchTimeEntries>>[number] & { project_name?: string | null }>;
    current: (Awaited<ReturnType<typeof fetchCurrentEntry>> & { project_name?: string | null }) | null;
    totalSeconds: number;
    date: string;
    quotaRemaining?: string | null;
    quotaResetsIn?: string | null;
  };
};

const responseCache = new Map<string, CacheEntry>();

function getCached(key: string) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return cached.payload;
}

function setCached(key: string, payload: CacheEntry["payload"]) {
  responseCache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const member = searchParams.get("member");
  const dateParam = searchParams.get("date");

  if (!member) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }

  const token = getTokenForMember(member);
  if (!token) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  const dateInput = dateParam ?? new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(dateInput)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const startDate = `${dateInput}T00:00:00Z`;
  const endDate = `${dateInput}T23:59:59Z`;
  const cacheKey = `${member.toLowerCase()}::${dateInput}`;
  const isTodayUtc = dateInput === new Date().toISOString().slice(0, 10);

  const cached = getCached(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    const [entries, current] = await Promise.all([
      fetchTimeEntries(token, startDate, endDate),
      isTodayUtc ? fetchCurrentEntry(token) : Promise.resolve(null),
    ]);
    const projectNames = await fetchProjectNames(token, current ? [...entries, current] : entries);
    const sortedEntries = sortEntriesByStart(entries).map((entry) => ({
      ...entry,
      project_name: getEntryProjectName(entry, projectNames),
    }));
    const enrichedCurrent = current
      ? {
          ...current,
          project_name: getEntryProjectName(current, projectNames),
        }
      : null;

    const totalSeconds = sortedEntries.reduce((acc, entry) => {
      if (entry.duration >= 0) return acc + entry.duration;
      const startedAt = new Date(entry.start).getTime();
      if (Number.isNaN(startedAt)) return acc;
      const runningSeconds = Math.floor((Date.now() - startedAt) / 1000);
      return acc + runningSeconds;
    }, 0);

    const payload = { entries: sortedEntries, current: enrichedCurrent, totalSeconds, date: dateInput };
    setCached(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = (error as Error & { status?: number }).status ?? 502;
    const retryAfter = (error as Error & { retryAfter?: string | null }).retryAfter ?? null;
    const quotaRemaining = (error as Error & { quotaRemaining?: string | null }).quotaRemaining ?? null;
    const quotaResetsIn = (error as Error & { quotaResetsIn?: string | null }).quotaResetsIn ?? null;

    if (status === 402) {
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
      return NextResponse.json(
        { error: "Rate limited by Toggl. Please retry shortly.", retryAfter, quotaRemaining, quotaResetsIn },
        { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : undefined }
      );
    }

    return NextResponse.json({ error: message }, { status: status >= 400 ? status : 502 });
  }
}
