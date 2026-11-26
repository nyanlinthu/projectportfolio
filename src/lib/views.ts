import { BoardView, ChildMap, PRIORITIES, STATUSES } from '@/lib/board'
import { BoardNode, Priority } from '@/types'

// Other ways of looking at the same cards. Nothing here stores anything: a view is a different arrangement of
// the work items that already exist, so changing a status on the board or a date for the timeline changes the
// one real task, and the tree shows it too.

export type NodeViewMode = 'tree' | 'board-project' | 'board-milestone' | 'board-priority' | 'timeline'
export const VIEW_MODES: { id: NodeViewMode; label: string }[] = [
  { id: 'tree', label: 'Tree' },
  { id: 'board-project', label: 'Board · by project' },
  { id: 'board-milestone', label: 'Board · by milestone' },
  { id: 'board-priority', label: 'Board · by priority' },
  { id: 'timeline', label: 'Timeline' },
]

const under = (id: string, kids: ChildMap): BoardNode[] => (kids.get(id) ?? []).flatMap((n) => [n, ...under(n.id, kids)])
const isLeafTask = (n: BoardNode, kids: ChildMap): boolean => n.kind === 'task' && !(kids.get(n.id)?.length)
const ancestor = (n: BoardNode, kind: BoardNode['kind'], nodes: Record<string, BoardNode>): BoardNode | undefined => {
  for (let cur: BoardNode | undefined = n; cur; cur = cur.parentId ? nodes[cur.parentId] : undefined) if (cur.kind === kind) return cur
  return undefined
}

// ---- board: status columns, with a lane per project or per milestone ---------------------------------------------
export interface BoardLane { id: string; title: string; context: string; tasks: BoardNode[] }
export interface BoardColumnDef { id: string; name: string; color: string; hint?: string }
/**
 * What the columns of a board mean. One board component draws any axis: the axis says which columns there are,
 * which one a task is in, and what changes on the real task when it is put in another.
 */
export interface BoardAxis {
  id: 'status' | 'priority'
  columns: (tasks: BoardNode[]) => BoardColumnDef[]
  of: (t: BoardNode) => string
  move: (t: BoardNode, to: string) => Partial<BoardNode>
}

export const STATUS_AXIS: BoardAxis = {
  id: 'status',
  // Blocked only takes up a column when something is actually blocked
  columns: (tasks) => { const anyBlocked = tasks.some((t) => t.status === 'blocked'); return STATUSES.filter((s) => s.id !== 'blocked' || anyBlocked) },
  of: (t) => t.status ?? 'backlog',
  move: (_t, to) => ({ status: to as BoardNode['status'] }),
}

const UNSORTED: BoardColumnDef = { id: 'none', name: 'Not sorted', hint: 'Drag into a column', color: '#8A93A6' }
const DONE = STATUSES.find((s) => s.id === 'done') as BoardColumnDef
/**
 * The Eisenhower matrix as a board. The four dispositions are the task's `priority`; Done is its status, so a
 * finished task sits in Done whatever its priority was and goes back there when reopened. Unsorted tasks get a
 * column of their own only while there are any.
 */
export const PRIORITY_AXIS: BoardAxis = {
  id: 'priority',
  columns: (tasks) => [...(tasks.some((t) => PRIORITY_AXIS.of(t) === 'none') ? [UNSORTED] : []), ...PRIORITIES, DONE],
  of: (t) => (t.status === 'done' ? 'done' : t.priority ?? 'none'),
  move: (t, to) => (to === 'done' ? { status: 'done' } : {
    ...(to === PRIORITY_AXIS.of(t) ? {} : { priority: to === 'none' ? undefined : (to as Priority) }),
    ...(t.status === 'done' ? { status: 'backlog' } : {}),
  }),
}

export function boardLanes(focus: BoardNode, nodes: Record<string, BoardNode>, kids: ChildMap, by: 'project' | 'milestone'): BoardLane[] {
  const lanes = new Map<string, BoardLane>()
  for (const t of under(focus.id, kids)) {
    if (!isLeafTask(t, kids)) continue
    const owner = ancestor(t, by, nodes)
    const key = owner?.id ?? '—'
    const project = ancestor(t, 'project', nodes)
    if (!lanes.has(key)) lanes.set(key, { id: key, title: owner?.title ?? 'Ungrouped', context: by === 'milestone' ? project?.title ?? '' : '', tasks: [] })
    lanes.get(key)?.tasks.push(t)
  }
  // every project / milestone in scope gets a lane, even an empty one, so there is somewhere to add the first task
  for (const n of [focus, ...under(focus.id, kids)]) {
    if (n.kind === by && !lanes.has(n.id)) lanes.set(n.id, { id: n.id, title: n.title, context: by === 'milestone' ? ancestor(n, 'project', nodes)?.title ?? '' : '', tasks: [] })
  }
  return [...lanes.values()]
}
/** The small line under a task on the board: where it belongs, at the level the lanes do not already show. */
export const taskContext = (t: BoardNode, nodes: Record<string, BoardNode>, by: 'project' | 'milestone'): string =>
  (by === 'project' ? ancestor(t, 'milestone', nodes)?.title : t.parentId && nodes[t.parentId]?.kind === 'task' ? nodes[t.parentId].title : '') ?? ''

// ---- timeline -----------------------------------------------------------------------------------------------------
export interface TimelineRow {
  node: BoardNode
  depth: number
  /** "YYYY-MM-DD"; a container spans its dated tasks. Absent when nothing under it has dates. */
  start?: string
  end?: string
  pct: number
  color: string
  label: string
  expandable: boolean
}

function span(n: BoardNode, kids: ChildMap): [string, string] | null {
  const mine = n.start || n.end ? ([n.start ?? n.end, n.end ?? n.start] as [string, string]) : null
  const below = (kids.get(n.id) ?? []).map((k) => span(k, kids)).filter((s): s is [string, string] => !!s)
  const all = mine ? [mine, ...below] : below
  if (!all.length) return null
  return [all.map((s) => s[0]).sort()[0], all.map((s) => s[1]).sort().reverse()[0]]
}

export function timelineRows(focus: BoardNode, kids: ChildMap, board: BoardView, open: Set<string>): { rows: TimelineRow[]; undated: BoardNode[] } {
  const rows: TimelineRow[] = []
  const walk = (n: BoardNode, depth: number): void => {
    const s = span(n, kids), v = board.view(n), children = kids.get(n.id) ?? []
    rows.push({ node: n, depth, start: s?.[0], end: s?.[1], pct: n.kind === 'task' && v.leaf ? (n.status === 'done' ? 100 : 0) : v.pct, color: v.color, label: v.label, expandable: children.length > 0 })
    if (open.has(n.id)) children.forEach((c) => walk(c, depth + 1))
  }
  // from the portfolio the rows are its projects; inside anything else, that card leads the list
  if (focus.kind === 'portfolio') (kids.get(focus.id) ?? []).forEach((c) => walk(c, 0)); else walk(focus, 0)
  return { rows, undated: under(focus.id, kids).filter((t) => isLeafTask(t, kids) && !t.start && !t.end) }
}

const DAY = 86_400_000
export const dayOf = (ymd: string): number => Math.round(Date.parse(`${ymd}T00:00:00Z`) / DAY)
export const ymdOf = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10)
