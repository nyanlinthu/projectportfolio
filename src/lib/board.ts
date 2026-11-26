import { rollup } from 'canvas-kit'
import type { Health, RollupResult, RPortfolio, RTask, Status, TaskState } from 'canvas-kit'
import { BoardNode, NodeKind, Priority } from '@/types'

// Single source for how the flat whiteboard maps onto canvas-kit's roll-up engine, and for the labels/colours
// every view shows. Views must not recompute progress themselves.

export const HEALTH_COLOR: Record<Health, string> = { 'on-track': '#92A524', 'at-risk': '#D9822B', blocked: '#C0392B' }
export const HEALTH_LABEL: Record<Health, string> = { 'on-track': 'On track', 'at-risk': 'At risk', blocked: 'Blocked' }
export const STATE_COLOR: Record<TaskState, string> = {
  done: '#92A524', doing: '#C9A64B', ready: '#F5EFE2', waiting: '#8A93A6', blocked: '#C0392B', 'out-of-sequence': '#D9822B', late: '#D9822B',
}
export const STATE_LABEL: Record<TaskState, string> = {
  done: 'Done', doing: 'Doing', ready: 'To do', waiting: 'Waiting', blocked: 'Blocked', 'out-of-sequence': 'Out of sequence', late: 'Late',
}
export const STATUSES: { id: Status; name: string; color: string }[] = [
  { id: 'backlog', name: 'To do', color: '#8A93A6' },
  { id: 'doing', name: 'Doing', color: '#C9A64B' },
  { id: 'blocked', name: 'Blocked', color: '#C0392B' },
  { id: 'done', name: 'Done', color: '#92A524' },
]
/** The Eisenhower matrix, left to right. `hint` is the urgent/important reading of each. */
export const PRIORITIES: { id: Priority; name: string; hint: string; color: string }[] = [
  { id: 'urgent', name: 'Urgent · must do', hint: 'Urgent and important', color: '#E5736B' },
  { id: 'plan', name: 'Plan', hint: 'Important, not urgent', color: '#D9822B' },
  { id: 'delegate', name: 'Delegate', hint: 'Urgent, not important', color: '#C9A64B' },
  { id: 'defer', name: 'Defer', hint: 'Neither, for later', color: '#7FB3D5' },
]
export const KIND_LABEL: Record<NodeKind, string> = { portfolio: 'Portfolio', project: 'Project', milestone: 'Milestone', task: 'Task' }
export const KIND_COLOR: Record<NodeKind, string> = { portfolio: '#C9A64B', project: '#D9925B', milestone: '#7FB3D5', task: '#8A93A6' }

/** What the + on a card creates. Tasks can nest (sub-tasks / work packages) to any depth. */
export const childKind = (k: NodeKind): NodeKind => (k === 'portfolio' ? 'project' : k === 'project' ? 'milestone' : 'task')

/** One tap on a task's status pill. Blocked is set from the sheet, not the cycle. */
export const nextStatus = (s: Status): Status => (s === 'backlog' ? 'doing' : s === 'doing' ? 'done' : 'backlog')

export const todayYmd = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type ChildMap = Map<string, BoardNode[]>
/** When a card sits on the timeline: its own planned/actual start, else the earliest date found under it. */
export function dateKey(n: BoardNode, kids: ChildMap, depth = 0): string | undefined {
  const own = n.start ?? n.end ?? n.actualStart ?? n.actualEnd
  if (own) return own
  if (depth > 20) return undefined
  const found = (kids.get(n.id) ?? []).map((c) => dateKey(c, kids, depth + 1)).filter(Boolean) as string[]
  return found.sort()[0]
}
/** Left = oldest, right = newest. Cards without any date are left to the other tie-breakers (position, then creation). */
export const byDate = (kids: ChildMap) => (a: BoardNode, b: BoardNode): number => {
  const da = dateKey(a, kids), db = dateKey(b, kids)
  return da && db && da !== db ? (da < db ? -1 : 1) : 0
}
export function childMap(nodes: Record<string, BoardNode>): ChildMap {
  const m: ChildMap = new Map()
  for (const n of Object.values(nodes)) if (n.parentId) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n])
  for (const list of m.values()) list.sort((a, b) => a.createdAt - b.createdAt)
  return m
}

const LOOSE = '~'

