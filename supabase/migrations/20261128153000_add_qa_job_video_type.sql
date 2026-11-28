alter table public.qa_jobs
  add column if not exists video_type text
  check (video_type in ('short', 'long'));

update public.qa_jobs jobs
set video_type = folders.video_type
from public.qa_folders folders
where jobs.folder_id = folders.id
  and jobs.video_type is null;

create index if not exists qa_jobs_user_type_updated_idx
  on public.qa_jobs (user_id, video_type, updated_at desc);

notify pgrst, 'reload schema';
