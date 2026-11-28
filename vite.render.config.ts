import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// The agent server's picture build (agent/src/render.ts): the normal app, but
//  - no Firebase config at all (envDir points at an empty folder, so .env files are NOT read): the app starts in
//    its single-browser "local" mode, with no sign-in and nothing it could write to;
//  - no service worker; output in agent/render/ (gitignored, never deployed).
// The agent puts one workspace's cards into the page's localStorage, opens a view, and screenshots it.
//   npx vite build --config vite.render.config.ts
export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, 'agent/render-env'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src'), 'canvas-kit': path.resolve(__dirname, 'canvas-kit/src/index.ts') },
    dedupe: ['react', 'react-dom'],
  },
  build: { outDir: 'agent/render', emptyOutDir: true, chunkSizeWarningLimit: 8000 },
})
