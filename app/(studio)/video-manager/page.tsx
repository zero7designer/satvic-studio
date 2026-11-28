import { redirect } from 'next/navigation';
import { createClient, hasSupabaseConfig } from '@/lib/supabase/server';
import VideoManagerDashboard from '@/features/video-manager/client/VideoManagerDashboard';

export default async function VideoManagerPage() {
  if (!hasSupabaseConfig()) redirect('/login?setup=missing');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile, error } = await supabase.from('profiles').select('role,full_name').eq('user_id', user.id).maybeSingle();
  if (error) redirect('/login?setup=profile-table');
  if (!profile) redirect('/onboarding');
  if (profile.role !== 'Video Manager') redirect('/dashboard/satvic-fluid');

  return <VideoManagerDashboard accountEmail={user.email || ''} fullName={profile.full_name}/>;
}
