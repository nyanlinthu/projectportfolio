import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// canvas-kit (pan/zoom canvas, drag, connection lines, roll-up engine) is consumed by source alias, the same way
// lifeos does it. It is vendored in ./canvas-kit so a fresh clone builds with no sibling folders.
const KIT = path.resolve(__dirname, 'canvas-kit')

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Firebase's reserved paths (/__/auth/handler for the sign-in popup, /__/firebase/init.json) must reach the
        // network. Without this, the service worker answers the popup with the app itself once auth runs on our domain.
        navigateFallbackDenylist: [/^\/__\//],
      },
      manifest: {
        name: 'ProjectPortfolio - Project Management',
        short_name: 'ProjectPortfolio',
        description: 'Portfolio work breakdown on a free-form whiteboard',
        theme_color: '#16294E',
        background_color: '#16294E',
        display: 'standalone',
        start_url: '/',
        icons: []
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'canvas-kit': path.join(KIT, 'src/index.ts')
    },
    dedupe: ['react', 'react-dom']
  },
  server: {
    port: 3000,
    fs: { allow: [path.resolve(__dirname), KIT] }
  }
})
