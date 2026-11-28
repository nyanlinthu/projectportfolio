import { FieldValue } from 'firebase-admin/firestore'
import { db } from './firestore'
import type { Caller } from './auth'
import { takeMentions } from './context'
import { elementAnc, treeAnc } from '@/lib/anc'
import { merge3 } from '@/lib/merge'
import { clearHistory } from '@/lib/history'
import { useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'
import { useSession, type Member } from '@/store/useSession'
import type { BoardElement, BoardNode } from '@/types'

/**
 * One agent call against one workspace:
 *   load the workspace from Firestore -> put it into the app's own stores -> run the app's own tool
 *   -> compare the stores before/after -> check the caller may make those changes -> write them (merged with
 *   anything a teammate changed meanwhile, stamped with `anc`) -> record them in the change log.
 *
 * Because the tools run on the same stores and derivations as the web app, an agent can only do what a person
 * could do in the app, and both always agree on roll-up, formulas and search.
 *
 * The stores are module-level singletons, so calls are strictly one at a time (`serial`).
 */
type Item = BoardNode | BoardElement
export type Change = { store: 'n' | 'e'; id: string; before: Item | null; after: Item | null }
type Stored<T> = T & { anc?: string[] }

let chain: Promise<unknown> = Promise.resolve()
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

const strip = <T extends object>(raw: Stored<T>): T => { const { anc: _a, ...rest } = raw; return rest as T }
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
export const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b)

export interface Loaded { nodes: Record<string, BoardNode>; elements: BoardElement[]; members: Member[] }

export async function load(c: Caller): Promise<Loaded> {
  const ws = db.collection('workspaces').doc(c.wid)
  const [n, e, m] = await Promise.all([ws.collection('nodes').get(), ws.collection('elements').get(), ws.collection('members').get()])
  const nodes: Record<string, BoardNode> = {}
  for (const d of n.docs) nodes[d.id] = strip(d.data() as Stored<BoardNode>)
  return { nodes, elements: e.docs.map((d) => strip(d.data() as Stored<BoardElement>)), members: m.docs.map((d) => d.data() as Member) }
}

/** Put a loaded workspace into the app's stores, as if `c` had opened it in the browser. */
export function hydrate(c: Caller, w: Loaded): void {
  clearHistory()
  useBoardStore.setState({ nodes: structuredClone(w.nodes), selectedId: null })
  useElementStore.setState({ elements: structuredClone(w.elements) })
  useSession.setState({
    status: 'ready', user: { uid: c.uid, email: c.email, name: c.name }, workspaceId: c.wid,
    workspaces: [{ id: c.wid, name: c.wsName, role: c.role, scopes: [] }], members: w.members, invites: [], error: null,
  })
  takeMentions()
}

/** Put changes into the stores (revert does this before commit, so `anc` is stamped from the restored tree). */
export function apply(changes: Change[]): void {
  const nodes = { ...useBoardStore.getState().nodes }
  let els = [...useElementStore.getState().elements]
  for (const ch of changes) {
    if (ch.store === 'n') { if (ch.after) nodes[ch.id] = ch.after as BoardNode; else delete nodes[ch.id] }
    else { els = els.filter((e) => e.id !== ch.id); if (ch.after) els.push(ch.after as BoardElement) }
  }
  useBoardStore.setState({ nodes })
  useElementStore.setState({ elements: els })
}

export function diff(w: Loaded): Change[] {
  const out: Change[] = []
  const nodes = useBoardStore.getState().nodes
  for (const id of new Set([...Object.keys(w.nodes), ...Object.keys(nodes)])) {
    const before = w.nodes[id] ?? null, after = nodes[id] ?? null
    if (!same(before, after)) out.push({ store: 'n', id, before, after })
  }
  const was = new Map(w.elements.map((e) => [e.id, e])), now = new Map(useElementStore.getState().elements.map((e) => [e.id, e]))
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const before = was.get(id) ?? null, after = now.get(id) ?? null
    if (!same(before, after)) out.push({ store: 'e', id, before, after })
  }
  return out
}

