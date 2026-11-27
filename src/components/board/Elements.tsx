import { memo, useEffect, useRef, useState } from 'react'
import { AutosizeTextarea, ChecklistEditor, ItemTextProps, useCanvasDrag } from 'canvas-kit'
import Shell, { DRAG_Z } from './ElementShell'
import TableCard from './TableCard'
import { STATUSES } from '@/lib/board'
import { useElementStore } from '@/store/useElementStore'
import { useLinks } from './LinkContext'
import { LinkedText, NotifyAt, useMention } from './Mention'
import { ancOf, elMentionKey } from '@/lib/scope'
import { useBoardStore } from '@/store/useBoardStore'
import { BoardElement, PoolEl, LinkEl, PageLink, ChecklistEl, ImageEl, KanbanCard, KanbanEl, PageEl, ShapeEl, StickyEl, StrokeEl, TextEl } from '@/types'

// Free-form whiteboard elements. Dragging uses canvas-kit's useCanvasDrag, the same hook the cards use.

const newId = (): string => Math.random().toString(36).slice(2, 9)

/** Mentioning a teammate in something on a board brings them to that board. */
function useNotifyAt(el: { id: string; scopeId: string }): NotifyAt {
  const nodes = useBoardStore((s) => s.nodes)
  const elements = useElementStore((s) => s.elements)
  const anc = ancOf(el.scopeId, nodes, elements)
  const owner = nodes[anc[anc.length - 1]]
  return { key: elMentionKey(el.id), title: owner ? `a note on ${owner.title}` : 'a note', anc }
}

