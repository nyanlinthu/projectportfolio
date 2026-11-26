import { callTool, TOOL_DEFS } from './tools'

// Makes the agent seam reachable from outside React: the browser console today, an in-app agent or a browser
// automation later. `projectportfolio.tools` is the tool list; `projectportfolio.call(name, args)` runs one.
declare global {
  interface Window { projectportfolio?: { tools: typeof TOOL_DEFS; call: typeof callTool } }
}
export function installAgentBridge(): void {
  window.projectportfolio = { tools: TOOL_DEFS, call: callTool }
}
