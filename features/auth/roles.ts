import type { User } from '@supabase/supabase-js';

export const VIDEO_MANAGER_EMAIL = 'piyushkumaryadav2027@gmail.com';
export type AppRole = 'Video Manager' | 'Video Dubbing Manager';

export function getAssignedRole(user: Pick<User, 'email' | 'app_metadata' | 'email_confirmed_at'>): AppRole {
  const isGoogle = user.app_metadata?.provider === 'google';
  const isVerified = Boolean(user.email_confirmed_at);
  const isVideoManager = isGoogle && isVerified && user.email?.trim().toLowerCase() === VIDEO_MANAGER_EMAIL;
  return isVideoManager ? 'Video Manager' : 'Video Dubbing Manager';
}
