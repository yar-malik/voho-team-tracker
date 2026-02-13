import { NextRequest, NextResponse } from "next/server";
import { getTeamMembers } from "@/lib/toggl";
import { stopManualTimer } from "@/lib/manualTimeEntriesStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StopRequest = {
  member?: string;
  tzOffset?: number;
};

export async function POST(request: NextRequest) {
  let body: StopRequest;
  try {
    body = (await request.json()) as StopRequest;
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
    const result = await stopManualTimer({
      memberName: matchedMember.name,
      tzOffsetMinutes: body.tzOffset,
    });
    if (!result.stopped) {
      return NextResponse.json({ error: "No running timer for member" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      stopped: result.stoppedEntry,
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stop timer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
