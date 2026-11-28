import { createClient } from '../../../lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Sign in to view your project history.' }, { status: 401 });
    const jobFields = 'id, user_id, run_id, project_name, original_name, source_language, target_language, video_type, status, issue_count, error_message, folder_id, original_blob_url, original_b2_key, dubbed_blob_url, created_at, updated_at';
    const [ownedResult, sharedFoldersResult] = await Promise.all([
      supabase.from('qa_jobs').select(jobFields).eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('qa_folders').select('id').eq('is_shared', true).neq('user_id', user.id),
    ]);
    if (ownedResult.error) throw ownedResult.error;
    if (sharedFoldersResult.error) throw sharedFoldersResult.error;
    const sharedFolderIds = (sharedFoldersResult.data || []).map(folder => folder.id);
    const sharedJobsResult = sharedFolderIds.length
      ? await supabase.from('qa_jobs').select(jobFields).in('folder_id', sharedFolderIds).neq('user_id', user.id).order('created_at', { ascending: false })
      : { data: [], error: null };
    if (sharedJobsResult.error) throw sharedJobsResult.error;
    const data = [...(ownedResult.data || []), ...(sharedJobsResult.data || [])]
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    return Response.json({ jobs: data.map(({ original_blob_url, original_b2_key, dubbed_blob_url, user_id, ...job }) => ({
      ...job,
      read_only: user_id !== user.id,
      original_video_url: original_b2_key
        ? `/api/jobs/${encodeURIComponent(job.run_id || job.id)}/b2/media?track=source`
        : original_blob_url ? `/api/jobs/media?runId=${encodeURIComponent(job.run_id || job.id)}&url=${encodeURIComponent(original_blob_url)}` : null,
      dubbed_available: Boolean(dubbed_blob_url),
    })), userEmail: user.email || '' }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load project history.';
    return Response.json({ error: message }, { status: 500 });
  }
}
