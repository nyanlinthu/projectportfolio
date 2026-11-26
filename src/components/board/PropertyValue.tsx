import { useRef, useState } from 'react'
import { fileToSmallDataUrl } from '@/lib/image'
import { searchIndex } from '@/lib/search'
import { rowKey } from '@/lib/scope'
import { autoValue, hasOptions, isAuto, joinLinks, joinMulti, safeHref, splitLinks, splitMulti, tableOps } from '@/lib/table'
import { notify, useSession } from '@/store/useSession'
import { ColumnOption, TableColumn, TableEl, TableRow } from '@/types'
import { useLinks } from './LinkContext'

interface PropertyValueProps { table: TableEl; row: TableRow; col: TableColumn }

const NEW = '\u0000new'
const stop = (e: React.PointerEvent): void => e.stopPropagation()
const chipStyle = (o: ColumnOption | undefined): React.CSSProperties => ({ background: `${o?.color ?? '#8A93A6'}33`, color: o?.color ?? '#C9CFDB', borderColor: `${o?.color ?? '#8A93A6'}66` })

/** People a "person" cell can hold: the workspace team when there is one, else whoever is already named in the column. */
function usePeople(table: TableEl, col: TableColumn): string[] {
  const members = useSession((s) => s.members)
  if (members.length) return members.map((m) => m.name)
  return [...new Set(table.rows.flatMap((r) => splitMulti(r.cells[col.id])))].sort()
}

/**
 * One property of one row, for every type that is picked rather than typed (text and number cells are typed
 * straight into the grid, where formulas live). Used by the table grid and by the row's page, so a property
 * behaves the same in both.
 */
