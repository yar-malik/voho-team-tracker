"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROJECT_COLOR, PROJECT_PASTEL_HEX, getProjectBaseColor } from "@/lib/projectColors";

type Project = {
  key: string;
  name: string;
  color: string;
  projectType: "work" | "non_work";
  totalSeconds: number;
  entryCount: number;
};

type EditModalState = {
  key: string;
  name: string;
  color: string;
  projectType: "work" | "non_work";
};

function formatHours(totalSeconds: number) {
  const hours = totalSeconds / 3600;
  return `${hours.toFixed(1)} h`;
}

function normalizeColor(color: string | null | undefined) {
  return getProjectBaseColor("", color).toUpperCase();
}

function ProjectModal({
  title,
  state,
  busy,
  onClose,
  onChange,
  onSave,
}: {
  title: string;
  state: EditModalState;
  busy: boolean;
  onClose: () => void;
  onChange: (next: EditModalState) => void;
  onSave: () => Promise<void>;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selectedColor = normalizeColor(state.color);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-2xl leading-none text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Project name</span>
            <div className="flex items-center gap-3">
              <span className="inline-block h-7 w-7 rounded-full" style={{ backgroundColor: selectedColor }} />
              <input
                type="text"
                value={state.name}
                onChange={(event) => onChange({ ...state, name: event.target.value })}
                placeholder="Project name"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-lg font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </div>
          </label>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Project type</p>
            <select
              value={state.projectType}
              onChange={(event) =>
                onChange({
                  ...state,
                  projectType: event.target.value === "non_work" ? "non_work" : "work",
                })
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            >
              <option value="work">Work</option>
              <option value="non_work">Non-Work</option>
            </select>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Project color</p>
            <div className="inline-grid grid-cols-5 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-8">
              {PROJECT_PASTEL_HEX.map((color) => {
                const active = selectedColor === color.toUpperCase();
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onChange({ ...state, color })}
                    className={`relative h-8 w-8 rounded-full border-2 ${active ? "border-slate-900" : "border-transparent"}`}
                    style={{ backgroundColor: color }}
                    aria-label={`Select color ${color}`}
                    title={color}
                  >
                    {active && <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">✓</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave()}
            className="rounded-xl bg-[#0BA5E9] px-8 py-3 text-base font-semibold text-white hover:bg-[#0994cf] disabled:bg-slate-300"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectsPageClient({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState(
    initialProjects.map((project) => ({
      ...project,
      color: normalizeColor(project.color),
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditModalState | null>(null);
  const [creating, setCreating] = useState<EditModalState | null>(null);

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    [projects]
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">Projects</h1>
          <button
            type="button"
            onClick={() => setCreating({ key: "", name: "", color: DEFAULT_PROJECT_COLOR, projectType: "work" })}
            className="rounded-xl bg-[#0BA5E9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0994cf]"
          >
            + New project
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-800">
            Show all, except archived
          </button>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Filters:</span>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-700">Member</span>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-700">Project name</span>
        </div>

        <div className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-700">
          Use colors to scan projects faster and keep the tracker visually consistent.
        </div>
      </div>

      {error && <p className="mx-6 mt-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-6 py-3">Project</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Time status</th>
              <th className="px-6 py-3">Entries</th>
              <th className="px-6 py-3 text-right">Edit</th>
            </tr>
          </thead>
          <tbody>
            {sortedProjects.map((project) => (
              <tr
                key={project.key}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                onClick={() =>
                  setEditing({
                    key: project.key,
                    name: project.name,
                    color: normalizeColor(project.color || DEFAULT_PROJECT_COLOR),
                    projectType: project.projectType ?? "work",
                  })
                }
              >
                <td className="px-6 py-3">
                  <div className="inline-flex items-center gap-2 text-base font-medium text-slate-900">
                    <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ backgroundColor: normalizeColor(project.color) }} />

                    {project.name}
                  </div>
                </td>
                <td className="px-6 py-3 text-slate-600">{project.projectType === "non_work" ? "Non-Work" : "Work"}</td>
                <td className="px-6 py-3 text-slate-600">{formatHours(project.totalSeconds || 0)}</td>
                <td className="px-6 py-3 text-slate-600">{project.entryCount || 0}</td>
                <td className="px-6 py-3 text-right">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing({
                        key: project.key,
                        name: project.name,
                        color: normalizeColor(project.color || DEFAULT_PROJECT_COLOR),
                        projectType: project.projectType ?? "work",
                      });
                    }}
                    aria-label={`Edit ${project.name}`}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {sortedProjects.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  No projects yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ProjectModal
          title="Edit project"
          state={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onChange={setEditing}
          onSave={async () => {
            if (!editing.name.trim()) {
              setError("Project name is required");
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const res = await fetch("/api/projects", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  key: editing.key,
                  name: editing.name,
                  color: normalizeColor(editing.color),
                  projectType: editing.projectType,
                }),
              });
              const data = (await res.json()) as {
                error?: string;
                project?: { key: string; name: string; color: string; projectType: "work" | "non_work" };
              };
              if (!res.ok || data.error) throw new Error(data.error || "Failed to update project");
              if (data.project) {
                setProjects((prev) =>
                  prev.map((project) =>
                    project.key === data.project!.key
                      ? {
                          ...project,
                          name: data.project!.name,
                          color: normalizeColor(data.project!.color),
                          projectType: data.project!.projectType ?? "work",
                        }
                      : project
                  )
                );
              }
              setEditing(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to update project");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {creating && (
        <ProjectModal
          title="Create project"
          state={creating}
          busy={busy}
          onClose={() => setCreating(null)}
          onChange={setCreating}
          onSave={async () => {
            if (!creating.name.trim()) {
              setError("Project name is required");
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const res = await fetch("/api/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: creating.name,
                  color: normalizeColor(creating.color),
                  projectType: creating.projectType,
                }),
              });
              const data = (await res.json()) as { error?: string; project?: Project };
              if (!res.ok || data.error) throw new Error(data.error || "Failed to create project");
              if (data.project) {
                setProjects((prev) => [
                  ...prev.filter((p) => p.key !== data.project!.key),
                  {
                    ...data.project!,
                    color: normalizeColor(data.project!.color),
                    projectType: data.project!.projectType ?? "work",
                  },
                ]);
              }
              setCreating(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to create project");
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}
