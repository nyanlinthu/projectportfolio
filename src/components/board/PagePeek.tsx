import { useMemo, useRef, useState } from 'react'
import { PERSON, useMention } from './Mention'
import { AutosizeTextarea } from 'canvas-kit'
import { display, FormulaError } from '@/lib/formula'
import { buildIndex, SearchHit } from '@/lib/search'
import { computeTable, isFormula, isTyped, rowBody, rowTitle, tableOps } from '@/lib/table'
import { pageAnc } from '@/lib/scope'
import { useElementStore } from '@/store/useElementStore'
import { Member, useSession } from '@/store/useSession'
import { BoardElement, BoardNode, KanbanCard, KanbanEl, PageEl, PageLink, TableEl } from '@/types'
import { STATUSES } from '@/lib/board'
import PropertyValue from './PropertyValue'

/** Link key prefix for a person mention (the rest is their uid). Never a search key, so never a page link. */


interface PeekProps {
  /** a brand-new page: centred overlay, cursor in the title, Enter moves on to the writing */
  overlay?: boolean
  /** a page gone into: its title and writing float on its own board, like any other thing there */
  onBoard?: boolean
  kicker: string
  title: string
  onTitle?: (t: string) => void
  properties?: React.ReactNode
  body: string
  links: PageLink[]
  onChange: (body: string, links: PageLink[]) => void
  /** this page's own search key: never offered as a mention, and what backlinks are matched against */
  selfKey: string
  nodes: Record<string, BoardNode>
  elements: BoardElement[]
  onGoTo: (hit: SearchHit) => void
  onClose: () => void
  onDelete?: () => void
  deleteLabel?: string
}

/**
 * A page, opened: title, properties, free writing, and connections, docked beside the page's own board (bottom
 * on a phone, right from tablet up) so that board stays fully usable. Typing @ in the writing area finds
 * anything in the workspace and links to it; the other side shows the link back.
 */
