import type { ToolDef } from '@/ai/tools'
import { deriveBoard, KIND_LABEL } from '@/lib/board'
import { ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import type { BoardNode } from '@/types'

/**
 * project_health: what needs attention, computed from the same roll-up the board shows (canvas-kit rollup via
 * lib/board.ts), so the agent explains facts instead of inventing them.
 *   - bottlenecks: open tasks that the most other open work waits on (follows `after`, finish-to-start, transitively)
 *   - longest open dependency chain: where the schedule is most exposed
 *   - blocked / late / out-of-sequence tasks, stale "doing" tasks, open tasks with nobody on them
 *   - per-person load, and every project/milestone that is not on track
 */
export const HEALTH_DEF: ToolDef = {
  name: 'project_health',
  description: 'Diagnose the portfolio or one project: bottlenecks (open tasks the most other work waits on), the longest open dependency chain, blocked/late/out-of-sequence tasks, stale in-progress tasks, unassigned work, per-person load, and milestones/projects not on track. Computed from the board, not estimated. Call it before answering "where are we stuck / what needs attention".',
  input_schema: { type: 'object', properties: {
    root_id: { type: 'string', description: 'A project or milestone id; default the whole portfolio.' },
    stale_days: { type: 'number', description: 'A "doing" task untouched this many days counts as stale. Default 7.' },
  } },
}

export function health(args: Record<string, unknown>): unknown {
  const nodes = useBoardStore.getState().nodes
  const rootId = typeof args.root_id === 'string' && args.root_id ? args.root_id : ROOT_ID
  if (!nodes[rootId]) return { error: `No work item with id ${rootId}` }
  const staleDays = Number(args.stale_days) > 0 ? Number(args.stale_days) : 7
  const board = deriveBoard(nodes)
  const st = board.r.taskState

  const under = new Set<string>()
  const walk = (id: string): void => { under.add(id); for (const k of board.kids.get(id) ?? []) walk(k.id) }
  walk(rootId)
  const tasks = [...under].map((id) => nodes[id]).filter((n): n is BoardNode => !!n && n.kind === 'task' && !(board.kids.get(n.id)?.length))
  const open = tasks.filter((t) => st[t.id] !== 'done')
  const openIds = new Set(open.map((t) => t.id))

  const path = (n: BoardNode): string => { const out: string[] = []; let cur: BoardNode | undefined = n; for (let i = 0; cur && i < 60; i++) { out.unshift(cur.title); cur = cur.parentId ? nodes[cur.parentId] : undefined } return out.slice(1).join(' › ') }
  const brief = (t: BoardNode) => ({ id: t.id, title: t.title, where: path(t), state: st[t.id], assignee: t.assignee ?? null, planned_end: t.end ?? null, ...(board.r.lateDays[t.id] ? { days_late: board.r.lateDays[t.id] } : {}) })

  // successors among open tasks (after = predecessors)
  const succ = new Map<string, string[]>()
  for (const t of open) for (const p of t.after ?? []) if (openIds.has(p)) succ.set(p, [...(succ.get(p) ?? []), t.id])
  const downstream = (id: string): number => { const seen = new Set<string>(); const go = (x: string): void => { for (const s of succ.get(x) ?? []) if (!seen.has(s)) { seen.add(s); go(s) } }; go(id); return seen.size }
  const bottlenecks = open.map((t) => ({ t, waiting: downstream(t.id) })).filter((x) => x.waiting > 0)
    .sort((a, b) => b.waiting - a.waiting).slice(0, 8).map((x) => ({ ...brief(x.t), open_tasks_waiting_on_it: x.waiting }))

  // longest chain of open tasks linked by `after`
  const memo = new Map<string, string[]>()
  const chainFrom = (id: string, depth = 0): string[] => {
    if (memo.has(id)) return memo.get(id)!
    if (depth > 200) return [id]
    let best: string[] = []
    for (const s of succ.get(id) ?? []) { const c = chainFrom(s, depth + 1); if (c.length > best.length) best = c }
    const out = [id, ...best]; memo.set(id, out); return out
  }
  const longest = open.reduce<string[]>((best, t) => { const c = chainFrom(t.id); return c.length > best.length ? c : best }, [])

  const now = Date.now()
  const stale = open.filter((t) => st[t.id] === 'doing' && t.updatedAt && now - t.updatedAt > staleDays * 86_400_000)
    .map((t) => ({ ...brief(t), untouched_days: Math.floor((now - t.updatedAt) / 86_400_000) }))
  const byState = (s: string) => open.filter((t) => st[t.id] === s).map(brief)

  const load = new Map<string, { open: number; doing: number; blocked_or_late: number }>()
  for (const t of open) {
    const who = t.assignee || '(unassigned)'
    const l = load.get(who) ?? { open: 0, doing: 0, blocked_or_late: 0 }
    l.open++; if (st[t.id] === 'doing') l.doing++; if (st[t.id] === 'blocked' || st[t.id] === 'late') l.blocked_or_late++
    load.set(who, l)
  }

  const containers = [...under].map((id) => nodes[id]).filter((n): n is BoardNode => !!n && (n.kind === 'project' || n.kind === 'milestone'))
    .map((n) => ({ n, v: board.view(n) })).filter((x) => x.v.total && x.v.label !== 'On track')
    .map(({ n, v }) => ({ id: n.id, kind: KIND_LABEL[n.kind], title: n.title, where: path(n), health: v.label, progress_pct: v.pct, tasks_done: v.done, tasks_total: v.total, planned_end: n.end ?? null }))

  const rootView = board.view(nodes[rootId])
  return {
    scope: { id: rootId, title: nodes[rootId].title, progress_pct: rootView.pct, health: rootView.label, tasks_open: open.length, tasks_total: tasks.length },
    bottlenecks,
    longest_open_dependency_chain: longest.length > 1 ? longest.map((id) => brief(nodes[id])) : [],
    blocked: byState('blocked'), late: byState('late'), out_of_sequence: byState('out-of-sequence'),
    stale_in_progress: stale,
    unassigned_open: open.filter((t) => !t.assignee).length,
    ready_to_start: board.r.ready.filter((id) => openIds.has(id)).slice(0, 10).map((id) => brief(nodes[id])),
    load_by_person: Object.fromEntries([...load].sort((a, b) => b[1].open - a[1].open)),
    not_on_track: containers,
  }
}
