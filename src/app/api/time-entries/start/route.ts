import { NextRequest, NextResponse } from "next/server";
import { resolveCanonicalMemberName, startManualTimer } from "@/lib/manualTimeEntriesStore";
import { readIdempotentResponse, writeIdempotentResponse } from "@/lib/idempotency";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StartRequest = {
  member?: string;
  description?: string | null;
  project?: string | null;
  tzOffset?: number;
  elapsedSeconds?: number;
};

export async function POST(request: NextRequest) {
  const idempotencyKey = request.headers.get("x-idempotency-key");
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

  const cached = await readIdempotentResponse({
    scope: "time-entries-start",
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

  try {
    const result = await startManualTimer({
      memberName: canonicalMember,
      description: body.description ?? null,
      projectName: body.project ?? null,
      tzOffsetMinutes: body.tzOffset,
      elapsedSeconds: body.elapsedSeconds,
    });
    if (!result.started) {
      const responseBody = {
        error: "Member already has a running timer",
        current: result.runningEntry,
      };
      await writeIdempotentResponse({
        scope: "time-entries-start",
        member: canonicalMember,
        idempotencyKey,
        status: 409,
        body: responseBody,
      });
      return NextResponse.json(responseBody, { status: 409 });
    }

    const responseBody = {
      ok: true,
      current: result.runningEntry,
      source: "db",
    };
    await writeIdempotentResponse({
      scope: "time-entries-start",
      member: canonicalMember,
      idempotencyKey,
      status: 200,
      body: responseBody,
    });
    return NextResponse.json(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start timer";
    const responseBody = { error: message };
    await writeIdempotentResponse({
      scope: "time-entries-start",
      member: canonicalMember,
      idempotencyKey,
      status: 500,
      body: responseBody,
      ttlSeconds: 120,
    });
    return NextResponse.json(responseBody, { status: 500 });
  }
}
