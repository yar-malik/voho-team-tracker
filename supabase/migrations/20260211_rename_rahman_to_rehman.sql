begin;

-- Ensure target member exists so references can be migrated safely.
insert into public.members (member_name)
values ('Rehman')
on conflict (member_name) do nothing;

-- Merge daily stats first to avoid PK collisions on (stat_date, member_name).
insert into public.daily_member_stats (stat_date, member_name, total_seconds, entry_count, updated_at)
select
  stat_date,
  'Rehman' as member_name,
  sum(total_seconds) as total_seconds,
  sum(entry_count) as entry_count,
  now() as updated_at
from public.daily_member_stats
where member_name in ('Rahman', 'Rehman')
group by stat_date
on conflict (stat_date, member_name) do update
set
  total_seconds = excluded.total_seconds,
  entry_count = excluded.entry_count,
  updated_at = now();

delete from public.daily_member_stats
where member_name = 'Rahman';

-- Move entry ownership.
update public.time_entries
set member_name = 'Rehman'
where member_name = 'Rahman';

-- Optional historical label cleanup.
update public.sync_events
set member_name = 'Rehman'
where member_name = 'Rahman';

-- Remove the old member record.
delete from public.members
where member_name = 'Rahman';

commit;
