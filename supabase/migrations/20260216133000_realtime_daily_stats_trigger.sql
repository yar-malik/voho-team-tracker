begin;

create or replace function public.recompute_daily_member_stat(p_member_name text, p_stat_date date)
returns void
language plpgsql
as $$
declare
  v_total_seconds integer := 0;
  v_entry_count integer := 0;
begin
  if p_member_name is null or p_stat_date is null then
    return;
  end if;

  select
    coalesce(sum(t.duration_seconds), 0)::integer,
    count(*)::integer
  into v_total_seconds, v_entry_count
  from public.time_entries t
  left join public.projects p
    on p.project_key = t.project_key
  where t.member_name = p_member_name
    and t.source_date = p_stat_date
    and t.is_running = false
    and coalesce(p.project_type, 'work') <> 'non_work';

  if v_total_seconds = 0 and v_entry_count = 0 then
    delete from public.daily_member_stats
    where stat_date = p_stat_date
      and member_name = p_member_name;
    return;
  end if;

  insert into public.daily_member_stats (stat_date, member_name, total_seconds, entry_count, updated_at)
  values (p_stat_date, p_member_name, v_total_seconds, v_entry_count, now())
  on conflict (stat_date, member_name) do update
  set total_seconds = excluded.total_seconds,
      entry_count = excluded.entry_count,
      updated_at = now();
end;
$$;

create or replace function public.refresh_daily_member_stats_from_time_entries()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recompute_daily_member_stat(new.member_name, new.source_date);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.member_name is distinct from new.member_name
       or old.source_date is distinct from new.source_date then
      perform public.recompute_daily_member_stat(old.member_name, old.source_date);
    end if;
    perform public.recompute_daily_member_stat(new.member_name, new.source_date);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.recompute_daily_member_stat(old.member_name, old.source_date);
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_time_entries_refresh_daily_stats on public.time_entries;
create trigger trg_time_entries_refresh_daily_stats
after insert or update or delete on public.time_entries
for each row
execute procedure public.refresh_daily_member_stats_from_time_entries();

-- Initial backfill from existing entries (non-running and work projects only).
insert into public.daily_member_stats (stat_date, member_name, total_seconds, entry_count, updated_at)
select
  t.source_date as stat_date,
  t.member_name,
  coalesce(sum(t.duration_seconds), 0)::integer as total_seconds,
  count(*)::integer as entry_count,
  now()
from public.time_entries t
left join public.projects p
  on p.project_key = t.project_key
where t.is_running = false
  and coalesce(p.project_type, 'work') <> 'non_work'
group by t.source_date, t.member_name
on conflict (stat_date, member_name) do update
set total_seconds = excluded.total_seconds,
    entry_count = excluded.entry_count,
    updated_at = now();

commit;

