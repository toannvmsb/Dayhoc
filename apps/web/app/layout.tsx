import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Học cùng con — Parent Copilot',
  description: 'AI Parent Learning Copilot — bản demo giao diện bố mẹ (Hướng 1A).',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
