import { createServer, type Server } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { ToolDef } from '@/ai/tools'
import { STORE_KEYS } from '@/lib/demo'
import { ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'

/**
 * Pictures of the board for an agent to send to a chat (Discord, Telegram, Slack, ...).
 *
 * The real app is rendered, not a lookalike: `npm run build:render` (repo root config vite.render.config.ts)
 * builds the app with no Firebase config, so it starts in its single-browser "local" mode. This file serves that
 * build on 127.0.0.1 only, opens it in headless Chrome with THIS caller's workspace (already loaded and
 * permission-checked by workspace.ts) placed in the page's localStorage, picks the view through the app's own
 * ?view= link and #/<card> hash, and screenshots it. The page has no credentials and nothing to write to.
 *
 * Chrome: PP_CHROME_PATH, else the usual install locations. The Docker image does not include Chrome; self-host
 * on a machine that has it, or add it to the image.
 */
export const RENDER_DEF: ToolDef = {
  name: 'render_view',
  description: 'A PNG picture of the board as the app draws it: the work breakdown tree (WBS), the timeline (planned vs actual bars, Gantt-style), the board by project / by milestone, or the priority (Eisenhower) board. Optionally opened into one project or milestone. Send it to the person instead of describing the board in text.',
  input_schema: { type: 'object', properties: {
    view: { type: 'string', enum: ['tree', 'timeline', 'board-project', 'board-milestone', 'board-priority'], description: 'default tree' },
    root_id: { type: 'string', description: 'A work item to open the board into (default the whole portfolio).' },
    width: { type: 'number', description: 'CSS pixels, default 1400' },
    height: { type: 'number', description: 'CSS pixels, default 900' },
  } },
}

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PP_RENDER_DIR || path.resolve(here, '../render')
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' }

function chromePath(): string {
  const tries = [process.env.PP_CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  const hit = tries.find((p) => p && existsSync(p))
  if (!hit) throw new Error('No Chrome found for pictures; set PP_CHROME_PATH')
  return hit
}

let server: Server | null = null
async function serve(): Promise<string> {
  if (!existsSync(path.join(ROOT, 'index.html'))) throw new Error('The render build is missing; run "npm run build:render" in agent/')
  if (!server) {
    server = createServer((req, res) => {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0])
      const file = path.resolve(ROOT, '.' + (rel === '/' ? '/index.html' : rel))
      const ok = file.startsWith(ROOT + path.sep) && existsSync(file) && statSync(file).isFile()
      const f = ok ? file : path.join(ROOT, 'index.html')
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' })
      createReadStream(f).pipe(res)
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  }
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Screenshot the stores' current contents (the caller's workspace) in the asked view. Returns base64 PNG. */
export async function renderView(args: Record<string, unknown>): Promise<{ png: string; view: string; root: string }> {
  const view = typeof args.view === 'string' && ['tree', 'timeline', 'board-project', 'board-milestone', 'board-priority'].includes(args.view) ? args.view : 'tree'
  const nodes = useBoardStore.getState().nodes
  const root = typeof args.root_id === 'string' && args.root_id ? args.root_id : ROOT_ID
  if (!nodes[root]) throw new Error(`No work item with id ${root}`)
  const width = Math.min(Math.max(Number(args.width) || 1400, 360), 3000), height = Math.min(Math.max(Number(args.height) || 900, 360), 3000)
  const store = {
    [STORE_KEYS.board]: JSON.stringify({ state: { nodes }, version: 0 }),
    [STORE_KEYS.elements]: JSON.stringify({ state: { elements: useElementStore.getState().elements }, version: 0 }),
    [STORE_KEYS.view]: view,
  }
  const base = await serve()
  const { default: puppeteer } = await import('puppeteer-core')
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'] })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width, height, deviceScaleFactor: 2 })
    // only this origin is ever loaded; nothing else may be fetched except the fonts the app asks for
    await page.setRequestInterception(true)
    page.on('request', (r) => { const u = r.url(); (u.startsWith(base) || u.startsWith('https://fonts.g') || u.startsWith('data:') ? r.continue() : r.abort()).catch(() => undefined) })
    await page.evaluateOnNewDocument((kv: Record<string, string>) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v) }, store)
    await page.goto(`${base}/?view=${encodeURIComponent(view)}${root === ROOT_ID ? '' : `#/${encodeURIComponent(root)}`}`, { waitUntil: 'networkidle0', timeout: 30_000 })
    // a picture, not an editor: hide the editing chrome (tool bars, the detail panel, search, lane bar)
    await page.addStyleTag({ content: '.wb-tools-wrap,.wb-context,.wb-lanebar,.wb-detail,.wb-detail-scrim,.wb-search-results{display:none!important}' })
    await new Promise((r) => setTimeout(r, 900)) // the canvas fits itself to the window with a short animation
    const png = (await page.screenshot({ type: 'png', encoding: 'base64' })) as string
    return { png, view, root }
  } finally { await browser.close() }
}
