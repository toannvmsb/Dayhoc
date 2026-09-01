import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Học cùng con',
    short_name: 'Học cùng con',
    description: 'AI Parent Learning Copilot — bản demo giao diện bố mẹ',
    start_url: '/',
    display: 'standalone',
    background_color: '#fffbf5',
    theme_color: '#fffbf5',
    lang: 'vi',
    orientation: 'portrait',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
