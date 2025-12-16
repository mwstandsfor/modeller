import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'ImageModel',
        short_name: 'ImageModel',
        description: 'Create 3D models from images using plane extrusion',
        theme_color: '#1a1a1a',
        background_color: '#1a1a1a',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
  server: {
    host: `0.0.0.0`,
    port: 3001,
    strictPort: true,
    hmr: {
      protocol: `wss`,
      host: `lazyimage.mwstandsfor.com`
    },
    allowedHosts: [ 
      'lazyimage.mwstandsfor.com'
    ]
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
});
