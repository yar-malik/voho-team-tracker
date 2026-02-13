begin;

-- Canonical rollup view: duplicate project keys are merged via project_aliases.
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

-- Safety check: merging aliases must never reduce entry count or total tracked seconds.
do $$
declare
  before_count bigint;
  before_sum bigint;
  after_count bigint;
  after_sum bigint;
begin
  select count(*), coalesce(sum(duration_seconds), 0)
  into before_count, before_sum
  from public.time_entries;

  update public.time_entries t
  set project_key = a.canonical_project_key
  from public.project_aliases a
  where t.project_key = a.source_project_key
    and t.project_key is distinct from a.canonical_project_key;

  select count(*), coalesce(sum(duration_seconds), 0)
  into after_count, after_sum
  from public.time_entries;

  if before_count <> after_count then
    raise exception 'Project merge safety failed: entry count changed from % to %', before_count, after_count;
  end if;

  if before_sum <> after_sum then
    raise exception 'Project merge safety failed: total duration changed from % to %', before_sum, after_sum;
  end if;
end;
$$;

commit;