function toRollup(nodes: Record<string, BoardNode>, kids: ChildMap): RPortfolio {
  const tasksUnder = (id: string, parentTask?: string): RTask[] =>
    (kids.get(id) ?? []).filter((n) => n.kind === 'task').flatMap((t) => [
      { id: t.id, status: t.status ?? 'backlog', weight: t.weight, after: t.after, start: t.start, end: t.end, parent: parentTask },
      ...tasksUnder(t.id, t.id),
    ])
  const projects = Object.values(nodes).filter((n) => n.kind === 'project')
  // Someone who was given a single milestone or task (card-level access) has it hanging straight off the
  // portfolio card, with no project in between. It still rolls up: as a project of its own.
  const loose = Object.values(nodes).filter((n) => (n.kind === 'milestone' || n.kind === 'task') && nodes[n.parentId ?? '']?.kind === 'portfolio')
  return {
    projects: [...projects.map((p) => ({
      id: p.id,
      milestones: (kids.get(p.id) ?? []).filter((m) => m.kind === 'milestone').map((m) => ({ id: m.id, tasks: tasksUnder(m.id) })),
    })), ...loose.map((n) => ({
      id: LOOSE + n.id,
      milestones: [n.kind === 'milestone' ? { id: n.id, tasks: tasksUnder(n.id) }
        : { id: LOOSE + n.id, tasks: [{ id: n.id, status: n.status ?? 'backlog', weight: n.weight, after: n.after, start: n.start, end: n.end }, ...tasksUnder(n.id, n.id)] }],
    }))],
  }
}

/** What a card shows. Everything here is derived; none of it is stored. */
export interface NodeView {
  pct: number
  done: number
  total: number
  color: string
  label: string
  /** a task with no sub-tasks: its status is set directly by the operator */
  leaf: boolean
}

export interface BoardView { r: RollupResult; kids: ChildMap; view: (n: BoardNode) => NodeView }

export function deriveBoard(nodes: Record<string, BoardNode>, asOf: string = todayYmd()): BoardView {
  const kids = childMap(nodes)
  const r = rollup(toRollup(nodes, kids), { asOf })
  const projectOf = (n: BoardNode): string | undefined => {
    let cur: BoardNode | undefined = n
    while (cur && cur.kind !== 'project') cur = cur.parentId ? nodes[cur.parentId] : undefined
    return cur?.id
  }
  const view = (n: BoardNode): NodeView => {
    if (n.kind === 'task') {
      const st: TaskState = r.taskState[n.id] ?? 'ready'
      const leaf = !(kids.get(n.id)?.length)
      return { pct: Math.round((r.credit[n.id] ?? 0) * 100), done: 0, total: 0, color: STATE_COLOR[st], label: STATE_LABEL[st], leaf }
    }
    const pg = n.kind === 'portfolio' ? r.portfolio
      : n.kind === 'project' ? r.projects[n.id]
      : (r.projects[projectOf(n) ?? ''] ?? r.projects[LOOSE + n.id])?.milestones[n.id]
    if (!pg) return { pct: 0, done: 0, total: 0, color: HEALTH_COLOR['on-track'], label: 'No tasks yet', leaf: false }
    return { pct: pg.pct, done: pg.done, total: pg.total, color: HEALTH_COLOR[pg.health], label: pg.total ? HEALTH_LABEL[pg.health] : 'No tasks yet', leaf: false }
  }
  return { r, kids, view }
}

const SLOT_W = 204, LEVEL_H = 150

/**
 * Where a new child's editor opens: one level below its parent, to the right of the right-most sibling, at every
 * level, so the board reads as a tree. It follows the user's own arrangement (siblings that were dragged elsewhere
 * pull the next one with them) and is only a suggestion; the card can be moved anywhere afterwards.
 */
