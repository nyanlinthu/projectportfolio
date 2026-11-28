import { owningNodeId } from '@/lib/scope'
import { BoardElement, BoardNode } from '@/types'

/**
 * `anc`: the card ids from the portfolio card down to an item's own card. It is stored on every card and element
 * and is what the access rules use to decide who may receive or change the item (card-level access). The web app
 * (services/cloud.ts) and the agent server (agent/) both stamp it through these two functions, so they can never
 * disagree about where something lives.
 *
 * `stop` lets a caller answer for a card itself before the walk continues past it (the web app uses it for a scoped
 * person's cards, whose real parent it cannot see). Return null to keep walking.
 */
export function treeAnc(id: string, nodes: Record<string, BoardNode>, stop?: (id: string) => string[] | null, depth = 0): string[] {
  const own = stop?.(id)
  if (own) return own
  const n = nodes[id]
  if (!n) return [id]
  if (!n.parentId || depth > 60) return [id]
  return [...treeAnc(n.parentId, nodes, stop, depth + 1), id]
}

/** An element's `anc` is its owning card's; empty when it no longer hangs from any card. */
export function elementAnc(e: BoardElement, nodes: Record<string, BoardNode>, els: BoardElement[], stop?: (id: string) => string[] | null): string[] {
  const owner = owningNodeId(e.scopeId, nodes, els)
  return owner ? treeAnc(owner, nodes, stop) : []
}
