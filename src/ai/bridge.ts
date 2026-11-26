import { callTool, TOOL_DEFS } from './tools'

// Makes the agent seam reachable from outside React: the browser console today, an in-app agent or a browser
// automation later. `flowboard.tools` is the tool list; `flowboard.call(name, args)` runs one.
declare global {
  interface Window { flowboard?: { tools: typeof TOOL_DEFS; call: typeof callTool } }
}
export function installAgentBridge(): void {
  window.flowboard = { tools: TOOL_DEFS, call: callTool }
}
