import { BoardNode } from '@/types'
import { todayYmd } from '@/lib/board'

// Planned vs actual. Planned = start/end (set ahead, by anyone planning). Actual = when the work really started and
// finished. Pure; the store calls stampActual on every update so all ways of changing status behave the same.

const DAY = 86_400_000
const dayOf = (ymd: string): number => Math.round(Date.parse(`${ymd}T00:00:00Z`) / DAY)

/** What a status change does to the actual dates. Explicit actual dates in the patch always win. */
export function stampActual(n: BoardNode, patch: Partial<BoardNode>): Partial<BoardNode> {
  if (!patch.status || patch.status === n.status || n.kind !== 'task') return {}
  const today = todayYmd()
  const out: Partial<BoardNode> = {}
  const started = 'actualStart' in patch ? patch.actualStart : n.actualStart
  if ((patch.status === 'doing' || patch.status === 'done') && !started) out.actualStart = today
  if (patch.status === 'done' && !('actualEnd' in patch)) out.actualEnd = n.actualEnd ?? today
  if (patch.status !== 'done' && n.actualEnd && !('actualEnd' in patch)) out.actualEnd = undefined // reopened: not finished
  if (patch.status === 'backlog' && n.actualStart && !('actualStart' in patch)) out.actualStart = undefined // back to not started
  return out
}

export type Span = { start?: string; end?: string }

/** Planned window: the card's own, else the span of what is planned under it. */
export function plannedSpan(id: string, nodes: Record<string, BoardNode>, kids: Map<string, BoardNode[]>): Span {
  const n = nodes[id]
  if (n?.start || n?.end) return { start: n.start ?? n.end, end: n.end ?? n.start }
  return rollSpan(id, kids, (t) => ({ start: t.start ?? t.end, end: t.end ?? t.start }), false)
}

/** Actual window: a task's own; a container's runs from its first started task to its last finished one, and only
 *  has an end once every task under it is finished. */
export function actualSpan(id: string, nodes: Record<string, BoardNode>, kids: Map<string, BoardNode[]>): Span {
  const n = nodes[id]
  if (!n) return {}
  if (!(kids.get(id)?.length)) return { start: n.actualStart, end: n.actualEnd }
  return rollSpan(id, kids, (t) => ({ start: t.actualStart, end: t.actualEnd }), true)
}

function rollSpan(id: string, kids: Map<string, BoardNode[]>, of: (t: BoardNode) => Span, needAllEnds: boolean): Span {
  const leaves: BoardNode[] = []
  const walk = (pid: string): void => { for (const k of kids.get(pid) ?? []) { if (kids.get(k.id)?.length) walk(k.id); else leaves.push(k) } }
  walk(id)
  const s = leaves.map(of)
  const starts = s.map((x) => x.start).filter(Boolean) as string[]
  const ends = s.map((x) => x.end).filter(Boolean) as string[]
  return {
    start: starts.sort()[0],
    end: needAllEnds && ends.length < leaves.length ? undefined : ends.sort().reverse()[0],
  }
}

/** Days late (+) or early (−) of actual against planned, for start and finish. Finish compares against today while
 *  the work is still open and already past its planned end. */
export function variance(plan: Span, act: Span, today: string = todayYmd()): { start?: number; end?: number } {
  const out: { start?: number; end?: number } = {}
  if (plan.start && act.start) out.start = dayOf(act.start) - dayOf(plan.start)
  if (plan.end && act.end) out.end = dayOf(act.end) - dayOf(plan.end)
  else if (plan.end && !act.end && today > plan.end) out.end = dayOf(today) - dayOf(plan.end)
  return out
}

export const fmtVar = (d: number | undefined): string =>
  d === undefined ? '' : d === 0 ? 'on time' : d > 0 ? `${d} day${d === 1 ? '' : 's'} late` : `${-d} day${d === -1 ? '' : 's'} early`

/** Would making `pred` come before `succ` close a loop (succ already, directly or not, comes before pred)? */
export function makesLoop(pred: string, succ: string, nodes: Record<string, BoardNode>): boolean {
  if (pred === succ) return true
  const seen = new Set<string>(), stack = [pred]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === succ) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(nodes[id]?.after ?? []))
  }
  return false
}

/** Link `pred` → `succ` (finish-to-start). False when it is already there or would make a loop. */
export function linkPatch(pred: string, succ: string, nodes: Record<string, BoardNode>): string[] | null {
  const n = nodes[succ]
  if (!n || (n.after ?? []).includes(pred) || makesLoop(pred, succ, nodes)) return null
  return [...(n.after ?? []), pred]
}
