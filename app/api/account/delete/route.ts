import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { del, list } from '@vercel/blob';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { getB2Client, getB2Config } from '@/lib/b2/client';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE_SIZE = 1000;
const BLOB_DELETE_BATCH_SIZE = 100;
const B2_DELETE_BATCH_SIZE = 1000;

type StoredJob = {
  status: string;
  original_blob_url: string | null;
  dubbed_blob_url: string | null;
  report_blob_url: string | null;
  original_b2_key: string | null;
  dubbed_b2_key: string | null;
  report_b2_key: string | null;
};

async function loadAccountJobs(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const jobs: StoredJob[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('qa_jobs')
      .select('status,original_blob_url,dubbed_blob_url,report_blob_url,original_b2_key,dubbed_b2_key,report_b2_key')
      .eq('user_id', userId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not list account projects: ${error.message}`);
    jobs.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return jobs;
  }
}

async function deleteAccountBlobs(userId: string, jobs: StoredJob[]) {
  const urls = new Set(jobs.flatMap(job => [job.original_blob_url, job.dubbed_blob_url, job.report_blob_url]).filter((url): url is string => Boolean(url)));
  const prefix = `satvic-users/${userId}/`;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: PAGE_SIZE, cursor });
    for (const blob of page.blobs) urls.add(blob.url);
    if (page.hasMore && !page.cursor) throw new Error('Vercel Blob returned another page without a cursor.');
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const allUrls = [...urls];
  for (let index = 0; index < allUrls.length; index += BLOB_DELETE_BATCH_SIZE) {
    await del(allUrls.slice(index, index + BLOB_DELETE_BATCH_SIZE));
  }
}

async function deleteAccountB2Objects(userId: string, jobs: StoredJob[], bucket: string) {
  const client = getB2Client();
  const keys = new Set(jobs.flatMap(job => [job.original_b2_key, job.dubbed_b2_key, job.report_b2_key]).filter((key): key is string => Boolean(key)));
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `satvic-archive/${userId}/`,
      ContinuationToken: continuationToken,
    }));
    for (const object of page.Contents || []) {
      if (object.Key) keys.add(object.Key);
    }
    if (page.IsTruncated && !page.NextContinuationToken) throw new Error('Backblaze returned another page without a continuation token.');
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  keys.add(`user-notifications/${userId}.json`);

  const allKeys = [...keys];
  for (let index = 0; index < allKeys.length; index += B2_DELETE_BATCH_SIZE) {
    const result = await client.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: allKeys.slice(index, index + B2_DELETE_BATCH_SIZE).map(Key => ({ Key })), Quiet: true },
    }));
    if (result.Errors?.length) throw new Error(`Backblaze did not delete ${result.Errors.length} account file(s).`);
  }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    let isSameOrigin = false;
    if (origin) {
      try {
        isSameOrigin = new URL(origin).origin === new URL(request.url).origin;
      } catch {
        isSameOrigin = false;
      }
    }
    if (!isSameOrigin) {
      return Response.json({ error: 'Account deletion must be requested from Satvic Studio.' }, { status: 403 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Sign in before deleting your account.' }, { status: 401 });

    const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
    const confirmation = typeof body?.confirmation === 'string' ? body.confirmation.trim() : '';
    const expectedConfirmation = user.email?.trim() || 'DELETE';
    const isConfirmed = confirmation.toLowerCase() === expectedConfirmation.toLowerCase();
    if (!isConfirmed) return Response.json({ error: `Enter ${user.email ? 'your account email' : 'DELETE'} exactly to confirm deletion.` }, { status: 400 });
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json({ error: 'Vercel Blob is not configured, so account files cannot be safely deleted.' }, { status: 503 });
    }

    const admin = createAdminClient();
    const jobs = await loadAccountJobs(admin, user.id);
    const activeJobs = jobs.filter(job => job.status === 'queued' || job.status === 'running').length;
    if (activeJobs) {
      return Response.json({ error: `Wait for ${activeJobs} active dubbing or QA job${activeJobs === 1 ? '' : 's'} to finish before deleting your account.` }, { status: 409 });
    }

    const { bucket } = getB2Config();
    await deleteAccountBlobs(user.id, jobs);
    await deleteAccountB2Objects(user.id, jobs, bucket);

    const { error: jobsError } = await admin.from('qa_jobs').delete().eq('user_id', user.id);
    if (jobsError) throw new Error(`Could not delete account projects: ${jobsError.message}`);
    const { error: foldersError } = await admin.from('qa_folders').delete().eq('user_id', user.id);
    if (foldersError) throw new Error(`Could not delete account folders: ${foldersError.message}`);
    const { error: profileError } = await admin.from('profiles').delete().eq('user_id', user.id);
    if (profileError) throw new Error(`Could not delete account profile: ${profileError.message}`);

    const { error: authError } = await admin.auth.admin.deleteUser(user.id);
    if (authError) throw new Error(`Could not remove the sign-in account: ${authError.message}`);
    return Response.json({ deleted: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account deletion failed.';
    console.error(`[api/account/delete] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
