"use client";

export const DEFAULT_POMODORO_SECONDS = 25 * 60;
export const POMODORO_STORAGE_KEY = "voho_sidebar_pomodoro_v2";
export const LEGACY_POMODORO_STORAGE_KEY = "voho_sidebar_pomodoro_v1";
export const POMODORO_SYNC_EVENT = "voho-pomodoro-sync";

export type PomodoroState = {
  secondsLeft: number;
  running: boolean;
  completionsByDay: Record<string, number>;
  sessions: PomodoroSession[];
  activeSessionId: string | null;
  updatedAt: number;
};

export type PomodoroSession = {
  id: string;
  dayKey: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  interruptions: number;
  focus: string;
  done: string;
};

function clampSeconds(value: number) {
  return Math.max(0, Math.min(DEFAULT_POMODORO_SECONDS, Math.floor(value)));
}

export function formatPomodoroTimer(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getPomodoroDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function emptyState(): PomodoroState {
  return {
    secondsLeft: DEFAULT_POMODORO_SECONDS,
    running: false,
    completionsByDay: {},
    sessions: [],
    activeSessionId: null,
    updatedAt: Date.now(),
  };
}

function normalizeState(raw: unknown): PomodoroState {
  const value = (raw ?? {}) as Partial<PomodoroState>;
  const completions = value.completionsByDay && typeof value.completionsByDay === "object" ? value.completionsByDay : {};
  const cleanedCompletions: Record<string, number> = {};
  for (const [day, count] of Object.entries(completions)) {
    const safeCount = Number(count);
    if (Number.isFinite(safeCount) && safeCount > 0) cleanedCompletions[day] = Math.floor(safeCount);
  }
  const rawSessions = Array.isArray((value as { sessions?: unknown[] }).sessions)
    ? ((value as { sessions?: unknown[] }).sessions as unknown[])
    : [];
  const sessions: PomodoroSession[] = rawSessions
    .map((row) => row as Partial<PomodoroSession>)
    .filter((row) => typeof row.id === "string" && row.id.length > 0)
    .map((row) => ({
      id: row.id as string,
      dayKey: typeof row.dayKey === "string" && row.dayKey ? row.dayKey : getPomodoroDayKey(),
      startedAt: typeof row.startedAt === "string" ? row.startedAt : new Date().toISOString(),
      endedAt: typeof row.endedAt === "string" ? row.endedAt : new Date().toISOString(),
      durationSeconds: Math.max(0, Math.floor(Number(row.durationSeconds ?? DEFAULT_POMODORO_SECONDS))),
      interruptions: Math.max(0, Math.floor(Number(row.interruptions ?? 0))),
      focus: typeof row.focus === "string" ? row.focus : "",
      done: typeof row.done === "string" ? row.done : "",
    }))
    .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
    .slice(0, 500);

  const activeSessionIdRaw = (value as { activeSessionId?: unknown }).activeSessionId;
  const activeSessionId =
    typeof activeSessionIdRaw === "string" && sessions.some((session) => session.id === activeSessionIdRaw)
      ? activeSessionIdRaw
      : null;

  return {
    secondsLeft: clampSeconds(Number(value.secondsLeft ?? DEFAULT_POMODORO_SECONDS)),
    running: Boolean(value.running),
    completionsByDay: cleanedCompletions,
    sessions,
    activeSessionId,
    updatedAt: Number(value.updatedAt ?? Date.now()),
  };
}

export function readPomodoroState(): PomodoroState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(POMODORO_STORAGE_KEY);
    if (raw) {
      const parsed = normalizeState(JSON.parse(raw));
      if (parsed.running) {
        const elapsed = Math.max(0, Math.floor((Date.now() - parsed.updatedAt) / 1000));
        parsed.secondsLeft = Math.max(0, parsed.secondsLeft - elapsed);
        parsed.running = parsed.secondsLeft > 0;
      }
      parsed.updatedAt = Date.now();
      return parsed;
    }
  } catch {
    // fall back to legacy/default.
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_POMODORO_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as {
        secondsLeft?: number;
        running?: boolean;
        updatedAt?: number;
      };
      let secondsLeft = clampSeconds(Number(parsed.secondsLeft ?? DEFAULT_POMODORO_SECONDS));
      const running = Boolean(parsed.running);
      const updatedAt = Number(parsed.updatedAt ?? Date.now());
      if (running) {
        const elapsed = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
        secondsLeft = Math.max(0, secondsLeft - elapsed);
      }
      return {
        secondsLeft,
        running: running && secondsLeft > 0,
        completionsByDay: {},
        sessions: [],
        activeSessionId: null,
        updatedAt: Date.now(),
      };
    }
  } catch {
    // fallback to default
  }

  return emptyState();
}

