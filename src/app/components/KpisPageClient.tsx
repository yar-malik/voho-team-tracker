"use client";

import { useMemo, useState } from "react";

type Member = { name: string };
type Kpi = { id: number; member: string; label: string; value: string; notes: string | null };

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

  const sortedKpis = useMemo(
    () => [...kpis].sort((a, b) => a.member.localeCompare(b.member) || a.label.localeCompare(b.label)),
    [kpis]
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">KPIs</h1>
      <p className="mt-1 text-sm text-slate-600">Member KPI registry managed inside the platform.</p>

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

