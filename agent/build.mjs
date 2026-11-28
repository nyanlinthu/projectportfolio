// Bundles the agent server together with the web app's own code (../src), so both run the same tools, roll-up and
// access stamping. Browser-only modules are swapped for server stand-ins in ./src/shims.
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const swap = {
  'canvas-kit': path.join(here, 'src/shims/canvas-kit.ts'),
  '@/services/inbox': path.join(here, 'src/shims/inbox.ts'),
}
await build({
  entryPoints: ['src/stdio.ts', 'src/http.ts', 'src/token.ts'].map((f) => path.join(here, f)),
  outdir: path.join(here, 'dist'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', sourcemap: false, logLevel: 'warning',
  tsconfig: path.join(here, '../tsconfig.json'), // the app's '@/...' paths
  external: ['@modelcontextprotocol/sdk', 'firebase-admin', 'express', 'puppeteer-core'],
  define: { 'import.meta.env': '{}' },
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  plugins: [{ name: 'server-shims', setup(b) {
    b.onResolve({ filter: /^(canvas-kit|@\/services\/inbox)$/ }, (a) => ({ path: swap[a.path] }))
    // anything else from services/ talks to Firebase from a browser and must never reach the server bundle
    b.onResolve({ filter: /^@\/services\// }, (a) => ({ errors: [{ text: `${a.path} is browser-only; add a server shim in agent/src/shims` }] }))
  } }],
})
console.log('built agent/dist')