export function nextChildSpot(parent: BoardNode, kids: ChildMap, wrap = COMPACT_MAX): { x: number; y: number } {
  const siblings = kids.get(parent.id) ?? []
  if (!siblings.length) return { x: parent.x, y: parent.y + LEVEL_H }
  // the next place in reading order: after the last card of the last row, or the start of a new row once that row
  // already holds COMPACT_MAX (a grid of projects gets its 17th card after the 16th, not at the end of the top row)
  const top = Math.min(...siblings.map((c) => c.y))
  const rowOf = (c: BoardNode): number => Math.round((c.y - top) / ROW_H)
  const lastRow = Math.max(...siblings.map(rowOf))
  const inLast = siblings.filter((c) => rowOf(c) === lastRow)
  const right = inLast.reduce((a, b) => (b.x > a.x ? b : a))
  if (lastRow === 0 && siblings.length < wrap) return { x: right.x + SLOT_W, y: right.y }
  if (inLast.length < wrap) return { x: right.x + SLOT_W, y: right.y }
  return { x: Math.min(...siblings.map((c) => c.x)), y: right.y + ROW_H }
}

/** Row pitch of a wrapped grid of cards (a card plus its fold badge and a gap). */
const ROW_H = 160

/** How many cards across still read comfortably on a screen this wide: 2 on a phone, up to 5 on a desktop. */
export const wrapFor = (screenW: number): number => Math.max(2, Math.min(COMPACT_MAX, Math.floor((screenW - 32) / (SLOT_W * 0.85))))

/**
 * Tidy: a clean top-down tree for one branch. Each level sits on its own row, children spread left to right in the
 * order they currently appear, parents centred above them. The branch's top card does not move.
 * A long row of cards with nothing showing under them (folded, or with no children) is wrapped into a grid `wrap`
 * cards across instead of one endless line: sixteen folded projects are four short rows, not a strip nobody can read.
 * Whatever sits under a folded card travels with it, so unfolding finds it right below.
 * Only ever run because the user asked for it; nothing calls this automatically.
 */
export function tidyPositions(root: BoardNode, kids: ChildMap, wrap = Infinity): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  let cursor = 0
  // a folded card is laid out as a single card
  const shown = (n: BoardNode): BoardNode[] => (n.collapsed && n.id !== root.id ? [] : kids.get(n.id) ?? [])
  const place = (n: BoardNode, y: number): number => {
    const all = shown(n)
    const grid = all.length > wrap && all.every((c) => !shown(c).length)
    // reading order when they will be (or already are) a grid, so tidying twice changes nothing; else left to right
    const top = Math.min(...all.map((c) => c.y))
    const rowOf = (c: BoardNode): number => (grid ? Math.round((c.y - top) / ROW_H) : 0)
    const cs = [...all].sort((a, b) => rowOf(a) - rowOf(b) || byDate(kids)(a, b) || a.x - b.x || a.createdAt - b.createdAt)
    let x: number
    if (grid) {
      cs.forEach((c, i) => { out[c.id] = { x: cursor + (i % wrap) * SLOT_W, y: y + LEVEL_H + Math.floor(i / wrap) * ROW_H } })
      x = cursor + ((wrap - 1) * SLOT_W) / 2
      cursor += wrap * SLOT_W
    } else if (cs.length) { const xs = cs.map((c) => place(c, y + LEVEL_H)); x = (xs[0] + xs[xs.length - 1]) / 2 }
    else { x = cursor; cursor += SLOT_W }
    out[n.id] = { x, y }
    return x
  }
  place(root, 0)
  const dx = root.x - out[root.id].x, dy = root.y - out[root.id].y
  for (const id of Object.keys(out)) out[id] = { x: out[id].x + dx, y: out[id].y + dy }
  const carry = (n: BoardNode, mx: number, my: number): void => {
    for (const c of kids.get(n.id) ?? []) { out[c.id] = { x: c.x + mx, y: c.y + my }; carry(c, mx, my) }
  }
  const walk = (n: BoardNode): void => {
    if (n.collapsed && n.id !== root.id) carry(n, out[n.id].x - n.x, out[n.id].y - n.y)
    else for (const c of kids.get(n.id) ?? []) walk(c)
  }
  walk(root)
  return out
}

export const STICKY_COLORS = ['#E8C96A', '#B9CC4A', '#7FB3D5', '#E59A8C', '#F5EFE2']
export const PEN_COLORS = ['#F5EFE2', '#C9A64B', '#C0392B', '#92A524', '#7FB3D5']

/** How far one open level pushes the cards below it. */
export const EXPAND_H = 175

