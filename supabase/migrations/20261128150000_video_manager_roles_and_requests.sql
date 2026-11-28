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

alter table public.profiles
  add constraint profiles_role_check check (role in ('Video Manager', 'Video Dubbing Manager'));

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

notify pgrst, 'reload schema';
