alter table public.projects
  add column if not exists project_type text;

update public.projects
set project_type = case
  when lower(trim(project_name)) in ('fitness', 'sleep', 'non-work', 'non work', 'non-work-task') then 'non_work'
  else 'work'
end
where project_type is null
   or project_type not in ('work', 'non_work');

alter table public.projects
  alter column project_type set default 'work';

alter table public.projects
  alter column project_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_project_type_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_project_type_check
      check (project_type in ('work', 'non_work'));
  end if;
end $$;
