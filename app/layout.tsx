import type { Metadata, Viewport } from 'next';
import { env } from 'cloudflare:workers';
import { EnvironmentBanner } from '@/components/environment-banner';
import { deploymentIdentity } from '@/lib/services/deployment-identity';
import './globals.css';

export const metadata: Metadata = {
  title: 'Luufi',
  description: 'Deine private Zentrale für Projektideen und Projekte.',
};
export const viewport: Viewport = {
  themeColor: '#070b12',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className="dark">
      <body>
        <EnvironmentBanner identity={deploymentIdentity(env)} />
        {children}
      </body>
    </html>
  );
}
