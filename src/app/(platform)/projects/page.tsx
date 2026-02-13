import ProjectsPageClient from "@/app/components/ProjectsPageClient";
import { listProjects } from "@/lib/manualTimeEntriesStore";

export default async function ProjectsPage() {
  const projects = await listProjects();
  return (
    <ProjectsPageClient
      initialProjects={projects.map((p) => ({
        key: p.project_key,
        name: p.project_name,
        source: p.project_key.startsWith("manual:") ? "manual" : "external",
      }))}
    />
  );
}

