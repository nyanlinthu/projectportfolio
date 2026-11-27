import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CANVAS_DRAG_EVENT, ConnectionLines, DrawLayer, MobileCanvas } from 'canvas-kit'
import type { CanvasHandle } from 'canvas-kit'
import { applyLaneEdit, BRANCH_W, childKind, childMap, compactChildren, deriveBoard, displayLayout, KIND_LABEL, LaneDir, LaneEdit, laneAt, laneLayout, laneNames, UNSORTED, nextChildSpot, nextStatus, PEN_COLORS, STICKY_COLORS, tidyPositions, wrapFor } from '@/lib/board'
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Circle, Diamond, RectangleHorizontal, Square } from 'lucide-react'
import { DEMO, resetDemo, STORE_KEYS } from '@/lib/demo'
import { fileToSmallDataUrl } from '@/lib/image'
import { owningNodeId, parentScope, resolvePage, rowKey } from '@/lib/scope'
import { pageTitle, SearchHit } from '@/lib/search'
import { CLIP_TYPE, copyPayload, pastePayload } from '@/lib/clipboard'
import { redo, undo } from '@/lib/history'
import { restack, StackOp, topZ } from '@/lib/stack'
import { starterTable } from '@/lib/table'
import { NodeViewMode, PRIORITY_AXIS, STATUS_AXIS, VIEW_MODES } from '@/lib/views'
import { ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'
import { Person, report, usePresence } from '@/store/usePresence'
import { canEdit, useSession } from '@/store/useSession'
import { BoardNode, ConnectorEl, NodeKind, PageEl, ShapeKind, Tool } from '@/types'
import AccountSheet from './AccountSheet'
import AdminSheet from './AdminSheet'
import InboxSheet, { useInbox } from './InboxSheet'
import BoardCard from './BoardCard'
import LaneBar from './LaneBar'
import { PoolTools } from './Elements'
import Elements from './Elements'
import InlineEditor, { NEW_CARD_ID } from './InlineEditor'
import { LinkProvider } from './LinkContext'
import PlansSheet from './PlansSheet'
import { addStarterKit, isStarted, plansOf } from '@/lib/pmkit'
import NodeSheet from './NodeSheet'
import { groupMoved, pick, pickModifier, usePicked } from '@/store/usePicked'
import { PeerCursors, PeerMark, PresenceBar } from './Presence'
import { NodeBoard, NodeTimeline } from './NodeViews'
import RelationLines from './RelationLines'
import { CardPage, RowPage, StandalonePage } from './PagePeek'
import SearchBar from './SearchBar'
import Toolbar from './Toolbar'

const SHAPES: { id: ShapeKind; label: string; Icon: typeof Square }[] = [
  { id: 'rect', label: 'Step', Icon: Square },
  { id: 'round', label: 'Start / end', Icon: RectangleHorizontal },
  { id: 'diamond', label: 'Decision', Icon: Diamond },
  { id: 'ellipse', label: 'Circle', Icon: Circle },
]
const STACK_OPS: { op: StackOp; label: string; Icon: typeof Square }[] = [
  { op: 'back', label: 'Send to back', Icon: ArrowDownToLine },
  { op: 'backward', label: 'Send backward', Icon: ArrowDown },
  { op: 'forward', label: 'Bring forward', Icon: ArrowUp },
  { op: 'front', label: 'Bring to front', Icon: ArrowUpToLine },
]

/** x/y = where the name box shows; sx/sy = where the new card is stored (they differ inside an unfolded branch) */
interface EditorState { kind: NodeKind; parentId: string; x: number; y: number; sx?: number; sy?: number; refold?: boolean; free?: boolean; seq: number }

const GLIDE_MS = 360 // keep in sync with `.wb-inner [data-canvas-id]` transition in App.css
/** A branch growing out of / shrinking back into its card (keep in sync with wb-branch-in / -out in App.css). */
const noop = (): void => undefined
const BRANCH_MS = 380, BRANCH_STEP = 22, BRANCH_STEPS = 8
/** Tools that put one thing on the board where you tap (the others are modes: draw, erase, connect, select). */
const PLACING = new Set<Tool>(['text', 'sticky', 'shape', 'checklist', 'page', 'table', 'kanban', 'pool'])
/** Roughly how much room each new thing takes, for finding it a free spot (canvas units). */
/** dx/dy = where its top-left sits relative to the point placeTool is given (keep in step with placeTool). */
const PLACE_SIZE: Partial<Record<Tool, { w: number; h: number; dx: number; dy: number }>> = {
  text: { w: 180, h: 44, dx: 0, dy: -14 }, sticky: { w: 180, h: 120, dx: -85, dy: -40 }, shape: { w: 170, h: 70, dx: -80, dy: -32 },
  checklist: { w: 230, h: 140, dx: -110, dy: -20 }, page: { w: 210, h: 90, dx: -100, dy: -30 },
  table: { w: 420, h: 190, dx: -200, dy: -20 }, kanban: { w: 340, h: 220, dx: -160, dy: -20 }, pool: { w: 760, h: 420, dx: -380, dy: -20 },
}
const DOUBLE_TAP_MS = 250
/** One colour per unfolded branch, readable on the navy board; a second open project never shares the first's. */
const BRANCH_COLORS = ['#3BB6A8', '#E5735C', '#9C8CF0', '#5AA9E6', '#D9B44A', '#E47BB0']
const CARD_W = 190, CARD_H = 100
/** where a page's own title and writing sit on its board (canvas units); matches .wb-pagedoc */
const PAGE_DOC = { x: 0, y: 0, w: 680 }

// Which card the board is opened into lives in the URL hash, so the phone's back gesture steps back out.
const hashId = (): string => decodeURIComponent(window.location.hash.replace(/^#\/?/, ''))
// Where you have been in this tab, so ‹ goes back to the place you actually came from (a page you followed a link
// out of, say), not just one level up the tree. Browser back moves through the same entries.
const trailOfVisits: string[] = [hashId()]
/** true while the board being opened was reached by going back: it returns to the view it was left at. */
let cameBack = false
const noteVisit = (h: string): void => {
  cameBack = false
  if (trailOfVisits.length > 1 && trailOfVisits[trailOfVisits.length - 2] === h) { trailOfVisits.pop(); cameBack = true }
  else if (trailOfVisits[trailOfVisits.length - 1] !== h) trailOfVisits.push(h)
}
const canGoBack = (): boolean => trailOfVisits.length > 1
function useFocusId(): [string, (id: string) => void] {
  const [id, setId] = useState(hashId)
  useEffect(() => {
    const on = (): void => { noteVisit(hashId()); setId(hashId()) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const open = useCallback((next: string) => { window.location.hash = next === ROOT_ID ? '' : `/${next}` }, [])
  return [id, open]
}

/**
 * The free-form board. Cards sit wherever they were dropped and nothing re-lays them out; canvas-kit supplies the
 * pan/zoom surface, drag, connection lines and the roll-up that turns task status into progress up the tree.
 */
export default function Whiteboard(): JSX.Element {
  const nodes = useBoardStore((s) => s.nodes)
  const selectedId = useBoardStore((s) => s.selectedId)
  const select = useBoardStore((s) => s.select)
  const addNode = useBoardStore((s) => s.addNode)
  const updateNode = useBoardStore((s) => s.updateNode)
  const moveNode = useBoardStore((s) => s.moveNode)

  // Who is looking. Operators see everything but may only move the status of tasks assigned to them; the server
  // enforces that (firestore.rules), this only keeps the screen honest about it.
  const session = useSession()
  const editable = canEdit(session)
  const myUid = session.user?.uid
  const cloud = session.status === 'ready'
  const inbox = useInbox()
  const unreadCount = inbox.filter((i) => !i.read).length
  const [accountOpen, setAccountOpenRaw] = useState(false)
  // one docked sheet at a time among account / notifications / admin
  const [inboxOpen, setInboxOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const setAccountOpen = useCallback((v: boolean | ((o: boolean) => boolean)) => { setInboxOpen(false); setAdminOpen(false); setAccountOpenRaw(v) }, [])
  // How the cards are shown: as the tree, as a board, or on a timeline. Only the cards change; notes, tables
  // and everything else on the board stay put. Remembered on this device.
  const [viewMode, setViewModeState] = useState<NodeViewMode>(() => {
    // a link may ask for a view: ?view=timeline (also the older names gantt / board / wbs)
    const asked = new URLSearchParams(window.location.search).get('view') ?? ''
    const fromLink = ({ gantt: 'timeline', timeline: 'timeline', board: 'board-project', priority: 'board-priority', eisenhower: 'board-priority', wbs: 'tree', tree: 'tree' } as Record<string, NodeViewMode>)[asked]
    const saved = localStorage.getItem(STORE_KEYS.view)
    return fromLink ?? (VIEW_MODES.some((v) => v.id === saved) ? (saved as NodeViewMode) : 'tree')
  })
  // Scrolling back into a board/timeline view after panning out of it: zoom to 100% (the size the view was fitted
  // to the window at).
  const snapInto = useCallback((panel: HTMLElement): void => {
    const c = canvasRef.current, area = areaRef.current
    if (!c || !area) return
    const a = area.getBoundingClientRect(), r = panel.getBoundingClientRect()
    const wx = (r.left - a.left - c.pan.x) / c.zoom, wy = (r.top - a.top - c.pan.y) / c.zoom
    // board by project lands on its top-left corner; the other views are centred (top-aligned if taller than the screen)
    const w = r.width / c.zoom, h = r.height / c.zoom
    if (panel.dataset.snap === 'corner') c.setView({ x: 12 - wx, y: 64 - wy, zoom: 1 }, { animateMs: 420 })
    else c.setView({ x: (a.width - w) / 2 - wx, y: Math.max(64, (a.height - h) / 2) - wy, zoom: 1 }, { animateMs: 420 })
  }, [])
  const setViewMode = (v: NodeViewMode): void => { localStorage.setItem(STORE_KEYS.view, v); setViewModeState(v) }

  const canvasRef = useRef<CanvasHandle>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const editorClosedAt = useRef(0)

  const board = useMemo(() => deriveBoard(nodes), [nodes])
  // How many cards fit across: 2 on a phone, up to 5 on a desktop. Branches, + slots and grids all use it.
  const [wrap, setWrap] = useState(() => wrapFor(window.innerWidth))
  useEffect(() => { const on = (): void => setWrap(wrapFor(window.innerWidth)); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  const wrapRef = useRef(wrap)
  wrapRef.current = wrap
  const all = useMemo(() => Object.values(nodes), [nodes])

  // Deep dive: double-tap a card to open the board into it. Only that card and what hangs under it are shown,
  // at the same positions, so stepping back out lands exactly where you were.
  const [focusId, openNode] = useFocusId()
  const elements = useElementStore((s) => s.elements)
  // A page (a standalone page or a table row) can be opened the same way. It is a board of its own: everything
  // in the toolbar works inside it, but it holds no work items, so no cards are shown or created there.
  const page = useMemo(() => (focusId.startsWith('p/') ? resolvePage(focusId.slice(2), elements) : null), [focusId, elements])
  const focus = nodes[page ? owningNodeId(page.key, nodes, elements) ?? ROOT_ID : focusId] ?? nodes[ROOT_ID]
  /** what new things on the board belong to: the open card, or the open page */
  const scopeId = page ? page.key : focus.id
  const focusRef = useRef(focus.id)
  focusRef.current = focus.id
  const scopeRef = useRef(scopeId)
  scopeRef.current = scopeId
  const openPageKey = useCallback((key: string) => openNode(`p/${key}`), [openNode])
  const list = useMemo(() => {
    if (page) return []
    // the open card and everything under it, except what sits under a folded card (the open card itself always shows its own)
    const out = [focus]
    for (let i = 0; i < out.length; i++) if (!out[i].collapsed || out[i].id === focus.id) out.push(...(board.kids.get(out[i].id) ?? []))
    return out
  }, [focus, board, page])
  const visible = useMemo(() => new Set(list.map((n) => n.id)), [list])
  // the detail can show any card in the open branch, even one folded away (picked from its parent's list)
  const underFocus = (id: string): boolean => { for (let n = nodes[id]; n; n = n.parentId ? nodes[n.parentId] : undefined as unknown as BoardNode) if (n.id === focus.id) return true; return false }
  // where each card is drawn: stored placement plus the room opened branches make (lib/board.ts displayLayout)
  // Swimlanes (the toolbar's lanes button): the open card's children grouped into lanes, as rows or as columns.
  // Remembered on this device; each card's own `lane` and its parent's `lanes` / `laneDir` are what is shared.
  // Always on when the page loads. Done / the toolbar button turn it off for this visit only: it is not remembered, so a
  // refresh brings it back. While on, the open card's children always sit in labelled lanes: with none made yet they
  // all sit in one visible "Unsorted" band (with a hint to add a lane), so a first-time board is never unexplained.
  const [lanesOn, setLanesOn] = useState(true)
  const toggleLanes = useCallback(() => setLanesOn((v) => !v), [])
  const laneDir: LaneDir = focus.laneDir === 'cols' ? 'cols' : 'rows'
  const laneBar = lanesOn && !page && viewMode === 'tree'
  const hasLanes = (focus.lanes?.length ?? 0) > 0 || (board.kids.get(focus.id) ?? []).some((c) => !!c.lane)
  const laneMode = laneBar
  const laneModeRef = useRef(laneMode); laneModeRef.current = laneMode
  // real card heights (title length varies), so a lane ends just below its tallest card's chips
  const [heights, setHeights] = useState<Record<string, number>>({})
  useLayoutEffect(() => {
    if (!laneMode) return
    const next: Record<string, number> = {}
    let changed = false
    for (const c of board.kids.get(focus.id) ?? []) {
      const el = document.querySelector<HTMLElement>(`.wb-node[data-canvas-id="${CSS.escape(c.id)}"]`)
      if (!el) continue
      const h = el.offsetHeight + 22 // the + and ▸ chips hang below the card
      next[c.id] = h
      if (Math.abs((heights[c.id] ?? 0) - h) > 2) changed = true
    }
    if (changed) setHeights((prev) => ({ ...prev, ...next }))
  })
  // a card being named is part of the layout too (it starts in Unsorted), so the lane it lands in grows to hold it
  const lanes = useMemo(() => {
    if (!laneMode) return null
    let kids = board.kids
    if (editor && visible.has(editor.parentId)) {
      kids = new Map(board.kids)
      const ghost = { id: NEW_CARD_ID, parentId: editor.parentId, kind: editor.kind, title: '', x: editor.sx ?? editor.x, y: 1e9, weight: 1, after: [], createdAt: Number.MAX_SAFE_INTEGER, updatedAt: 0 } as BoardNode
      kids.set(editor.parentId, [...(board.kids.get(editor.parentId) ?? []), ghost])
    }
    return laneLayout(focus, kids, wrap, laneDir, heights)
  }, [laneMode, focus, board, wrap, laneDir, editor, visible, heights])
  const disp = useMemo(() => lanes?.pos ?? displayLayout(focus, board.kids, wrap), [lanes, focus, board, wrap])
  const dispRef = useRef(disp)
  // Unfolded cards: each one (and the branch it shows) gets its own colour; everything else dims back a little.
  const hl = useMemo(() => {
    const out = new Map<string, string>()
    const open = (board.kids.get(focus.id) ?? []).filter((c) => !c.collapsed && (board.kids.get(c.id)?.length ?? 0) > 0)
      .sort((a, b) => a.y - b.y || a.x - b.x || a.createdAt - b.createdAt)
    open.forEach((e, i) => {
      const color = BRANCH_COLORS[i % BRANCH_COLORS.length]
      out.set(e.id, color)
      const walk = (id: string): void => { for (const c of board.kids.get(id) ?? []) { out.set(c.id, color); if (!c.collapsed) walk(c.id) } }
      walk(e.id)
    })
    return out
  }, [board, focus.id])
  dispRef.current = disp
  // stagger for cards growing out of an unfolded card: reading order (row by row, left to right), not list order
  const bornRank = useMemo(() => {
    const ids = list.filter((n) => n.id !== focus.id && n.parentId && n.parentId !== focus.id && disp[n.id]).map((n) => n.id)
    ids.sort((a, b) => disp[a].y - disp[b].y || disp[a].x - disp[b].x)
    return new Map(ids.map((id, i) => [id, Math.min(i, BRANCH_STEPS)]))
  }, [list, disp, focus.id])

  // Free-form layer (text, stickies, pen, images, status boards). Each element belongs to a card and is shown
  // whenever that card is on the board.
  const storageFull = useElementStore((s) => s.storageFull)
  const shownElements = useMemo(() => {
    // project plans (kit) live in their project's Plans sheet, never on the canvas
    const placed = elements.filter((e) => e.kind !== 'connector' && !('kit' in e && e.kit) && (page ? e.scopeId === page.key : visible.has(e.scopeId)))
    const ids = new Set([...visible, ...placed.map((e) => e.id)])
    // an arrow shows when both of its ends are on the board
    return [...placed, ...elements.filter((e) => e.kind === 'connector' && ids.has(e.fromId) && ids.has(e.toId))]
  }, [elements, visible, page])
  const relations = useMemo(() => shownElements.filter((e): e is ConnectorEl => e.kind === 'connector'), [shownElements])
  const [shape, setShape] = useState<ShapeKind>('rect')
  // Arrow tool: first tap picks where it starts, second tap where it points.
  const [connectFrom, setConnectFromState] = useState<string | null>(null)
  const connectFromRef = useRef<string | null>(null)
  const setConnectFrom = (id: string | null): void => { connectFromRef.current = id; setConnectFromState(id) }
  const [tool, setTool] = useState<Tool>('select')
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [selectedEl, setSelectedEl] = useState<string | null>(null)
  // A page that was just dropped: its name panel shows over the board you are on. Going inside it is a separate, later choice.
  const [namingPage, setNamingPage] = useState<string | null>(null)
  const namingEl = namingPage ? elements.find((e): e is PageEl => e.id === namingPage && e.kind === 'page') : undefined
  const toolRef = useRef(tool)
  toolRef.current = tool
  const selectedElement = selectedEl ? shownElements.find((e) => e.id === selectedEl) : undefined
  // deleting a card, a page or a row takes what was on its board with it
  useEffect(() => { useElementStore.getState().prune(new Set(Object.keys(nodes))) }, [nodes, elements])
  const editorParent = editor && visible.has(editor.parentId) ? editor.parentId : null
  const connections = useMemo(() => [
    // Inside a task, everything on the board is already under it: no line from the task to each sub-task.
    ...list.filter((n) => n.parentId && visible.has(n.parentId) && !(focus.kind === 'task' && n.parentId === focus.id))
      .map((n) => ({ fromId: n.parentId as string, toId: n.id, color: hl.get(n.id), dim: hl.size > 0 && !hl.has(n.id) })),
    // while a card is being named, a dashed line shows where it will hang
    ...(editorParent && !(focus.kind === 'task' && editorParent === focus.id) ? [{ fromId: editorParent, toId: NEW_CARD_ID, kind: 'dep' as const }] : []),
  ], [list, visible, hl, editorParent, focus.kind, focus.id])
  const positions = useMemo(() => Object.fromEntries(list.map((n) => [n.id, disp[n.id] ?? { x: n.x, y: n.y }])), [list, disp])
  const operators = useMemo(() => [...new Set(all.map((n) => n.assignee).filter((a): a is string => !!a))].sort(), [all])

  // Opening view, frozen at mount: the portfolio card centred near the top, zoomed out a little on a phone.
  const [initialView] = useState(() => {
    const root = useBoardStore.getState().nodes[ROOT_ID]
    const zoom = Math.max(0.7, Math.min(1, window.innerWidth / 520))
    return { x: window.innerWidth / 2 - (root.x + 95) * zoom, y: 72 - root.y * zoom + 20, zoom }
  })

  /** Glide the view so a canvas point sits in the upper part of the screen (clear of the phone keyboard). */
  const bringIntoView = useCallback((x: number, y: number) => {
    const c = canvasRef.current, el = areaRef.current
    if (!c || !el) return
    const w = el.clientWidth, h = el.clientHeight
    const sx = c.pan.x + x * c.zoom, sy = c.pan.y + y * c.zoom
    // Move only as far as needed: the board should not jump around while a list is being typed in.
    const tx = Math.min(Math.max(sx, 16), Math.max(16, w - 206 * c.zoom))
    // On a touch device the keyboard covers the lower half, so keep the editor in the upper part of the screen.
    const floor = window.matchMedia('(pointer: coarse)').matches ? h * 0.42 : h - 110
    const ty = Math.min(Math.max(sy, 20), Math.max(20, floor))
    if (tx === sx && ty === sy) return
    c.setView({ x: c.pan.x + tx - sx, y: c.pan.y + ty - sy }, { animateMs: 320 })
  }, [])

  // The width the board can use: up to the docked details panel when it sits beside the board (not over it, on a phone).
  const usableW = (el: HTMLElement): number => {
    const dock = document.querySelector<HTMLElement>('.wb-detail.is-docked')
    if (!dock || window.innerWidth < 768) return el.clientWidth
    return Math.max(320, dock.getBoundingClientRect().left - el.getBoundingClientRect().left)
  }
  // Opening into a card (or stepping back out) glides the view to fit what is now on the board.
  const fitView = (): void => {
    const c = canvasRef.current, el = areaRef.current
    if (!c || !el) return
    const w = usableW(el), h = el.clientHeight
    const shown = useBoardStore.getState().nodes
    // cards when a card is open; the page's own elements when a page is open
    const boxes = page
      ? [...(page.kind === 'page' ? [{ x: PAGE_DOC.x, y: PAGE_DOC.y, w: PAGE_DOC.w, h: 260 }] : []),
        ...useElementStore.getState().elements.filter((e) => e.scopeId === page.key && e.kind !== 'connector' && e.kind !== 'stroke').map((e) => ({ x: e.x, y: e.y, w: e.kind === 'pool' ? e.w : e.kind === 'table' || e.kind === 'kanban' ? 640 : 220, h: e.kind === 'pool' ? e.h : 180 }))]
      : (() => { const lay = laneModeRef.current ? laneLayout(shown[focus.id] ?? focus, deriveBoard(shown).kids, wrapRef.current, (shown[focus.id] ?? focus).laneDir === 'cols' ? 'cols' : 'rows').pos : displayLayout(shown[focus.id] ?? focus, deriveBoard(shown).kids, wrapRef.current); return [...visible].map((id) => shown[id]).filter(Boolean).map((n) => ({ ...(lay[n.id] ?? { x: n.x, y: n.y }), w: CARD_W, h: CARD_H })) })()
    if (!boxes.length) return
    const minX = Math.min(...boxes.map((n) => n.x)), maxX = Math.max(...boxes.map((n) => n.x + n.w))
    const minY = Math.min(...boxes.map((n) => n.y)), maxY = Math.max(...boxes.map((n) => n.y + n.h))
    // Readable beats complete: a tall board fits its width and scrolls down, rather than shrinking until nothing can be read.
    const wFit = (w - 32) / (maxX - minX), hFit = (h - 48) / (maxY - minY)
    const zoom = Math.max(0.45, Math.min(1, wFit, Math.max(hFit, Math.min(wFit, 0.85))))
    const fitsWide = (maxX - minX) * zoom <= w - 16
    const top = page ? boxes[0] : shown[focus.id] ?? focus
    c.setView({
      x: fitsWide ? (w - (maxX - minX) * zoom) / 2 - minX * zoom : w / 2 - (top.x + CARD_W / 2) * zoom,
      y: (w < 640 ? 104 : 24) - (fitsWide ? minY : top.y) * zoom, // on a phone the view tabs sit across the top
      zoom,
    }, { animateMs: 460 })
  }
  // Opening into a card whose children are still one long row puts them into a 5-wide grid, once (lib/board.ts).
  useEffect(() => {
    if (page || !editable) return
    const s = useBoardStore.getState().nodes, f = s[focus.id]
    const pos = f && compactChildren(f, deriveBoard(s).kids, wrapRef.current)
    if (pos) useBoardStore.getState().setPositions(pos)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId])
  useEffect(() => { usePicked.getState().clear() }, [scopeId])
  // Each board remembers where you were looking when you left it; going back returns you there (to the thing you
  // followed a link from), not to a fresh fit. Saved when the board is left (the camera has not moved yet).
  const savedViews = useRef(new Map<string, { x: number; y: number; zoom: number }>())
  useEffect(() => () => { const c = canvasRef.current; if (c) savedViews.current.set(scopeId, { ...c.pan, zoom: c.zoom }) }, [scopeId])
  const restoreOrFit = (): void => {
    const v = cameBack ? savedViews.current.get(scopeId) : undefined
    if (v) canvasRef.current?.setView(v, { animateMs: 460 }); else fitView()
  }
  const firstFit = useRef(true)
  useEffect(() => {
    // a blank portfolio opens on its one card (initialView); anything with work on it opens fitted to the screen
    if (firstFit.current) { firstFit.current = false; if (scopeId === ROOT_ID && list.length <= 1) return }
    restoreOrFit()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId])
  const firstView = useRef(true)
  useEffect(() => {
    if (firstView.current) { firstView.current = false; if (viewMode === 'tree') return }
    if (viewMode === 'tree' || page) { restoreOrFit(); return }
    // Centre the board or timeline on screen, zoomed out only as far as needed to fit its width. It is measured
    // after it has been drawn, since its size depends on how much work it shows.
    const c = canvasRef.current, el = areaRef.current
    const panel = document.querySelector<HTMLElement>('.wb-view')
    if (!c || !el || !panel) return
    const W = usableW(el), H = el.clientHeight, pw = panel.offsetWidth, ph = panel.offsetHeight
    const zoom = Math.max(0.5, Math.min(1, (W - 32) / pw))
    c.setView({
      x: Math.max(16, (W - pw * zoom) / 2) - focus.x * zoom,
      y: Math.max(64, (H - ph * zoom) / 2) - focus.y * zoom, // centred when it fits; otherwise top, clear of the view tabs
      zoom,
    }, { animateMs: 460 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, scopeId])

  const openEditor = useCallback((e: Omit<EditorState, 'seq'>) => {
    setEditor((cur) => ({ ...e, seq: (cur?.seq ?? 0) + 1 }))
    bringIntoView(e.x, e.y)
  }, [bringIntoView])

  const closeEditor = useCallback(() => { editorClosedAt.current = Date.now(); setEditor(null) }, [])
  // Esc / cancel: put the card back as it was before + (folded again if + unfolded it and nothing was added)
  const cancelEditor = useCallback(() => {
    setEditor((e) => { if (e?.refold) useBoardStore.getState().updateNode(e.parentId, { collapsed: true }); return e })
    closeEditor()
  }, [closeEditor])

  // Tap on empty board: close whatever is open; if nothing is, start a new card right there, under whatever
  // the board is opened into (a project at the top level, a milestone inside a project, and so on).
  // Put a new thing of kind `t` at canvas point (cx, cy): from a tap on the board, or (phone) straight from the toolbar.
  const placeTool = (t: Tool, cx: number, cy: number): string | undefined => {
    const els = useElementStore.getState()
    const base = { scopeId, z: topZ() }
    if (t === 'text') { const id = els.add({ ...base, kind: 'text', x: cx, y: cy - 14, text: '' }); setSelectedEl(id); setTool('select'); return id }
    if (t === 'sticky') { const id = els.add({ ...base, kind: 'sticky', x: cx - 85, y: cy - 40, text: '', color: STICKY_COLORS[0] }); setSelectedEl(id); setTool('select'); return id }
    if (t === 'shape') { const id = els.add({ ...base, kind: 'shape', shape, x: cx - 80, y: cy - 32, text: '' }); setSelectedEl(id); setTool('select'); return id } // one box per tap: pick the tool again for the next one
    if (t === 'checklist') { const id = els.add({ ...base, kind: 'checklist', x: cx - 110, y: cy - 20, groups: [{ id: 'g' + Date.now().toString(36), title: '', items: [] }] }); setSelectedEl(id); setTool('select'); return id }
    if (t === 'page') { const pid = els.add({ ...base, kind: 'page', x: cx - 100, y: cy - 30, title: '', body: '' }); setSelectedEl(pid); setTool('select'); setNamingPage(pid); return pid }
    if (t === 'table') { const id = els.add({ ...base, kind: 'table', x: cx - 200, y: cy - 20, ...starterTable() }); setSelectedEl(id); setTool('select'); return id }
    if (t === 'pool') { const id = els.add({ ...base, z: 0, kind: 'pool', x: cx - 380, y: cy - 20, dir: 'rows', w: 760, h: 420, title: '', lanes: [1, 2, 3].map((n) => ({ id: 'l' + Date.now().toString(36) + n, title: `Lane ${n}` })) }); setSelectedEl(id); setTool('select'); return id }
    if (t === 'kanban') { const id = els.add({ ...base, kind: 'kanban', x: cx - 160, y: cy - 20, cards: [] }); setSelectedEl(id); setTool('select'); return id }
  }
  /**
   * The nearest point to `at` (canvas units, as placeTool takes it) where a thing of size `size` covers nothing already
   * on the board: rings outward from `at`, closest first, preferring what is on screen. Measured from the DOM, so
   * cards (as drawn, pushed or not), notes, tables and the name box all count.
   */
  const freeSpot = (at: { x: number; y: number }, size: { w: number; h: number; dx: number; dy: number }, ignore?: string): { x: number; y: number } => {
    const c = canvasRef.current, inner = stageRef.current?.querySelector('.wb-inner')
    if (!c || !inner) return at
    const o = inner.getBoundingClientRect(), z = c.zoom, GAP = 16
    const taken = [...inner.querySelectorAll<HTMLElement>('.wb-node:not(.is-leaving), .wb-el:not(.wb-pool), .wb-editor')].filter((el) => !ignore || el.dataset.relId !== ignore).map((el) => {
      const r = el.getBoundingClientRect()
      return { l: (r.left - o.left) / z - GAP, t: (r.top - o.top) / z - GAP, r: (r.right - o.left) / z + GAP, b: (r.bottom - o.top) / z + GAP }
    })
    const free = (x: number, y: number): boolean => {
      const l = x + size.dx, t = y + size.dy, r = l + size.w, b = t + size.h
      return !taken.some((k) => l < k.r && k.l < r && t < k.b && k.t < b)
    }
    // what is on screen (canvas units), less the header and the toolbar
    const area = areaRef.current
    const vw = area ? { l: -c.pan.x / z, t: (-c.pan.y + 110) / z, r: (area.clientWidth - c.pan.x) / z, b: (area.clientHeight - 90 - c.pan.y) / z } : null
    const seen = (x: number, y: number): boolean => !vw || (x + size.dx >= vw.l && y + size.dy >= vw.t && x + size.dx + size.w <= vw.r && y + size.dy + size.h <= vw.b)
    if (free(at.x, at.y) && seen(at.x, at.y)) return at
    const STEP = 30
    let offScreen: { x: number; y: number } | null = null
    for (let ring = 1; ring <= 50; ring++) {
      const pts: { x: number; y: number; d: number }[] = []
      for (let i = -ring; i <= ring; i++) for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) pts.push({ x: at.x + dx * STEP, y: at.y + dy * STEP, d: Math.hypot(dx, dy) })
      pts.sort((a, b) => a.d - b.d)
      for (const p of pts) {
        if (!free(p.x, p.y)) continue
        if (seen(p.x, p.y)) return { x: p.x, y: p.y }
        offScreen ??= { x: p.x, y: p.y }
      }
    }
    return offScreen ?? at
  }
  const lastCanvasTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const onCanvasTap = useCallback((cx: number, cy: number) => {
    if (Date.now() - editorClosedAt.current < 350) return // this tap was the one that dismissed the editor
    if (usePicked.getState().ids.length) { usePicked.getState().clear(); return } // a tap on empty board drops the group
    if (tool === 'connect') { setConnectFrom(null); return }
    if (PLACING.has(tool)) { placeTool(tool, cx, cy); return }
    if (selectedEl) { setSelectedEl(null); return }
    if (!editable || page || viewMode !== 'tree') { select(null); return } // cards are only created in the tree
    if (useBoardStore.getState().selectedId) { select(null); return }
    // A tap on empty board while branches are unfolded folds them all back to the overview.
    if (viewMode === 'tree') {
      const s = useBoardStore.getState().nodes, kids = childMap(s)
      const open = (kids.get(focus.id) ?? []).filter((c) => !c.collapsed && (kids.get(c.id)?.length ?? 0) > 0)
      if (open.length) { for (const c of open) toggleFoldRef.current(c.id); lastCanvasTap.current = null; return }
    }
    // A new card only on a double-tap of empty board; a single tap there does nothing, so a stray tap never starts one.
    const now = Date.now(), last = lastCanvasTap.current
    lastCanvasTap.current = { t: now, x: cx, y: cy }
    if (!last || now - last.t > DOUBLE_TAP_MS + 100 || Math.hypot(cx - last.x, cy - last.y) > 30) return
    lastCanvasTap.current = null
    openEditor({ kind: childKind(focus.kind), parentId: focus.id, x: cx - 95, y: cy - 24, free: true })
  }, [select, openEditor, focus.kind, focus.id, scopeId, page, openPageKey, tool, selectedEl, shape, editable, viewMode])

  // Where a new child of `parentId` will appear: the next slot of its branch as drawn (displayLayout), worked out by
  // laying the board out with a stand-in card added last. The open card's own children keep their stored spots.
  const addSpot = useCallback((parentId: string, kind: NodeKind) => {
    const s = useBoardStore.getState().nodes
    const parent = s[parentId]
    const stored = nextChildSpot(parent, childMap(s), wrapRef.current)
    if (parentId === focusRef.current && !laneModeRef.current) return { ...stored, sx: stored.x, sy: stored.y }
    const NEW = '\u0000new'
    const fake: Record<string, BoardNode> = { ...s, [parentId]: { ...parent, collapsed: false },
      [NEW]: { id: NEW, parentId, kind, title: '', x: stored.x, y: 1e9, weight: 1, after: [], createdAt: Number.MAX_SAFE_INTEGER, updatedAt: 0 } as BoardNode }
    const at = (laneModeRef.current ? laneLayout(fake[focusRef.current] ?? s[ROOT_ID], childMap(fake), wrapRef.current, (fake[focusRef.current] ?? s[ROOT_ID]).laneDir === 'cols' ? 'cols' : 'rows').pos : displayLayout(fake[focusRef.current] ?? s[ROOT_ID], childMap(fake), wrapRef.current))[NEW] ?? stored
    // While a row still has room, the box goes right after its last card as drawn now: the row only re-centres
    // once the card exists, so taking the re-centred slot would cover a neighbour while typing.
    const now = dispRef.current, sibs = (childMap(s).get(parentId) ?? []).map((c) => now[c.id]).filter(Boolean)
    if (parentId === focusRef.current) return { x: at.x, y: at.y, sx: stored.x, sy: stored.y } // swimlanes: the new card starts in Unsorted
    if (sibs.length % wrapRef.current && !parent.collapsed) {
      const rowY = Math.max(...sibs.map((p) => p.y)), last = sibs.filter((p) => p.y === rowY).reduce((a, b) => (b.x > a.x ? b : a))
      return { x: last.x + BRANCH_W, y: rowY, sx: stored.x, sy: stored.y }
    }
    return { x: at.x, y: at.y, sx: stored.x, sy: stored.y }
  }, [])
  const onAddChild = useCallback((id: string) => {
    const s = useBoardStore.getState().nodes
    const parent = s[id]
    if (!parent) return
    select(null)
    // adding under a folded card unfolds it, so the new card appears in place among its siblings
    const refold = !!parent.collapsed && id !== focusRef.current
    if (refold) useBoardStore.getState().updateNode(id, { collapsed: false })
    const kind = childKind(parent.kind)
    openEditor({ kind, parentId: id, ...addSpot(id, kind), refold })
  }, [select, openEditor, addSpot])

  const onSave = (title: string, again: boolean): void => {
    if (!editor) return
    const made = addNode(editor.kind, editor.parentId, editor.sx ?? editor.x, editor.sy ?? editor.y, title)
    if (editor.kind === 'project' && editable) addStarterKit(made) // every new project starts with its five plans
    useBoardStore.getState().setZ({ [made]: topZ() })
    const s = useBoardStore.getState().nodes
    const parent = s[editor.parentId]
    // Enter after + keeps the keyboard up and opens the next sibling, so a whole list goes in without touching the board.
    // A card dropped by double-tapping the board is a one-off: Enter just saves it.
    if (again && parent && !editor.free && editor.kind !== 'project') openEditor({ kind: editor.kind, parentId: editor.parentId, ...addSpot(editor.parentId, editor.kind) })
    else closeEditor()
  }

  // Cards glide to new spots with a CSS transition; pulse so the connection lines follow them there.
  const pulseLines = useCallback(() => {
    const t0 = performance.now()
    const tick = (): void => { window.dispatchEvent(new Event(CANVAS_DRAG_EVENT)); if (performance.now() - t0 < Math.max(GLIDE_MS, BRANCH_MS + BRANCH_STEP * BRANCH_STEPS) + 80) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  }, [])

  // Dragging a card carries the cards under it (see moveNode). Notes, tables and everything else on the board
  // stay where they are: they are things in their own right, not attachments of a card.
  // A card is drawn at its stored spot plus the room opened branches make; the drop is stored without that room.
  const lanesRef = useRef(lanes); lanesRef.current = lanes
  const onMove = useCallback((id: string, x: number, y: number) => {
    const n = useBoardStore.getState().nodes[id], d = dispRef.current[id]
    // swimlanes: the lane under the drop is the card's lane and it snaps into that lane's grid; nothing else moves
    if (laneModeRef.current && lanesRef.current && n && n.parentId === focusRef.current) {
      const dir: LaneDir = (useBoardStore.getState().nodes[focusRef.current]?.laneDir === 'cols') ? 'cols' : 'rows'
      const to = laneAt(lanesRef.current.bands, dir, x + CARD_W / 2, y + CARD_H / 2)
      const lane = to === UNSORTED ? undefined : to
      // the drop spot also orders undated cards inside the lane (left to right / top to bottom)
      updateNode(id, { lane, x: n.x + (x - (d?.x ?? n.x)), y: n.y + (y - (d?.y ?? n.y)) })
      pulseLines()
      return
    }
    const nx = x - (d && n ? d.x - n.x : 0), ny = y - (d && n ? d.y - n.y : 0)
    moveNode(id, nx, ny); if (n) groupMoved(id, nx - n.x, ny - n.y); pulseLines()
  }, [moveNode, pulseLines, updateNode])

  // Tidy: arrange what is on the board into a clean tree. Only on request, and one tap puts it back.
  const [undoTidy, setUndoTidy] = useState<Record<string, { x: number; y: number; collapsed: boolean }> | null>(null)
  const undoTimer = useRef(0)
  const commitLayout = (pos: Record<string, { x: number; y: number; collapsed?: boolean }>): void => useBoardStore.setState((cur) => {
    const next = { ...cur.nodes }
    for (const [k, v] of Object.entries(pos)) if (next[k]) next[k] = { ...next[k], x: v.x, y: v.y, ...(v.collapsed === undefined ? {} : { collapsed: v.collapsed }) }
    return { nodes: next }
  })
  const onTidy = (): void => {
    window.clearTimeout(undoTimer.current)
    if (undoTidy) { commitLayout(undoTidy); setUndoTidy(null) }
    else {
      // Tidy = back to the compact overview: every card folded, the open level laid out as a grid
      setUndoTidy(Object.fromEntries(list.map((n) => [n.id, { x: n.x, y: n.y, collapsed: !!n.collapsed }])))
      const folded: Record<string, BoardNode> = { ...useBoardStore.getState().nodes }
      for (const n of list) if (n.id !== focus.id && (board.kids.get(n.id)?.length ?? 0) > 0) folded[n.id] = { ...folded[n.id], collapsed: true }
      const b2 = deriveBoard(folded)
      const pos = tidyPositions(folded[focus.id], b2.kids, wrapFor(areaRef.current?.clientWidth ?? window.innerWidth))
      commitLayout(Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, { ...v, collapsed: folded[k]?.collapsed }])))
      undoTimer.current = window.setTimeout(() => setUndoTidy(null), 8000)
    }
    pulseLines()
    fitView()
  }

  // Fold one level at a time, inside the project of the card last tapped or folded (the whole board if none).
  // 'task' hides every task (milestones stay); 'milestone' hides every milestone (projects stay).
  const lastTouched = useRef<string | null>(null)
  const onFoldLevel = (level: 'task' | 'milestone'): void => {
    const s = useBoardStore.getState().nodes
    let scope: BoardNode | undefined = lastTouched.current ? s[lastTouched.current] : undefined
    while (scope && scope.kind !== 'project' && scope.parentId) scope = s[scope.parentId]
    if (!scope || scope.kind !== 'project') scope = focus
    const kids = childMap(s)
    const hide: string[] = []
    const holds = level === 'task' ? ['milestone', 'task'] : ['project']
    const walk = (n: BoardNode): void => {
      if (holds.includes(n.kind) && (kids.get(n.id)?.length ?? 0) > 0 && !n.collapsed) hide.push(n.id)
      for (const c of kids.get(n.id) ?? []) walk(c)
    }
    walk(scope)
    if (!hide.length) return
    useBoardStore.setState((cur) => {
      const next = { ...cur.nodes }
      for (const id of hide) next[id] = { ...next[id], collapsed: true, updatedAt: Date.now() }
      return { nodes: next }
    })
    pulseLines()
  }

  // One tap selects (after a short wait, so a double-tap never flashes the sheet); two taps open the card.
  const pendingTap = useRef<{ id: string; timer: number; fire: () => void } | null>(null)
  const pickForArrow = useCallback((id: string) => {
    const from = connectFromRef.current
    if (!from) { setConnectFrom(id); return }
    const els = useElementStore.getState()
    const dup = els.elements.some((e) => e.kind === 'connector' && e.fromId === from && e.toId === id)
    if (from !== id && !dup) els.add({ kind: 'connector', scopeId: scopeRef.current, x: 0, y: 0, fromId: from, toId: id })
    setConnectFrom(null)
  }, [])
  /** Pressing a card brings it to the front, so nothing dropped on it keeps it buried. */
  const raise = useCallback((id: string) => {
    const z = topZ()
    if ((useBoardStore.getState().nodes[id]?.z ?? 0) < z - 1) useBoardStore.getState().setZ({ [id]: z })
  }, [])
  const onTap = useCallback((id: string) => {
    lastTouched.current = id
    if (toolRef.current === 'connect') { pickForArrow(id); return }
    // Cmd/Ctrl-click or a long press picks the card into the group instead of opening it
    if (pickModifier()) { pick(id); return }
    const p = pendingTap.current
    if (p) window.clearTimeout(p.timer)
    pendingTap.current = null
    setSelectedEl(null)
    // second tap on the same card = straight in, with nothing having moved in between
    if (p?.id === id) { select(null); openNode(id); return }
    p?.fire() // a quick tap on another card first: the earlier tap still counts
    // One tap opens any card's detail (name, dates, notes...); folding lives on the card's ▸/▾ chip. It waits the
    // double-tap window first, so a double-tap goes into the card without the detail flashing open and shut.
    const fire = (): void => { select(useBoardStore.getState().selectedId === id ? null : id) }
    const timer = window.setTimeout(() => { pendingTap.current = null; fire() }, DOUBLE_TAP_MS)
    pendingTap.current = { id, timer, fire }
  }, [select, openNode, pickForArrow, board])
  const onOpenSelected = useCallback(() => { const id = useBoardStore.getState().selectedId; if (id) { select(null); openNode(id) } }, [select, openNode])
  const onCycleStatus = useCallback((id: string) => {
    const n = useBoardStore.getState().nodes[id]
    if (n) updateNode(id, { status: nextStatus(n.status ?? 'backlog') })
  }, [updateNode])
  const onCloseSheet = useCallback(() => select(null), [select])
  const [dockOpen, setDockOpen] = useState(true)
  const dockMounted = useRef(false)
  // showing or hiding the details panel re-centres the board in the space left beside it
  useEffect(() => { if (!dockMounted.current) { dockMounted.current = true; return } if (viewMode === 'tree' || page) fitView()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockOpen])
  // Unfolding or folding is only the flag: where the branch shows and the room it makes are worked out when the
  // board is drawn (displayLayout), so nothing moves in storage and folding always lands on the exact layout.
  // Cards a fold just hid stay drawn for a moment, shrinking back into the card they hang from.
  const [leaving, setLeaving] = useState<{ n: BoardNode; at: { x: number; y: number }; to: { x: number; y: number }; rank: number }[]>([])
  const leaveTimer = useRef(0)
  /** the view from just before each unfold moved the camera, so folding can glide back to it */
  const viewBefore = useRef(new Map<string, { x: number; y: number; zoom: number }>())
  /** phone: how many cards of the branch just unfolded are still below the screen (null = none / dismissed) */
  const [moreBelow, setMoreBelow] = useState<{ id: string; n: number } | null>(null)
  const scrollDown = (): void => {
    const c = canvasRef.current, area = areaRef.current
    if (!c || !area) return
    const step = (area.clientHeight - 200) * 0.85
    c.setView({ y: c.pan.y - step }, { animateMs: 380 })
    setMoreBelow((m) => (m ? { ...m, n: Math.max(0, m.n - Math.max(1, Math.round(step / (175 * c.zoom)) * wrapRef.current)) } : m))
  }
  const onToggleFold = useCallback((id: string) => {
    lastTouched.current = id
    const s = useBoardStore.getState().nodes
    const n = s[id]
    if (!n) return
    if (!n.collapsed) {
      const kids = childMap(s), d = dispRef.current, to = d[id]
      const gone: BoardNode[] = []
      const walk = (x: string): void => { for (const c of kids.get(x) ?? []) { if (d[c.id]) gone.push(c); if (!c.collapsed) walk(c.id) } }
      walk(id)
      if (to && gone.length) {
        const order = [...gone].sort((a, b) => d[b.id].y - d[a.id].y || d[b.id].x - d[a.id].x) // last in, first out
        window.clearTimeout(leaveTimer.current)
        const add = order.map((c, rank) => ({ n: c, at: d[c.id], to, rank: Math.min(rank, BRANCH_STEPS) }))
        setLeaving((l) => [...l.filter((x) => !add.some((a) => a.n.id === x.n.id)), ...add]) // several branches can fold at once
        leaveTimer.current = window.setTimeout(() => setLeaving([]), BRANCH_MS + BRANCH_STEP * BRANCH_STEPS + 60)
      }
    } else setLeaving((l) => (l.length ? [] : l))
    useBoardStore.getState().updateNode(id, { collapsed: !n.collapsed })
    pulseLines()
    // Camera: unfolding frames the card and what it revealed (always on a phone; on a big screen only if some of it
    // would be off-screen). Folding glides back to the view from before the unfold.
    const c = canvasRef.current, area = areaRef.current
    if (!c || !area) return
    if (!n.collapsed) {
      setMoreBelow(null)
      const back = viewBefore.current.get(id)
      viewBefore.current.delete(id)
      if (back) c.setView(back, { animateMs: 420 })
      return
    }
    const after = useBoardStore.getState().nodes, kids = childMap(after)
    const lay = laneModeRef.current ? laneLayout(after[focusRef.current] ?? after[ROOT_ID], kids, wrapRef.current, (after[focusRef.current] ?? after[ROOT_ID]).laneDir === 'cols' ? 'cols' : 'rows').pos : displayLayout(after[focusRef.current] ?? after[ROOT_ID], kids, wrapRef.current)
    const ids = [id]
    const walk = (x: string): void => { for (const k of kids.get(x) ?? []) { ids.push(k.id); if (!k.collapsed) walk(k.id) } }
    walk(id)
    const boxes = ids.map((k) => lay[k]).filter(Boolean)
    if (!boxes.length) return
    const minX = Math.min(...boxes.map((b) => b.x)) - 24, maxX = Math.max(...boxes.map((b) => b.x)) + CARD_W + 24
    const minY = Math.min(...boxes.map((b) => b.y)) - 24, maxY = Math.max(...boxes.map((b) => b.y)) + CARD_H + 60
    const w = area.clientWidth, h = area.clientHeight, top = w < 640 ? 110 : 70, bottom = 90 // clear of the header and the toolbar
    const phone = w < 640
    const onScreen = (x: number, y: number): boolean => { const sx = c.pan.x + x * c.zoom, sy = c.pan.y + y * c.zoom; return sx >= 0 && sx <= w && sy >= top && sy <= h - bottom }
    if (!phone && onScreen(minX, minY) && onScreen(maxX, maxY)) return
    // A phone keeps cards readable (never below 85%) and frames the top of the branch; the rest is a thumb-scroll
    // down, with a "more below" hint. A big screen fits the whole branch.
    const fit = Math.min(phone ? 1.1 : 1, (w - 16) / (maxX - minX), (h - top - bottom) / (maxY - minY))
    const zoom = phone ? Math.max(0.85, Math.min(1, fit)) : Math.max(0.45, fit)
    viewBefore.current.set(id, { x: c.pan.x, y: c.pan.y, zoom: c.zoom })
    const view = { x: (w - (maxX - minX) * zoom) / 2 - minX * zoom, y: top - minY * zoom, zoom }
    c.setView(view, { animateMs: 460 })
    const below = boxes.filter((b) => view.y + (b.y + CARD_H) * zoom > h - bottom).length
    setMoreBelow(below ? { id, n: below } : null)
  }, [pulseLines])
  // Whatever changed the drawn layout (a tap, +, Esc, Tidy, a teammate), keep the lines on the cards while they move.
  useEffect(() => { pulseLines() }, [disp, pulseLines])
  const toggleFoldRef = useRef(onToggleFold)
  toggleFoldRef.current = onToggleFold
  const onSelectInView = useCallback((id: string) => { setSelectedEl(null); select(id) }, [select])
  const treeView = viewMode === 'tree' || !!page

  // ---- free-form tools ---------------------------------------------------------------------------------
  const onSelectElement = useCallback((id: string | null) => {
    if (id && toolRef.current === 'connect') { pickForArrow(id); return }
    setSelectedEl(id)
    if (id) select(null)
  }, [select, pickForArrow])
  const onOpenRow = useCallback((tableId: string, rowId: string) => { select(null); setSelectedEl(null); openPageKey(rowKey(tableId, rowId)) }, [select, openPageKey])
  // Plans sheet (lib/pmkit.ts): which project's plans are showing, and which plan is open in it
  const [plansFor, setPlansFor] = useState<{ id: string; open?: string } | null>(null)
  const plansCount = useMemo(() => {
    const out = new Map<string, { started: number; total: number } | null>()
    for (const n of list) if (n.kind === 'project') { const p = plansOf(n.id, elements); out.set(n.id, p.length ? { started: p.filter(isStarted).length, total: p.length } : null) }
    return out
  }, [list, elements])
  const onOpenPlans = useCallback((id: string) => { select(null); setSelectedEl(null); setPlansFor({ id }) }, [select])
  const onOpenPage = useCallback((id: string) => { select(null); setSelectedEl(null); openPageKey(id) }, [select, openPageKey])
  /** hash target for any scope: a card id as is, a page key behind "p/" */
  const hashOf = (scope: string): string => (nodes[scope] ? scope : `p/${scope}`)

  /** Search result or link -> go there: open the board that shows it, glide to it, select it. Never a new screen. */
  const goTo = (h: SearchHit): void => {
    // a project plan opens in its project's Plans sheet, over whatever board is showing
    const kitEl = h.elementId && !h.rowId ? elements.find((e) => e.id === h.elementId && 'kit' in e && e.kit) : undefined
    if (kitEl && nodes[kitEl.scopeId]) { select(null); setSelectedEl(null); setPlansFor({ id: kitEl.scopeId, open: kitEl.id }); return }
    setPlansFor(null) // going anywhere else closes the plans
    const isPage = !!h.elementId && !h.rowId && elements.find((e) => e.id === h.elementId)?.kind === 'page'
    // a row or a page is itself a place: open it rather than pointing at where it sits
    if (h.elementId && (h.rowId || isPage)) { select(null); setSelectedEl(null); openPageKey(h.rowId ? rowKey(h.elementId, h.rowId) : h.elementId); return }
    if (h.nodeId && viewMode !== 'tree') setViewMode('tree')
    const onThisBoard = h.nodeId ? !page && (h.nodeId === ROOT_ID || visible.has(h.nodeId)) : h.scopeId === scopeId || (!page && visible.has(h.scopeId))
    const moved = !onThisBoard
    if (moved) openNode(h.nodeId ? nodes[h.nodeId]?.parentId ?? ROOT_ID : hashOf(h.scopeId))
    window.setTimeout(() => {
      const c = canvasRef.current, el = areaRef.current
      if (c && el && h.x !== undefined && h.y !== undefined) c.setView({ x: el.clientWidth / 2 - (h.x + 95) * c.zoom, y: el.clientHeight * 0.3 - h.y * c.zoom }, { animateMs: 380 })
      if (h.nodeId) { setSelectedEl(null); select(h.nodeId) }
      else if (h.elementId) { select(null); setSelectedEl(h.elementId) }
    }, moved ? 560 : 0) // after the fit-to-board glide
  }
  const goToRef = useRef(goTo)
  goToRef.current = goTo
  const stableGoTo = useCallback((h: SearchHit) => goToRef.current(h), [])
  const onSelectRelation = useCallback((id: string) => { setSelectedEl(id); select(null) }, [select])
  // Where pasted things land: under the mouse if it is over the board, otherwise the middle of what is on screen.
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  const pasteSpot = (): { x: number; y: number } => {
    const c = canvasRef.current, el = stageRef.current
    if (!c || !el) return { x: focus.x, y: focus.y + 200 }
    const r = el.getBoundingClientRect(), p = lastPointer.current
    const inside = p && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom
    const sx = inside ? p.x - r.left : r.width / 2, sy = inside ? p.y - r.top : r.height / 2
    return { x: (sx - c.pan.x) / c.zoom, y: (sy - c.pan.y) / c.zoom }
  }
  const addImage = async (file: Blob): Promise<void> => {
    try {
      const img = await fileToSmallDataUrl(file)
      const at = pasteSpot()
      const shown = Math.min(320, img.w)
      setSelectedEl(useElementStore.getState().add({ kind: 'image', scopeId, z: topZ(), x: at.x - shown / 2, y: at.y - (shown / img.w) * img.h / 2, ...img }))
      select(null)
    } catch (err) { console.error('Could not add image', err) }
  }
  const addPastedText = (text: string): void => {
    const at = pasteSpot()
    setSelectedEl(useElementStore.getState().add({ kind: 'text', scopeId, z: topZ(), x: at.x, y: at.y, text }))
    select(null)
  }
  // Cmd/Ctrl+C / V for the selected card (with its branch) or board item; see lib/clipboard.ts
  const pasteEntity = (json: string): boolean => {
    const made = pastePayload(json, pasteSpot(), { scopeId, focusId: focus.id, selectedNodeId: useBoardStore.getState().selectedId, allowNodes: editable && !page && viewMode === 'tree' })
    if (!made) return false
    if (made.elementId) { setSelectedEl(made.elementId); select(null) } else if (made.nodeId) { setSelectedEl(null); select(made.nodeId) }
    return true
  }
  const pasteRef = useRef({ addImage, addPastedText, pasteEntity, selectedEl, editable })
  pasteRef.current = { addImage, addPastedText, pasteEntity, selectedEl, editable }
  useEffect(() => {
    // Cmd/Ctrl+V anywhere on the board: an image becomes an image, text becomes a text label.
    // While the cursor is in a typing field, text pastes are left alone so the field receives them.
    const onPaste = (e: ClipboardEvent): void => {
      const cd = e.clipboardData
      if (!cd) return
      const file = [...cd.items].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile()
        ?? [...cd.files].find((f) => f.type.startsWith('image/'))
      if (file) { e.preventDefault(); void pasteRef.current.addImage(file); return }
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement | null)?.tagName ?? '')
      const clip = cd.getData(CLIP_TYPE)
      if (!typing && clip && pasteRef.current.editable) { e.preventDefault(); pasteRef.current.pasteEntity(clip); return }
      const text = cd.getData('text/plain').trim()
      if (!typing && text) { e.preventDefault(); pasteRef.current.addPastedText(text.slice(0, 2000)) }
    }
    const onPointer = (e: PointerEvent): void => {
      lastPointer.current = { x: e.clientX, y: e.clientY }
      // teammates see this pointer, in board coordinates, while it is over the board itself
      const c = canvasRef.current, el = stageRef.current, t = e.target as Element | null
      if (!c || !el || !t?.closest?.('.wb-stage') || t.closest('.wb-tools-wrap, .wb-views')) { report({ x: null, y: null }); return }
      const r = el.getBoundingClientRect()
      report({ x: Math.round((e.clientX - r.left - c.pan.x) / c.zoom), y: Math.round((e.clientY - r.top - c.pan.y) / c.zoom) })
    }
    const onAway = (): void => report({ x: null, y: null })
    const onHidden = (): void => { if (document.hidden) report({ x: null, y: null, edit: null }) }
    // ...and which field the cursor is in: a table cell, something on the board, or the open sheet
    const onFocusIn = (e: FocusEvent): void => {
      const t = e.target as Element | null
      if (!t?.matches?.('input, textarea, select')) return
      report({ edit: t.getAttribute('data-cell') ?? t.closest('[data-peer-cell]')?.getAttribute('data-peer-cell') ?? t.closest('[data-rel-id]')?.getAttribute('data-rel-id') ?? (t.closest('.wb-sheet') ? sheetKey.current : null) })
    }
    const onFocusOut = (): void => report({ edit: null })
    document.documentElement.addEventListener('mouseleave', onAway)
    document.addEventListener('visibilitychange', onHidden)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('pointerdown', onPointer, { passive: true })
    const onKey = (e: KeyboardEvent): void => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)
      // Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y redoes. Inside a typing field the field's own undo is left alone.
      if ((e.metaKey || e.ctrlKey) && !typing && pasteRef.current.editable) {
        const k = e.key.toLowerCase()
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
        if (k === 'y') { e.preventDefault(); redo(); return }
      }
      if (e.key === 'Escape') { setTool('select'); setConnectFrom(null); if (!typing) setSelectedEl(null) }
      if (e.key === 'Escape') usePicked.getState().clear()
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && usePicked.getState().ids.length && pasteRef.current.editable) {
        // everything picked goes: board elements, and cards with what hangs under them (never the card the board is open into)
        const es = useElementStore.getState(), bs = useBoardStore.getState(), ids = usePicked.getState().ids
        for (const id of ids) {
          if (es.elements.some((x) => x.id === id)) es.remove(id)
          else if (bs.nodes[id] && id !== ROOT_ID && id !== focusRef.current) useBoardStore.getState().deleteNode(id)
        }
        select(null)
        usePicked.getState().clear(); return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) setSelectedEl((id) => { if (id) useElementStore.getState().remove(id); return null })
    }
    const onCopy = (e: ClipboardEvent): void => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement | null)?.tagName ?? '')
      if (typing || !e.clipboardData || window.getSelection()?.toString()) return
      const data = copyPayload({ elementId: pasteRef.current.selectedEl, nodeId: useBoardStore.getState().selectedId })
      if (!data) return
      e.preventDefault()
      e.clipboardData.setData(CLIP_TYPE, data.json)
      e.clipboardData.setData('text/plain', data.text)
    }
    window.addEventListener('copy', onCopy)
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKey)
    return () => { document.documentElement.removeEventListener('mouseleave', onAway); document.removeEventListener('visibilitychange', onHidden); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut); window.removeEventListener('copy', onCopy); window.removeEventListener('paste', onPaste); window.removeEventListener('keydown', onKey); window.removeEventListener('pointermove', onPointer); window.removeEventListener('pointerdown', onPointer) }
  }, [])

  // ---- working together: tell teammates where this tab is, and go to where they are -------------------------
  const sharedView = page ? 'tree' : viewMode
  /** what the open sheet is about, for "typing in…" */
  const sheetKey = useRef<string | null>(null)
  sheetKey.current = accountOpen || inboxOpen || adminOpen ? null : page ? page.key.split(':')[0] : namingEl?.id ?? selectedId
  useEffect(() => { report({ scope: scopeId, view: sharedView }) }, [scopeId, sharedView])
  useEffect(() => { report({ sel: selectedEl ?? selectedId ?? null }) }, [selectedEl, selectedId])
  const placeOf = (p: Person): string => {
    const pg = nodes[p.scope] ? null : resolvePage(p.scope, elements)
    const where = nodes[p.scope]?.title ?? (pg ? pageTitle(pg) : 'Somewhere else')
    const how = VIEW_MODES.find((v) => v.id === p.view)?.label
    return p.scope === scopeId && p.view === sharedView ? `${where} · on this board with you` : how && p.view !== 'tree' ? `${where} · ${how}` : where
  }
  const goToPerson = (uid: string): void => {
    const find = (): ReturnType<typeof usePresence.getState>['peers'][number] | undefined => {
      const mine = usePresence.getState().peers.filter((x) => x.uid === uid)
      return mine.find((x) => x.x !== undefined) ?? mine[0]
    }
    const p = find()
    if (!p) return
    if (!nodes[p.scope] && !resolvePage(p.scope, elements)) return // that board no longer exists
    if (nodes[p.scope] && p.view !== viewMode && VIEW_MODES.some((v) => v.id === p.view)) setViewMode(p.view as NodeViewMode)
    const moved = p.scope !== scopeId || p.view !== sharedView
    if (p.scope !== scopeId) openNode(hashOf(p.scope))
    window.setTimeout(() => {
      const now = find(), c = canvasRef.current, el = areaRef.current
      if (!now || !c || !el || now.x === undefined || now.y === undefined) return
      c.setView({ x: el.clientWidth / 2 - now.x * c.zoom, y: el.clientHeight * 0.4 - now.y * c.zoom }, { animateMs: 380 })
    }, moved ? 560 : 0) // after the fit-to-board glide
  }

  const onStrokeDone = (path: string): void => { useElementStore.getState().add({ kind: 'stroke', scopeId, x: 0, y: 0, path, color: penColor, width: 3 }) }
  const onEraseAt = (cx: number, cy: number): void => {
    const reach = 14 / (canvasRef.current?.zoom ?? 1)
    for (const e of shownElements) {
      if (e.kind !== 'stroke') continue
      const nums = e.path.match(/-?[\d.]+/g)?.map(Number) ?? []
      for (let i = 0; i + 1 < nums.length; i += 2) {
        if (Math.hypot(nums[i] + e.x - cx, nums[i + 1] + e.y - cy) < reach) { useElementStore.getState().remove(e.id); break }
      }
    }
  }
  const onTool = (t: Tool): void => {
    setConnectFrom(null); closeEditor()
    if (t !== 'select') { select(null); setSelectedEl(null) }
    // On a phone, a thing to place appears at once in the middle of the screen, ready to type in: no second tap.
    const c = canvasRef.current, area = areaRef.current
    if (PLACING.has(t) && c && area && area.clientWidth < 640) {
      const want = { x: (area.clientWidth / 2 - c.pan.x) / c.zoom, y: (area.clientHeight * 0.42 - c.pan.y) / c.zoom }
      const est = PLACE_SIZE[t] ?? { w: 200, h: 100, dx: -100, dy: -50 }
      const spot = freeSpot(want, est)
      const id = placeTool(t, spot.x, spot.y)
      // the guess at its size can be short (a table is as wide as its columns): once drawn, measure it, and if it
      // still covers something, move it to the nearest spot that fits its real size
      if (id) requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = stageRef.current?.querySelector<HTMLElement>(`[data-rel-id="${id}"]`), cz = canvasRef.current?.zoom ?? 1
        const me = useElementStore.getState().elements.find((e) => e.id === id)
        if (!el || !me) return
        const r = el.getBoundingClientRect()
        const real = { w: r.width / cz, h: r.height / cz, dx: 0, dy: 0 }
        const next = freeSpot({ x: me.x, y: me.y }, real, id)
        if (next.x !== me.x || next.y !== me.y) useElementStore.getState().update(id, { x: next.x, y: next.y })
        // no free room on screen: bring it into view, so what is being typed into can be seen
        const cv = canvasRef.current, ar = areaRef.current
        if (cv && ar) {
          const sx = cv.pan.x + next.x * cv.zoom, sy = cv.pan.y + next.y * cv.zoom
          if (sx < 0 || sy < 110 || sx + real.w * cv.zoom > ar.clientWidth || sy + real.h * cv.zoom > ar.clientHeight - 90)
            cv.setView({ x: ar.clientWidth / 2 - (next.x + real.w / 2) * cv.zoom, y: ar.clientHeight * 0.4 - (next.y + real.h / 2) * cv.zoom }, { animateMs: 380 })
        }
      }))
      setTool('select')
      return
    }
    setTool(t)
  }
  // ---- the row above the tools: whatever is relevant to what you are doing right now ------------------------
  const swatchRow = (colors: string[], current: string, onPick: (c: string) => void): JSX.Element => (
    <div key="swatches" className="wb-swatches" role="group" aria-label="Colour">
      {colors.map((c) => (
        <button key={c} onClick={() => onPick(c)} aria-label={`Colour ${c}`} aria-pressed={c === current} className={c === current ? 'is-on' : ''}><i style={{ background: c }} /></button>
      ))}
    </div>
  )
  // layer order applies to the selected element, or to the selected card
  const stackTarget = selectedElement ? (selectedElement.kind === 'connector' ? null : selectedElement.id) : selectedId && visible.has(selectedId) ? selectedId : null
  const shownIds = (): Set<string> => new Set([...visible, ...shownElements.map((e) => e.id)])
  const onLaneEdit = useCallback((e: LaneEdit): string | undefined => {
    const st = useBoardStore.getState().nodes
    const r = applyLaneEdit(st, focusRef.current, childMap(st), e)
    if (r.error) return r.error
    if (r.nodes !== st) useBoardStore.setState({ nodes: r.nodes }) // one write: one undo puts the whole edit back
    pulseLines()
    return undefined
  }, [pulseLines])
  const laneCounts = useMemo(() => {
    const names = laneNames(focus, board.kids), out: Record<string, number> = {}
    for (const c of board.kids.get(focus.id) ?? []) { const k = c.lane && names.includes(c.lane) ? c.lane : UNSORTED; out[k] = (out[k] ?? 0) + 1 }
    return out
  }, [focus, board])
  const context: JSX.Element[] = []
  if (selectedElement?.kind === 'pool' && editable) context.push(<PoolTools key="pool" el={selectedElement} />)
  if (laneBar && editable) context.push(<LaneBar key="lanes" names={laneNames(focus, board.kids)} counts={laneCounts} dir={laneDir} onDir={(d) => updateNode(focus.id, { laneDir: d })} onEdit={onLaneEdit} onDone={toggleLanes} />)
  if (tool === 'connect') context.push(<span key="hint" className="wb-context-hint">{connectFrom ? 'Now tap what it points to' : 'Tap where the arrow starts'}</span>)
  else if (tool === 'shape') context.push(
    <div key="shapes" className="wb-swatches" role="group" aria-label="Shape">
      {SHAPES.map(({ id, label, Icon }) => <button key={id} title={label} aria-label={label} aria-pressed={shape === id} className={`wb-ctx-btn ${shape === id ? 'is-on' : ''}`} onClick={() => setShape(id)}><Icon size={18} /></button>)}
    </div>)
  else if (tool === 'draw') context.push(swatchRow(PEN_COLORS, penColor, setPenColor))
  else {
    if (stackTarget) context.push(
      <div key="stack" className="wb-swatches" role="group" aria-label="Layer order">
        {STACK_OPS.map(({ op, label, Icon }) => <button key={op} title={label} aria-label={label} className="wb-ctx-btn" onClick={() => restack(stackTarget, op, shownIds())}><Icon size={18} /></button>)}
      </div>)
    if (selectedElement?.kind === 'sticky') context.push(swatchRow(STICKY_COLORS, selectedElement.color, (c) => useElementStore.getState().update(selectedElement.id, { color: c })))
    if (selectedElement?.kind === 'connector') context.push(
      <input key="label" className="wb-context-input" value={selectedElement.label ?? ''} placeholder="Label this arrow (e.g. Yes)" maxLength={40}
        onChange={(e) => useElementStore.getState().update(selectedElement.id, { label: e.target.value })} />)
  }

  const selected = selectedId ? nodes[selectedId] : undefined
  const focusView = board.view(focus)
  // Where you are, as a trail: the cards above, then any pages you have gone into.
  const trail: { target: string; title: string }[] = []
  for (let cur: string | undefined = focus.id; cur && nodes[cur]; cur = nodes[cur].parentId) trail.unshift({ target: cur, title: nodes[cur].title })
  if (page) {
    const pages: typeof trail = []
    for (let key: string | undefined = page.key, i = 0; key && !nodes[key] && i < 30; key = parentScope(key, elements), i++) {
      const pg = resolvePage(key, elements)
      if (!pg) break
      pages.unshift({ target: `p/${key}`, title: pageTitle(pg) })
    }
    trail.push(...pages)
  }
  const here = trail[trail.length - 1]
  const crumbs = trail.slice(0, -1)
  const inside = scopeId !== ROOT_ID
  // ‹ (and closing a page) returns to where you were before; with nothing behind you in this tab, one level up.
  const goUp = (): void => { if (canGoBack()) window.history.back(); else openNode(crumbs.length ? crumbs[crumbs.length - 1].target : ROOT_ID) }
  const childLabel = KIND_LABEL[childKind(focus.kind)].toLowerCase()
  const pathOf = (id: string): string => {
    const out: string[] = []
    let cur = nodes[id]?.parentId
    while (cur && nodes[cur]) { out.unshift(nodes[cur].title); cur = nodes[cur].parentId }
    return out.join(' › ')
  }

  return (
    <LinkProvider nodes={nodes} elements={elements} goTo={stableGoTo}>
    <div className="wb">
      <header className="wb-top">
        <button className={`wb-brand ${inside ? 'is-inside' : ''}`} onClick={() => openNode(ROOT_ID)} aria-label="Home" title="Home">ProjectPortfolio</button>
        {inside && (
          <>
            <button className="wb-back" onClick={goUp} aria-label="Back" title="Back">‹</button>
            <nav className="wb-crumbs" aria-label="Where you are">
              {crumbs.map((c) => <button key={c.target} onClick={() => openNode(c.target)}>{c.title}</button>)}
              <span>{here?.title}</span>
            </nav>
          </>
        )}
        <SearchBar nodes={nodes} elements={elements} canLink={editable && (treeView || !!page)}
          onPick={(h, mode) => {
            if (mode !== 'link') { goTo(h); return }
            const at = pasteSpot()
            setSelectedEl(useElementStore.getState().add({ kind: 'link', scopeId, z: topZ(), x: at.x - 90, y: at.y - 20, key: h.key, title: h.title }))
          }} />
        {editable && treeView && !page && list.length > 2 && <button className="wb-tidy" onClick={onTidy}>{undoTidy ? 'Undo' : 'Tidy'}</button>}
        {editable && treeView && !page && list.length > 2 && <>
          <button className="wb-tidy" onClick={() => onFoldLevel('task')} title="Fold away the tasks (in the project you last touched)">− Tasks</button>
          <button className="wb-tidy" onClick={() => onFoldLevel('milestone')} title="Fold away the milestones (in the project you last touched)">− Milestones</button>
        </>}
        {!page && <span className="wb-top-stat" style={{ color: focusView.color }}>
          <i style={{ background: focusView.color }} />
          {focus.kind === 'task' ? (focusView.leaf ? focusView.label : `${focusView.pct}%`)
            : focusView.total ? `${focusView.pct}% · ${focusView.done}/${focusView.total}` : 'No tasks yet'}
        </span>}
        {DEMO && <button className="wb-tidy" onClick={resetDemo} title="Put the example back as it was. Your changes are only in this browser.">Reset demo</button>}
        {cloud && <PresenceBar placeOf={placeOf} onGoTo={goToPerson} />}
        {cloud && (
          <button className="wb-bell" onClick={() => { const next = !inboxOpen; setAccountOpen(false); setInboxOpen(next) }}
            aria-label={unreadCount ? `Notifications, ${unreadCount} new` : 'Notifications'} title="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
            {unreadCount > 0 && <em>{unreadCount > 9 ? '9+' : unreadCount}</em>}
          </button>
        )}
        {cloud && (
          <button className="wb-account" onClick={() => setAccountOpen((o) => !o)} aria-label="Account and team"
            title={session.sync === 'saved' ? 'All changes saved' : session.sync === 'saving' ? 'Saving…' : 'Offline: changes are kept on this device'}>
            {(session.user?.name ?? '?').charAt(0).toUpperCase()}
            <i className={`is-${session.sync}`} />
          </button>
        )}
      </header>

      <div ref={areaRef} className="wb-area" onPointerDownCapture={(e) => { if (moreBelow && !(e.target as HTMLElement).closest('.wb-more-below')) setMoreBelow(null) }}>
        {moreBelow && moreBelow.n > 0 && <button className="wb-more-below" onClick={scrollDown}>▾ {moreBelow.n} more below</button>}
        <div ref={stageRef} className={`wb-stage ${tool === 'text' || tool === 'sticky' || tool === 'checklist' || tool === 'shape' || tool === 'kanban' || tool === 'pool' || tool === 'table' || tool === 'page' ? 'is-placing' : ''}`}>
        <MobileCanvas ref={canvasRef} className="wb-canvas" initialView={initialView} onCanvasTap={onCanvasTap}>
          <div className="wb-dots" />
          <div className="canvas-inner wb-inner">
            {laneMode && lanes && lanes.bands.map((b, i) => (
              <div key={b.name} className={`wb-lane is-${laneDir}${b.count ? '' : ' is-empty'}`} aria-hidden
                style={{ left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top, '--lane': `var(--lane-${i % 6})` } as React.CSSProperties}>
                <span className="wb-lane-label">{b.name}<b>{b.count}</b>{!hasLanes && b.name === UNSORTED && b.count > 0 && <em className="wb-lane-note">add a lane in the bar below to group these cards</em>}</span>
                {!b.count && <span className="wb-lane-hint">Drop cards here</span>}
              </div>
            ))}
            {treeView && <ConnectionLines connections={connections} positions={positions} />}
            <RelationLines relations={relations} tick={shownElements} selectedId={selectedEl} onSelect={onSelectRelation} />
            {page?.kind === 'page' && <StandalonePage onBoard page={page.page} nodes={nodes} elements={elements} onGoTo={goTo} onClose={goUp} />}
            <Elements elements={shownElements} selectedId={connectFrom ?? selectedEl} onSelect={onSelectElement} onOpenRow={onOpenRow} onOpenPage={onOpenPage} />
            {!treeView && viewMode === 'timeline' && <NodeTimeline focus={focus} nodes={nodes} board={board} selectedId={selectedId} onSelect={onSelectInView} canEdit={editable} myUid={myUid} onSnapIn={snapInto} />}
            {!treeView && viewMode !== 'timeline' && <NodeBoard focus={focus} nodes={nodes} board={board} selectedId={selectedId} onSelect={onSelectInView} canEdit={editable} myUid={myUid} onSnapIn={snapInto} by={viewMode === 'board-milestone' ? 'milestone' : 'project'} axis={viewMode === 'board-priority' ? PRIORITY_AXIS : STATUS_AXIS} />}
            {treeView && leaving.map(({ n, at, to, rank }) => (
              <div key={`leaving-${n.id}`} className="wb-node is-leaving" aria-hidden
                style={{ left: at.x, top: at.y, '--z': n.z ?? 0, '--tx': `${to.x - at.x}px`, '--ty': `${to.y - at.y}px`, '--i': rank } as React.CSSProperties}>
                <BoardCard node={{ ...n, ...at }} view={board.view(n)} selected={false} onTap={noop} onMove={noop} onAddChild={noop}
                  onCycleStatus={noop} canAdd={false} canStatus={false} childCount={board.kids.get(n.id)?.length ?? 0} onToggleFold={noop} />
              </div>
            ))}
            {treeView && list.map((n) => {
              // a card shown because its parent is unfolded (not the open card or its own children) branches out of it
              const from = n.id !== focus.id && n.parentId !== focus.id && n.parentId ? disp[n.parentId] : undefined
              const at = disp[n.id]
              return (
              <div key={n.id} className={`wb-node${hl.has(n.id) ? ' is-hl' : hl.size && n.id !== focus.id ? ' is-dim' : ''}${from && at ? ' is-born' : ''}`} data-canvas-id={n.id} data-rel-id={n.id} onPointerDownCapture={() => raise(n.id)}
                style={{ left: at?.x ?? n.x, top: at?.y ?? n.y, '--z': n.z ?? 0, '--hl': hl.get(n.id),
                  ...(from && at ? { '--fx': `${from.x - at.x}px`, '--fy': `${from.y - at.y}px`, '--i': bornRank.get(n.id) ?? 0 } : {}) } as React.CSSProperties}>
                <BoardCard node={disp[n.id] ? { ...n, x: disp[n.id].x, y: disp[n.id].y } : n} view={board.view(n)} selected={selectedId === n.id || connectFrom === n.id}
                  onTap={onTap} onMove={onMove} onAddChild={onAddChild} onCycleStatus={onCycleStatus}
                  canAdd={editable} canStatus={editable || (!!myUid && n.assigneeUid === myUid)}
                  childCount={n.id === focus.id ? 0 : board.kids.get(n.id)?.length ?? 0} onToggleFold={onToggleFold}
                  plans={n.kind === 'project' ? plansCount.get(n.id) ?? null : undefined} onOpenPlans={n.kind === 'project' ? onOpenPlans : undefined} />
                <PeerMark id={n.id} />
              </div>
              )
            })}
            {editable && treeView && !page && list.length === 1 && !editor && (
              <div className="wb-hint" style={{ left: focus.x - 30, top: focus.y + 130 }}>
                Tap <b>+</b> to add a {childLabel}, or double-tap any empty space.<br />Drag anything anywhere. Double-tap a card to open it.
              </div>
            )}
            {cloud && <PeerCursors scope={scopeId} view={sharedView} />}
            {editor && (
              <InlineEditor key={editor.seq} kind={editor.kind} x={laneMode && disp[NEW_CARD_ID] ? disp[NEW_CARD_ID].x : editor.x} y={laneMode && disp[NEW_CARD_ID] ? disp[NEW_CARD_ID].y : editor.y} onSave={onSave} onCancel={cancelEditor} />
            )}
          </div>
        </MobileCanvas>
          <DrawLayer active={tool === 'draw' || tool === 'erase'} eraseMode={tool === 'erase'} color={penColor} width={3}
            canvasRef={canvasRef} onStrokeDone={onStrokeDone} onEraseAt={onEraseAt} />
          {!page && (
            <div className="wb-views" role="tablist" aria-label="How the cards are shown">
              {VIEW_MODES.map((v) => <button key={v.id} role="tab" aria-selected={viewMode === v.id} className={viewMode === v.id ? 'is-on' : ''} onClick={() => setViewMode(v.id)}>{v.label}</button>)}
            </div>
          )}
          {DEMO && <div className="wb-demo-note">Demo with example data. Change anything: it is saved in this browser only.</div>}
          {storageFull && <div className="wb-full">This browser's storage is full, so the latest change was not saved. Delete an image to free space.</div>}
          {session.notice && <div className="wb-notice" role="status">{session.notice}</div>}
          {editable && <Toolbar lanesOn={laneBar} onLanes={treeView && !page && viewMode === 'tree' ? toggleLanes : undefined} tool={tool} onTool={onTool} onImage={(f) => void addImage(f)} context={context.length ? context : undefined}
            canDelete={!!selectedElement} onDelete={() => { if (selectedEl) useElementStore.getState().remove(selectedEl); setSelectedEl(null) }} />}
        </div>

        {accountOpen && <AccountSheet onClose={() => setAccountOpen(false)} onAdmin={session.isAdmin ? () => { setAccountOpen(false); setAdminOpen(true) } : undefined} />}
        {inboxOpen && <InboxSheet items={inbox} onClose={() => setInboxOpen(false)} />}
        {adminOpen && <AdminSheet onClose={() => setAdminOpen(false)} />}
        {!accountOpen && !inboxOpen && !adminOpen && page?.kind === 'card' && <CardPage board={page.board} cardId={page.card.id} nodes={nodes} elements={elements} onGoTo={goTo} onClose={goUp} />}
        {!accountOpen && !inboxOpen && !adminOpen && page?.kind === 'row' && <RowPage table={page.table} rowId={page.row.id} nodes={nodes} elements={elements} onGoTo={goTo} onClose={goUp} />}
        
        {!accountOpen && !inboxOpen && !adminOpen && !page && namingEl && <StandalonePage overlay page={namingEl} nodes={nodes} elements={elements} onGoTo={(h) => { setNamingPage(null); goTo(h) }} onClose={() => setNamingPage(null)} />}
        {!accountOpen && !inboxOpen && !adminOpen && !page && selected && (visible.has(selected.id) || underFocus(selected.id)) && (
          selected.id !== focus.id && <NodeSheet node={selected} view={board.view(selected)} path={pathOf(selected.id)} operators={operators}
            lateDays={board.r.lateDays[selected.id]} onClose={onCloseSheet} onOpen={onOpenSelected}
            readOnly={!editable} canStatus={editable || (!!myUid && selected.assigneeUid === myUid)} members={cloud ? session.members : []} kids={board.kids} onSelect={onSelectInView} />
        )}
        {!accountOpen && !inboxOpen && !adminOpen && !page && focus.id !== ROOT_ID && (dockOpen
          ? <NodeSheet key={`dock:${focus.id}`} docked node={focus} view={focusView} path={pathOf(focus.id)} operators={operators}
              lateDays={board.r.lateDays[focus.id]} onClose={() => setDockOpen(false)}
              readOnly={!editable} canStatus={editable || (!!myUid && focus.assigneeUid === myUid)} members={cloud ? session.members : []} kids={board.kids} onSelect={onSelectInView} />
          : <button className="wb-dock-tab" onClick={() => setDockOpen(true)}>« Details</button>)}
        {!accountOpen && !inboxOpen && !adminOpen && plansFor && nodes[plansFor.id] && (
          <PlansSheet key={`${plansFor.id}:${plansFor.open ?? ''}`} project={nodes[plansFor.id]} canEdit={editable} openId={plansFor.open}
            onOpenRow={(t, r) => { setPlansFor(null); onOpenRow(t, r) }} onClose={() => setPlansFor(null)} />
        )}
      </div>
    </div>
    </LinkProvider>
  )
}
