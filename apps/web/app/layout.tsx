import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@copilot/design-tokens/css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Học cùng con',
  description: 'AI Parent Learning Copilot — bản demo giao diện bố mẹ (Hướng 1A).',
  applicationName: 'Học cùng con',
  appleWebApp: {
    capable: true,
    title: 'Học cùng con',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#fffbf5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
