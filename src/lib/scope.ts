import { BoardElement, BoardNode, KanbanCard, KanbanEl, PageEl, TableEl, TableRow } from '@/types'

// A "scope" is whatever a board is opened into. It is either a work item (a card: portfolio, project,
// milestone, task) or a page (a standalone page element, or a table row). Every free-form element records the
// scope it was made in as `scopeId`: a card's id, or a page key.
//
// Page keys:  "<pageElementId>"  for a standalone page,  "<tableId>:<rowId>"  for a table row,
//             "<kanbanId>:<cardId>"  for a kanban card.
// Pages can hold tables whose rows are pages, so scopes nest to any depth.

export const rowKey = (tableId: string, rowId: string): string => `${tableId}:${rowId}`

export type ResolvedPage =
  | { kind: 'row'; key: string; table: TableEl; row: TableRow; rowIndex: number }
  | { kind: 'page'; key: string; page: PageEl }
  | { kind: 'card'; key: string; board: KanbanEl; card: KanbanCard }

/** The page a key refers to, or null if it no longer exists. */
export function resolvePage(key: string, elements: BoardElement[]): ResolvedPage | null {
  const [elId, rowId] = key.split(':')
  const el = elements.find((e) => e.id === elId)
  if (!el) return null
  if (el.kind === 'page' && !rowId) return { kind: 'page', key, page: el }
  if (el.kind === 'table' && rowId) {
    const rowIndex = el.rows.findIndex((r) => r.id === rowId)
    return rowIndex < 0 ? null : { kind: 'row', key, table: el, row: el.rows[rowIndex], rowIndex }
  }
  if (el.kind === 'kanban' && rowId) {
    const card = (el.cards ?? []).find((c) => c.id === rowId)
    return card ? { kind: 'card', key, board: el, card } : null
  }
  return null
}

/** The scope a page sits in: the board that holds its table or its page card. */
export const parentScope = (key: string, elements: BoardElement[]): string | undefined => elements.find((e) => e.id === key.split(':')[0])?.scopeId

/** The card a scope ultimately belongs to, however many pages deep it is. */
export function owningNodeId(scopeId: string, nodes: Record<string, BoardNode>, elements: BoardElement[]): string | undefined {
  let cur: string | undefined = scopeId
  for (let i = 0; cur && i < 50; i++) { if (nodes[cur]) return cur; cur = parentScope(cur, elements) }
  return undefined
}

/** The cards above a page (a page element id, or tableId:rowId), from the top card down: what the access rules
 *  check a mention against. Empty when the page no longer exists. */
export function pageAnc(key: string, nodes: Record<string, BoardNode>, elements: BoardElement[]): string[] {
  const host = parentScope(key, elements)
  let cur = host ? owningNodeId(host, nodes, elements) : undefined
  const out: string[] = []
  for (let i = 0; cur && nodes[cur] && i < 60; i++) { out.unshift(cur); cur = nodes[cur].parentId }
  return out
}

/**
 * Elements whose scope still exists. Deleting a card, a page or a row takes everything on its board with it,
 * including pages nested further down, so this repeats until nothing more falls away.
 */
export function withLiveScopes(liveNodes: Set<string>, elements: BoardElement[]): BoardElement[] {
  let keep = elements
  for (;;) {
    const scopes = new Set(liveNodes)
    for (const e of keep) {
      if (e.kind === 'page') scopes.add(e.id)
      else if (e.kind === 'table') for (const r of e.rows) scopes.add(rowKey(e.id, r.id))
      else if (e.kind === 'kanban') for (const c of e.cards ?? []) scopes.add(rowKey(e.id, c.id))
    }
    const next = keep.filter((e) => scopes.has(e.scopeId))
    if (next.length === keep.length) return next
    keep = next
  }
}

/** The cards from the top down to the card that owns `scopeId` (a card id, page key or element scope): what the
 *  access rules check a mention of a teammate against. */
export function ancOf(scopeId: string, nodes: Record<string, BoardNode>, elements: BoardElement[]): string[] {
  let cur = owningNodeId(scopeId, nodes, elements)
  const out: string[] = []
  for (let i = 0; cur && nodes[cur] && i < 60; i++) { out.unshift(cur); cur = nodes[cur].parentId }
  return out
}

/** Mention keys for places that are not pages: a card (`card:<id>`), or a thing on a board (`el:<elementId>`). */
export const cardMentionKey = (id: string): string => `card:${id}`
export const elMentionKey = (id: string): string => `el:${id}`
