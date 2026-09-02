import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@copilot/design-tokens/css';
import './globals.css';

export const metadata: Metadata = {
  title: 'DạyZi — Hôm nay dạy con gì?',
  description: 'DạyZi — Hiểu con. Dạy đúng. Cùng con tiến bộ mỗi ngày.',
  applicationName: 'DạyZi',
  appleWebApp: {
    capable: true,
    title: 'DạyZi',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#3b5bff',
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
