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
  email text null unique,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  project_key text primary key,
  workspace_id bigint not null,
  project_id bigint not null,
  project_name text not null,
  project_color text not null default '#0EA5E9',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_projects_workspace_project
  on public.projects (workspace_id, project_id);

create table if not exists public.project_aliases (
  source_project_key text primary key references public.projects(project_key) on delete cascade,
  canonical_project_key text not null references public.projects(project_key) on update cascade on delete restrict,
  normalized_name text null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_aliases_canonical
  on public.project_aliases (canonical_project_key);

create or replace function public.normalize_project_name(input_name text)
returns text
language sql
stable
as $$
  with cleaned as (
    select
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(coalesce(input_name, '')), '\byt\b', 'youtube', 'g'),
              '\bmeetings\b', 'meeting', 'g'
            ),
            '\bmeeting[\s\-_]*old\b', 'meeting', 'g'
          ),
          '\bprep(ing|ping)?\b', 'prepping', 'g'
        ),
        '&', ' and ', 'g'
      ) as value
  ),
  tokenized as (
    select lower(trim(t.value)) as token, t.ord
    from cleaned c,
    regexp_split_to_table(regexp_replace(c.value, '[^a-zA-Z0-9]+', ' ', 'g'), '\s+') with ordinality as t(value, ord)
  ),
  member_tokens as (
    select distinct lower(trim(value)) as token
    from public.members m
    cross join regexp_split_to_table(regexp_replace(coalesce(m.member_name, ''), '[^a-zA-Z0-9]+', ' ', 'g'), '\s+') as value
    where trim(value) <> ''
  )
  select coalesce(string_agg(t.token, ' ' order by t.ord), '')
  from tokenized t
  where t.token <> ''
    and t.token not in ('task', 'tasks', 'project', 'projects')
    and not exists (
      select 1 from member_tokens mt where mt.token = t.token
    );
$$;

create or replace function public.format_project_name(normalized_name text)
returns text
language sql
immutable
as $$
  select coalesce(
    string_agg(upper(left(token, 1)) || substr(token, 2), '-' order by ord),
    ''
  )
  from regexp_split_to_table(coalesce(normalized_name, ''), '\s+') with ordinality as t(token, ord)
  where trim(token) <> '';
$$;

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

create table if not exists public.member_kpis (
  id bigint generated always as identity primary key,
  member_name text not null references public.members(member_name) on update cascade,
  kpi_label text not null,
  kpi_value text not null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_name, kpi_label)
);

create or replace view public.project_rollups as
select
  coalesce(a.canonical_project_key, t.project_key) as project_key,
  sum(t.duration_seconds)::bigint as total_seconds,
  count(*)::bigint as entry_count
from public.time_entries t
left join public.project_aliases a
  on a.source_project_key = t.project_key
where t.project_key is not null
group by coalesce(a.canonical_project_key, t.project_key);

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

drop trigger if exists trg_project_aliases_updated_at on public.project_aliases;
create trigger trg_project_aliases_updated_at
before update on public.project_aliases
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

drop trigger if exists trg_member_kpis_updated_at on public.member_kpis;
create trigger trg_member_kpis_updated_at
before update on public.member_kpis
for each row
execute procedure public.set_updated_at();
