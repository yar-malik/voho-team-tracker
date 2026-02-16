import { NextRequest, NextResponse } from "next/server";
import { resolveCanonicalMemberName, updateStoredTimeEntry } from "@/lib/manualTimeEntriesStore";
import { readIdempotentResponse, writeIdempotentResponse } from "@/lib/idempotency";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type UpdateRequest = {
  member?: string;
  entryId?: number;
  description?: string | null;
  project?: string | null;
  startAt?: string;
  stopAt?: string;
  tzOffset?: number;
};

export async function POST(request: NextRequest) {
  const idempotencyKey = request.headers.get("x-idempotency-key");
  let body: UpdateRequest;
  try {
    body = (await request.json()) as UpdateRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const member = body.member?.trim() ?? "";
  if (!member) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }

  const cached = await readIdempotentResponse({
    scope: "time-entries-update",
    member,
    idempotencyKey,
  });
  if (cached) {
    return NextResponse.json(cached.body, { status: cached.status });
  }

  const canonicalMember = await resolveCanonicalMemberName(member);
  if (!canonicalMember) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  const entryId = Number(body.entryId ?? 0);
  if (!Number.isFinite(entryId) || entryId <= 0) {
    return NextResponse.json({ error: "Invalid entryId" }, { status: 400 });
  }
  const startAt = body.startAt?.trim() ?? "";
  const stopAt = body.stopAt?.trim() ?? "";
  if (!startAt || !stopAt) {
    return NextResponse.json({ error: "Missing startAt/stopAt" }, { status: 400 });
  }

  try {
    const entry = await updateStoredTimeEntry({
      memberName: canonicalMember,
      entryId,
      description: body.description ?? null,
      projectName: body.project ?? null,
      startAtIso: startAt,
      stopAtIso: stopAt,
      tzOffsetMinutes: body.tzOffset,
    });
    const responseBody = {
      ok: true,
      entry,
      source: "db",
    };
    await writeIdempotentResponse({
      scope: "time-entries-update",
      member: canonicalMember,
      idempotencyKey,
      status: 200,
      body: responseBody,
    });
    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update entry";
    const responseBody = { error: message };
    await writeIdempotentResponse({
      scope: "time-entries-update",
      member: canonicalMember,
      idempotencyKey,
      status: 500,
      body: responseBody,
      ttlSeconds: 120,
    });
    return NextResponse.json(responseBody, { status: 500 });
  }
}