function PagePeek({ overlay, onBoard, kicker, title, onTitle, properties, body, links, onChange, selfKey, nodes, elements, onGoTo, onClose, onDelete, deleteLabel }: PeekProps): JSX.Element {
  const index = useMemo(() => buildIndex(nodes, elements), [nodes, elements])
  const byKey = useMemo(() => new Map(index.map((h) => [h.key, h])), [index])
  const area = useRef<HTMLTextAreaElement | null>(null)
  const [armed, setArmed] = useState(false)
  const [folded, setFolded] = useState(false)

  // Teammates who can see this page can be @mentioned: they get a notification that brings them right here.
  // Someone limited to certain cards is only offered when this page sits under one of them (the rules agree).
  const members = useSession((s) => s.members)
  const anc = useMemo(() => pageAnc(selfKey, nodes, elements), [selfKey, nodes, elements])
  const at = useMention({ text: body, links, onChange, selfKey, notifyAt: { key: selfKey, title, anc } })

  // who points at this page
  const backlinks = useMemo(() => {
    const out: SearchHit[] = []
    for (const e of elements) {
      if (e.kind === 'page' && e.links?.some((l) => l.key === selfKey)) { const h = byKey.get(e.id); if (h) out.push(h) }
      if ((e.kind === 'text' || e.kind === 'sticky' || e.kind === 'shape') && e.links?.some((l) => l.key === selfKey)) { const h = byKey.get(e.id); if (h) out.push(h) }
      if (e.kind === 'kanban') for (const c of e.cards ?? []) if ([...(c.bodyLinks ?? []), ...(c.links ?? [])].some((l) => l.key === selfKey)) { const h = byKey.get(`${e.id}:${c.id}`); if (h) out.push(h) }
      if (e.kind === 'table') for (const r of e.rows) if (r.links?.some((l) => l.key === selfKey)) { const h = byKey.get(`${e.id}:${r.id}`); if (h) out.push(h) }
    }
    for (const n of Object.values(nodes)) if (n.noteLinks?.some((l) => l.key === selfKey)) { const h = byKey.get(n.id); if (h) out.push(h) }
    return out
  }, [elements, nodes, byKey, selfKey])

  const personLinks = links.filter((l) => l.key.startsWith(PERSON))
  const pageLinks = links.filter((l) => !l.key.startsWith(PERSON))

  return (
    <Wrap overlay={overlay} onClose={onClose}>
    <aside className={onBoard ? 'wb-pagedoc freeform-el' : overlay ? 'wb-peek wb-peek-new' : `wb-sheet wb-pagesheet ${folded ? 'is-folded' : ''}`} aria-label={title || 'Page'}>
        {!onBoard && <div className="wb-sheet-head">
          <span className="wb-kicker" style={{ flex: 1, minWidth: 0 }}><span className="truncate">{folded ? title || 'Untitled' : kicker}</span></span>
          <button className="wb-x" onClick={() => setFolded(!folded)} aria-label={folded ? 'Show the page' : 'Fold the page away to see more of its board'} title={folded ? 'Show the page' : 'Fold away'}>{folded ? '⌃' : '⌄'}</button>
          <button className="wb-x" onClick={onClose} aria-label="Close this page">✕</button>
        </div>}
        {!folded && <>
        {onTitle
          ? <input className="wb-peek-title" value={title} placeholder={overlay || onBoard ? 'New page' : 'Untitled'} maxLength={120} aria-label="Title" autoFocus={overlay}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); area.current?.focus() } }} onChange={(e) => onTitle(e.target.value)} />
          : <div className="wb-peek-title">{title || 'Untitled'}</div>}

        {properties && <div className="wb-peek-props">{properties}</div>}

        <div className="wb-peek-body">
          <AutosizeTextarea value={body} placeholder={overlay || onBoard ? "Start writing. Type @ to link anything or mention someone" : "Write here. Type @ to mention a teammate (they get notified) or link a task, a table, a note or another page."}
            {...at.fieldProps}
            onFocus={(e) => { area.current = e.target }}
            onKeyDown={(e) => { at.onKeyDown(e) }} />
          {at.list}
        </div>

        {(links.length > 0 || backlinks.length > 0) && (
          <div className="wb-peek-links">
            {personLinks.length > 0 && <div className="wb-kicker"><span>Mentioned people</span></div>}
            {personLinks.map((l) => {
              const m = members.find((x: Member) => `${PERSON}${x.uid}` === l.key)
              return <span key={l.key} className={`wb-linkchip is-person ${m ? '' : 'is-gone'}`}><i>@</i>{m?.name ?? l.title}</span>
            })}
            {pageLinks.length > 0 && <div className="wb-kicker"><span>Links to</span></div>}
            {pageLinks.map((l) => {
              const h = byKey.get(l.key)
              return (
                <button key={l.key} className={`wb-linkchip ${h ? '' : 'is-gone'}`} disabled={!h} onClick={() => h && onGoTo(h)}>
                  {h && <i>{h.kind}</i>}{h?.title ?? `${l.title} (deleted)`}
                </button>
              )
            })}
            {backlinks.length > 0 && <div className="wb-kicker"><span>Mentioned in</span></div>}
            {backlinks.map((h) => <button key={h.key} className="wb-linkchip" onClick={() => onGoTo(h)}><i>{h.kind}</i>{h.title}</button>)}
          </div>
        )}

        {onDelete && (
          <button className={`wb-del ${armed ? 'is-armed' : ''}`} onClick={() => (armed ? onDelete() : setArmed(true))}>
            {armed ? 'Tap again to delete' : deleteLabel ?? 'Delete'}
          </button>
        )}
        </>}
    </aside>
    </Wrap>
  )
}

/** A new page sits over a dimmed board (tap outside to finish); an existing one docks beside its board. */
function Wrap({ overlay, onClose, children }: { overlay?: boolean; onClose: () => void; children: React.ReactNode }): JSX.Element {
  if (!overlay) return <>{children}</>
  return <div className="wb-peek-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>{children}</div>
}

type Shared = Pick<PeekProps, 'nodes' | 'elements' | 'onGoTo' | 'onClose'>

