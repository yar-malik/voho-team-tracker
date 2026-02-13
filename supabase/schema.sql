create table if not exists public.cache_snapshots (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_cache_snapshots_updated_at on public.cache_snapshots;
create trigger trg_cache_snapshots_updated_at
before update on public.cache_snapshots
for each row
execute procedure public.set_updated_at();

create index if not exists idx_cache_snapshots_expires_at
  on public.cache_snapshots (expires_at);

create table if not exists public.members (
  member_name text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  project_key text primary key,
  workspace_id bigint not null,
  project_id bigint not null,
  project_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_projects_workspace_project
  on public.projects (workspace_id, project_id);

create sequence if not exists public.time_entries_id_seq;

create table if not exists public.time_entries (
  toggl_entry_id bigint primary key default nextval('public.time_entries_id_seq'),
  entry_source text not null default 'toggl',
  source_entry_id text null,
  member_name text not null references public.members(member_name) on update cascade,
  project_key text null references public.projects(project_key) on update cascade,
  description text null,
  start_at timestamptz not null,
  stop_at timestamptz null,
  duration_seconds integer not null,
  is_running boolean not null default false,
  tags jsonb null,
  source_date date not null,
  synced_at timestamptz not null default now(),
  raw jsonb not null
);

create index if not exists idx_time_entries_member_start
  on public.time_entries (member_name, start_at);

create index if not exists idx_time_entries_source_date
  on public.time_entries (source_date);

create index if not exists idx_time_entries_project_key
  on public.time_entries (project_key);

create index if not exists idx_time_entries_entry_source
  on public.time_entries (entry_source);

create unique index if not exists idx_time_entries_source_unique
  on public.time_entries (entry_source, source_entry_id)
  where source_entry_id is not null;

create table if not exists public.daily_member_stats (
  stat_date date not null,
  member_name text not null references public.members(member_name) on update cascade,
  total_seconds integer not null default 0,
  entry_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (stat_date, member_name)
);

create table if not exists public.sync_events (
  id bigint generated always as identity primary key,
  scope text not null,
  member_name text null,
  requested_date date not null,
  fetched_entries integer not null default 0,
  status text not null,
  error text null,
  created_at timestamptz not null default now()
);

create table if not exists public.api_quota_locks (
  key text primary key,
  locked_until timestamptz not null,
  last_status integer not null,
  reason text null,
  retry_hint_seconds integer null,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_members_updated_at on public.members;
create trigger trg_members_updated_at
before update on public.members
for each row
execute procedure public.set_updated_at();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row
execute procedure public.set_updated_at();

drop trigger if exists trg_daily_member_stats_updated_at on public.daily_member_stats;
create trigger trg_daily_member_stats_updated_at
before update on public.daily_member_stats
for each row
execute procedure public.set_updated_at();

drop trigger if exists trg_api_quota_locks_updated_at on public.api_quota_locks;
create trigger trg_api_quota_locks_updated_at
before update on public.api_quota_locks
for each row
execute procedure public.set_updated_at();
