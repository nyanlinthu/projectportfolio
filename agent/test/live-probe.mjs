// Read-only probe of a live workspace with the same settings an agent uses. Usage: node test/live-probe.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const c = new Client({ name: 'probe', version: '1' })
await c.connect(new StdioClientTransport({ command: 'node', args: ['dist/stdio.js'], env: process.env }))
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return r }
console.log('tools:', (await c.listTools()).tools.length)
const o = JSON.parse((await call('get_outline')).content[0].text)
const count = (n) => 1 + (n.children ?? []).reduce((a, k) => a + count(k), 0)
console.log('portfolio:', o.title, '| items:', count(o), '| projects:', (o.children ?? []).map((p) => `${p.title} ${p.progress_pct}% ${p.health}`).join('; '))
const h = JSON.parse((await call('project_health')).content[0].text)
console.log('health:', JSON.stringify({ scope: h.scope, bottlenecks: h.bottlenecks.length, blocked: h.blocked.length, late: h.late.length, stale: h.stale_in_progress.length }))
await c.close()
