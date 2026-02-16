import "server-only";

type CachedIdempotent = {
  status: number;
  body: unknown;
};

function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders() {
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: token,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getBaseUrl() {
  return process.env.SUPABASE_URL!;
}

function normalizeKey(scope: string, member: string | null | undefined, idempotencyKey: string) {
  const safeMember = (member ?? "").trim().toLowerCase() || "unknown";
  return `idem:${scope}:${safeMember}:${idempotencyKey.trim()}`;
}

export async function readIdempotentResponse(input: {
  scope: string;
  member?: string | null;
  idempotencyKey?: string | null;
}): Promise<CachedIdempotent | null> {
  if (!isSupabaseConfigured()) return null;
  const rawKey = input.idempotencyKey?.trim();
  if (!rawKey) return null;
  const cacheKey = normalizeKey(input.scope, input.member, rawKey);

  const response = await fetch(
    `${getBaseUrl()}/rest/v1/cache_snapshots?select=payload,expires_at&cache_key=eq.${encodeURIComponent(cacheKey)}&limit=1`,
    {
      method: "GET",
      headers: supabaseHeaders(),
      cache: "no-store",
    }
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ payload?: unknown; expires_at?: string }>;
  const row = rows[0];
  if (!row?.payload || !row.expires_at) return null;
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs < Date.now()) return null;

  const payload = row.payload as { status?: unknown; body?: unknown };
  const status = Number(payload.status);
  if (!Number.isFinite(status) || status < 100 || status > 599) return null;
  return {
    status,
    body: payload.body,
  };
}

export async function writeIdempotentResponse(input: {
  scope: string;
  member?: string | null;
  idempotencyKey?: string | null;
  status: number;
  body: unknown;
  ttlSeconds?: number;
}) {
  if (!isSupabaseConfigured()) return;
  const rawKey = input.idempotencyKey?.trim();
  if (!rawKey) return;
  const cacheKey = normalizeKey(input.scope, input.member, rawKey);
  const ttlSeconds = Math.max(30, Math.min(3600, Math.floor(input.ttlSeconds ?? 600)));
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const payload = [
    {
      cache_key: cacheKey,
      payload: {
        status: input.status,
        body: input.body,
      },
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
  ];

  await fetch(`${getBaseUrl()}/rest/v1/cache_snapshots?on_conflict=cache_key`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  }).catch(() => {
    // Best-effort idempotency cache.
  });
}

