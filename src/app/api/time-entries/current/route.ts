import { NextRequest, NextResponse } from "next/server";
import { getRunningEntry, resolveCanonicalMemberName, updateRunningEntryMetadata } from "@/lib/manualTimeEntriesStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const member = searchParams.get("member")?.trim();
  if (!member) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }

  const canonicalMember = await resolveCanonicalMemberName(member);
  if (!canonicalMember) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  try {
    const entry = await getRunningEntry(canonicalMember);
    return NextResponse.json({
      member: canonicalMember,
      current: entry,
      cachedAt: new Date().toISOString(),
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read running timer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type UpdateCurrentBody = {
  member?: string;
  description?: string | null;
  project?: string | null;
};

export async function PATCH(request: NextRequest) {
  let body: UpdateCurrentBody;
  try {
    body = (await request.json()) as UpdateCurrentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const member = body.member?.trim();
  if (!member) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }

  const canonicalMember = await resolveCanonicalMemberName(member);
  if (!canonicalMember) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  try {
    const updated = await updateRunningEntryMetadata({
      memberName: canonicalMember,
      description: body.description ?? null,
      projectName: body.project ?? null,
    });
    return NextResponse.json({
      ok: true,
      member: canonicalMember,
      current: updated,
      cachedAt: new Date().toISOString(),
      source: "db",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update running timer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
