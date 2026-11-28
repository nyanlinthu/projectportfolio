import './shims/env'
import express from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { resolveCaller } from './auth'
import { createServer } from './server'

// HTTP: one hosted endpoint many agents connect to, each with its own token (Authorization: Bearer ppa_...).
// Stateless: a fresh server + transport per request. Every request is authenticated; there is no open route.
const PORT = Number(process.env.PORT ?? 8787)
const app = express()
app.set('trust proxy', 1)
app.get('/', (_req, res) => { res.type('text').send('projectportfolio agent server') })
app.post('/mcp', express.json({ limit: '1mb' }), async (req, res) => {
  const token = /^Bearer\s+(\S+)$/i.exec(req.header('authorization') ?? '')?.[1]
  try { await resolveCaller(token) } catch (e) { res.status(401).json({ error: (e as Error).message }); return }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => { void transport.close() })
  await createServer(() => resolveCaller(token)).connect(transport)
  await transport.handleRequest(req, res, req.body)
})
app.all('/mcp', (_req, res) => { res.status(405).json({ error: 'POST only' }) })
app.listen(PORT, () => console.error(`projectportfolio agent server on :${PORT}`))
