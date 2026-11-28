create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  role text not null check (role in ('Video Manager', 'Video Dubbing Manager')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles p
set role = case
  when lower(u.email) = 'piyushkumaryadav2027@gmail.com'
    and u.email_confirmed_at is not null
    and u.raw_app_meta_data ->> 'provider' = 'google'
  then 'Video Manager'
  else 'Video Dubbing Manager'
end
from auth.users u
where u.id = p.user_id;
alter table public.profiles add constraint profiles_role_check check (role in ('Video Manager', 'Video Dubbing Manager'));

create or replace function public.assign_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  account_email text;
  account_provider text;
  email_confirmed_at timestamptz;
begin
  select lower(email), raw_app_meta_data ->> 'provider', auth.users.email_confirmed_at
    into account_email, account_provider, email_confirmed_at
    from auth.users
    where id = new.user_id;
  new.role := case
    when account_email = 'piyushkumaryadav2027@gmail.com'
      and account_provider = 'google'
      and email_confirmed_at is not null
    then 'Video Manager'
    else 'Video Dubbing Manager'
  end;
  return new;
end;
$$;
drop trigger if exists profiles_assign_role on public.profiles;
create trigger profiles_assign_role
before insert or update of user_id, role on public.profiles
for each row execute function public.assign_profile_role();

alter table public.profiles enable row level security;
drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can create their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own profile" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own profile" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update on public.profiles to authenticated;

create table if not exists public.video_manager_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submitter_name text not null,
  submitter_email text not null,
  project_name text not null check (char_length(project_name) between 2 and 120),
  video_type text not null check (video_type in ('short', 'long')),
  source_url text not null check (source_url ~ '^https://'),
  target_languages text[] not null check (cardinality(target_languages) between 1 and 12),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_at timestamptz not null default now()
);
create index if not exists video_manager_requests_status_created_idx
  on public.video_manager_requests (status, created_at desc);
alter table public.video_manager_requests enable row level security;
revoke all on public.video_manager_requests from anon, authenticated;
grant select, insert, update, delete on public.video_manager_requests to service_role;

create table if not exists public.qa_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id text unique,
  project_name text not null,
  original_name text not null,
  source_language text not null,
  target_language text not null,
  original_blob_url text not null,
  dubbed_blob_url text,
  report_blob_url text,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  issue_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.qa_jobs enable row level security;
drop policy if exists "Users can read their own QA jobs" on public.qa_jobs;
drop policy if exists "Users can read own and shared QA jobs" on public.qa_jobs;
drop policy if exists "Users can read QA jobs in shared folders" on public.qa_jobs;
drop policy if exists "Users can create their own QA jobs" on public.qa_jobs;
drop policy if exists "Users can update their own QA jobs" on public.qa_jobs;
drop policy if exists "Users can delete their own QA jobs" on public.qa_jobs;
create policy "Users can read their own QA jobs" on public.qa_jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create their own QA jobs" on public.qa_jobs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own QA jobs" on public.qa_jobs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own QA jobs" on public.qa_jobs for delete to authenticated using ((select auth.uid()) = user_id);
create index if not exists qa_jobs_user_created_idx on public.qa_jobs (user_id, created_at desc);
grant select, insert, update, delete on public.qa_jobs to authenticated;

-- Optional Backblaze B2 archive for the complete report and both video tracks.
alter table public.qa_jobs alter column original_blob_url drop not null;
alter table public.qa_jobs add column if not exists original_b2_key text;
alter table public.qa_jobs add column if not exists dubbed_b2_key text;
alter table public.qa_jobs add column if not exists report_b2_key text;

-- User-owned folders for grouping dubbed video projects.
create table if not exists public.qa_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  video_type text check (video_type in ('short', 'long')),
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
alter table public.qa_folders add column if not exists video_type text check (video_type in ('short', 'long'));
alter table public.qa_folders add column if not exists is_shared boolean not null default false;
update public.qa_folders set video_type = 'short' where video_type is null;
alter table public.qa_folders add column if not exists feedback_form_url text;
alter table public.qa_folders add column if not exists feedback_sheet_url text;

create unique index if not exists qa_folders_user_name_idx on public.qa_folders (user_id, lower(name));
alter table public.qa_folders enable row level security;
drop policy if exists "Users can read their own folders" on public.qa_folders;
drop policy if exists "Users can read their own or shared folders" on public.qa_folders;
drop policy if exists "Users can create their own folders" on public.qa_folders;
  drop policy if exists "Users can update their own folders" on public.qa_folders;
drop policy if exists "Users can delete their own folders" on public.qa_folders;
create policy "Users can read their own or shared folders" on public.qa_folders for select to authenticated using ((select auth.uid()) = user_id or is_shared);
create policy "Users can create their own folders" on public.qa_folders for insert to authenticated with check ((select auth.uid()) = user_id);
  create policy "Users can update their own folders" on public.qa_folders for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own folders" on public.qa_folders for delete to authenticated using ((select auth.uid()) = user_id);
  grant select, insert, update, delete on public.qa_folders to authenticated;

alter table public.qa_jobs add column if not exists folder_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qa_jobs_folder_user_fkey') then
    alter table public.qa_jobs add constraint qa_jobs_folder_user_fkey
      foreign key (folder_id, user_id) references public.qa_folders (id, user_id);
  end if;
end $$;
drop policy if exists "Users can read their own QA jobs" on public.qa_jobs;
drop policy if exists "Users can read own and shared QA jobs" on public.qa_jobs;
create policy "Users can read own and shared QA jobs" on public.qa_jobs for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.qa_folders
      where qa_folders.id = qa_jobs.folder_id
        and qa_folders.is_shared
    )
  );
create index if not exists qa_jobs_folder_user_created_idx on public.qa_jobs (user_id, folder_id, created_at desc);
notify pgrst, 'reload schema';
