alter table public.qa_folders
  add column if not exists is_shared boolean not null default false;

drop policy if exists "Users can read their own folders" on public.qa_folders;
drop policy if exists "Users can read their own or shared folders" on public.qa_folders;
create policy "Users can read their own or shared folders"
  on public.qa_folders for select to authenticated
  using ((select auth.uid()) = user_id or is_shared);

drop policy if exists "Users can read their own QA jobs" on public.qa_jobs;
drop policy if exists "Users can read QA jobs in shared folders" on public.qa_jobs;
drop policy if exists "Users can read own and shared QA jobs" on public.qa_jobs;
create policy "Users can read own and shared QA jobs"
  on public.qa_jobs for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.qa_folders
      where qa_folders.id = qa_jobs.folder_id
        and qa_folders.is_shared
    )
  );

notify pgrst, 'reload schema';
