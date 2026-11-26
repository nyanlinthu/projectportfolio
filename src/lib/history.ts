import { useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'
import { BoardElement, BoardNode } from '@/types'

/**
 * Undo / redo for everything on the board: work items and free-form elements alike.
 *
 * It records what THIS person changed, one item at a time (before and after), never whole-board snapshots, so
 * undoing does not roll back what a teammate did in the meantime. Changes that arrive from the server are not
 * recorded (cloud.ts brackets them with pauseHistory). An undo is an ordinary local change, so it syncs like one.
 * Changes made within a short burst (typing a title, a delete plus its clean-up) are one step.
 */
type Change = { store: 'n' | 'e'; id: string; before?: BoardNode | BoardElement; after?: BoardNode | BoardElement }
type Step = { at: number; changes: Map<string, Change> }

const BURST_MS = 600, LIMIT = 200
let undoStack: Step[] = [], redoStack: Step[] = []
let paused = 0, replaying = false

export const pauseHistory = (on: boolean): void => { paused = Math.max(0, paused + (on ? 1 : -1)) }
export const clearHistory = (): void => { undoStack = []; redoStack = [] }
export const canUndo = (): boolean => undoStack.length > 0
export const canRedo = (): boolean => redoStack.length > 0

function record(changes: Change[]): void {
  if (!changes.length) return
  const now = Date.now()
  let step = undoStack[undoStack.length - 1]
  if (!step || now - step.at > BURST_MS) { step = { at: now, changes: new Map() }; undoStack.push(step); if (undoStack.length > LIMIT) undoStack.shift() }
  step.at = now
  for (const c of changes) {
    const key = c.store + c.id, had = step.changes.get(key)
    step.changes.set(key, had ? { ...had, after: c.after } : c) // keep the earliest "before" of the burst
  }
  redoStack = []
}

// stacking order alone (bringing something to the front by touching it) is not worth an undo step
const sameButZ = (a: object, b: object): boolean => {
  const ka = Object.keys(a).filter((k) => k !== 'z'), kb = Object.keys(b).filter((k) => k !== 'z')
  return ka.length === kb.length && ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
}

useBoardStore.subscribe((s, p) => {
  if (paused || replaying || s.nodes === p.nodes) return
  const out: Change[] = []
  for (const id in s.nodes) if (s.nodes[id] !== p.nodes[id] && !(p.nodes[id] && sameButZ(s.nodes[id], p.nodes[id]))) out.push({ store: 'n', id, before: p.nodes[id], after: s.nodes[id] })
  for (const id in p.nodes) if (!s.nodes[id]) out.push({ store: 'n', id, before: p.nodes[id] })
  record(out)
})
useElementStore.subscribe((s, p) => {
  if (paused || replaying || s.elements === p.elements) return
  const was = new Map(p.elements.map((e) => [e.id, e]))
  const out: Change[] = []
  for (const e of s.elements) { const b = was.get(e.id); if (b !== e && !(b && sameButZ(e, b))) out.push({ store: 'e', id: e.id, before: b, after: e }); was.delete(e.id) }
  for (const b of was.values()) out.push({ store: 'e', id: b.id, before: b })
  record(out)
})

function apply(step: Step, side: 'before' | 'after'): void {
  const nodes = { ...useBoardStore.getState().nodes }
  let els = useElementStore.getState().elements
  let nodesChanged = false, elsChanged = false
  for (const c of step.changes.values()) {
    const v = c[side]
    if (c.store === 'n') { nodesChanged = true; if (v) nodes[c.id] = v as BoardNode; else delete nodes[c.id] }
    else {
      elsChanged = true
      const rest = els.filter((e) => e.id !== c.id)
      els = v ? (els.some((e) => e.id === c.id) ? els.map((e) => (e.id === c.id ? (v as BoardElement) : e)) : [...rest, v as BoardElement]) : rest
    }
  }
  replaying = true
  try {
    if (nodesChanged) useBoardStore.setState((s) => ({ nodes, selectedId: s.selectedId && nodes[s.selectedId] ? s.selectedId : null }))
    if (elsChanged) useElementStore.setState({ elements: els })
  } finally { replaying = false }
}

/** Take back the last thing you did. Returns false when there is nothing to undo. */
export function undo(): boolean {
  const step = undoStack.pop()
  if (!step) return false
  apply(step, 'before'); redoStack.push(step)
  return true
}
/** Do again what was just undone. */
export function redo(): boolean {
  const step = redoStack.pop()
  if (!step) return false
  apply(step, 'after'); undoStack.push({ ...step, at: 0 }) // at: 0 so the next edit starts its own step
  return true
}