/**
 * Where each card on the board is drawn. Nothing here is stored.
 * - The open card and its direct children sit where the user put them (their stored x/y).
 * - A child that is unfolded shows its branch laid out under it, spread a little so neighbouring chips never touch,
 *   and every card below its row moves down one EXPAND_H per open level to make room.
 * Folding is therefore just the flag: the layout returns to the stored one by construction, on every device,
 * whatever order things were opened in. Cards not covered here (none, normally) fall back to their stored spot.
 */
export function displayLayout(focus: BoardNode, kids: ChildMap, wrap = COMPACT_MAX): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = { [focus.id]: { x: focus.x, y: focus.y } }
  const base = kids.get(focus.id) ?? []
  for (const c of base) out[c.id] = { x: c.x, y: c.y }
  const open = base.filter((c) => !c.collapsed && (kids.get(c.id)?.length ?? 0) > 0).sort((a, b) => a.y - b.y || a.x - b.x || a.createdAt - b.createdAt)
  for (const e of open) {
    const at = out[e.id]
    const br = placeBranch(e, at, kids, wrap)
    for (const id of Object.keys(out)) if (out[id].y > at.y + 100) out[id] = { x: out[id].x, y: out[id].y + br.depth }
    Object.assign(out, br.pos)
  }
  return out
}

export const BRANCH_W = 250 // a little wider than a slot, so neighbouring + and ▸ chips never touch

/**
 * One unfolded card's branch, drawn the same way at every depth: its children in rows of at most COMPACT_MAX,
 * centred under it, and any of them that is unfolded too opens its own branch under it, pushing the rows below
 * down. `depth` is how far the cards under the parent's row must move to make room.
 */
function placeBranch(e: BoardNode, at: { x: number; y: number }, kids: ChildMap, wrap: number): { pos: Record<string, { x: number; y: number }>; depth: number } {
  const cs = [...(kids.get(e.id) ?? [])].sort((a, b) => a.y - b.y || a.x - b.x || a.createdAt - b.createdAt)
  const pos: Record<string, { x: number; y: number }> = {}
  const cols = Math.min(cs.length, wrap)
  cs.forEach((c, i) => { pos[c.id] = { x: at.x + ((i % wrap) - (cols - 1) / 2) * BRANCH_W, y: at.y + LEVEL_H + 30 + Math.floor(i / wrap) * ROW_H } })
  for (const c of cs) {
    if (c.collapsed || !(kids.get(c.id)?.length)) continue
    const cAt = pos[c.id]
    const sub = placeBranch(c, cAt, kids, wrap)
    for (const id of Object.keys(pos)) if (pos[id].y > cAt.y + 100) pos[id] = { x: pos[id].x, y: pos[id].y + sub.depth }
    Object.assign(pos, sub.pos)
  }
  const bottom = Math.max(at.y, ...Object.values(pos).map((p) => p.y))
  return { pos, depth: cs.length ? bottom - at.y - 5 : 0 }
}

/** Cards in one row at most this many across; more wrap into a grid (Tidy, revealed branches, a card opened up). */
export const COMPACT_MAX = 5

/**
 * A card's children still in their first single long row (how they are added) are put into a COMPACT_MAX-wide grid
 * centred under it, each carrying what hangs under it. Anything the user has already arranged (not one row, or
 * few enough to fit) is left alone, so this runs once per card and never undoes a placement. null = nothing to do.
 */
export function compactChildren(focus: BoardNode, kids: ChildMap, wrap = COMPACT_MAX): Record<string, { x: number; y: number }> | null {
  const cs = kids.get(focus.id) ?? []
  if (cs.length <= wrap) return null
  const y0 = Math.min(...cs.map((c) => c.y))
  if (cs.some((c) => Math.abs(c.y - y0) > 12)) return null
  const sorted = [...cs].sort((a, b) => a.x - b.x || a.createdAt - b.createdAt)
  const left = focus.x - ((wrap - 1) * SLOT_W) / 2
  const out: Record<string, { x: number; y: number }> = {}
  const carry = (n: BoardNode, dx: number, dy: number): void => { for (const c of kids.get(n.id) ?? []) { out[c.id] = { x: c.x + dx, y: c.y + dy }; carry(c, dx, dy) } }
  sorted.forEach((c, i) => { const x = left + (i % wrap) * SLOT_W, y = y0 + Math.floor(i / wrap) * ROW_H; out[c.id] = { x, y }; carry(c, x - c.x, y - c.y) })
  return out
}
