"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addManualPomodoroSession,
  completePomodoro,
  formatPomodoroTimer,
  getPomodoroDayKey,
  pausePomodoro,
  POMODORO_SYNC_EVENT,
  PomodoroState,
  readPomodoroState,
  resetPomodoro,
  startPomodoro,
  updatePomodoroSession,
  writePomodoroState,
} from "@/lib/pomodoroClient";

function formatDay(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map((value) => Number(value));
  const date = new Date(year, (month || 1) - 1, day || 1);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

type ManualPomodoroDraft = {
  id: string;
  startTime: string;
  endTime: string;
  focus: string;
  done: string;
  interruptions: string;
  error: string | null;
};

function toLocalTimeValue(date: Date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function buildTodayIso(timeValue: string) {
  const now = new Date();
  const [hRaw, mRaw] = timeValue.split(":");
  const hours = Number(hRaw);
  const minutes = Number(mRaw);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  return date.toISOString();
}

function createDraft(): ManualPomodoroDraft {
  const now = new Date();
  const start = new Date(now.getTime() - 25 * 60 * 1000);
  return {
    id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startTime: toLocalTimeValue(start),
    endTime: toLocalTimeValue(now),
    focus: "",
    done: "",
    interruptions: "0",
    error: null,
  };
}

export default function PomodoroPageClient() {
  const [pomodoroState, setPomodoroState] = useState<PomodoroState>({
    secondsLeft: 25 * 60,
    running: false,
    completionsByDay: {},
    sessions: [],
    activeSessionId: null,
    updatedAt: Date.now(),
  });
  const [manualDrafts, setManualDrafts] = useState<ManualPomodoroDraft[]>([]);

  useEffect(() => {
    const restored = readPomodoroState();
    setPomodoroState(restored);
    writePomodoroState(restored, "pomodoro-page");
  }, []);

  useEffect(() => {
    const syncListener = (event: Event) => {
      const custom = event as CustomEvent<{ source?: string; state?: PomodoroState }>;
      const incoming = custom.detail?.state;
      const source = custom.detail?.source ?? "";
      if (!incoming || source === "pomodoro-page") return;
      setPomodoroState(incoming);
    };
    window.addEventListener(POMODORO_SYNC_EVENT, syncListener as EventListener);
    return () => window.removeEventListener(POMODORO_SYNC_EVENT, syncListener as EventListener);
  }, []);

  const todayKey = getPomodoroDayKey();
  const completedToday = pomodoroState.completionsByDay[todayKey] ?? 0;

  const lastSevenDays = useMemo(() => {
    const rows: Array<{ key: string; count: number }> = [];
    const base = new Date();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(base);
      date.setDate(base.getDate() - offset);
      const key = getPomodoroDayKey(date);
      rows.push({ key, count: pomodoroState.completionsByDay[key] ?? 0 });
    }
    return rows;
  }, [pomodoroState.completionsByDay]);

  const weekTotal = useMemo(() => lastSevenDays.reduce((sum, item) => sum + item.count, 0), [lastSevenDays]);
  const completedSessions = useMemo(
    () => pomodoroState.sessions.filter((session) => session.durationSeconds > 0),
    [pomodoroState.sessions]
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Pomodoro</h1>
      <p className="mt-1 text-sm text-slate-600">Run 25-minute focus sessions and track your daily count.</p>

      <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Focus Timer</p>
        <p className="mt-2 text-5xl font-semibold tabular-nums text-slate-900">{formatPomodoroTimer(pomodoroState.secondsLeft)}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setPomodoroState((prev) => {
                const next = prev.running ? pausePomodoro(prev) : startPomodoro(prev);
                writePomodoroState(next, "pomodoro-page");
                return next;
              })
            }
            className="rounded-lg bg-[#0BA5E9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0994cf]"
          >
            {pomodoroState.running ? "Pause" : pomodoroState.secondsLeft === 0 ? "Start next Pomodoro" : "Start Pomodoro"}
          </button>
          <button
            type="button"
            onClick={() =>
              setPomodoroState((prev) => {
                const next = completePomodoro(prev);
                writePomodoroState(next, "pomodoro-page");
                return next;
              })
            }
            className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100"
          >
            Complete now
          </button>
          <button
            type="button"
            onClick={() =>
              setPomodoroState((prev) => {
                const next = resetPomodoro(prev);
                writePomodoroState(next, "pomodoro-page");
                return next;
              })
            }
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Completed Today</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{completedToday}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Last 7 Days</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{weekTotal}</p>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2">Day</th>
              <th className="px-4 py-2">Completed Pomodoros</th>
            </tr>
          </thead>
          <tbody>
            {lastSevenDays.map((item) => (
              <tr key={item.key} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-900">{formatDay(item.key)}</td>
                <td className="px-4 py-2 text-slate-700">{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Manual Pomodoros (today)</p>
          <button
            type="button"
            onClick={() => setManualDrafts((prev) => [createDraft(), ...prev])}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Add manual pomodoro
          </button>
        </div>

        {manualDrafts.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2">Start</th>
                  <th className="px-3 py-2">End</th>
                  <th className="px-3 py-2">Focus</th>
                  <th className="px-3 py-2">What was done</th>
                  <th className="px-3 py-2">Interruptions</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {manualDrafts.map((draft) => (
                  <tr key={draft.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={draft.startTime}
                        onChange={(event) =>
                          setManualDrafts((prev) =>
                            prev.map((row) =>
                              row.id === draft.id ? { ...row, startTime: event.target.value, error: null } : row
                            )
                          )
                        }
                        className="w-28 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={draft.endTime}
                        onChange={(event) =>
                          setManualDrafts((prev) =>
                            prev.map((row) => (row.id === draft.id ? { ...row, endTime: event.target.value, error: null } : row))
                          )
                        }
                        className="w-28 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={draft.focus}
                        placeholder="Focus"
                        onChange={(event) =>
                          setManualDrafts((prev) =>
                            prev.map((row) => (row.id === draft.id ? { ...row, focus: event.target.value } : row))
                          )
                        }
                        className="w-full min-w-32 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={draft.done}
                        placeholder="What was done"
                        onChange={(event) =>
                          setManualDrafts((prev) =>
                            prev.map((row) => (row.id === draft.id ? { ...row, done: event.target.value } : row))
                          )
                        }
                        className="w-full min-w-40 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        value={draft.interruptions}
                        onChange={(event) =>
                          setManualDrafts((prev) =>
                            prev.map((row) => (row.id === draft.id ? { ...row, interruptions: event.target.value } : row))
                          )
                        }
                        className="w-20 rounded-md border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const startIso = buildTodayIso(draft.startTime);
                            const endIso = buildTodayIso(draft.endTime);
                            const interruptions = Number(draft.interruptions || "0");
                            if (!startIso || !endIso) {
                              setManualDrafts((prev) =>
                                prev.map((row) => (row.id === draft.id ? { ...row, error: "Use valid start/end times." } : row))
                              );
                              return;
                            }
                            const startDate = new Date(startIso);
                            const endDate = new Date(endIso);
                            if (endDate.getTime() <= startDate.getTime()) {
                              setManualDrafts((prev) =>
                                prev.map((row) =>
                                  row.id === draft.id ? { ...row, error: "End time must be after start time." } : row
                                )
                              );
                              return;
                            }
                            if (!Number.isFinite(interruptions) || interruptions < 0) {
                              setManualDrafts((prev) =>
                                prev.map((row) =>
                                  row.id === draft.id ? { ...row, error: "Interruptions must be 0 or more." } : row
                                )
                              );
                              return;
                            }

                            setPomodoroState((prev) => {
                              const next = addManualPomodoroSession(prev, {
                                startedAtIso: startIso,
                                endedAtIso: endIso,
                                focus: draft.focus,
                                done: draft.done,
                                interruptions,
                              });
                              writePomodoroState(next, "pomodoro-page");
                              return next;
                            });
                            setManualDrafts((prev) => prev.filter((row) => row.id !== draft.id));
                          }}
                          className="rounded-md bg-[#0BA5E9] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0994cf]"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setManualDrafts((prev) => prev.filter((row) => row.id !== draft.id))}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                      {draft.error && <p className="mt-1 text-xs text-rose-600">{draft.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2">Start</th>
              <th className="px-4 py-2">End</th>
              <th className="px-4 py-2">Focus</th>
              <th className="px-4 py-2">What was done</th>
              <th className="px-4 py-2">Interruptions</th>
            </tr>
          </thead>
          <tbody>
            {completedSessions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-slate-500">
                  No completed pomodoros yet.
                </td>
              </tr>
            )}
            {completedSessions.map((session) => (
              <tr key={session.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-700">
                  {new Date(session.startedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {new Date(session.endedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={session.focus}
                    onChange={(event) =>
                      setPomodoroState((prev) => {
                        const next = updatePomodoroSession(prev, session.id, { focus: event.target.value });
                        writePomodoroState(next, "pomodoro-page");
                        return next;
                      })
                    }
                    placeholder="Focus area"
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-slate-800"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={session.done}
                    onChange={(event) =>
                      setPomodoroState((prev) => {
                        const next = updatePomodoroSession(prev, session.id, { done: event.target.value });
                        writePomodoroState(next, "pomodoro-page");
                        return next;
                      })
                    }
                    placeholder="What did you complete?"
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-slate-800"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    value={session.interruptions}
                    onChange={(event) =>
                      setPomodoroState((prev) => {
                        const next = updatePomodoroSession(prev, session.id, {
                          interruptions: Number(event.target.value || 0),
                        });
                        writePomodoroState(next, "pomodoro-page");
                        return next;
                      })
                    }
                    className="w-20 rounded-md border border-slate-300 px-2 py-1 text-slate-800"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