/** Text, sticky notes and shapes share one edit behaviour: new ones open ready to type; tap a selected one to edit. */
function Writable({ el, selected, onSelect, className, style, backdrop, keepEmpty }: {
  el: TextEl | StickyEl | ShapeEl; selected: boolean; onSelect: (id: string | null) => void; className: string
  style?: React.CSSProperties; backdrop?: React.ReactNode; /** shapes may stay on the board with no text */ keepEmpty?: boolean
}): JSX.Element {
  const update = useElementStore((s) => s.update)
  const remove = useElementStore((s) => s.remove)
  const [editing, setEditing] = useState(el.text === '')
  const [value, setValue] = useState(el.text)
  const [links, setLinks] = useState(el.links ?? [])
  const at = useMention({ text: value, links, onChange: (t, l) => { setValue(t); setLinks(l) }, notifyAt: useNotifyAt(el) })
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (editing) ref.current?.focus({ preventScroll: true }) }, [editing])
  useEffect(() => { // grow with the text
    const t = ref.current
    if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px` }
  }, [value, editing])

  const commit = (): void => {
    setEditing(false)
    const t = value.trim()
    const kept = links.filter((l) => t.includes(`@${l.title}`))
    if (!t && !keepEmpty) remove(el.id)
    else if (t !== el.text || kept.length !== (el.links?.length ?? 0)) update(el.id, { text: t, links: kept })
  }

  return (
    <Shell el={el} selected={selected} className={className} onTap={() => { if (selected) setEditing(true); else onSelect(el.id) }}>
      {backdrop}
      <div style={style} className="wb-writable">
        {editing ? (
          <>
          <textarea ref={ref} value={value} rows={1} placeholder="Type… (@ to link)"
            onChange={at.fieldProps.onChange} onBlur={() => { at.fieldProps.onBlur(); commit() }}
            onKeyDown={(e) => { if (at.onKeyDown(e)) return; if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur() }}
            onPointerDown={(e) => e.stopPropagation()} />
          {at.list}
          </>
        ) : <div className="wb-writable-text"><LinkedText text={el.text} links={el.links} /></div>}
      </div>
    </Shell>
  )
}

/** Flowchart outline, stretched to whatever size the text needs. */
function ShapeOutline({ shape }: { shape: ShapeEl['shape'] }): JSX.Element {
  const common = { fill: '#1B3159', stroke: '#F5EFE2', strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' as const }
  return (
    <svg className="wb-shape-bg" viewBox="0 0 100 100" preserveAspectRatio="none">
      {shape === 'diamond' ? <polygon points="50,1 99,50 50,99 1,50" {...common} />
        : shape === 'ellipse' ? <ellipse cx="50" cy="50" rx="49" ry="49" {...common} />
        : <rect x="1" y="1" width="98" height="98" rx={shape === 'round' ? 30 : 2} ry={shape === 'round' ? 49 : 2} {...common} />}
    </svg>
  )
}

function ImageCard({ el, selected, onSelect }: { el: ImageEl; selected: boolean; onSelect: (id: string | null) => void }): JSX.Element {
  const shown = Math.min(320, el.w)
  return (
    <Shell el={el} selected={selected} className="wb-image" onTap={() => onSelect(selected ? null : el.id)}>
      <img src={el.src} alt="" draggable={false} style={{ width: shown, height: Math.round((shown / el.w) * el.h) }} />
    </Shell>
  )
}

/** A checklist item's text with @ links: gold, tappable names while not editing; the @ picker while typing. */
function ItemText({ item, onPatch, onPaste, className, notifyAt }: ItemTextProps & { notifyAt: NotifyAt }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const at = useMention({ text: item.text, links: item.links ?? [], notifyAt,
    onChange: (text, links) => onPatch({ text, links: links.length ? links : undefined }) })
  if (!editing && item.links?.length) {
    return <div className={className} onClick={() => setEditing(true)}><LinkedText text={item.text} links={item.links} /></div>
  }
  return (
    <div className="wb-itemtext">
      <AutosizeTextarea value={item.text} className={className} autoFocus={editing} onPaste={onPaste}
        onChange={at.fieldProps.onChange} onBlur={() => { at.fieldProps.onBlur(); setEditing(false) }}
        onKeyDown={(e) => { if (at.onKeyDown(e)) return; if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }} />
      {at.list}
    </div>
  )
}

/** A tick list on the board. Drag it by its header; the list itself is canvas-kit's ChecklistEditor. */
function ChecklistCard({ el, selected, onSelect }: { el: ChecklistEl; selected: boolean; onSelect: (id: string | null) => void }): JSX.Element {
  const update = useElementStore((s) => s.update)
  const remove = useElementStore((s) => s.remove)
  const items = el.groups.flatMap((g) => g.items)
  const notifyAt = useNotifyAt(el)
  return (
    <Shell el={el} selected={selected} className="wb-checklist" onTap={() => onSelect(selected ? null : el.id)}>
      <div className="wb-checklist-head"><span>Checklist</span><span>{items.filter((i) => i.done).length}/{items.length}</span></div>
      <div className="wb-checklist-body" onPointerDown={(e) => e.stopPropagation()}>
        <ChecklistEditor groups={el.groups} onChange={(groups) => (groups.length ? update(el.id, { groups }) : remove(el.id))}
          renderItemText={(p) => <ItemText key={p.item.id} {...p} notifyAt={notifyAt} />} />
      </div>
    </Shell>
  )
}

/** A standalone page as it sits on the board: its title and the first lines. Tap it again once selected to open it. */
function PageCard({ el, selected, onSelect, onOpen }: { el: PageEl; selected: boolean; onSelect: (id: string | null) => void; onOpen: (id: string) => void }): JSX.Element {
  return (
    <Shell el={el} selected={selected} className="wb-page" onTap={() => (selected ? onOpen(el.id) : onSelect(el.id))}>
      <div className="wb-page-head"><span>Page</span>{!!el.links?.length && <span>{el.links.length} link{el.links.length === 1 ? '' : 's'}</span>}</div>
      <div className="wb-page-title">{el.title || 'Untitled'}</div>
      {el.body && <div className="wb-page-preview">{el.body}</div>}
      <button className="wb-page-open" onPointerDown={(e) => e.stopPropagation()} onClick={() => onOpen(el.id)}>Open ⤢</button>
    </Shell>
  )
}

// ---- kanban: a self-contained board. Its cards are its own; it does not mirror the work-item tree. ----------
const COL_W = 156

function Chip({ card, onMoveTo, onRemove, onOpen }: { card: KanbanCard; onMoveTo: (col: number) => void; onRemove: () => void; onOpen: () => void }): JSX.Element {
  // Drag sideways to another column. Rigid (no spring): the chip re-renders in its new column on release.
  const drag = useCanvasDrag({
    x: 0, y: 0, spring: false, liftScale: 1.04, dragZ: DRAG_Z,
    onMove: (dx) => onMoveTo(Math.max(0, Math.min(STATUSES.length - 1, card.col + Math.round(dx / COL_W)))),
    onTap: onOpen, // a card is a page: tap opens it
  })
  return (
    <div ref={drag.ref} className="wb-chip" style={{ ...drag.style, borderLeftColor: STATUSES[card.col].color }} {...drag.handlers}>
      <div><LinkedText text={card.text} links={card.links} /></div>
      <button onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} aria-label="Remove card">✕</button>
    </div>
  )
}

/** The "+ Add card" line of a column, with @ links and teammate mentions. */
function AddCard({ el, col }: { el: KanbanEl; col: number }): JSX.Element {
  const update = useElementStore((s) => s.update)
  const [text, setText] = useState('')
  const [links, setLinks] = useState<PageLink[]>([])
  const at = useMention({ text, links, onChange: (t, l) => { setText(t); setLinks(l) }, notifyAt: useNotifyAt(el) })
  const add = (): void => {
    const t = text.trim()
    if (!t) return
    const kept = links.filter((l) => t.includes(`@${l.title}`))
    update(el.id, { cards: [...(el.cards ?? []), { id: newId(), text: t, col, ...(kept.length ? { links: kept } : {}) }] })
    setText(''); setLinks([])
  }
  return (
    <div className="wb-kanban-addwrap">
      <input className="wb-kanban-add" value={text} placeholder="+ Add card (@ to link)" maxLength={120}
        onPointerDown={(e) => e.stopPropagation()} onChange={at.fieldProps.onChange}
        onKeyDown={(e) => { if (at.onKeyDown(e)) return; if (e.key === 'Enter') add() }}
        onBlur={() => { if (!at.open) add(); at.fieldProps.onBlur() }} />
      {at.list}
    </div>
  )
}

function KanbanBoard({ el, selected, onSelect, onOpenRow }: { el: KanbanEl; selected: boolean; onSelect: (id: string | null) => void; onOpenRow: (kanbanId: string, cardId: string) => void }): JSX.Element {
  const update = useElementStore((s) => s.update)
  const cards = el.cards ?? []
  return (
    <Shell el={el} selected={selected} className="wb-kanban" onTap={() => onSelect(selected ? null : el.id)}>
      <div className="wb-kanban-head">
        <span>Board</span>
        <input value={el.title ?? ''} placeholder="Name this board" maxLength={60} aria-label="Board name"
          onPointerDown={(e) => e.stopPropagation()} onChange={(e) => update(el.id, { title: e.target.value })} />
        <span>{cards.length} card{cards.length === 1 ? '' : 's'}</span>
      </div>
      <div className="wb-kanban-cols">
        {STATUSES.map((s, i) => {
          const list = cards.filter((c) => c.col === i)
          return (
            <div key={s.id} className="wb-kanban-col" style={{ width: COL_W }}>
              <div className="wb-kanban-col-head" style={{ color: s.color }}>{s.name}<i>{list.length}</i></div>
              {list.map((c) => (
                <Chip key={c.id} card={c}
                  onMoveTo={(col) => { if (col !== c.col) update(el.id, { cards: cards.map((x) => (x.id === c.id ? { ...x, col } : x)) }) }}
                  onRemove={() => update(el.id, { cards: cards.filter((x) => x.id !== c.id) })} onOpen={() => onOpenRow(el.id, c.id)} />
              ))}
<AddCard el={el} col={i} />
            </div>
          )
        })}
      </div>
    </Shell>
  )
}

interface ElementsProps {
  elements: BoardElement[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onOpenRow: (tableId: string, rowId: string) => void
  onOpenPage: (id: string) => void
}

/** An @link on the board: shows the target's current name; a tap goes there (drag to move, long-press to select). */
function LinkChip({ el, selected }: { el: LinkEl; selected: boolean }): JSX.Element {
  const { byKey, goTo } = useLinks()
  const hit = byKey.get(el.key)
  return (
    <Shell el={el} selected={selected} className={`wb-boardlink ${hit ? '' : 'is-gone'}`} onTap={() => { if (hit) goTo(hit) }}>
      <i>@ {hit?.kind ?? 'gone'}</i><span>{hit?.title ?? el.title}</span>
    </Shell>
  )
}

// ---- swimlane board: a frame of lanes (rows or columns) for process flows by department / team / entity. ----------
const laneId = (): string => 'l' + Math.random().toString(36).slice(2, 8)
export const POOL_STEP = { w: 120, h: 80, min: { w: 360, h: 220 } }

function Pool({ el, selected, onSelect }: { el: PoolEl; selected: boolean; onSelect: (id: string | null) => void }): JSX.Element {
  const update = useElementStore((s) => s.update)
  const setLane = (id: string, title: string): void => update(el.id, { lanes: el.lanes.map((l) => (l.id === id ? { ...l, title } : l)) })
  const drop = (id: string): void => { if (el.lanes.length > 1) update(el.id, { lanes: el.lanes.filter((l) => l.id !== id) }) }
  const stop = (e: React.PointerEvent): void => e.stopPropagation() // typing in a label must not start dragging the board
  return (
    <Shell el={el} selected={selected} className="wb-pool" onTap={() => onSelect(selected ? null : el.id)}>
      <div className={`wb-pool-box is-${el.dir}`} style={{ width: el.w, height: el.h }}>
        <div className="wb-pool-title" title="Drag here to move the board">
          <span className="wb-pool-grip" aria-hidden>⠿</span>
          <input value={el.title ?? ''} placeholder="Process or department" maxLength={60} aria-label="Swimlane board title" onPointerDown={stop}
            onChange={(e) => update(el.id, { title: e.target.value })} />
        </div>
        <div className="wb-pool-lanes">
          {el.lanes.map((l, i) => (
            <div key={l.id} className="wb-pool-lane" style={{ '--lane': `var(--lane-${i % 6})` } as React.CSSProperties}>
              <div className="wb-pool-head" title="Drag here to move the board">
                <span className="wb-pool-grip" aria-hidden>⠿</span>
                <input value={l.title} maxLength={24} aria-label={`Lane ${i + 1} name`} onPointerDown={stop} onChange={(e) => setLane(l.id, e.target.value)} />
                {selected && el.lanes.length > 1 && <button className="wb-pool-x" title="Remove this lane" aria-label="Remove lane" onPointerDown={stop} onClick={() => drop(l.id)}>×</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  )
}

/** The row of controls above the tools while a swimlane board is selected. */
export function PoolTools({ el }: { el: PoolEl }): JSX.Element {
  const update = useElementStore((s) => s.update)
  const grow = (dw: number, dh: number): void => update(el.id, { w: Math.max(POOL_STEP.min.w, el.w + dw), h: Math.max(POOL_STEP.min.h, el.h + dh) })
  const add = (): void => update(el.id, { lanes: [...el.lanes, { id: laneId(), title: `Lane ${el.lanes.length + 1}` }], ...(el.dir === 'rows' ? { h: el.h + 140 } : { w: el.w + 220 }) })
  return (
    <div className="wb-pool-tools" role="group" aria-label="Swimlane board">
      <button className="wb-ctx-btn" onClick={add} title="Add a lane">+ Lane</button>
      <button className="wb-ctx-btn" onClick={() => update(el.id, { dir: el.dir === 'rows' ? 'cols' : 'rows', w: el.h + 120, h: el.w - 120 })} title="Switch between horizontal and vertical lanes">{el.dir === 'rows' ? '▥ Vertical' : '☰ Horizontal'}</button>
      <button className="wb-ctx-btn" onClick={() => grow(POOL_STEP.w, 0)} title="Wider">↔ +</button>
      <button className="wb-ctx-btn" onClick={() => grow(-POOL_STEP.w, 0)} title="Narrower">↔ −</button>
      <button className="wb-ctx-btn" onClick={() => grow(0, POOL_STEP.h)} title="Taller">↕ +</button>
      <button className="wb-ctx-btn" onClick={() => grow(0, -POOL_STEP.h)} title="Shorter">↕ −</button>
    </div>
  )
}

function Elements({ elements, selectedId, onSelect, onOpenRow, onOpenPage }: ElementsProps): JSX.Element {
  const strokes = elements.filter((e): e is StrokeEl => e.kind === 'stroke')
  return (
    <>
      {elements.map((el) => {
        const sel = el.id === selectedId
        if (el.kind === 'pool') return <Pool key={el.id} el={el} selected={sel} onSelect={onSelect} />
        if (el.kind === 'text') return <Writable key={el.id} el={el} selected={sel} onSelect={onSelect} className="wb-text" />
        if (el.kind === 'sticky') return <Writable key={el.id} el={el} selected={sel} onSelect={onSelect} className="wb-sticky" style={{ background: el.color }} />
        if (el.kind === 'shape') return <Writable key={el.id} el={el} selected={sel} onSelect={onSelect} keepEmpty className={`wb-shape wb-shape-${el.shape}`} backdrop={<ShapeOutline shape={el.shape} />} />
        if (el.kind === 'image') return <ImageCard key={el.id} el={el} selected={sel} onSelect={onSelect} />
        if (el.kind === 'checklist') return <ChecklistCard key={el.id} el={el} selected={sel} onSelect={onSelect} />
        if (el.kind === 'kanban') return <KanbanBoard key={el.id} el={el} selected={sel} onSelect={onSelect} onOpenRow={onOpenRow} />
        if (el.kind === 'link') return <LinkChip key={el.id} el={el} selected={sel} />
        if (el.kind === 'page') return <PageCard key={el.id} el={el} selected={sel} onSelect={onSelect} onOpen={onOpenPage} />
        if (el.kind === 'table') return <TableCard key={el.id} el={el} selected={sel} onSelect={onSelect} onOpenRow={onOpenRow} />
        return null
      })}
      {/* pen strokes sit above everything: ink drawn over a card stays visible */}
      <svg className="wb-strokes">
        {strokes.map((s) => (
          <path key={s.id} d={s.path} transform={`translate(${s.x} ${s.y})`} stroke={s.color} strokeWidth={s.width}
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </>
  )
}

export default memo(Elements)
