import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'DạyZi — Hôm nay dạy con gì?',
    short_name: 'DạyZi',
    description: 'DạyZi — Hiểu con. Dạy đúng. Cùng con tiến bộ mỗi ngày.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f8fc',
    theme_color: '#3b5bff',
    lang: 'vi',
    orientation: 'portrait',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
