"use client";

import { useEffect, useMemo, useState } from "react";

type Member = { name: string };
type Kpi = { id: number; member: string; label: string; value: string; notes: string | null };

const POMODORO_SECONDS = 25 * 60;
const POMODORO_STORAGE_KEY = "voho_pomodoro_state_v1";

function formatPomodoro(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function KpisPageClient({
  members,
  initialKpis,
}: {
  members: Member[];
  initialKpis: Kpi[];
}) {
  const [kpis, setKpis] = useState(initialKpis);
  const [member, setMember] = useState(members[0]?.name ?? "");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pomodoroName, setPomodoroName] = useState("Focus Session");
  const [pomodoroSecondsLeft, setPomodoroSecondsLeft] = useState(POMODORO_SECONDS);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [completedPomodoros, setCompletedPomodoros] = useState(0);

  const sortedKpis = useMemo(
    () => [...kpis].sort((a, b) => a.member.localeCompare(b.member) || a.label.localeCompare(b.label)),
    [kpis]
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(POMODORO_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        name?: string;
        secondsLeft?: number;
        running?: boolean;
        completed?: number;
        updatedAt?: number;
      };
      const restoredName = parsed.name?.trim() || "Focus Session";
      let restoredSeconds = Math.max(0, Math.min(POMODORO_SECONDS, Number(parsed.secondsLeft ?? POMODORO_SECONDS)));
      const restoredRunning = Boolean(parsed.running);
      const updatedAt = Number(parsed.updatedAt ?? Date.now());
      if (restoredRunning) {
        const elapsed = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
        restoredSeconds = Math.max(0, restoredSeconds - elapsed);
      }
      setPomodoroName(restoredName);
      setPomodoroSecondsLeft(restoredSeconds);
      setPomodoroRunning(restoredRunning && restoredSeconds > 0);
      setCompletedPomodoros(Math.max(0, Number(parsed.completed ?? 0)));
    } catch {
      // Ignore invalid local state.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        POMODORO_STORAGE_KEY,
        JSON.stringify({
          name: pomodoroName,
          secondsLeft: pomodoroSecondsLeft,
          running: pomodoroRunning,
          completed: completedPomodoros,
          updatedAt: Date.now(),
        })
      );
    } catch {
      // Ignore storage failures.
    }
  }, [pomodoroName, pomodoroSecondsLeft, pomodoroRunning, completedPomodoros]);

  useEffect(() => {
    if (!pomodoroRunning) return;
    const timer = window.setInterval(() => {
      setPomodoroSecondsLeft((prev) => {
        if (prev <= 1) {
          setPomodoroRunning(false);
          setCompletedPomodoros((count) => count + 1);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pomodoroRunning]);

  const pomodoroProgress = useMemo(() => {
    const consumed = POMODORO_SECONDS - pomodoroSecondsLeft;
    return Math.max(0, Math.min(100, Math.round((consumed / POMODORO_SECONDS) * 100)));
  }, [pomodoroSecondsLeft]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">KPIs</h1>
      <p className="mt-1 text-sm text-slate-600">Member KPI registry managed inside the platform.</p>

      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Pomodoro</p>
            <input
              type="text"
              value={pomodoroName}
              onChange={(event) => setPomodoroName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 md:w-[280px]"
            />
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums text-slate-900">{formatPomodoro(pomodoroSecondsLeft)}</p>
            <p className="text-xs text-slate-600">Completed today: {completedPomodoros}</p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-sky-100">
          <div className="h-full rounded-full bg-[#0BA5E9]" style={{ width: `${pomodoroProgress}%` }} />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPomodoroRunning((running) => !running)}
            className="rounded-lg bg-[#0BA5E9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0994cf]"
          >
            {pomodoroRunning ? "Pause" : pomodoroSecondsLeft === 0 ? "Start next 25m" : "Start 25m"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPomodoroRunning(false);
              setPomodoroSecondsLeft(POMODORO_SECONDS);
            }}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <select
          value={member}
          onChange={(event) => setMember(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {members.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="KPI label"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="KPI value"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!member || !label.trim() || !value.trim()) {
              setError("Member, KPI label and value are required");
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const res = await fetch("/api/kpis", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ member, label, value, notes }),
              });
              const data = (await res.json()) as { error?: string; kpi?: Kpi };
              if (!res.ok || data.error) throw new Error(data.error || "Failed to save KPI");
              if (data.kpi) {
                setKpis((prev) => [...prev.filter((k) => k.id !== data.kpi!.id), data.kpi!]);
              }
              setLabel("");
              setValue("");
              setNotes("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to save KPI");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Save KPI
        </button>
      </div>

      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">KPI</th>
              <th className="px-4 py-2">Value</th>
              <th className="px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {sortedKpis.map((kpi) => (
              <tr key={kpi.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-900">{kpi.member}</td>
                <td className="px-4 py-2 text-slate-700">{kpi.label}</td>
                <td className="px-4 py-2 text-slate-700">{kpi.value}</td>
                <td className="px-4 py-2 text-slate-600">{kpi.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
