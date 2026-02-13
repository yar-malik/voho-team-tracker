begin;

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
    select trim(t.value) as token, t.ord
    from cleaned c,
    regexp_split_to_table(regexp_replace(c.value, '[^a-z0-9]+', ' ', 'g'), '\s+') with ordinality as t(value, ord)
  ),
  member_tokens as (
    select distinct lower(trim(v.value)) as token
    from public.members m
    cross join regexp_split_to_table(regexp_replace(coalesce(m.member_name, ''), '[^a-zA-Z0-9]+', ' ', 'g'), '\s+') as v(value)
    where trim(v.value) <> ''
  )
  select coalesce(
    string_agg(t.token, ' ' order by t.ord),
    ''
  )
  from tokenized t
  where t.token <> ''
    and t.token not in ('task', 'tasks', 'project', 'projects')
    and not exists (
      select 1
      from member_tokens mt
      where mt.token = t.token
    );
$$;

with normalized as (
  select
    p.project_key,
    p.project_name,
    p.created_at,
    nullif(public.normalize_project_name(p.project_name), '') as normalized_name,
    coalesce(nullif(public.normalize_project_name(p.project_name), ''), lower(p.project_name)) as grouping_key
  from public.projects p
),
canonical as (
  select distinct on (n.grouping_key)
    n.grouping_key,
    n.project_key as canonical_project_key,
    n.normalized_name
  from normalized n
  order by n.grouping_key, n.created_at asc, n.project_key asc
),
alias_rows as (
  select
    n.project_key as source_project_key,
    c.canonical_project_key,
    c.normalized_name
  from normalized n
  join canonical c on c.grouping_key = n.grouping_key
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

update public.projects p
set
  project_name = public.format_project_name(a.normalized_name),
  updated_at = now()
from public.project_aliases a
where p.project_key = a.canonical_project_key
  and a.normalized_name is not null
  and a.normalized_name <> '';

commit;
