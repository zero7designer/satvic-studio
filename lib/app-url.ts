const PRODUCTION_APP_URL = 'https://satvic-studio.vercel.app';

export function appUrl(): string {
  const configuredUrl = process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');
  if (process.env.VERCEL) return PRODUCTION_APP_URL;
  return 'http://localhost:3000';
}
