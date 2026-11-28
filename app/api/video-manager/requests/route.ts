import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { VIDEO_MANAGER_LANGUAGES } from '@/features/video-manager/constants';

export const runtime = 'nodejs';

async function getAccount() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: Response.json({ error: 'Sign in to continue.' }, { status: 401 }) };
  const { data: profile, error } = await supabase.from('profiles').select('role,full_name').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!profile) return { response: Response.json({ error: 'Finish setting up your account first.' }, { status: 403 }) };
  return { user, profile };
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const account = await getAccount();
    if ('response' in account) return account.response;
    if (account.profile.role !== 'Video Dubbing Manager' && account.profile.role !== 'Video Manager') {
      return Response.json({ error: 'This account cannot view video requests.' }, { status: 403 });
    }

    const admin = createAdminClient();
    let query = admin.from('video_manager_requests')
      .select('id,submitter_name,submitter_email,project_name,video_type,source_url,target_languages,status,created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (account.profile.role === 'Video Manager') query = query.eq('user_id', account.user.id);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json({ requests: data || [] }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load video requests.';
    console.error(`[api/video-manager/requests] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ error: 'Update requests from Satvic Studio.' }, { status: 403 });
    }
    const account = await getAccount();
    if ('response' in account) return account.response;
    const body = await request.json().catch(() => null) as { id?: unknown; status?: unknown; action?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return Response.json({ error: 'Choose a valid video request.' }, { status: 400 });
    }

    if (body && 'action' in body && body.action === 'cancel') {
      if (account.profile.role !== 'Video Manager') {
        return Response.json({ error: 'Only the Video Manager can cancel their requests.' }, { status: 403 });
      }
      const admin = createAdminClient();
      const { data, error } = await admin.from('video_manager_requests')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('user_id', account.user.id)
        .in('status', ['pending', 'in_progress'])
        .select('id,status')
        .maybeSingle();
      if (error) throw error;
      if (!data) return Response.json({ error: 'This request can no longer be cancelled. Refresh your requests and try again.' }, { status: 409 });
      return Response.json({ request: data }, { headers: { 'cache-control': 'no-store' } });
    }

    if (account.profile.role !== 'Video Dubbing Manager') {
      return Response.json({ error: 'Only Video Dubbing Managers can update request status.' }, { status: 403 });
    }
    if (body?.status !== 'in_progress' && body?.status !== 'completed') {
      return Response.json({ error: 'Choose an available request status.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const previousStatus = body.status === 'in_progress' ? 'pending' : 'in_progress';
    const { data, error } = await admin.from('video_manager_requests')
      .update({ status: body.status })
      .eq('id', id)
      .eq('status', previousStatus)
      .select('id,status')
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: 'This request has already changed. Refresh the queue and try again.' }, { status: 409 });
    return Response.json({ request: data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not update the request status.';
    console.error(`[api/video-manager/requests] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ error: 'Delete requests from Satvic Studio.' }, { status: 403 });
    }
    const account = await getAccount();
    if ('response' in account) return account.response;
    if (account.profile.role !== 'Video Manager') {
      return Response.json({ error: 'Only the Video Manager can delete their requests.' }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as { id?: unknown } | null;
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return Response.json({ error: 'Choose a valid video request.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.from('video_manager_requests')
      .delete()
      .eq('id', id)
      .eq('user_id', account.user.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: 'This request could not be found. Refresh your requests and try again.' }, { status: 404 });
    return Response.json({ request: data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not delete the video request.';
    console.error(`[api/video-manager/requests] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      return Response.json({ error: 'Submit requests from Satvic Studio.' }, { status: 403 });
    }
    const account = await getAccount();
    if ('response' in account) return account.response;
    if (account.profile.role !== 'Video Manager') {
      return Response.json({ error: 'Only the Video Manager can submit a request.' }, { status: 403 });
    }

    const body = await request.json().catch(() => null) as {
      projectName?: unknown;
      videoType?: unknown;
      sourceUrl?: unknown;
      targetLanguages?: unknown;
    } | null;
    const projectName = typeof body?.projectName === 'string' ? body.projectName.trim() : '';
    const videoType = body?.videoType;
    const sourceUrlText = typeof body?.sourceUrl === 'string' ? body.sourceUrl.trim() : '';
    const selectedLanguages = body?.targetLanguages;
    if (projectName.length < 2 || projectName.length > 120) {
      return Response.json({ error: 'Enter a video title between 2 and 120 characters.' }, { status: 400 });
    }
    if (videoType !== 'short' && videoType !== 'long') {
      return Response.json({ error: 'Choose Short-form or Long-form.' }, { status: 400 });
    }
    if (sourceUrlText.length > 2048) return Response.json({ error: 'The video link is too long.' }, { status: 400 });
    let sourceUrl: string;
    try {
      const parsed = new URL(sourceUrlText);
      if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) throw new Error();
      sourceUrl = parsed.toString();
    } catch {
      return Response.json({ error: 'Enter a valid HTTPS link to the source video.' }, { status: 400 });
    }
    if (!Array.isArray(selectedLanguages) || selectedLanguages.length < 1 || selectedLanguages.length > VIDEO_MANAGER_LANGUAGES.length) {
      return Response.json({ error: 'Choose at least one target language.' }, { status: 400 });
    }
    const languages = selectedLanguages.filter((value): value is string => typeof value === 'string');
    if (languages.length !== selectedLanguages.length
      || new Set(languages).size !== languages.length
      || languages.some(language => !(VIDEO_MANAGER_LANGUAGES as readonly string[]).includes(language))) {
      return Response.json({ error: 'Choose valid target languages without duplicates.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.from('video_manager_requests').insert({
      user_id: account.user.id,
      submitter_name: account.profile.full_name,
      submitter_email: account.user.email || '',
      project_name: projectName,
      video_type: videoType,
      source_url: sourceUrl,
      target_languages: languages,
    }).select('id,project_name,video_type,target_languages,status,created_at').single();
    if (error || !data) throw error || new Error('Could not save this video request.');
    return Response.json({ request: data }, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not submit this video request.';
    console.error(`[api/video-manager/requests] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }
}
