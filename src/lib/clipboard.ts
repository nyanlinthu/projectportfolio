import { childKind, childMap } from '@/lib/board'
import { topZ } from '@/lib/stack'
import { ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'
import { BoardElement, BoardNode } from '@/types'

/**
 * Copy / paste of things on the board. A copy travels on the real clipboard under its own type (so it works
 * between tabs and workspaces) with the title as plain text beside it (so pasting into any other app gives words).
 */
export const CLIP_TYPE = 'application/x-flowboard'
type Clip = { kind: 'element'; el: BoardElement } | { kind: 'nodes'; rootId: string; nodes: BoardNode[] }

const rid = (p: string): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

/** What Cmd/Ctrl+C puts on the clipboard for the selected thing, or null when it cannot be copied. */
export function copyPayload(sel: { elementId?: string | null; nodeId?: string | null }): { json: string; text: string } | null {
  if (sel.elementId) {
    const el = useElementStore.getState().elements.find((e) => e.id === sel.elementId)
    if (!el || el.kind === 'connector') return null // an arrow is nothing without its two ends
    const text = 'text' in el && typeof el.text === 'string' ? el.text : 'title' in el && typeof el.title === 'string' ? el.title : el.kind
    return { json: JSON.stringify({ kind: 'element', el } satisfies Clip), text: text || el.kind }
  }
  const nodes = useBoardStore.getState().nodes
  const root = sel.nodeId ? nodes[sel.nodeId] : undefined
  if (!root || root.id === ROOT_ID) return null
  // the card and everything under it
  const kids = childMap(nodes), all = [root]
  for (let i = 0; i < all.length; i++) all.push(...(kids.get(all[i].id) ?? []))
  return { json: JSON.stringify({ kind: 'nodes', rootId: root.id, nodes: all } satisfies Clip), text: all.map((n) => n.title).join('\n') }
}

/**
 * Paste at a board point. An element lands there, on top, in whatever the board is opened into. A card (with its
 * whole branch) goes under the selected card when that is a fitting parent, else beside the original, else under
 * the open card. Returns what to select, or null when it did not fit anywhere.
 */
export function pastePayload(json: string, at: { x: number; y: number }, ctx: { scopeId: string; focusId: string; selectedNodeId: string | null; allowNodes: boolean }): { elementId?: string; nodeId?: string } | null {
  let clip: Clip
  try { clip = JSON.parse(json) as Clip } catch { return null }
  if (clip.kind === 'element' && clip.el) {
    const { id: _old, ...rest } = clip.el
    void _old
    return { elementId: useElementStore.getState().add({ ...rest, scopeId: ctx.scopeId, x: at.x, y: at.y, z: topZ() } as Parameters<ReturnType<typeof useElementStore.getState>['add']>[0]) }
  }
  if (clip.kind !== 'nodes' || !ctx.allowNodes || !Array.isArray(clip.nodes)) return null
  const root = clip.nodes.find((n) => n.id === clip.rootId)
  if (!root) return null
  const nodes = useBoardStore.getState().nodes
  const fits = (p?: BoardNode): boolean => !!p && (childKind(p.kind) === root.kind)
  const parent = [ctx.selectedNodeId ? nodes[ctx.selectedNodeId] : undefined, root.parentId ? nodes[root.parentId] : undefined, nodes[ctx.focusId]].find(fits)
  if (!parent) return null
  const ids = new Map(clip.nodes.map((n) => [n.id, rid('')]))
  const dx = at.x - root.x, dy = at.y - root.y, now = Date.now()
  const made: Record<string, BoardNode> = {}
  clip.nodes.forEach((n, i) => {
    const id = ids.get(n.id) as string
    made[id] = {
      ...n, id, x: n.x + dx, y: n.y + dy, z: undefined, createdAt: now + i, updatedAt: now,
      parentId: n.id === root.id ? parent.id : ids.get(n.parentId ?? '') ?? parent.id,
      // "after" links inside the copied branch point at the copies; links to work outside it are kept as they were
      after: (n.after ?? []).filter((a) => ids.has(a) || !!nodes[a]).map((a) => ids.get(a) ?? a),
    }
  })
  const newRoot = ids.get(root.id) as string
  made[newRoot].z = topZ()
  useBoardStore.setState((s) => ({ nodes: { ...s.nodes, ...made } }))
  return { nodeId: newRoot }
}
