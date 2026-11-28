import './shims/env'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Caller } from './auth'
import { AGENT_TOOLS, runTool } from './tools'

/** One MCP server bound to one caller (one member of one workspace). Transports: stdio.ts, http.ts. */
export function createServer(getCaller: () => Promise<Caller>): Server {
  const server = new Server({ name: 'projectportfolio', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AGENT_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
  }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const caller = await getCaller()
      const out = await runTool(caller, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>)
      const isError = !!out && typeof out === 'object' && 'error' in (out as object)
      return { content: [{ type: 'text', text: JSON.stringify(out ?? null, null, 1) }], isError }
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
    }
  })
  return server
}
