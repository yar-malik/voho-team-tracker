begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'time_entries'
    ) then
      execute 'alter publication supabase_realtime add table public.time_entries';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'daily_member_stats'
    ) then
      execute 'alter publication supabase_realtime add table public.daily_member_stats';
    end if;
  end if;
end
$$;

commit;

