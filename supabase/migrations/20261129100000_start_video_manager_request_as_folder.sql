alter table public.qa_folders
  add column if not exists source_url text check (source_url is null or source_url ~ '^https://'),
  add column if not exists target_languages text[] check (target_languages is null or cardinality(target_languages) between 1 and 12),
  add column if not exists video_manager_request_id uuid unique references public.video_manager_requests(id) on delete set null;

create or replace function public.start_video_manager_request(p_request_id uuid, p_manager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.video_manager_requests%rowtype;
  folder_row public.qa_folders%rowtype;
  base_name text;
  folder_name text;
  suffix text;
  suffix_number integer := 1;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = p_manager_id and role = 'Video Dubbing Manager'
  ) then
    raise exception 'Only Video Dubbing Managers can start requests.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_manager_id::text)::bigint);

  select * into request_row
  from public.video_manager_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Video request not found.' using errcode = 'P0002';
  end if;

  if request_row.status = 'in_progress' then
    select * into folder_row
    from public.qa_folders
    where video_manager_request_id = request_row.id;
    if found then
      if folder_row.user_id <> p_manager_id then
        raise exception 'This request is already assigned to another manager.' using errcode = '40001';
      end if;
      return to_jsonb(folder_row);
    end if;
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Video request is no longer pending.' using errcode = '40001';
  end if;

  base_name := left(request_row.project_name, 80);
  folder_name := base_name;
  while exists (
    select 1 from public.qa_folders
    where user_id = p_manager_id and lower(name) = lower(folder_name)
  ) loop
    suffix_number := suffix_number + 1;
    suffix := format(' (%s)', suffix_number);
    folder_name := left(base_name, 80 - char_length(suffix)) || suffix;
  end loop;

  insert into public.qa_folders (
    user_id,
    name,
    video_type,
    source_url,
    target_languages,
    video_manager_request_id
  ) values (
    p_manager_id,
    folder_name,
    request_row.video_type,
    request_row.source_url,
    request_row.target_languages,
    request_row.id
  )
  returning * into folder_row;

  update public.video_manager_requests
  set status = 'in_progress'
  where id = request_row.id;

  return to_jsonb(folder_row);
end;
$$;

revoke all on function public.start_video_manager_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_video_manager_request(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