const OPERATOR_KEYS = new Set(['status', 'updatedAt', 'actualStart', 'actualEnd'])
/** The write half of firestore.rules, for a caller the rules cannot see (the admin SDK skips them). */
export function authorize(c: Caller, changes: Change[]): void {
  if (c.role === 'owner' || c.role === 'manager') return
  for (const ch of changes) {
    const b = ch.before as BoardNode | null, a = ch.after as BoardNode | null
    const keys = b && a ? Object.keys({ ...b, ...a }).filter((k) => !same((b as never)[k], (a as never)[k])) : []
    const ok = ch.store === 'n' && b && a && b.kind === 'task' && b.assigneeUid === c.uid && keys.every((k) => OPERATOR_KEYS.has(k))
    if (!ok) throw new Error('Your role in this workspace (operator) lets your agent change only the status of tasks assigned to you')
  }
}

const MAX_CHANGES = 400 // one Firestore transaction holds 500 writes; the log entry and mentions need room too

/** Write `changes` (computed against `base`), merged with anything changed on the server since `base` was read. */
export async function commit(c: Caller, _base: Loaded, changes: Change[], meta: { tool: string; args: unknown; revertOf?: string }): Promise<string | null> {
  const mentions = takeMentions()
  if (!changes.length && !mentions.length) return null
  if (changes.length > MAX_CHANGES) throw new Error(`That would change ${changes.length} items at once; the limit is ${MAX_CHANGES}. Do it in smaller steps.`)
  const ws = db.collection('workspaces').doc(c.wid)
  const nodesNow = useBoardStore.getState().nodes, elsNow = useElementStore.getState().elements
  const known = (id: string): string[] | null => (!nodesNow[id] ? [id] : null)
  const logRef = ws.collection('agentLog').doc()
  await db.runTransaction(async (tx) => {
    const refs = changes.map((ch) => ws.collection(ch.store === 'n' ? 'nodes' : 'elements').doc(ch.id))
    const cur = refs.length ? await tx.getAll(...refs) : []
    const written: Change[] = []
    changes.forEach((ch, i) => {
      const remote = cur[i].exists ? strip(cur[i].data() as Stored<Item>) : null
      if (!ch.after) { if (remote) tx.delete(refs[i]); written.push({ ...ch, before: remote }); return }
      // a teammate changed it since we read it: keep both sides, field by field (same merge as the web app)
      const out = remote && ch.before && !same(remote, ch.before) ? merge3(ch.before, ch.after, remote) : ch.after
      const anc = ch.store === 'n' ? treeAnc(ch.id, nodesNow, known) : elementAnc(out as BoardElement, nodesNow, elsNow, known)
      tx.set(refs[i], { ...out, anc })
      written.push({ ...ch, before: remote, after: out })
    })
    for (const m of mentions) tx.set(db.collection('users').doc(m.to).collection('inbox').doc(m.id), m.data)
    const entry = { at: Date.now(), by: c.uid, byName: c.name, tool: meta.tool, args: JSON.stringify(meta.args ?? {}).slice(0, 2000), revertOf: meta.revertOf ?? null, changes: written, revertedBy: null }
    // Firestore documents top out at 1 MiB; a change carrying large images is logged without its contents
    const big = Buffer.byteLength(JSON.stringify(entry)) > 900_000
    tx.set(logRef, big ? { ...entry, changes: written.map((w) => ({ store: w.store, id: w.id, before: null, after: null })), revertable: false } : { ...entry, revertable: true })
    if (meta.revertOf) tx.update(ws.collection('agentLog').doc(meta.revertOf), { revertedBy: logRef.id, revertedAt: FieldValue.serverTimestamp() })
  })
  return logRef.id
}
