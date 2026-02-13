create sequence if not exists public.time_entries_id_seq;

alter table public.time_entries
  alter column toggl_entry_id set default nextval('public.time_entries_id_seq');

do $$
declare
  max_id bigint;
begin
  select coalesce(max(toggl_entry_id), 0) into max_id from public.time_entries;
  perform setval('public.time_entries_id_seq', greatest(max_id, 1), true);
end
$$;

alter table public.time_entries
  add column if not exists entry_source text not null default 'toggl';

alter table public.time_entries
  add column if not exists source_entry_id text null;

update public.time_entries
set source_entry_id = toggl_entry_id::text
where source_entry_id is null
  and entry_source = 'toggl';

create index if not exists idx_time_entries_entry_source
  on public.time_entries (entry_source);

create unique index if not exists idx_time_entries_source_unique
  on public.time_entries (entry_source, source_entry_id)
  where source_entry_id is not null;

