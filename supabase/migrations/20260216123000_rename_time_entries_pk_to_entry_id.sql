begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'time_entries'
      and column_name = 'toggl_entry_id'
  ) then
    alter table public.time_entries rename column toggl_entry_id to entry_id;
  end if;
end
$$;

-- Keep sequence ownership explicit after column rename.
do $$
begin
  if exists (
    select 1
    from information_schema.sequences
    where sequence_schema = 'public'
      and sequence_name = 'time_entries_id_seq'
  ) then
    alter sequence public.time_entries_id_seq owned by public.time_entries.entry_id;
  end if;
end
$$;

commit;

