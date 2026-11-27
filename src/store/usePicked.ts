import { create } from 'zustand'
import { CANVAS_DRAG_EVENT } from 'canvas-kit'
import { useBoardStore } from './useBoardStore'
import { useElementStore } from './useElementStore'

/**
 * Cmd/Ctrl-click multi-selection: cards and board elements picked together, so they move (and elements delete)
 * as a group. Separate from the single `selectedId` that opens a card's detail.
 */
interface Picked { ids: string[]; toggle: (id: string) => void; only: (id: string) => void; clear: () => void }
export const usePicked = create<Picked>((set) => ({
  ids: [],
  toggle: (id) => set((s) => ({ ids: s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id] })),
  only: (id) => set({ ids: [id] }),
  clear: () => set((s) => (s.ids.length ? { ids: [] } : s)),
}))

/** Whether the press that is about to become a tap is a pick: Cmd (Mac) / Ctrl held, or a long press (touch).
 *  Taps carry no event, so the press is recorded here. */
const LONG_PRESS_MS = 450
let modHeld = false, downAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => { modHeld = e.metaKey || e.ctrlKey; downAt = Date.now() }, true)
}

// While a card or board item is held, show it is ready BEFORE the finger lifts: once the hold reaches the long-press
// time without moving, it gets a gold ring and a "Release to select" badge (and a short buzz on phones).
const HOLD_SLOP = 8
let holdEl: HTMLElement | null = null, holdTimer = 0, holdX = 0, holdY = 0
const endHold = (): void => { window.clearTimeout(holdTimer); holdEl?.classList.remove('is-hold-ready'); holdEl = null }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    endHold()
    if (e.metaKey || e.ctrlKey || e.button > 0) return
    const t = e.target as HTMLElement | null
    if (!t || t.closest('button, input, textarea, select, a')) return // chips, fields and links keep their own press
    const el = t.closest<HTMLElement>('.wb-card, .wb-el')
    if (!el) return
    holdX = e.clientX; holdY = e.clientY
    holdTimer = window.setTimeout(() => { holdEl = el; el.classList.add('is-hold-ready'); try { navigator.vibrate?.(12) } catch { /* not supported */ } }, LONG_PRESS_MS)
  }, true)
  window.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - holdX, e.clientY - holdY) > HOLD_SLOP) endHold() }, true)
  for (const ev of ['pointerup', 'pointercancel', 'dragstart', 'blur']) window.addEventListener(ev, endHold, true)
}
export const pickModifier = (): boolean => modHeld || Date.now() - downAt >= LONG_PRESS_MS
/** Apply a pick press: Cmd/Ctrl adds or removes from the group; a long press selects just this one thing. */
export function pick(id: string): void {
  const p = usePicked.getState()
  if (modHeld) p.toggle(id); else p.only(id)
}

/** The lead of a picked group was dropped `dx,dy` from where it was: move the rest of the group the same amount. */
export function groupMoved(leadId: string, dx: number, dy: number): void {
  const ids = usePicked.getState().ids
  if (!ids.includes(leadId) || ids.length < 2 || (!dx && !dy)) { endGroupDrag(); return }
  const bs = useBoardStore.getState(), es = useElementStore.getState()
  for (const id of ids) {
    if (id === leadId) continue
    const n = bs.nodes[id]
    if (n) { bs.moveNode(id, n.x + dx, n.y + dy); continue }
    const el = es.elements.find((e) => e.id === id)
    if (el && el.kind !== 'connector' && el.kind !== 'stroke') es.update(id, { x: el.x + dx, y: el.y + dy })
  }
  endGroupDrag()
}

const domOf = (id: string): HTMLElement | null => {
  const card = document.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)
  return (card?.closest('[data-canvas-id]') as HTMLElement | null) ?? card ?? document.querySelector<HTMLElement>(`[data-rel-id="${CSS.escape(id)}"]`)
}

/** While one picked thing is carried, the rest of the group follows it on screen. */
let carrying: string | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(CANVAS_DRAG_EVENT, () => {
    const ids = usePicked.getState().ids
    if (ids.length < 2) return
    let lead: string | null = null, tx = 0, ty = 0
    for (const id of ids) {
      const m = domOf(id)?.style.transform.match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\)/)
      if (m && (carrying === null || carrying === id)) { lead = id; tx = +m[1]; ty = +m[2]; break }
    }
    carrying = lead
    for (const id of ids) {
      if (id === lead) continue
      const el = domOf(id)
      if (el) el.style.transform = lead ? `translate(${tx}px, ${ty}px)` : ''
    }
  })
}

/** After the lead lands: clear the followers' live transforms (their stored positions take over). */
export function endGroupDrag(): void {
  carrying = null
  for (const id of usePicked.getState().ids) { const el = domOf(id); if (el) el.style.transform = '' }
}
