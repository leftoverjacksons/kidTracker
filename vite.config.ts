import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Served from https://<user>.github.io/kidTracker/ on GitHub Pages.
const base = process.env.VITE_BASE ?? '/kidTracker/';

let version = 'dev';
try {
  version = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  /* not a git checkout */
}

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { chunkSizeWarningLimit: 1500 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-64.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'kidTracker',
        short_name: 'kidTracker',
        description: 'Shared baby tracker',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1f2a44',
        theme_color: '#1f2a44',
        // Long-press the app icon for these; each can also be dragged onto the home screen.
        shortcuts: [
          { name: 'Diaper', short_name: 'Diaper', url: `${base}#/home?log=diaper`, icons: [{ src: 'icons/sc-diaper.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Bottle', short_name: 'Bottle', url: `${base}#/home?log=bottle`, icons: [{ src: 'icons/sc-bottle.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Nurse', short_name: 'Nurse', url: `${base}#/home?log=nursing`, icons: [{ src: 'icons/sc-nursing.png', sizes: '96x96', type: 'image/png' }] },
          { name: 'Sleep', short_name: 'Sleep', url: `${base}#/home?log=sleep`, icons: [{ src: 'icons/sc-sleep.png', sizes: '96x96', type: 'image/png' }] },
        ],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // restore.html is a standalone page, not part of the app shell.
        navigateFallbackDenylist: [/restore\.html$/],
      },
    }),
  ],
});
