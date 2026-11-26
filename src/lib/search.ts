import type { ResolvedPage } from './scope'
import { display } from '@/lib/formula'
import { KIND_LABEL } from '@/lib/board'
import { parentScope, resolvePage } from '@/lib/scope'
import { computeTable, rowBody, rowTitle } from '@/lib/table'
import { BoardElement, BoardNode } from '@/types'

// One index over everything on every board: work items, notes, shapes, checklist items, kanban cards, table rows,
// arrow labels. The search bar and the AI tool layer both query this, so "findable by a person" and "findable by
// the agent" are the same thing by construction.

export interface SearchHit {
  key: string
  /** what it is, in words: "Task", "Sticky note", "Table row"… */
  kind: string
  title: string
  /** where it lives: the path of cards above it, or the element it sits in */
  context: string
  nodeId?: string
  elementId?: string
  rowId?: string
  /** the card whose board shows this hit */
  scopeId: string
  x?: number
  y?: number
}
interface Entry extends SearchHit { hay: string }
export type SearchIndex = Entry[]

const EL_LABEL: Record<string, string> = { page: 'Page', text: 'Text', sticky: 'Sticky note', shape: 'Shape', checklist: 'Checklist', kanban: 'Kanban board', table: 'Table', connector: 'Arrow' }

export function buildIndex(nodes: Record<string, BoardNode>, elements: BoardElement[]): SearchIndex {
  const out: Entry[] = []
  const nodePath = (id: string | undefined): string => {
    const parts: string[] = []
    for (let cur = id; cur && nodes[cur]; cur = nodes[cur].parentId) parts.unshift(nodes[cur].title)
    return parts.join(' › ')
  }
  /** Where a scope is, in words: the cards above it, then any pages it is nested in. */
  const pathOf = (id: string | undefined, depth = 0): string => {
    if (!id) return ''
    if (nodes[id] || depth > 20) return nodePath(id)
    const pg = resolvePage(id, elements)
    if (!pg) return ''
    const name = pg.kind === 'row' ? `${pg.table.title || 'Table'} › ${pageTitle(pg)}` : pageTitle(pg)
    return [pathOf(parentScope(id, elements), depth + 1), name].filter(Boolean).join(' › ')
  }
  const push = (h: SearchHit, extra = ''): void => { out.push({ ...h, hay: `${h.title} ${extra}`.toLowerCase() }) }

  for (const n of Object.values(nodes)) {
    push({ key: n.id, kind: KIND_LABEL[n.kind], title: n.title, context: nodePath(n.parentId), nodeId: n.id, scopeId: n.parentId ?? n.id, x: n.x, y: n.y },
      `${n.assignee ?? ''} ${n.status ?? ''} ${n.priority ?? ''} ${n.notes ?? ''}`)
  }
  for (const e of elements) {
    if (!nodes[e.scopeId] && !resolvePage(e.scopeId, elements)) continue
    const base = { elementId: e.id, scopeId: e.scopeId, x: e.x, y: e.y, context: pathOf(e.scopeId) }
    const kind = EL_LABEL[e.kind] ?? e.kind
    if (e.kind === 'text' || e.kind === 'sticky' || e.kind === 'shape') { if (e.text) push({ ...base, key: e.id, kind, title: e.text }) }
    else if (e.kind === 'page') push({ ...base, key: e.id, kind, title: e.title || 'Untitled' }, e.body)
    else if (e.kind === 'connector') { if (e.label) push({ ...base, key: e.id, kind, title: e.label, x: undefined, y: undefined }) }
    else if (e.kind === 'checklist') {
      for (const g of e.groups) {
        if (g.title) push({ ...base, key: `${e.id}:${g.id}`, kind, title: g.title })
        for (const i of g.items) push({ ...base, key: `${e.id}:${i.id}`, kind: 'Checklist item', title: i.text, context: [base.context, g.title].filter(Boolean).join(' › ') }, i.note ?? '')
      }
    } else if (e.kind === 'kanban') {
      if (e.title) push({ ...base, key: e.id, kind, title: e.title })
      for (const c of e.cards ?? []) push({ ...base, key: `${e.id}:${c.id}`, rowId: c.id, kind: 'Kanban card', title: c.text, context: [base.context, e.title].filter(Boolean).join(' › ') }, c.body ?? '')
    } else if (e.kind === 'table') {
      if (e.title) push({ ...base, key: e.id, kind, title: e.title })
      const computed = computeTable(e)
      e.rows.forEach((r, ri) => {
        const cells = computed[ri].map(display).filter(Boolean)
        if (!cells.length && !rowBody(r)) return
        push({ ...base, key: `${e.id}:${r.id}`, kind: 'Table row', title: rowTitle(ri, computed), rowId: r.id, context: [base.context, e.title || 'Table'].filter(Boolean).join(' › ') },
          `${cells.join(' ')} ${rowBody(r)}`)
      })
    }
  }
  return out
}

/** Every word must appear somewhere in the item. Titles that start with the query come first. */
export function searchIndex(index: SearchIndex, query: string, limit = 30): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { e: Entry; s: number }[] = []
  for (const e of index) {
    if (!words.every((w) => e.hay.includes(w))) continue
    const t = e.title.toLowerCase()
    scored.push({ e, s: (t.startsWith(words[0]) ? 4 : 0) + (words.every((w) => t.includes(w)) ? 2 : 0) + (e.nodeId ? 1 : 0) })
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map(({ e }) => { const { hay: _hay, ...hit } = e; return hit })
}

/** The name a page goes by: a page's title, a table row's first column, a kanban card's text. */
export function pageTitle(pg: ResolvedPage): string {
  if (pg.kind === 'page') return pg.page.title || 'Untitled'
  if (pg.kind === 'card') return pg.card.text || 'Untitled card'
  return rowTitle(pg.rowIndex, computeTable(pg.table))
}
