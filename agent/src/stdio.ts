import './shims/env'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { resolveCaller } from './auth'
import { createServer } from './server'

// stdio: the agent starts this process itself (Hermes, Claude Code, Codex all can). stdout belongs to the MCP
// protocol, so anything else goes to stderr.
console.log = console.error
console.info = console.error
const token = process.env.PP_AGENT_TOKEN
try { await resolveCaller(token) } catch (e) { console.error(`projectportfolio agent refused to start: ${(e as Error).message}`); process.exit(1) }
await createServer(() => resolveCaller(token)).connect(new StdioServerTransport())
