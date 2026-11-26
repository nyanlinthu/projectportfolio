import { useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'

// One stacking order for everything on the board: cards and free-form elements share the same `z`.
// Anything without a z yet counts as 0; among equals, elements sit under cards, then older under newer.

export type StackOp = 'front' | 'forward' | 'backward' | 'back'

/** A z above everything that exists. New things, dropped things and pressed cards get this. */
export function topZ(): number {
  let max = 0
  for (const n of Object.values(useBoardStore.getState().nodes)) if ((n.z ?? 0) > max) max = n.z ?? 0
  for (const e of useElementStore.getState().elements) if ((e.z ?? 0) > max) max = e.z ?? 0
  return max + 1
}

/**
 * Move one item within the stack of what is currently on the board. `shownIds` limits "one step" to things
 * you can actually see, so a step never disappears behind something on another part of the portfolio.
 */
export function restack(id: string, op: StackOp, shownIds: Set<string>): void {
  const nodes = Object.values(useBoardStore.getState().nodes)
  const els = useElementStore.getState().elements.filter((e) => e.kind !== 'connector' && e.kind !== 'stroke')
  const all = [
    ...els.map((e, i) => ({ id: e.id, z: e.z ?? 0, tie: i, node: false })),
    ...nodes.map((n, i) => ({ id: n.id, z: n.z ?? 0, tie: 1e6 + i, node: true })),
  ].sort((a, b) => a.z - b.z || a.tie - b.tie)
  const at = all.findIndex((x) => x.id === id)
  if (at < 0) return
  const [me] = all.splice(at, 1)
  let to = at
  if (op === 'front') to = all.length
  else if (op === 'back') to = 0
  else if (op === 'forward') { to = at; while (to < all.length && !shownIds.has(all[to].id)) to++; to = Math.min(all.length, to + 1) }
  else { to = at; while (to > 0 && !shownIds.has(all[to - 1].id)) to--; to = Math.max(0, to - 1) }
  all.splice(to, 0, me)
  // renumber from 1 so nothing ever goes negative (which would slip behind the board itself)
  const nz: Record<string, number> = {}, ez: Record<string, number> = {}
  all.forEach((x, i) => { (x.node ? nz : ez)[x.id] = i + 1 })
  useBoardStore.getState().setZ(nz)
  useElementStore.getState().setZ(ez)
}
