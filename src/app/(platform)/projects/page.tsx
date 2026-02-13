import ProjectsPageClient from "@/app/components/ProjectsPageClient";
import { listProjects } from "@/lib/manualTimeEntriesStore";
import { DEFAULT_PROJECT_COLOR } from "@/lib/projectColors";

export default async function ProjectsPage() {
  const projects = await listProjects();
  return (
    <ProjectsPageClient
      initialProjects={projects.map((p) => ({
        key: p.project_key,
        name: p.project_name,
        color: p.project_color || DEFAULT_PROJECT_COLOR,
        totalSeconds: p.total_seconds ?? 0,
        entryCount: p.entry_count ?? 0,
      }))}
    />
  );
}
