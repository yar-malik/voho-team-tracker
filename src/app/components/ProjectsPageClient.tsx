"use client";

import { useState } from "react";

type Project = {
  key: string;
  name: string;
  source: "manual" | "external";
};

export default function ProjectsPageClient({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [newProjectName, setNewProjectName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
        <div className="flex gap-2">
          <input
            type="text"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New project"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!newProjectName.trim()) {
                setError("Project name is required");
                return;
              }
              setBusy(true);
              setError(null);
              try {
                const res = await fetch("/api/projects", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: newProjectName }),
                });
                const data = (await res.json()) as { error?: string; project?: Project };
                if (!res.ok || data.error) throw new Error(data.error || "Failed to create project");
                if (data.project) {
                  setProjects((prev) =>
                    [...prev.filter((p) => p.key !== data.project!.key), data.project!].sort((a, b) => a.name.localeCompare(b.name))
                  );
                }
                setNewProjectName("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to create project");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            New project
          </button>
        </div>
      </div>
      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-2">Project</th>
              <th className="px-4 py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.key} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-900">{project.name}</td>
                <td className="px-4 py-2 text-slate-600">{project.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

