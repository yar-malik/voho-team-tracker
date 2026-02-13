begin;

alter table public.projects
  add column if not exists project_color text;

update public.projects
set project_color = case mod(abs(hashtext(project_name)), 15)
  when 0 then '#2D9CDB'
  when 1 then '#9B51E0'
  when 2 then '#D53F8C'
  when 3 then '#ED8936'
  when 4 then '#C56A00'
  when 5 then '#38A169'
  when 6 then '#17A2B8'
  when 7 then '#D97706'
  when 8 then '#4C51BF'
  when 9 then '#9F7AEA'
  when 10 then '#D69E2E'
  when 11 then '#6B8E23'
  when 12 then '#E53E3E'
  when 13 then '#4A5568'
  else '#0EA5E9'
end
where project_color is null;

alter table public.projects
  alter column project_color set default '#0EA5E9';

alter table public.projects
  alter column project_color set not null;

commit;