/** A table row opened as a page: its other columns are the page's properties. */
export function RowPage({ table, rowId, ...shared }: Shared & { table: TableEl; rowId: string }): JSX.Element | null {
  const computed = useMemo(() => computeTable(table), [table, shared.nodes]) // eslint-disable-line react-hooks/exhaustive-deps
  const ri = table.rows.findIndex((r) => r.id === rowId)
  const row = table.rows[ri]
  if (!row) return null
  const first = table.columns[0]
  const titleEditable = !!first && isTyped(first.type) && !isFormula(row.cells[first.id])
  return (
    <PagePeek {...shared} selfKey={`${table.id}:${rowId}`} kicker={`${table.title || 'Table'} › Row ${ri + 1}`}
      title={titleEditable ? row.cells[first.id] ?? '' : rowTitle(ri, computed)}
      onTitle={titleEditable ? (t) => tableOps.setCell(table.id, rowId, first.id, t) : undefined}
      body={rowBody(row)} links={row.links ?? []} onChange={(body, links) => tableOps.patchRow(table.id, rowId, { body, links })}
      onDelete={() => { tableOps.removeRow(table.id, rowId); shared.onClose() }} deleteLabel="Delete row"
      properties={table.columns.slice(titleEditable ? 1 : 0).map((c) => {
        const ci = table.columns.indexOf(c), raw = row.cells[c.id] ?? '', value = computed[ri]?.[ci] ?? ''
        return (
          <div key={c.id} className="wb-peek-prop">
            <span>{c.name || 'Property'}</span>
            {isTyped(c.type) ? (
              <div>
                <input className="wb-prop-input" value={raw} aria-label={c.name} onChange={(e) => tableOps.setCell(table.id, rowId, c.id, e.target.value)} />
                {isFormula(raw) && <em className={value instanceof FormulaError ? 'is-err' : ''}>= {display(value)}</em>}
              </div>
            ) : <div><PropertyValue table={table} row={row} col={c} /></div>}
          </div>
        )
      })} />
  )
}

/** A kanban card, opened as a page: its text is the title, its column a property, and it has its own writing. */
export function CardPage({ board, cardId, ...shared }: Shared & { board: KanbanEl; cardId: string }): JSX.Element | null {
  const update = useElementStore((s) => s.update)
  const card = (board.cards ?? []).find((c) => c.id === cardId)
  if (!card) return null
  const patch = (p: Partial<KanbanCard>): void => {
    const cur = useElementStore.getState().elements.find((e) => e.id === board.id)
    if (cur?.kind === 'kanban') update(board.id, { cards: (cur.cards ?? []).map((c) => (c.id === cardId ? { ...c, ...p } : c)) })
  }
  return (
    <PagePeek {...shared} selfKey={`${board.id}:${cardId}`} kicker={`${board.title || 'Board'} › Card`}
      title={card.text} onTitle={(text) => patch({ text })}
      body={card.body ?? ''} links={card.bodyLinks ?? []} onChange={(body, bodyLinks) => patch({ body: body || undefined, bodyLinks: bodyLinks.length ? bodyLinks : undefined })}
      onDelete={() => { const cur = useElementStore.getState().elements.find((e) => e.id === board.id); if (cur?.kind === 'kanban') update(board.id, { cards: (cur.cards ?? []).filter((c) => c.id !== cardId) }); shared.onClose() }}
      deleteLabel="Delete card"
      properties={[
        <div key="col" className="wb-peek-prop">
          <span>Column</span>
          <div><select className="wb-prop-input" value={card.col} onChange={(e) => patch({ col: Number(e.target.value) })}>
            {STATUSES.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
          </select></div>
        </div>,
      ]} />
  )
}

/** A standalone page element, opened. */
export function StandalonePage({ page, overlay, onBoard, ...shared }: Shared & { page: PageEl; overlay?: boolean; onBoard?: boolean }): JSX.Element {
  const update = useElementStore((s) => s.update)
  const remove = useElementStore((s) => s.remove)
  return (
    <PagePeek {...shared} overlay={overlay} onBoard={onBoard} selfKey={page.id} kicker="Page" title={page.title} onTitle={(title) => update(page.id, { title })}
      body={page.body} links={page.links ?? []} onChange={(body, links) => update(page.id, { body, links })}
      onDelete={() => { remove(page.id); shared.onClose() }} deleteLabel="Delete page" />
  )
}
