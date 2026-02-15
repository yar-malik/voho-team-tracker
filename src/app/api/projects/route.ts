import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects, updateProject } from "@/lib/manualTimeEntriesStore";
import { requireSignedInOrThrow } from "@/lib/authorization";
import { assignUniquePastelColors, DEFAULT_PROJECT_COLOR } from "@/lib/projectColors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CreateProjectBody = {
  name?: string;
  color?: string;
};

type UpdateProjectBody = {
  key?: string;
  name?: string;
  color?: string;
};

export async function GET() {
  try {
    const projects = await listProjects();
    const colorByKey = assignUniquePastelColors(
      projects.map((project) => ({
        key: project.project_key,
        name: project.project_name,
        color: project.project_color ?? null,
      }))
    );
    return NextResponse.json({
      projects: projects.map((project) => ({
        key: project.project_key,
        name: project.project_name,
        color: colorByKey.get(project.project_key) || project.project_color || DEFAULT_PROJECT_COLOR,
        totalSeconds: project.total_seconds ?? 0,
        entryCount: project.entry_count ?? 0,
      })),
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list projects";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: CreateProjectBody;
  try {
    body = (await request.json()) as CreateProjectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ error: "Project name is required" }, { status: 400 });
  }

  try {
    await requireSignedInOrThrow();
    const project = await createProject(name, body.color ?? null);
    return NextResponse.json({
      ok: true,
      project: {
        key: project.projectKey,
        name: project.projectName,
        color: project.projectColor,
      },
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create project";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  let body: UpdateProjectBody;
  try {
    body = (await request.json()) as UpdateProjectBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const key = body.key?.trim() ?? "";
  if (!key) {
    return NextResponse.json({ error: "Project key is required" }, { status: 400 });
  }

  try {
    await requireSignedInOrThrow();
    const updated = await updateProject({
      key,
      name: body.name ?? null,
      color: body.color ?? null,
    });
    return NextResponse.json({
      ok: true,
      project: {
        key: updated.projectKey,
        name: updated.projectName,
        color: updated.projectColor,
      },
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update project";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
