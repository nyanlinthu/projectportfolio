import { TOOL_DEFS, callTool, type ToolDef } from '@/ai/tools'
import { db } from './firestore'
import type { Caller } from './auth'
import { apply, authorize, commit, diff, hydrate, load, same, serial, type Change } from './workspace'
import { health, HEALTH_DEF } from './health'

/**
 * The agent's tool list = the web app's own tools (src/ai/tools.ts, unchanged) minus the two that only make sense
 * in one browser tab (undo/redo: this server keeps no tab), plus the server's own:
 *   list_changes / revert_change   the change log that replaces undo, shared by every agent and person
 *   project_health                 bottlenecks, stuck work and what needs attention, computed, not guessed
 */
const BROWSER_ONLY = new Set(['undo', 'redo'])

const SERVER_TOOLS: ToolDef[] = [
  {
    name: 'list_changes',
    description: 'Recent changes agents made in this workspace (newest first): id, when, who, which tool, how many items. Use the id with revert_change.',
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'default 20, max 100' } } },
  },
  {
    name: 'revert_change',
    description: 'Undo one change made by an agent (an id from list_changes): every item it touched goes back to how it was. Refused for an item someone has changed again since, unless force is true (which overwrites their later edit).',
    input_schema: { type: 'object', properties: { change_id: { type: 'string' }, force: { type: 'boolean' } }, required: ['change_id'] },
  },
  HEALTH_DEF,
]

export const AGENT_TOOLS: ToolDef[] = [...TOOL_DEFS.filter((t) => !BROWSER_ONLY.has(t.name)), ...SERVER_TOOLS]

export async function runTool(c: Caller, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (BROWSER_ONLY.has(name)) return { error: `"${name}" is not available to agents; use list_changes and revert_change` }
  if (name === 'list_changes') {
    const n = Math.min(Math.max(Number(args.limit) || 20, 1), 100)
    const snap = await db.collection(`workspaces/${c.wid}/agentLog`).orderBy('at', 'desc').limit(n).get()
    return snap.docs.map((d) => { const x = d.data(); return { change_id: d.id, at: new Date(x.at).toISOString(), by: x.byName, tool: x.tool, items: (x.changes ?? []).length, reverted_by: x.revertedBy ?? null, revert_of: x.revertOf ?? null, revertable: x.revertable !== false } })
  }
  return serial(async () => {
    const base = await load(c)
    hydrate(c, base)
    if (name === 'project_health') return health(args)
    if (name === 'revert_change') return revert(c, base, args)
    if (!AGENT_TOOLS.some((t) => t.name === name)) return { error: `Unknown tool "${name}"` }
    const result = callTool(name, args) as { error?: string } | undefined
    const changes = diff(base)
    if (result && typeof result === 'object' && 'error' in result) return result // a failed tool writes nothing
    if (!changes.length && name !== 'mention_teammate') return result
    authorize(c, changes)
    const change_id = await commit(c, base, changes, { tool: name, args })
    return change_id ? { result, change_id, changed_items: changes.length } : result
  })
}

async function revert(c: Caller, base: Awaited<ReturnType<typeof load>>, args: Record<string, unknown>): Promise<unknown> {
  const id = String(args.change_id ?? '')
  if (!id) return { error: '"change_id" is required' }
  const log = await db.doc(`workspaces/${c.wid}/agentLog/${id}`).get()
  const x = log.data() as { changes?: Change[]; revertedBy?: string | null; revertable?: boolean } | undefined
  if (!x) return { error: `No change ${id}` }
  if (x.revertedBy) return { error: `Change ${id} was already reverted by ${x.revertedBy}` }
  if (x.revertable === false) return { error: `Change ${id} carried large images and was logged without its contents, so it cannot be reverted automatically` }
  const els = new Map(base.elements.map((e) => [e.id, e]))
  const now = (ch: Change) => (ch.store === 'n' ? base.nodes[ch.id] : els.get(ch.id)) ?? null
  const moved = (x.changes ?? []).filter((ch) => !same(now(ch), ch.after))
  if (moved.length && args.force !== true) return { error: `${moved.length} item(s) were changed again after ${id}; pass force:true to overwrite those later edits`, items: moved.map((m) => m.id) }
  const changes: Change[] = (x.changes ?? []).map((ch) => ({ store: ch.store, id: ch.id, before: now(ch), after: ch.before }))
  authorize(c, changes)
  apply(changes)
  const change_id = await commit(c, base, changes, { tool: 'revert_change', args, revertOf: id })
  return { reverted: id, change_id, changed_items: changes.length }
}
