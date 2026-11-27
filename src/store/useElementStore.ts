import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChecklistGroup } from 'canvas-kit'
import { STORE_KEYS } from '@/lib/demo'
import { withLiveScopes } from '@/lib/scope'
import { BoardElement, KanbanCard, PageLink, PoolEl, PoolLane, TableColumn, TableRow } from '@/types'

/** Whether `e` sits on swimlane board `pool` (its top-left corner is inside the board): it moves with the board and goes when the board goes. */
export const isOnPool = (pool: PoolEl, e: BoardElement): boolean =>
  e.id !== pool.id && e.scopeId === pool.scopeId && e.kind !== 'connector' && e.x >= pool.x && e.y >= pool.y && e.x <= pool.x + pool.w && e.y <= pool.y + pool.h

const newId = (): string => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

// Distributive, so each element kind keeps its own fields when `id` is left out.
type NewElement = BoardElement extends infer E ? (E extends BoardElement ? Omit<E, 'id'> : never) : never
type ElementPatch = { text?: string; color?: string; x?: number; y?: number; z?: number; groups?: ChecklistGroup[]; cards?: KanbanCard[]; title?: string; label?: string; columns?: TableColumn[]; rows?: TableRow[]; body?: string; links?: PageLink[]; w?: number; h?: number; dir?: 'rows' | 'cols'; lanes?: PoolLane[] }

interface ElementStore {
  elements: BoardElement[]
  /** true once the browser refused to store more (pasted images fill it quickly) */
  storageFull: boolean
  add: (el: NewElement) => string
  update: (id: string, patch: ElementPatch) => void
  remove: (id: string) => void
  setZ: (z: Record<string, number>) => void
  /** Drop elements whose card no longer exists, and arrows that have lost an end. */
  prune: (liveNodes: Set<string>) => void
}

// Browser storage is small (about 5 MB). A failed write must not break the board, so it is caught and surfaced.
const safeStorage = createJSONStorage(() => ({
  getItem: (k: string) => localStorage.getItem(k),
  removeItem: (k: string) => localStorage.removeItem(k),
  setItem: (k: string, v: string) => {
    try { localStorage.setItem(k, v); if (useElementStore.getState().storageFull) useElementStore.setState({ storageFull: false }) }
    catch { useElementStore.setState({ storageFull: true }) }
  },
}))

export const useElementStore = create<ElementStore>()(
  persist(
    (set) => ({
      elements: [],
      storageFull: false,
      add: (el) => { const id = newId(); set((s) => ({ elements: [...s.elements, { ...el, id } as BoardElement] })); return id },
      update: (id, patch) => set((s) => ({ elements: s.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as BoardElement) : e)) })),
      // deleting a swimlane board deletes what is on it too (arrows left without an end are pruned afterwards)
      remove: (id) => set((s) => {
        const target = s.elements.find((e) => e.id === id)
        const gone = new Set<string>([id])
        if (target?.kind === 'pool') for (const e of s.elements) if (isOnPool(target, e)) gone.add(e.id)
        return { elements: s.elements.filter((e) => !gone.has(e.id)) }
      }),
      setZ: (z) => set((s) => ({ elements: s.elements.map((e) => (z[e.id] !== undefined && z[e.id] !== e.z ? { ...e, z: z[e.id] } : e)) })),
      prune: (live) => set((s) => {
        const scoped = withLiveScopes(live, s.elements)
        const ids = new Set([...live, ...scoped.map((e) => e.id)])
        const kept = scoped.filter((e) => e.kind !== 'connector' || (ids.has(e.fromId) && ids.has(e.toId)))
        return kept.length === s.elements.length ? s : { elements: kept }
      }),
    }),
    { name: STORE_KEYS.elements, storage: safeStorage, partialize: (s) => ({ elements: s.elements }) as ElementStore }
  )
)
