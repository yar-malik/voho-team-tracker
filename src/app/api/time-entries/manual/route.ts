import { NextRequest, NextResponse } from "next/server";
import { getTeamMembers } from "@/lib/toggl";
import { createManualTimeEntry } from "@/lib/manualTimeEntriesStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ManualRequest = {
  member?: string;
  description?: string | null;
  project?: string | null;
  startAt?: string;
  durationMinutes?: number;
  tzOffset?: number;
};

export async function POST(request: NextRequest) {
  let body: ManualRequest;
  try {
    body = (await request.json()) as ManualRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const member = body.member?.trim() ?? "";
  if (!member) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }
  const matchedMember = getTeamMembers().find((item) => item.name.toLowerCase() === member.toLowerCase());
  if (!matchedMember) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  const startAt = body.startAt?.trim() ?? "";
  if (!startAt) {
    return NextResponse.json({ error: "Missing startAt" }, { status: 400 });
  }
  const durationMinutes = Number(body.durationMinutes ?? 0);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return NextResponse.json({ error: "durationMinutes must be > 0" }, { status: 400 });
  }

  try {
    const entry = await createManualTimeEntry({
      memberName: matchedMember.name,
      description: body.description ?? null,
      projectName: body.project ?? null,
      startAtIso: startAt,
      durationSeconds: Math.round(durationMinutes * 60),
      tzOffsetMinutes: body.tzOffset,
    });

    return NextResponse.json({
      ok: true,
      entry,
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create manual entry";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