export default function PropertyValue({ table, row, col }: PropertyValueProps): JSX.Element {
  const raw = row.cells[col.id] ?? ''
  const set = (v: string): void => tableOps.setCell(table.id, row.id, col.id, v)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const people = usePeople(table, col)
  const file = useRef<HTMLInputElement>(null)

  if (isAuto(col.type)) return <span className="wb-prop-auto">{autoValue(col.type, row)}</span>
  if (col.type === 'link') return <LinkValue raw={raw} set={set} selfKey={rowKey(table.id, row.id)} label={col.name} />

  if (col.type === 'checkbox') {
    return <input type="checkbox" className="wb-prop-check" checked={raw === 'true'} aria-label={col.name} onChange={(e) => set(e.target.checked ? 'true' : '')} />
  }
  if (col.type === 'date') {
    return <input type="date" className="wb-prop-input" value={raw} aria-label={col.name} onPointerDown={stop} onChange={(e) => set(e.target.value)} />
  }

  if (col.type === 'url' || col.type === 'email' || col.type === 'phone') {
    const href = safeHref(col.type, raw)
    return (
      <span className="wb-prop-link">
        <input className="wb-prop-input" value={raw} aria-label={col.name} onPointerDown={stop} onChange={(e) => set(e.target.value)}
          type={col.type === 'email' ? 'email' : col.type === 'phone' ? 'tel' : 'url'} inputMode={col.type === 'phone' ? 'tel' : undefined} />
        {href && <a href={href} target="_blank" rel="noopener noreferrer" onPointerDown={stop} aria-label={`Open ${raw}`}>↗</a>}
      </span>
    )
  }

  if (col.type === 'files') {
    const files = row.files?.[col.id] ?? []
    const add = async (f: File): Promise<void> => {
      if (!f.type.startsWith('image/')) { notify('Only pictures can be attached for now.'); return }
      if (files.length >= 4) { notify('Up to four pictures per cell.'); return }
      try { const img = await fileToSmallDataUrl(f, 700); tableOps.setFiles(table.id, row.id, col.id, [...files, { name: f.name, src: img.src }]) }
      catch { notify('That picture could not be added.') }
    }
    return (
      <span className="wb-prop-files" onPointerDown={stop}>
        {files.map((f, i) => (
          <span key={i} className="wb-prop-thumb" title={f.name}>
            <img src={f.src} alt={f.name} draggable={false} />
            <button aria-label={`Remove ${f.name}`} onClick={() => tableOps.setFiles(table.id, row.id, col.id, files.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
        <button className="wb-prop-add" aria-label="Attach a picture" onClick={() => file.current?.click()}>+</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void add(f); e.target.value = '' }} />
      </span>
    )
  }

  // ---- choices: select, status, multi-select, person ----
  const options: ColumnOption[] = col.type === 'person' ? people.map((p) => ({ id: p, name: p, color: '#7FB3D5' })) : col.options ?? []
  const optionOf = (name: string): ColumnOption | undefined => options.find((o) => o.name === name)
  const multi = col.type === 'multiselect' || col.type === 'person'
  const chosen = multi ? splitMulti(raw) : raw ? [raw] : []
  const pick = (name: string): void => {
    if (name === NEW) { setAdding(true); setDraft(''); return }
    if (multi) set(joinMulti([...chosen, name])); else set(name)
  }
  const commitNew = (): void => {
    const name = draft.trim().replace(/,/g, ' ')
    setAdding(false)
    if (!name) return
    if (hasOptions(col.type)) tableOps.ensureOption(table.id, col.id, name)
    pick(name)
  }

  if (adding) {
    return <input className="wb-prop-input" autoFocus value={draft} placeholder={col.type === 'person' ? 'Name…' : 'New option…'} maxLength={40}
      onPointerDown={stop} onChange={(e) => setDraft(e.target.value)} onBlur={commitNew}
      onKeyDown={(e) => { if (e.key === 'Enter') commitNew(); else if (e.key === 'Escape') setAdding(false) }} />
  }

  if (!multi) {
    return (
      <select className="wb-prop-select" value={raw} aria-label={col.name} style={raw ? chipStyle(optionOf(raw)) : undefined}
        onPointerDown={stop} onChange={(e) => pick(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
        {raw && !optionOf(raw) && <option value={raw}>{raw}</option>}
        <option value={NEW}>+ New option…</option>
      </select>
    )
  }
  const rest = options.filter((o) => !chosen.includes(o.name))
  return (
    <span className="wb-prop-chips" onPointerDown={stop}>
      {chosen.map((name) => (
        <span key={name} className="wb-chip-tag" style={chipStyle(optionOf(name))}>
          {name}<button aria-label={`Remove ${name}`} onClick={() => set(joinMulti(chosen.filter((x) => x !== name)))}>✕</button>
        </span>
      ))}
      <select className="wb-prop-more" value="" aria-label={`Add to ${col.name}`} onChange={(e) => { if (e.target.value) pick(e.target.value) }}>
        <option value="">+</option>
        {rest.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
        <option value={NEW}>{col.type === 'person' ? '+ Someone else…' : '+ New option…'}</option>
      </select>
    </span>
  )
}

/**
 * A link cell: chips for what it points at (each opens it), and a search box to add more. Anything in the
 * workspace search can be linked: a task, a milestone, a row of another table, a page, a note.
 */
function LinkValue({ raw, set, selfKey, label }: { raw: string; set: (v: string) => void; selfKey: string; label: string }): JSX.Element {
  const { byKey, index, goTo } = useLinks()
  const keys = splitLinks(raw)
  const [q, setQ] = useState<string | null>(null)
  const [sel, setSel] = useState(0)
  const hits = q ? searchIndex(index, q, 8).filter((h) => h.key !== selfKey && !keys.includes(h.key)) : []
  const add = (key: string): void => { set(joinLinks([...keys, key])); setQ(null); setSel(0) }
  return (
    <span className="wb-prop-chips wb-prop-links" onPointerDown={stop}>
      {keys.map((k) => {
        const h = byKey.get(k)
        return (
          <span key={k} className={`wb-linkchip ${h ? '' : 'is-gone'}`}>
            <button className="wb-linkchip-go" disabled={!h} onClick={() => h && goTo(h)} title={h ? `${h.kind}: ${h.title}` : 'Deleted'}>
              {h && <i>{h.kind}</i>}{h?.title ?? 'Deleted'}
            </button>
            <button aria-label={`Unlink ${h?.title ?? k}`} onClick={() => set(joinLinks(keys.filter((x) => x !== k)))}>✕</button>
          </span>
        )
      })}
      {q === null
        ? <button className="wb-prop-add" aria-label={`Link something to ${label}`} onClick={() => setQ('')}>+</button>
        : (
          <span className="wb-link-pick">
            <input className="wb-prop-input" autoFocus value={q} placeholder="Find a task, row, page…" maxLength={60}
              onChange={(e) => { setQ(e.target.value); setSel(0) }} onBlur={() => window.setTimeout(() => setQ(null), 120)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); setQ(null) }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(hits.length - 1, i + 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
                else if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); add(hits[sel].key) }
              }} />
            {hits.length > 0 && (
              <ul className="wb-search-results wb-mention-list" role="listbox" aria-label="Link to">
                {hits.map((h, i) => (
                  <li key={h.key} role="option" aria-selected={i === sel} className={i === sel ? 'is-on' : ''}
                    onPointerDown={(e) => { e.preventDefault(); add(h.key) }} onPointerEnter={() => setSel(i)}>
                    <span className="wb-search-kind">{h.kind}</span>
                    <span className="wb-search-title">{h.title}</span>
                    {h.context && <span className="wb-search-ctx">{h.context}</span>}
                  </li>
                ))}
              </ul>
            )}
          </span>
        )}
    </span>
  )
}
