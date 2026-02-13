create table if not exists public.api_quota_locks (
  key text primary key,
  locked_until timestamptz not null,
  last_status integer not null,
  reason text null,
  retry_hint_seconds integer null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_api_quota_locks_updated_at on public.api_quota_locks;
create trigger trg_api_quota_locks_updated_at
before update on public.api_quota_locks
for each row
execute procedure public.set_updated_at();
