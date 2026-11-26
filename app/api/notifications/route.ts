import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createClient } from '@/lib/supabase/server';
import { getB2Client, getB2Config } from '@/lib/b2/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Notice = { id: string; title: string; description: string; kind: string; createdAt: string; href: string };
const retentionMs = 30 * 24 * 60 * 60 * 1000;
const recordKey = (userId: string) => `user-notifications/${userId}.json`;

async function getUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

async function readRecord(bucket: string, userId: string) {
  const client = getB2Client();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: recordKey(userId) }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes || bytes.byteLength > 64_000) return { dismissed: [] as string[], updatedAt: 0 };
    const data = JSON.parse(gunzipSync(bytes, { maxOutputLength: 64_000 }).toString('utf8')) as { dismissed?: unknown; updatedAt?: string };
    const updatedAt = Date.parse(data.updatedAt || '');
    if (!updatedAt || Date.now() - updatedAt > retentionMs) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: recordKey(userId) }));
      return { dismissed: [] as string[], updatedAt: 0 };
    }
    return { dismissed: Array.isArray(data.dismissed) ? data.dismissed.filter((id): id is string => typeof id === 'string').slice(-500) : [], updatedAt };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if ((error as { name?: string }).name === 'NoSuchKey' || status === 404) return { dismissed: [] as string[], updatedAt: 0 };
    throw error;
  }
}

export async function GET() {
  const { supabase, user } = await getUser();
  if (!user) return Response.json({ error: 'Sign in to view notifications.' }, { status: 401 });

  try {
    const { bucket } = getB2Config();
    const [{ data: jobs, error }, record] = await Promise.all([
      supabase.from('qa_jobs').select('id,run_id,project_name,status,issue_count,error_message,created_at,updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(100),
      readRecord(bucket, user.id),
    ]);
    if (error) throw error;

    const qaNotices: Notice[] = (jobs || []).flatMap(job => {
      if (job.status !== 'completed' && job.status !== 'failed') return [];
      const id = `qa:${job.id}:${job.status}`;
      const runId = job.run_id || job.id;
      return [{
        id,
        title: job.status === 'failed' ? 'Video dubbing and QA needs attention' : 'Video dubbing and QA complete',
        description: job.status === 'failed' ? `${job.project_name}: ${job.error_message || 'Open the project to review the issue.'}` : `${job.project_name} is ready. ${job.issue_count} finding${job.issue_count === 1 ? '' : 's'} to review.`,
        kind: 'Satvic Studio',
        createdAt: job.updated_at || job.created_at,
        href: `/dashboard/satvic-fluid?qaRunId=${encodeURIComponent(runId)}`,
      }];
    });
    const dismissed = new Set(record.dismissed);
    const notifications = qaNotices.filter(item => !dismissed.has(item.id)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100);
    return Response.json({ notifications }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[notifications] Could not load notifications:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Could not load notifications. Check your Backblaze and database configuration.' }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const { user } = await getUser();
  if (!user) return Response.json({ error: 'Sign in to manage notifications.' }, { status: 401 });
  try {
    const body = await request.json() as { id?: unknown };
    if (typeof body.id !== 'string' || body.id.length > 500) return Response.json({ error: 'Choose a valid notification.' }, { status: 400 });
    const { bucket } = getB2Config();
    const record = await readRecord(bucket, user.id);
    const dismissed = [...new Set([...record.dismissed, body.id])].slice(-500);
    const now = new Date();
    const payload = JSON.stringify({ updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + retentionMs).toISOString(), dismissed });
    await getB2Client().send(new PutObjectCommand({ Bucket: bucket, Key: recordKey(user.id), Body: gzipSync(payload), ContentType: 'application/json; charset=utf-8', ContentEncoding: 'gzip' }));
    return Response.json({ dismissed: body.id }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[notifications] Could not dismiss notification:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Could not remove the notification. Please try again.' }, { status: 503 });
  }
}
