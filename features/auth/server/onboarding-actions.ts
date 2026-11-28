'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isProfileAvatarId } from '@/features/auth/profile-avatar';
import { getAssignedRole } from '@/features/auth/roles';

export async function completeProfile(formData: FormData) {
  const fullName = String(formData.get('fullName') || '').trim().replace(/\s+/g, ' ');
  const avatarId = String(formData.get('avatarId') || '');
  if (fullName.length < 2 || fullName.length > 80 || !isProfileAvatarId(avatarId)) redirect('/onboarding?error=details');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (user.app_metadata?.provider !== 'google') redirect('/login?error=google-only');
  const { error: avatarError } = await supabase.auth.updateUser({ data: { avatar_id: avatarId } });
  if (avatarError) redirect('/onboarding?error=save');
  const { error } = await supabase.from('profiles').upsert({ user_id: user.id, full_name: fullName, role: getAssignedRole(user) }, { onConflict: 'user_id' });
  if (error) redirect('/onboarding?error=save');
  redirect('/dashboard');
}
