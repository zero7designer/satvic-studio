import { redirect } from 'next/navigation';
import AuthPanel from '@/features/auth/components/AuthPanel';

export default async function Home({ searchParams }: { searchParams: Promise<{ code?: string; setup?: string; error?: string }> }) {
  const { code, setup, error } = await searchParams;
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`);
  return <AuthPanel mode="login" setup={setup} error={error} />;
}
