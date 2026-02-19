"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROJECT_COLOR, PROJECT_PASTEL_HEX, getProjectBaseColor } from "@/lib/projectColors";

type Project = {
  key: string;
  name: string;
  color: string;
  projectType: "work" | "non_work";
  archived: boolean;
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

function IconButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 ${className ?? ""}`}
    >
      {children}
    </button>
  );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold text-slate-800">{title}</h2>
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
                className="input text-base font-medium"
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
            className="btn-primary"
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
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditModalState | null>(null);
  const [creating, setCreating] = useState<EditModalState | null>(null);

  const sortedProjects = useMemo(
    () =>
      [...projects]
        .filter((project) => (showArchived ? true : !project.archived))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [projects, showArchived]
  );

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="border-b border-slate-200 px-6 py-5 bg-slate-50/50">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-800">Projects</h1>
          <button
            type="button"
            onClick={() => setCreating({ key: "", name: "", color: DEFAULT_PROJECT_COLOR, projectType: "work" })}
            className="btn-primary"
          >
            + New project
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => setShowArchived((value) => !value)}
            className="rounded-lg border border-slate-300 px-3 py-2 font-medium text-slate-800"
          >
            {showArchived ? "Show active only" : "Show all, including archived"}
          </button>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Filters:</span>
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
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-6 py-3">Project</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Time status</th>
              <th className="px-6 py-3">Entries</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedProjects.map((project) => (
              <tr
                key={project.key}
                className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${project.archived ? "opacity-65" : ""}`}
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
                <td className="px-6 py-3 text-slate-500">{project.projectType === "non_work" ? "Non-Work" : "Work"}</td>
                <td className="px-6 py-3 text-slate-500">{project.archived ? "Archived" : "Active"}</td>
                <td className="px-6 py-3 text-slate-500">{formatHours(project.totalSeconds || 0)}</td>
                <td className="px-6 py-3 text-slate-500">{project.entryCount || 0}</td>
                <td className="px-6 py-3 text-right">
                  <div className="inline-flex items-center justify-end gap-2">
                    <IconButton
                      label={`Edit ${project.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditing({
                          key: project.key,
                          name: project.name,
                          color: normalizeColor(project.color || DEFAULT_PROJECT_COLOR),
                          projectType: project.projectType ?? "work",
                        });
                      }}
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                        <path d="M14.69 2.86a1.5 1.5 0 0 1 2.12 2.12l-8.6 8.6-3.3.6.6-3.3 8.6-8.6Z" />
                      </svg>
                    </IconButton>
                    <IconButton
                      label={project.archived ? `Unarchive ${project.name}` : `Archive ${project.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void (async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            const res = await fetch("/api/projects", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                key: project.key,
                                archived: !project.archived,
                              }),
                            });
                            const data = (await res.json()) as { error?: string; project?: { key: string; archived: boolean } };
                            if (!res.ok || data.error) throw new Error(data.error || "Failed to update project");
                            setProjects((prev) =>
                              prev.map((item) =>
                                item.key === project.key
                                  ? {
                                      ...item,
                                      archived: data.project?.archived ?? !project.archived,
                                    }
                                  : item
                              )
                            );
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Failed to archive project");
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M3 7h18" />
                        <path d="M5 7l1 13h12l1-13" />
                        <path d="M9 11v5M15 11v5" />
                        <path d="M9 4h6l1 3H8l1-3Z" />
                      </svg>
                    </IconButton>
                    <IconButton
                      label={`Delete ${project.name}`}
                      className="border-rose-300 text-rose-700 hover:bg-rose-50"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!window.confirm(`Delete project "${project.name}"? This works only if it has no time entries.`)) return;
                        void (async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            const res = await fetch("/api/projects", {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ key: project.key }),
                            });
                            const data = (await res.json()) as { error?: string };
                            if (!res.ok || data.error) throw new Error(data.error || "Failed to delete project");
                            setProjects((prev) => prev.filter((item) => item.key !== project.key));
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Failed to delete project");
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
            {sortedProjects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
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
                project?: { key: string; name: string; color: string; projectType: "work" | "non_work"; archived: boolean };
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
                          archived: data.project!.archived === true,
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
                    archived: data.project!.archived === true,
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
