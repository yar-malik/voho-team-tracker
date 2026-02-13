import { NextRequest, NextResponse } from "next/server";
import { getTeamMembers } from "@/lib/toggl";
import { startManualTimer } from "@/lib/manualTimeEntriesStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StartRequest = {
  member?: string;
  description?: string | null;
  project?: string | null;
  tzOffset?: number;
};

export async function POST(request: NextRequest) {
  let body: StartRequest;
  try {
    body = (await request.json()) as StartRequest;
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

  try {
    const result = await startManualTimer({
      memberName: matchedMember.name,
      description: body.description ?? null,
      projectName: body.project ?? null,
      tzOffsetMinutes: body.tzOffset,
    });
    if (!result.started) {
      return NextResponse.json(
        {
          error: "Member already has a running timer",
          current: result.runningEntry,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      current: result.runningEntry,
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start timer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
