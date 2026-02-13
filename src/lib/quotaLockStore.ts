import "server-only";

type QuotaLockRow = {
  key: string;
  locked_until: string;
  last_status: number;
  reason: string | null;
  retry_hint_seconds: number | null;
  updated_at: string;
};

export type QuotaLockState = {
  active: boolean;
  retryAfterSeconds: number;
  lockedUntil: string | null;
  lastStatus: number | null;
  reason: string | null;
};

const DEFAULT_LOCK_KEY = "toggl-global";

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

export async function getQuotaLockState(key = DEFAULT_LOCK_KEY): Promise<QuotaLockState> {
  if (!isSupabaseConfigured()) {
    return {
      active: false,
      retryAfterSeconds: 0,
      lockedUntil: null,
      lastStatus: null,
      reason: null,
    };
  }

  const base = process.env.SUPABASE_URL!;
  const url =
    `${base}/rest/v1/api_quota_locks` +
    `?select=key,locked_until,last_status,reason,retry_hint_seconds,updated_at&key=eq.${encodeURIComponent(key)}&limit=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    return {
      active: false,
      retryAfterSeconds: 0,
      lockedUntil: null,
      lastStatus: null,
      reason: null,
    };
  }
  const rows = (await response.json()) as QuotaLockRow[];
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) {
    return {
      active: false,
      retryAfterSeconds: 0,
      lockedUntil: null,
      lastStatus: null,
      reason: null,
    };
  }

  const lockedUntilMs = new Date(row.locked_until).getTime();
  if (Number.isNaN(lockedUntilMs)) {
    return {
      active: false,
      retryAfterSeconds: 0,
      lockedUntil: null,
      lastStatus: row.last_status ?? null,
      reason: row.reason ?? null,
    };
  }

  const nowMs = Date.now();
  const retryAfterSeconds = Math.max(0, Math.ceil((lockedUntilMs - nowMs) / 1000));
  return {
    active: retryAfterSeconds > 0,
    retryAfterSeconds,
    lockedUntil: row.locked_until,
    lastStatus: row.last_status ?? null,
    reason: row.reason ?? null,
  };
}

export async function setQuotaLock(params: {
  status: number;
  lockForSeconds: number;
  retryHintSeconds?: number | null;
  reason?: string | null;
  key?: string;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const key = params.key ?? DEFAULT_LOCK_KEY;
  const now = Date.now();
  const requestedLockMs = now + Math.max(1, params.lockForSeconds) * 1000;
  const current = await getQuotaLockState(key);
  const currentLockMs = current.lockedUntil ? new Date(current.lockedUntil).getTime() : Number.NEGATIVE_INFINITY;
  const targetLockMs = Math.max(currentLockMs, requestedLockMs);

  const base = process.env.SUPABASE_URL!;
  const url = `${base}/rest/v1/api_quota_locks`;
  const body = [
    {
      key,
      locked_until: new Date(targetLockMs).toISOString(),
      last_status: params.status,
      reason: params.reason ?? null,
      retry_hint_seconds: params.retryHintSeconds ?? null,
    },
  ];

  await fetch(url, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  }).catch(() => undefined);
}
