import { NextRequest, NextResponse } from "next/server";
import { createManualTimeEntry, resolveCanonicalMemberName } from "@/lib/manualTimeEntriesStore";
import { readIdempotentResponse, writeIdempotentResponse } from "@/lib/idempotency";

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
  const idempotencyKey = request.headers.get("x-idempotency-key");
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

  const cached = await readIdempotentResponse({
    scope: "time-entries-manual",
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
      memberName: canonicalMember,
      description: body.description ?? null,
      projectName: body.project ?? null,
      startAtIso: startAt,
      durationSeconds: Math.round(durationMinutes * 60),
      tzOffsetMinutes: body.tzOffset,
    });

    const responseBody = {
      ok: true,
      entry,
      source: "db",
    };
    await writeIdempotentResponse({
      scope: "time-entries-manual",
      member: canonicalMember,
      idempotencyKey,
      status: 200,
      body: responseBody,
    });
    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create manual entry";
    const responseBody = { error: message };
    await writeIdempotentResponse({
      scope: "time-entries-manual",
      member: canonicalMember,
      idempotencyKey,
      status: 500,
      body: responseBody,
      ttlSeconds: 120,
    });
    return NextResponse.json(responseBody, { status: 500 });
  }
}
