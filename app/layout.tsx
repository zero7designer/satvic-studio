import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import './dashboard.css';
import './community-map.css';
import './landing.css';
import '../features/website/satvic-studio.css';
import './auth-page.css';
import './incoming-video-requests.css';
import NavigationLoading from '@/features/navigation/NavigationLoading';

export const metadata: Metadata = {
  title: 'Satvic Studio | Multilingual Video QA',
  description: 'A private workspace for comparing dubbed audio and reviewing multilingual video quality.',
  icons: {
    icon: '/sarvamlogo.svg',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<NavigationLoading /><Analytics /><SpeedInsights /></body></html>;
}
