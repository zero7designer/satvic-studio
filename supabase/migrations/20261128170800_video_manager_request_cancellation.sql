alter table public.video_manager_requests
  drop constraint if exists video_manager_requests_status_check;

alter table public.video_manager_requests
  add constraint video_manager_requests_status_check
  check (status in ('pending', 'in_progress', 'completed', 'cancelled'));
