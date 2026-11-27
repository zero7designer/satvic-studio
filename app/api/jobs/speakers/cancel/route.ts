import { del } from '@vercel/blob';
import { NextResponse } from 'next/server';
import { createClient } from '../../../../../lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in before deleting an uploaded source.' }, { status: 401 });
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: 'Private video storage is not configured; the temporary upload could not be deleted.' }, { status: 503 });
    }

    const body = await request.json() as { originalBlobUrl?: unknown };
    if (typeof body.originalBlobUrl !== 'string') {
      return NextResponse.json({ error: 'The temporary source URL is missing.' }, { status: 400 });
    }

    let blobUrl: URL;
    try {
      blobUrl = new URL(body.originalBlobUrl);
    } catch {
      return NextResponse.json({ error: 'The temporary source URL is invalid.' }, { status: 400 });
    }
    if (blobUrl.protocol !== 'https:' || !blobUrl.hostname.endsWith('.blob.vercel-storage.com')) {
      return NextResponse.json({ error: 'The temporary source URL is not a Vercel Blob URL.' }, { status: 400 });
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(blobUrl.pathname).replace(/^\/+/, '');
    } catch {
      return NextResponse.json({ error: 'The temporary source path is invalid.' }, { status: 400 });
    }
    const expectedPrefix = `satvic-users/${user.id}/satvic-jobs/`;
    if (!pathname.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: 'That source upload does not belong to your account.' }, { status: 403 });
    }

    const { data: referencedJob, error: lookupError } = await supabase
      .from('qa_jobs')
      .select('id')
      .eq('user_id', user.id)
      .eq('original_blob_url', blobUrl.href)
      .limit(1)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (referencedJob) {
      return NextResponse.json({ error: 'This source is already attached to a saved job and was kept.' }, { status: 409 });
    }

    await del(blobUrl.href);
    return NextResponse.json({ deleted: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete the temporary source upload.';
    console.error(`[api/jobs/speakers/cancel] ${message}`);
    return NextResponse.json({ error: message }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
