import { redirect } from 'next/navigation';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { completeProfile } from '@/features/auth/server/onboarding-actions';
import AvatarPicker from '@/features/auth/components/AvatarPicker';
import PendingSubmitButton from '@/features/auth/components/PendingSubmitButton';
import { createClient, hasSupabaseConfig } from '@/lib/supabase/server';
import { getAssignedRole } from '@/features/auth/roles';

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  if (!hasSupabaseConfig()) redirect('/login?setup=missing');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile, error: profileError } = await supabase.from('profiles').select('user_id').eq('user_id', user.id).maybeSingle();
  if (profileError) redirect('/login?setup=profile-table');
  if (profile) redirect('/dashboard');
  const assignedRole = getAssignedRole(user);
  return (
    <main className="auth-screen onboarding-screen">
      <section className="auth-card onboarding-card">
        <Link className="onboarding-back-link" href="/"><ArrowRight size={13}/> Back to sign in or create account</Link>
        <h1>Set up your profile</h1>
        <p className="auth-copy">Add your name and choose an avatar. Your Google account determines your workspace role.</p>
        {params.error === 'details' ? <div className="auth-error">Enter your name to continue.</div> : params.error === 'save' ? <div className="auth-error">We couldn’t save your profile. Please try again.</div> : null}
        <form action={completeProfile} className="onboarding-form">
          <label className="onboarding-name" htmlFor="fullName">Your name<input id="fullName" name="fullName" type="text" autoComplete="name" defaultValue={user.user_metadata?.full_name || user.user_metadata?.name || ''} placeholder="e.g. Piyush Yadav" minLength={2} maxLength={80} required /></label>
          <AvatarPicker />
          <div className="onboarding-role"><span>Workspace role</span><strong>{assignedRole}</strong></div>
          <PendingSubmitButton className="onboarding-submit" pendingText="Creating workspace…">Continue <ArrowRight size={16} /></PendingSubmitButton>
        </form>
        <div className="auth-privacy"><ShieldCheck size={13} /> Google account: {user.email || 'signed in'}</div>
      </section>
      <div className="auth-ambient auth-ambient-one" /><div className="auth-ambient auth-ambient-two" />
    </main>
  );
}
