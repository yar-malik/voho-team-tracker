import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects, updateProject } from "@/lib/manualTimeEntriesStore";
import { requireAdminOrThrow } from "@/lib/authorization";

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
    return NextResponse.json({
      projects: projects.map((project) => ({
        key: project.project_key,
        name: project.project_name,
        color: project.project_color || "#0EA5E9",
        totalSeconds: project.total_seconds ?? 0,
        entryCount: project.entry_count ?? 0,
        source: project.project_key.startsWith("manual:") ? "manual" : "external",
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
    await requireAdminOrThrow();
    const project = await createProject(name);
    return NextResponse.json({
      ok: true,
      project: {
        key: project.projectKey,
        name: project.projectName,
        color: project.projectColor,
        source: "manual",
      },
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create project";
    return NextResponse.json({ error: message }, { status: 500 });
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
    await requireAdminOrThrow();
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
