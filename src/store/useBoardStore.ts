import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { startingBoard } from '@/data/seed'
import { STORE_KEYS } from '@/lib/demo'
import { stampActual } from '@/lib/dates'
import { BoardNode, NodeKind } from '@/types'

export const ROOT_ID = 'portfolio'

// Not crypto.randomUUID: that is unavailable on plain-http LAN addresses (phone testing).
const newId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export const seedNodes = (): Record<string, BoardNode> => ({
  [ROOT_ID]: { id: ROOT_ID, kind: 'portfolio', title: 'My Portfolio', x: 400, y: 80, weight: 1, after: [], createdAt: Date.now(), updatedAt: Date.now() },
})

const descendants = (nodes: Record<string, BoardNode>, id: string): string[] => {
  const out: string[] = []
  const walk = (pid: string): void => {
    for (const n of Object.values(nodes)) if (n.parentId === pid) { out.push(n.id); walk(n.id) }
  }
  walk(id)
  return out
}

interface BoardStore {
  nodes: Record<string, BoardNode>
  selectedId: string | null
  addNode: (kind: NodeKind, parentId: string, x: number, y: number, title: string) => string
  updateNode: (id: string, patch: Partial<Omit<BoardNode, 'id' | 'kind'>>) => void
  /** Drop a card at a new spot. Every card under it follows, so a branch (or, from the portfolio card, the
   *  whole tree) moves as one. Notes, tables and other elements are not cards and stay where they are. */
  moveNode: (id: string, x: number, y: number) => void
  /** Set many positions at once (Tidy, and its undo). */
  setPositions: (pos: Record<string, { x: number; y: number }>) => void
  setZ: (z: Record<string, number>) => void
  /** Change many cards in one go (saving a baseline). No status stamping: use updateNode for status. */
  patchMany: (patches: Record<string, Partial<BoardNode>>) => void
  /** Removes the node and everything under it. */
  deleteNode: (id: string) => void
  select: (id: string | null) => void
}

export const useBoardStore = create<BoardStore>()(
  persist(
    (set) => ({
      nodes: startingBoard() ?? seedNodes(),
      selectedId: null,

      addNode: (kind, parentId, x, y, title) => {
        const id = newId()
        const now = Date.now()
        const node: BoardNode = { id, kind, title, parentId, x, y, weight: 1, after: [], createdAt: now, updatedAt: now, ...(kind === 'task' ? { status: 'backlog' as const } : {}) }
        set((s) => ({ nodes: { ...s.nodes, [id]: node } }))
        return id
      },

      updateNode: (id, patch) => set((s) => {
        const n = s.nodes[id]
        if (!n) return s
        // a status change stamps the actual dates here, so every way of changing status (card pill, sheet, boards,
        // agent) records them the same
        return { nodes: { ...s.nodes, [id]: { ...n, ...patch, ...stampActual(n, patch), updatedAt: Date.now() } } }
      }),

      moveNode: (id, x, y) => set((s) => {
        const n = s.nodes[id]
        if (!n) return s
        const dx = x - n.x, dy = y - n.y
        const next = { ...s.nodes, [id]: { ...n, x, y, updatedAt: Date.now() } }
        for (const d of descendants(s.nodes, id)) next[d] = { ...next[d], x: next[d].x + dx, y: next[d].y + dy }
        return { nodes: next }
      }),

      setPositions: (pos) => set((s) => {
        const next = { ...s.nodes }
        for (const [id, p] of Object.entries(pos)) if (next[id]) next[id] = { ...next[id], x: p.x, y: p.y }
        return { nodes: next }
      }),

      patchMany: (patches) => set((s) => {
        const next = { ...s.nodes }, now = Date.now()
        for (const [id, p] of Object.entries(patches)) if (next[id]) next[id] = { ...next[id], ...p, updatedAt: now }
        return { nodes: next }
      }),

      setZ: (z) => set((s) => {
        const next = { ...s.nodes }
        for (const [id, v] of Object.entries(z)) if (next[id] && next[id].z !== v) next[id] = { ...next[id], z: v }
        return { nodes: next }
      }),

      deleteNode: (id) => set((s) => {
        if (id === ROOT_ID || !s.nodes[id]) return s
        const gone = new Set([id, ...descendants(s.nodes, id)])
        const next: Record<string, BoardNode> = {}
        for (const n of Object.values(s.nodes)) if (!gone.has(n.id)) next[n.id] = gone.size && n.after.some((a) => gone.has(a)) ? { ...n, after: n.after.filter((a) => !gone.has(a)) } : n
        return { nodes: next, selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId }
      }),

      select: (id) => set({ selectedId: id }),
    }),
    // Browser-only for now, so work survives a reload. Shared saving (Firestore + real login) is the next step.
    { name: STORE_KEYS.board, partialize: (s) => ({ nodes: s.nodes }) }
  )
)
