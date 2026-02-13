begin;

create table if not exists public.project_aliases (
  source_project_key text primary key references public.projects(project_key) on delete cascade,
  canonical_project_key text not null references public.projects(project_key) on update cascade on delete restrict,
  normalized_name text null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_aliases_canonical
  on public.project_aliases (canonical_project_key);

drop trigger if exists trg_project_aliases_updated_at on public.project_aliases;
create trigger trg_project_aliases_updated_at
before update on public.project_aliases
for each row
execute procedure public.set_updated_at();

create or replace function public.normalize_project_name(input_name text)
returns text
language sql
stable
as $$
  with tokenized as (
    select lower(trim(value)) as token
    from regexp_split_to_table(regexp_replace(coalesce(input_name, ''), '[^a-zA-Z0-9]+', ' ', 'g'), '\s+') as value
  ),
  member_tokens as (
    select distinct lower(trim(value)) as token
    from public.members m
    cross join regexp_split_to_table(regexp_replace(coalesce(m.member_name, ''), '[^a-zA-Z0-9]+', ' ', 'g'), '\s+') as value
    where trim(value) <> ''
  )
  select coalesce(string_agg(t.token, ' '), '')
  from tokenized t
  where t.token <> ''
    and not exists (
      select 1 from member_tokens mt where mt.token = t.token
    );
$$;

with normalized as (
  select
    p.project_key,
    p.project_name,
    nullif(public.normalize_project_name(p.project_name), '') as normalized_name
  from public.projects p
),
canonical as (
  select
    coalesce(n.normalized_name, lower(n.project_name)) as grouping_key,
    min(n.project_key) as canonical_project_key
  from normalized n
  group by coalesce(n.normalized_name, lower(n.project_name))
),
alias_rows as (
  select
    n.project_key as source_project_key,
    c.canonical_project_key,
    n.normalized_name
  from normalized n
  join canonical c
    on c.grouping_key = coalesce(n.normalized_name, lower(n.project_name))
)
insert into public.project_aliases (source_project_key, canonical_project_key, normalized_name, updated_at)
select source_project_key, canonical_project_key, normalized_name, now()
from alias_rows
on conflict (source_project_key) do update
set
  canonical_project_key = excluded.canonical_project_key,
  normalized_name = excluded.normalized_name,
  updated_at = now();

update public.time_entries t
set project_key = a.canonical_project_key
from public.project_aliases a
where t.project_key = a.source_project_key
  and t.project_key <> a.canonical_project_key;

with canonical_names as (
  select
    a.canonical_project_key as project_key,
    max(a.normalized_name) filter (where a.normalized_name is not null and a.normalized_name <> '') as normalized_name
  from public.project_aliases a
  group by a.canonical_project_key
)
update public.projects p
set
  project_name = initcap(cn.normalized_name),
  updated_at = now()
from canonical_names cn
where p.project_key = cn.project_key
  and cn.normalized_name is not null
  and cn.normalized_name <> '';

commit;
