import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvasDrag } from 'canvas-kit'
import { BoardView, ChildMap, KIND_LABEL, nextChildSpot, todayYmd } from '@/lib/board'
import { topZ } from '@/lib/stack'
import { BoardAxis, BoardColumnDef, boardLanes, dayOf, taskContext, timelineRows, TimelineRow, ymdOf } from '@/lib/views'
import { useBoardStore } from '@/store/useBoardStore'
import { actualSpan, linkPatch, plannedSpan } from '@/lib/dates'
import { BoardNode, NodeKind } from '@/types'

// The same cards, arranged differently. These panels sit on the whiteboard where the tree would be; notes, tables
// and everything else on the board stay exactly where they are.

const stop = (e: React.PointerEvent): void => e.stopPropagation()
const COL_W = 236

interface ViewProps {
  focus: BoardNode
  nodes: Record<string, BoardNode>
  board: BoardView
  selectedId: string | null
  onSelect: (id: string) => void
  /** managers edit anything; an operator may only move tasks assigned to them */
  canEdit: boolean
  myUid?: string
  /** the view was scrolled back into after the whiteboard had been panned past its edge */
  onSnapIn?: (el: HTMLElement) => void
}

/** Create a work item under a parent, placed where the tree would put it. One implementation for every view. */
export function createUnder(parent: BoardNode, kids: ChildMap, title: string, patch: Partial<BoardNode> = {}): string {
  const store = useBoardStore.getState()
  const kind: NodeKind = parent.kind === 'portfolio' ? 'project' : parent.kind === 'project' ? 'milestone' : 'task'
  const spot = nextChildSpot(parent, kids)
  const id = store.addNode(kind, parent.id, spot.x, spot.y, title)
  store.setZ({ [id]: topZ() })
  if (Object.keys(patch).length) store.updateNode(id, patch)
  return id
}

/**
 * Add a project, a milestone or a task without leaving the view. What can be added follows from where you are:
 * projects only from the portfolio; a milestone needs a project to go in, a task needs a milestone.
 */
function AddBar({ focus, nodes, board, withDates }: { focus: BoardNode; nodes: Record<string, BoardNode>; board: BoardView; withDates?: boolean }): JSX.Element | null {
  const scope = useMemo(() => {
    const out: BoardNode[] = [focus]
    for (let i = 0; i < out.length; i++) out.push(...(board.kids.get(out[i].id) ?? []))
    return out
  }, [focus, board])
  const parentsFor = (k: NodeKind): BoardNode[] => scope.filter((n) => (k === 'project' ? n.kind === 'portfolio' : k === 'milestone' ? n.kind === 'project' : n.kind === 'milestone'))
  const kinds = (['task', 'milestone', 'project'] as NodeKind[]).filter((k) => parentsFor(k).length > 0 || (k === 'task' && parentsFor('milestone').length > 0))
  const [kind, setKind] = useState<NodeKind>('task')
  const [parentId, setParentId] = useState('')
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const useKind = kinds.includes(kind) ? kind : kinds[0]
  if (!useKind) return null
  const parents = parentsFor(useKind)
  const parent = parents.find((p) => p.id === parentId) ?? parents[parents.length - 1]
  const path = (n: BoardNode): string => (n.kind === 'milestone' && n.parentId && nodes[n.parentId] ? `${nodes[n.parentId].title} › ${n.title}` : n.title)
  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!title.trim() || !parent) return
    createUnder(parent, board.kids, title.trim(), useKind === 'task' && (start || end) ? { start: start || end, end: end || start } : {})
    setTitle('')
  }
  return (
    <form className="wb-vaddbar" onSubmit={submit}>
      <select value={useKind} aria-label="What to add" onChange={(e) => setKind(e.target.value as NodeKind)}>
        {kinds.map((k) => <option key={k} value={k}>New {KIND_LABEL[k].toLowerCase()}</option>)}
      </select>
      {parents.length > 1 && (
        <select value={parent?.id ?? ''} aria-label="Where it goes" onChange={(e) => setParentId(e.target.value)}>
          {parents.map((p) => <option key={p.id} value={p.id}>in {path(p)}</option>)}
        </select>
      )}
      <input value={title} placeholder={`Name the ${KIND_LABEL[useKind].toLowerCase()}…`} maxLength={100} aria-label="Name" onChange={(e) => setTitle(e.target.value)} />
      {withDates && useKind === 'task' && (
        <>
          <input type="date" value={start} aria-label="Start" onChange={(e) => setStart(e.target.value)} />
          <input type="date" value={end} aria-label="End" onChange={(e) => setEnd(e.target.value)} />
        </>
      )}
      <button type="submit" disabled={!title.trim()}>Add</button>
    </form>
  )
}