export function writePomodoroState(next: PomodoroState, source: string) {
  if (typeof window === "undefined") return;
  const normalized = normalizeState(next);
  normalized.updatedAt = Date.now();
  localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent(POMODORO_SYNC_EVENT, {
      detail: {
        source,
        state: normalized,
      },
    })
  );
}

export function incrementPomodoroForToday(state: PomodoroState, at = new Date()): PomodoroState {
  const key = getPomodoroDayKey(at);
  return {
    ...state,
    completionsByDay: {
      ...state.completionsByDay,
      [key]: (state.completionsByDay[key] ?? 0) + 1,
    },
  };
}

function ensureActiveSession(state: PomodoroState): PomodoroState {
  if (state.activeSessionId && state.sessions.some((session) => session.id === state.activeSessionId)) return state;
  const now = new Date();
  const nextSession: PomodoroSession = {
    id: `pomodoro-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    dayKey: getPomodoroDayKey(now),
    startedAt: now.toISOString(),
    endedAt: now.toISOString(),
    durationSeconds: DEFAULT_POMODORO_SECONDS,
    interruptions: 0,
    focus: "",
    done: "",
  };
  return {
    ...state,
    sessions: [nextSession, ...state.sessions].slice(0, 500),
    activeSessionId: nextSession.id,
  };
}

export function startPomodoro(state: PomodoroState): PomodoroState {
  const base = ensureActiveSession(state);
  return {
    ...base,
    secondsLeft: base.secondsLeft <= 0 ? DEFAULT_POMODORO_SECONDS : base.secondsLeft,
    running: true,
  };
}

export function pausePomodoro(state: PomodoroState): PomodoroState {
  if (!state.running) return state;
  let sessions = state.sessions;
  if (state.activeSessionId) {
    sessions = state.sessions.map((session) =>
      session.id === state.activeSessionId
        ? {
            ...session,
            interruptions: session.interruptions + 1,
          }
        : session
    );
  }
  return {
    ...state,
    running: false,
    sessions,
  };
}

export function resetPomodoro(state: PomodoroState): PomodoroState {
  return {
    ...state,
    running: false,
    secondsLeft: DEFAULT_POMODORO_SECONDS,
    activeSessionId: null,
  };
}

export function completePomodoro(state: PomodoroState, at = new Date()): PomodoroState {
  const base = ensureActiveSession(state);
  const dayKey = getPomodoroDayKey(at);
  const endedAt = at.toISOString();
  const sessions = base.sessions.map((session) =>
    session.id === base.activeSessionId
      ? {
          ...session,
          dayKey,
          endedAt,
          durationSeconds: DEFAULT_POMODORO_SECONDS,
        }
      : session
  );

  return {
    ...base,
    running: false,
    secondsLeft: 0,
    sessions,
    activeSessionId: null,
    completionsByDay: {
      ...base.completionsByDay,
      [dayKey]: (base.completionsByDay[dayKey] ?? 0) + 1,
    },
  };
}

export function updatePomodoroSession(
  state: PomodoroState,
  sessionId: string,
  patch: { focus?: string; done?: string; interruptions?: number }
): PomodoroState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId
        ? {
            ...session,
            focus: patch.focus ?? session.focus,
            done: patch.done ?? session.done,
            interruptions:
              typeof patch.interruptions === "number"
                ? Math.max(0, Math.floor(patch.interruptions))
                : session.interruptions,
          }
        : session
    ),
  };
}

export function addManualPomodoroSession(
  state: PomodoroState,
  input: {
    endedAtIso: string;
    focus?: string;
    done?: string;
    interruptions?: number;
    durationSeconds?: number;
  }
): PomodoroState {
  const endedAtDate = new Date(input.endedAtIso);
  const safeEndedAt = Number.isNaN(endedAtDate.getTime()) ? new Date() : endedAtDate;
  const durationSeconds = Math.max(60, Math.floor(Number(input.durationSeconds ?? DEFAULT_POMODORO_SECONDS)));
  const startedAt = new Date(safeEndedAt.getTime() - durationSeconds * 1000);
  const dayKey = getPomodoroDayKey(safeEndedAt);
  const nextSession: PomodoroSession = {
    id: `pomodoro-${safeEndedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    dayKey,
    startedAt: startedAt.toISOString(),
    endedAt: safeEndedAt.toISOString(),
    durationSeconds,
    interruptions: Math.max(0, Math.floor(Number(input.interruptions ?? 0))),
    focus: (input.focus ?? "").trim(),
    done: (input.done ?? "").trim(),
  };
  return {
    ...state,
    sessions: [nextSession, ...state.sessions].slice(0, 500),
    completionsByDay: {
      ...state.completionsByDay,
      [dayKey]: (state.completionsByDay[dayKey] ?? 0) + 1,
    },
  };
}