/** The browser window's size: views fit it (as many columns as fit) and scroll/pan inside instead of growing. */
function useWindowSize(): { w: number; h: number } {
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => { const on = (): void => setWin({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  return win
}
const viewH = (h: number): number => Math.max(320, h - 240)

// ---- board ------------------------------------------------------------------------------------------------------
function TaskChip({ task, col, columns, axis, context, selected, movable, onSelect, byDrop }: { task: BoardNode; col: number; columns: BoardColumnDef[]; axis: BoardAxis; context: string; selected: boolean; /** 'status': an operator's own task, only its status may change */ movable: boolean | 'status'; onSelect: (id: string) => void; /** the columns are stacked as groups: the target is whichever group cell the chip is dropped on */ byDrop?: boolean }): JSX.Element {
  const updateNode = useBoardStore((s) => s.updateNode)
  // Drag sideways into another column (or onto another group) to change the real task (its status, or its priority).
  const drag = useCanvasDrag({
    x: 0, y: 0, spring: false, liftScale: 1.03, dragZ: 100000,
    onMove: (dx) => {
      if (!movable) return
      let to = col
      if (byDrop) {
        const r = (drag.ref.current as HTMLElement | null)?.getBoundingClientRect()
        const hit = r && document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).map((e) => e.closest('[data-col]')).find((e) => e && !e.contains(drag.ref.current as Node | null))
        const i = columns.findIndex((c) => c.id === hit?.getAttribute('data-col'))
        if (i >= 0) to = i
      } else to = Math.max(0, Math.min(columns.length - 1, col + Math.round(dx / COL_W)))
      if (to === col) return
      const patch = axis.move(task, columns[to].id)
      if (movable === 'status') { if (patch.status) updateNode(task.id, { status: patch.status }) } else updateNode(task.id, patch)
    },
    onTap: () => onSelect(task.id),
  })
  return (
    <div ref={drag.ref} className={`wb-vchip ${selected ? 'is-selected' : ''}`} style={{ ...drag.style, borderLeftColor: columns[col].color }} {...drag.handlers}>
      <b>{task.title}</b>
      {(context || task.assignee) && <span>{context}{context && task.assignee ? ' · ' : ''}{task.assignee && <em>{task.assignee}</em>}</span>}
    </div>
  )
}

export function NodeBoard({ focus, nodes, board, selectedId, onSelect, canEdit, myUid, by, axis, onSnapIn }: ViewProps & { by: 'project' | 'milestone'; axis: BoardAxis }): JSX.Element {
  const lanes = useMemo(() => boardLanes(focus, nodes, board.kids, by), [focus, nodes, board, by])
  const columns = useMemo(() => axis.columns(lanes.flatMap((l) => l.tasks)), [lanes, axis])
  const count = (tasks: BoardNode[], c: BoardColumnDef): number => tasks.filter((t) => axis.of(t) === c.id).length
  // with many lanes the board opens as a list of them (name and count); with a few, everything is open
  const [folded, setFolded] = useState<Set<string>>(() => { const ls = boardLanes(focus, nodes, board.kids, by); return new Set([...(ls.length > 6 ? ls.map((l) => l.id) : []), 's:done']) })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const toggle = (id: string): void => setFolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  /**
   * New task typed straight into a column, already in that status or priority. In a milestone lane it goes under that
   * milestone; in a project lane it goes under the project's most recent milestone (one is made if there is none).
   */
  const add = (laneId: string, ci: number): void => {
    const key = `${laneId}:${ci}`, title = (draft[key] ?? '').trim()
    const lane = nodes[laneId]
    if (!title || !lane) return
    let parent = lane
    if (lane.kind === 'project') {
      const ms = (board.kids.get(lane.id) ?? []).filter((n) => n.kind === 'milestone')
      parent = ms[ms.length - 1] ?? useBoardStore.getState().nodes[createUnder(lane, board.kids, 'Milestone 1')]
    }
    const blank = { status: 'backlog' } as BoardNode
    createUnder(parent, board.kids, title, axis.of(blank) === columns[ci].id ? {} : axis.move(blank, columns[ci].id))
    setDraft((d) => ({ ...d, [key]: '' }))
  }

  const cells = (l: { id: string; tasks: BoardNode[] }, ctx: 'project' | 'milestone'): JSX.Element => (
    <div className="wb-vlane-cells">
      {columns.map((c, ci) => (
        <div key={c.id} className="wb-vcell" style={{ width: COL_W }}>
          {l.tasks.filter((t) => axis.of(t) === c.id).map((t) => (
            <TaskChip key={t.id} task={t} col={ci} columns={columns} axis={axis} context={taskContext(t, nodes, ctx)} selected={selectedId === t.id}
              movable={canEdit || (!!myUid && t.assigneeUid === myUid && 'status')} onSelect={onSelect} />
          ))}
          {canEdit && nodes[l.id] && (
            <input className="wb-vadd" value={draft[`${l.id}:${ci}`] ?? ''} placeholder="+ New task" maxLength={100}
              onChange={(e) => setDraft((d) => ({ ...d, [`${l.id}:${ci}`]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') add(l.id, ci) }} onBlur={() => add(l.id, ci)} />
          )}
        </div>
      ))}
    </div>
  )

  const transposed = by === 'project' && axis.id === 'status'
  const scroll = useTimelineScroll(0, onSnapIn)
  const win = useWindowSize()
  // By project (status): projects are the columns and To do / Doing / Done are the groups, Notion style
  if (transposed) {
    const projects = lanes
    // the panel is as big as the window (2, 3, 4… columns, whatever fits); the rest scrolls or pans inside it
    const fit = Math.max(1, Math.min(projects.length, Math.floor((win.w - 72) / (COL_W + 8))))
    return (
      <div ref={scroll.panel} data-snap="corner" className="freeform-el wb-view wb-vboard" style={{ left: focus.x, top: focus.y, width: fit * (COL_W + 8) + 24 }} onPointerDown={stop}>
        <div className="wb-view-head"><span>Board</span><b>{focus.title}</b><span>tasks by project</span></div>
        <div ref={scroll.scroller} className="wb-vboard-scroll" style={{ maxHeight: viewH(win.h) }} onPointerDown={scroll.onPointerDown}>
        <div className="wb-vboard-cols is-sticky">
          {projects.map((p) => <div key={p.id} style={{ width: COL_W }} title={p.title}><b className="wb-vproj">{p.title}</b><em>{p.tasks.length}</em></div>)}
        </div>
        {projects.length === 0 && <p className="wb-view-empty">No projects here yet. Add one below.</p>}
        {projects.length > 0 && columns.map((c, ci) => {
          const gid = `s:${c.id}`
          return (
            <section key={c.id} className="wb-vlane">
              <button className="wb-vlane-head is-sticky" onClick={() => toggle(gid)} aria-expanded={!folded.has(gid)}>
                <i>{folded.has(gid) ? '▸' : '▾'}</i><b className="wb-vstatus" style={{ color: c.color }}><s style={{ background: c.color }} />{c.name}</b>
                <em>{projects.reduce((n, p) => n + count(p.tasks, c), 0)}</em>
              </button>
              {!folded.has(gid) && (
                <div className="wb-vlane-cells">
                  {projects.map((p) => (
                    <div key={p.id} className="wb-vcell" data-col={c.id} style={{ width: COL_W }}>
                      {p.tasks.filter((t) => axis.of(t) === c.id).map((t) => (
                        <TaskChip key={t.id} task={t} col={ci} columns={columns} axis={axis} context={taskContext(t, nodes, 'project')} selected={selectedId === t.id}
                          movable={canEdit || (!!myUid && t.assigneeUid === myUid && 'status')} onSelect={onSelect} byDrop />
                      ))}
                      {canEdit && nodes[p.id] && (
                        <input className="wb-vadd" value={draft[`${p.id}:${ci}`] ?? ''} placeholder="+ New task" maxLength={100}
                          onChange={(e) => setDraft((d) => ({ ...d, [`${p.id}:${ci}`]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') add(p.id, ci) }} onBlur={() => add(p.id, ci)} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}
        </div>
        {canEdit && <AddBar focus={focus} nodes={nodes} board={board} />}
      </div>
    )
  }

  return (
    <div ref={scroll.panel} className="freeform-el wb-view wb-vboard" style={{ left: focus.x, top: focus.y, width: Math.max(1, Math.min(columns.length, Math.floor((win.w - 72) / (COL_W + 8)))) * (COL_W + 8) + 24 }} onPointerDown={stop}>
      <div className="wb-view-head"><span>Board</span><b>{focus.title}</b><span>{axis.id === 'priority' ? 'priority' : 'tasks'} by {by}</span></div>
      <div ref={scroll.scroller} className="wb-vboard-scroll" style={{ maxHeight: viewH(win.h) }} onPointerDown={scroll.onPointerDown}>
      <div className="wb-vboard-cols is-sticky">
        {columns.map((c) => <div key={c.id} style={{ width: COL_W, color: c.color }} title={c.hint}><i style={{ background: c.color }} />{c.name}<em>{lanes.reduce((n, l) => n + count(l.tasks, c), 0)}</em></div>)}
      </div>
      {lanes.length === 0 && <p className="wb-view-empty">No {by}s here yet. Add one below.</p>}
      {lanes.map((l, li) => {
        // by milestone: lanes are gathered under their project, named once above them instead of on every lane
        const group = by === 'milestone' && l.context ? `g:${l.context}` : ''
        const firstOfGroup = !!group && lanes[li - 1]?.context !== l.context
        const inGroup = lanes.filter((x) => x.context === l.context)
        return [
          firstOfGroup && (
            <button key={group} className="wb-vgroup" onClick={() => toggle(group)} aria-expanded={!folded.has(group)}>
              <i>{folded.has(group) ? '▸' : '▾'}</i><span>Project</span><b>{l.context}</b>
              <em>{inGroup.length} milestone{inGroup.length === 1 ? '' : 's'} · {inGroup.reduce((n, x) => n + x.tasks.length, 0)} tasks</em>
            </button>
          ),
          !(group && folded.has(group)) && (
        <section key={l.id} className={`wb-vlane ${group ? 'is-grouped' : ''}`}>
          <button className="wb-vlane-head" onClick={() => toggle(l.id)} aria-expanded={!folded.has(l.id)}>
            <i>{folded.has(l.id) ? '▸' : '▾'}</i><b>{l.title}</b>{l.context && !group && <span>{l.context}</span>}<em>{l.tasks.length}</em>
          </button>
          {!folded.has(l.id) && (by === 'project' && axis.id === 'status' && nodes[l.id]
            // a project's tasks are sub-grouped by milestone, each with its own row of columns (by priority the
            // project's tasks stay together: what to do first is decided across the whole project)
            ? boardLanes(nodes[l.id], nodes, board.kids, 'milestone').map((m) => (
              <div key={m.id} className="wb-vsub">
                <button className="wb-vsub-head" onClick={() => toggle(m.id)} aria-expanded={!folded.has(m.id)}>
                  <i>{folded.has(m.id) ? '▸' : '▾'}</i><b>{m.title}</b>
                  <em>{columns.map((c) => count(m.tasks, c)).join(' · ')}</em>
                </button>
                {!folded.has(m.id) && cells(m, 'milestone')}
              </div>
            ))
            : cells(l, by))}
        </section>
          ),
        ]
      })}
      </div>
      {canEdit && <AddBar focus={focus} nodes={nodes} board={board} />}
    </div>
  )
}

// ---- timeline ---------------------------------------------------------------------------------------------------
const ROW_H = 40

/**
 * The timeline scrolls inside its own panel instead of growing as wide as its dates. The wheel (or trackpad) over
 * the panel moves the timeline, never the board behind it; a plain mouse wheel moves it sideways when there is
 * nothing to scroll down. Dragging the empty part of a lane scrolls too, which is what a finger does on a phone
 * (the board switches native touch scrolling off).
 */
function useTimelineScroll(todayX: number, onSnapIn?: (el: HTMLElement) => void): { panel: React.RefObject<HTMLDivElement>; scroller: React.RefObject<HTMLDivElement>; onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void } {
  const panel = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = panel.current, sc = scroller.current
    if (!el || !sc) return
    sc.scrollLeft = todayX - sc.clientWidth * 0.6 // open on today, with what is coming next in view
    // Scrolling works in gestures (a burst of wheel events; a pause of 250ms ends one). A gesture that reaches an
    // edge stops there and the edge lights up; the NEXT gesture that pushes on that edge snaps out and pans the
    // whiteboard. Once out, the panel ignores the rest of that gesture; a new scroll started over the panel snaps
    // back in, so wandering the whiteboard elsewhere never pulls it back.
    let lastT = -1e9, out = false
    const flash = (cls: string): void => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); window.setTimeout(() => el.classList.remove(cls), 600) }
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return // pinch / ctrl-wheel still zooms the board
      const fresh = e.timeStamp - lastT > 250
      lastT = e.timeStamp
      if (out) {
        if (!fresh) return // still the gesture that snapped out: the whiteboard pans
        out = false; el.classList.remove('is-out'); flash('is-snapin')
        e.preventDefault(); e.stopPropagation(); onSnapIn?.(el); return
      }
      const tall = sc.scrollHeight > sc.clientHeight + 1
      const dx = e.deltaX + (tall ? 0 : e.deltaY), dy = tall ? e.deltaY : 0
      const maxL = sc.scrollWidth - sc.clientWidth, maxT = sc.scrollHeight - sc.clientHeight
      const stuckX = !dx || (dx < 0 ? sc.scrollLeft <= 0 : sc.scrollLeft >= maxL - 1)
      const stuckY = !dy || (dy < 0 ? sc.scrollTop <= 0 : sc.scrollTop >= maxT - 1)
      if (stuckX && stuckY) {
        const edge = !dx ? (dy < 0 ? 'top' : 'bottom') : dx < 0 ? 'left' : 'right'
        if (fresh && el.dataset.edge === edge && el.style.getPropertyValue('--pull') === '1') {
          out = true; el.style.setProperty('--pull', '0'); el.classList.add('is-out'); flash('is-snapout'); return
        }
        el.dataset.edge = edge; el.style.setProperty('--pull', '1') // stopped at the edge: the next scroll this way snaps out
        e.preventDefault(); e.stopPropagation(); return
      }
      el.style.setProperty('--pull', '0')
      e.preventDefault(); e.stopPropagation()
      sc.scrollLeft += dx
      sc.scrollTop += dy
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const sc = scroller.current
    if (!sc || (e.target as HTMLElement).closest('.wb-vbar, .wb-vchip, button, input, form')) return
    const zoom = sc.getBoundingClientRect().width / sc.offsetWidth || 1
    const x0 = e.clientX, y0 = e.clientY, l0 = sc.scrollLeft, t0 = sc.scrollTop
    const move = (m: PointerEvent): void => { sc.scrollLeft = l0 - (m.clientX - x0) / zoom; sc.scrollTop = t0 - (m.clientY - y0) / zoom }
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up)
  }
  return { panel, scroller, onPointerDown }
}
const fmtDur = (days: number): string => (days >= 60 ? `${(days / 30.4).toFixed(1)} months` : `${days} day${days === 1 ? '' : 's'}`)

/** A bar on the timeline. A task's bar can be dragged sideways to move its dates; containers follow their tasks. */
function TimeBar({ row, left, width, dayW, selected, movable, onSelect }: { row: TimelineRow & { own?: boolean }; left: number; width: number; dayW: number; selected: boolean; movable: boolean; onSelect: (id: string) => void }): JSX.Element {
  const updateNode = useBoardStore((s) => s.updateNode)
  const n = row.node
  const drag = useCanvasDrag({
    x: 0, y: 0, spring: false, liftScale: 1, dragZ: 100000,
    onMove: (dx) => {
      const by = Math.round(dx / dayW)
      if (!movable || !by || !n.start || !n.end) return
      updateNode(n.id, { start: ymdOf(dayOf(n.start) + by), end: ymdOf(dayOf(n.end) + by) })
    },
    onTap: () => onSelect(n.id),
  })
  // drag the right edge to change the planned finish (Microsoft Project style); never before the start
  const resize = (e: React.PointerEvent): void => {
    e.stopPropagation(); e.preventDefault()
    if (!n.start || !n.end) return
    const x0 = e.clientX, end0 = dayOf(n.end), s0 = dayOf(n.start)
    // screen px per canvas px (the board may be zoomed)
    const bar = e.currentTarget.parentElement as HTMLElement
    const scale = bar.getBoundingClientRect().width / (bar.offsetWidth || 1) || 1
    const mv = (ev: PointerEvent): void => {
      const d = Math.max(s0, end0 + Math.round((ev.clientX - x0) / scale / dayW))
      if (ymdOf(d) !== useBoardStore.getState().nodes[n.id]?.end) updateNode(n.id, { end: ymdOf(d) })
    }
    const up = (): void => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }
  // drag from the dot at the end onto another bar to make that one wait for this one (finish-to-start)
  const startLink = (e: React.PointerEvent): void => {
    e.stopPropagation(); e.preventDefault()
    document.body.classList.add('is-linking')
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-linking')
      const to = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-row]')?.getAttribute('data-row')
      if (!to || to === n.id) return
      const all = useBoardStore.getState().nodes
      const after = linkPatch(n.id, to, all)
      if (after) updateNode(to, { after })
    }
    window.addEventListener('pointerup', up)
  }
  return (
    <div ref={drag.ref} className={`wb-vbar ${selected ? 'is-selected' : ''} ${movable ? 'is-movable' : ''} ${row.own ? '' : 'is-derived'}`} style={{ ...drag.style, left, minWidth: width }} title={`Planned ${row.start} → ${row.end}`} {...drag.handlers}>
      {/* the label slides along its bar so a long bar that starts off-screen still says what it is */}
      <div className="wb-vbar-in">
        <b>{n.title}</b>
        <span>{row.pct}%</span>
        <i className="wb-vmeter"><i style={{ width: `${row.pct}%`, background: row.color }} /></i>
        <em style={{ color: row.color }}>{row.label}</em>
        <span>{fmtDur(dayOf(row.end as string) - dayOf(row.start as string) + 1)}</span>
        {n.assignee && <span>{n.assignee}</span>}
      </div>
      {movable && <i className="wb-vbar-grip" onPointerDown={resize} aria-label="Drag to change the planned finish" />}
      {movable && <i className="wb-vbar-link" onPointerDown={startLink} title="Drag onto another bar: that one starts after this finishes" />}
    </div>
  )
}

export function NodeTimeline({ focus, nodes, board, selectedId, onSelect, canEdit, onSnapIn }: ViewProps): JSX.Element {
  const updateNode = useBoardStore((s) => s.updateNode)
  // inside a project or milestone everything starts unfolded; the portfolio starts as a list of its projects
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus.kind === 'portfolio' ? [] : Object.keys(nodes)))
  const { rows, undated } = useMemo(() => timelineRows(focus, board.kids, board, open), [focus, board, open])
  const toggle = (id: string): void => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // adding a row straight into the plan: which row's "+" is open, and the name being typed
  const [adding, setAdding] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const addUnder = (parent: BoardNode): void => {
    const t = draft.trim()
    if (!t) { setAdding(null); return }
    const id = createUnder(parent, board.kids, t)
    setOpen((s) => new Set(s).add(parent.id).add(id))
    setDraft('') // stays open: type the next one
  }

  // Baseline: a snapshot of the plan as it stands, kept while start/end get re-planned. Two taps to replace one.
  const [armBase, setArmBase] = useState(false)
  const hasBase = rows.some((r) => r.node.baseStart)
  const saveBaseline = (): void => {
    if (hasBase && !armBase) { setArmBase(true); window.setTimeout(() => setArmBase(false), 3000); return }
    const ids: string[] = [focus.id]
    for (let i = 0; i < ids.length; i++) ids.push(...(board.kids.get(ids[i]) ?? []).map((k) => k.id))
    const patches: Record<string, Partial<BoardNode>> = {}
    for (const id of ids) { const p = plannedSpan(id, nodes, board.kids); patches[id] = { baseStart: p.start, baseEnd: p.end } }
    useBoardStore.getState().patchMany(patches)
    setArmBase(false)
  }

  const today = dayOf(todayYmd())
  const dated = rows.filter((r) => r.start && r.end)
  const acts = rows.map((r) => actualSpan(r.node.id, nodes, board.kids))
  const actDays = [...acts.flatMap((a) => [a.start, a.end]), ...rows.flatMap((r) => [r.node.baseStart, r.node.baseEnd])].filter(Boolean).map((d) => dayOf(d as string))
  const first = Math.min(today, ...dated.map((r) => dayOf(r.start as string)), ...actDays) - 5
  const last = Math.max(today, ...dated.map((r) => dayOf(r.end as string)), ...actDays) + 12
  const days = last - first
  const dayW = Math.max(3, Math.min(26, 1100 / days))
  // room after the last day for the label of a short bar that ends there, so nothing spills out of the panel
  const W = Math.round(days * dayW) + 260
  const phone = window.innerWidth < 640
  const NAME_W = phone ? 124 : 230
  const win = useWindowSize()
  const panelW = Math.min(NAME_W + W + 26, Math.max(340, win.w - 72))
  const scroll = useTimelineScroll((today - first) * dayW, onSnapIn)
  // a label at the start of each month
  const months: { x: number; label: string }[] = []
  for (let d = first; d <= last; d++) {
    const date = new Date(`${ymdOf(d)}T00:00:00Z`)
    if (d === first || date.getUTCDate() === 1) months.push({ x: (d - first) * dayW, label: date.toLocaleDateString('en-GB', { month: 'long', ...(d === first || date.getUTCMonth() === 0 ? { year: 'numeric' } : {}), timeZone: 'UTC' }) })
  }

  // dependency arrows between rows on screen: from the end of the one that must finish to the start of the one waiting
  const yOf = new Map<string, number>()
  let rowCount = 0
  for (const r of rows) { yOf.set(r.node.id, rowCount * ROW_H + ROW_H / 2 - 4); rowCount += adding === r.node.id ? 2 : 1 }
  const byId = new Map(rows.map((r) => [r.node.id, r]))
  const links: { key: string; from: string; to: string; d: string; bad: boolean }[] = []
  for (const r of rows) for (const pid of r.node.after ?? []) {
    const p = byId.get(pid)
    if (!p?.end || !r.start) continue
    const x1 = (dayOf(p.end) - first + 1) * dayW, y1 = yOf.get(pid) as number
    const x2 = (dayOf(r.start) - first) * dayW, y2 = yOf.get(r.node.id) as number
    const mid = y1 < y2 ? y2 - ROW_H / 2 + 2 : y2 + ROW_H / 2 - 2
    const d = x2 - 6 >= x1 + 6
      ? `M${x1} ${y1} H${x1 + 6} V${y2} H${x2}`
      : `M${x1} ${y1} H${x1 + 6} V${mid} H${x2 - 8} V${y2} H${x2}`
    links.push({ key: `${pid}>${r.node.id}`, from: pid, to: r.node.id, d, bad: r.start <= p.end })
  }

  return (
    <div ref={scroll.panel} className="freeform-el wb-view wb-vtime" style={{ left: focus.x, top: focus.y, width: panelW }} onPointerDown={stop}>
      <div className="wb-view-head"><span>Timeline</span><b>{focus.title}</b>{undated.length > 0 && <span>No date ({undated.length})</span>}
        <span className="wb-vlegend"><i className="is-plan" />Planned <i className="is-act" />Actual{hasBase && <><i className="is-base" />Baseline</>}</span>
        {canEdit && <button className={`wb-vbase ${armBase ? 'is-armed' : ''}`} onClick={saveBaseline}
          title="Keep today's plan to compare against when dates move">{armBase ? 'Tap again to replace the baseline' : hasBase ? 'Re-save baseline' : 'Save baseline'}</button>}</div>
      <div ref={scroll.scroller} className="wb-vtime-grid" style={{ maxHeight: viewH(win.h), gridTemplateColumns: `${NAME_W}px ${W}px`, ['--name-w' as string]: `${NAME_W}px` }} onPointerDown={scroll.onPointerDown}>
        <div className="wb-vtime-corner">Name</div>
        <div className="wb-vtime-months" style={{ height: 30 }}>
          {months.map((m) => <span key={m.x} style={{ left: m.x }}>{m.label}</span>)}
          <span className="is-today" style={{ left: (today - first) * dayW }}>Today</span>
        </div>
        <svg className="wb-vlinks" style={{ left: NAME_W, top: 31, width: W, height: rowCount * ROW_H }} aria-hidden="true">
          <defs><marker id="wb-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="context-stroke" /></marker></defs>
          {links.map((l) => (
            <g key={l.key} className={`wb-vlink ${l.bad ? 'is-bad' : ''}`}>
              <path d={l.d} markerEnd="url(#wb-arrow)" />
              {canEdit && <path className="wb-vlink-hit" d={l.d} onClick={() => { const n = nodes[l.to]; if (n) updateNode(l.to, { after: (n.after ?? []).filter((x) => x !== l.from) }) }}>
                <title>{`${nodes[l.from]?.title} → ${nodes[l.to]?.title}${l.bad ? ' (starts before it finishes)' : ''}. Click to remove.`}</title></path>}
            </g>
          ))}
        </svg>
        {rows.map((r, i) => {
          const sx = r.start ? (dayOf(r.start) - first) * dayW : 0
          const len = r.start && r.end ? dayOf(r.end) - dayOf(r.start) + 1 : 0
          const sel = selectedId === r.node.id
          const own = !!(r.node.start && r.node.end)
          const act = acts[i]
          const aEnd = act.end ?? (act.start ? todayYmd() : undefined)
          const canAdd = canEdit && r.node.kind !== 'task'
          const out = [
            <div key={`${r.node.id}-n`} className={`wb-vtime-name ${sel ? 'is-selected' : ''}`} style={{ paddingLeft: 10 + r.depth * 16, height: ROW_H }}>
              <button className="wb-vtime-fold" onClick={() => r.expandable && toggle(r.node.id)} aria-label={r.expandable ? (open.has(r.node.id) ? 'Fold' : 'Unfold') : undefined} tabIndex={r.expandable ? 0 : -1}>{r.expandable ? (open.has(r.node.id) ? '▾' : '▸') : ''}</button>
              <button className="wb-vtime-title" onClick={() => onSelect(r.node.id)}><span>{r.node.title || 'Untitled'}</span></button>
              {canAdd && <button className="wb-vtime-plus" onClick={() => { setAdding(r.node.id); setDraft(''); setOpen((s) => new Set(s).add(r.node.id)) }} aria-label={`Add under ${r.node.title}`} title="Add under this">+</button>}
            </div>,
            <div key={`${r.node.id}-b`} data-row={r.node.id} className="wb-vtime-lane" style={{ height: ROW_H, backgroundSize: `${Math.max(dayW * 7, 20)}px 100%` }}>
              <i className="wb-vtime-now" style={{ left: (today - first) * dayW }} />
              {r.node.baseStart && r.node.baseEnd && <i className="wb-vbase-line" title={`Baseline ${r.node.baseStart} → ${r.node.baseEnd}`}
                style={{ left: (dayOf(r.node.baseStart) - first) * dayW, width: Math.max((dayOf(r.node.baseEnd) - dayOf(r.node.baseStart) + 1) * dayW, 4) }} />}
              {len > 0
                ? <TimeBar row={{ ...r, own }} left={sx} width={Math.max(len * dayW, 10)} dayW={dayW} selected={sel} movable={canEdit && own} onSelect={onSelect} />
                : canEdit
                  // nothing planned yet: click the day it starts (a week to begin with; drag its end to fit)
                  ? <button className="wb-vtime-set" onClick={(e) => { const rc = e.currentTarget.getBoundingClientRect(); const day = first + Math.floor((e.clientX - rc.left) / (rc.width / days)); updateNode(r.node.id, { start: ymdOf(day), end: ymdOf(day + (r.node.kind === 'task' ? 2 : 6)) }) }}>click a day to plan this {KIND_LABEL[r.node.kind].toLowerCase()}</button>
                  : <span className="wb-vtime-nodate">not planned yet</span>}
              {act.start && <i className={`wb-vact ${act.end ? '' : 'is-open'}`} title={`Actual ${act.start} → ${act.end ?? 'in progress'}`}
                style={{ left: (dayOf(act.start) - first) * dayW, width: Math.max((dayOf(aEnd as string) - dayOf(act.start) + 1) * dayW, 4) }} />}
            </div>,
          ]
          if (adding === r.node.id) {
            const kind = r.node.kind === 'portfolio' ? 'project' : r.node.kind === 'project' ? 'milestone' : 'task'
            out.push(
              <form key={`${r.node.id}-add`} className="wb-vtime-name wb-vtime-addrow" style={{ paddingLeft: 26 + (r.depth + 1) * 16, height: ROW_H }}
                onSubmit={(e) => { e.preventDefault(); addUnder(r.node) }}>
                <input autoFocus value={draft} maxLength={100} placeholder={`New ${kind}… (Enter)`} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setAdding(null) }} onBlur={() => { if (!draft.trim()) setAdding(null) }} />
              </form>,
              <div key={`${r.node.id}-addl`} className="wb-vtime-lane wb-vtime-addhint" style={{ height: ROW_H }}>Enter adds it and opens the next; then click its row on a day to plan it.</div>,
            )
          }
          return out
        })}
      </div>
      {rows.length === 0 && <p className="wb-view-empty">Nothing here yet. Add something below.</p>}
      {undated.length > 0 && (
        <div className="wb-vtime-undated">
          <span>No date ({undated.length}) — tap one to give it a start and end:</span>
          {undated.slice(0, 40).map((t) => <button key={t.id} className={selectedId === t.id ? 'is-selected' : ''} onClick={() => onSelect(t.id)}>{t.title}</button>)}
        </div>
      )}
      {canEdit && <AddBar focus={focus} nodes={nodes} board={board} withDates />}
    </div>
  )
}
