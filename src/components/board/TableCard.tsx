import { useEscape } from '@/hooks/useEscape'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { closeBrackets, colLetter, display, FormulaError, FUNCTION_HELP, functionAtCaret, ImageValue, wantsReference } from '@/lib/formula'
import { COLUMN_TYPES, computeTable, hasOptions, isFormula, isTyped, newOption, OPTION_COLORS, tableOps, typeInfo } from '@/lib/table'
import { useBoardStore } from '@/store/useBoardStore'
import { TableColumn, TableEl } from '@/types'
import Shell from './ElementShell'
import { PeerMark } from './Presence'
import PropertyValue from './PropertyValue'

interface TableCardProps {
  el: TableEl
  selected: boolean
  onSelect: (id: string | null) => void
  onOpenRow: (tableId: string, rowId: string) => void
}

const stop = (e: React.PointerEvent): void => e.stopPropagation()
const refOf = (r: number, c: number): string => `${colLetter(c)}${r + 1}`
const rangeOf = (a: { r: number; c: number }, b: { r: number; c: number }): string =>
  a.r === b.r && a.c === b.c ? refOf(a.r, a.c) : `${refOf(Math.min(a.r, b.r), Math.min(a.c, b.c))}:${refOf(Math.max(a.r, b.r), Math.max(a.c, b.c))}`

/** The menu behind a column header: what kind of property this is, its choices, and removing it. */
function PropertyMenu({ table, col, onClose }: { table: TableEl; col: TableColumn; onClose: () => void }): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent): void => { if (box.current && !box.current.contains(e.target as Node)) onClose() }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [onClose])
  useEscape(onClose)
  const options = col.options ?? []
  const setOptions = (next: typeof options): void => tableOps.patchColumn(table.id, col.id, { options: next })
  return (
    <div ref={box} className="wb-propmenu" onPointerDown={stop}>
      <div className="wb-kicker"><span>Property type</span></div>
      <div className="wb-propmenu-types">
        {COLUMN_TYPES.map((t) => (
          <button key={t.id} className={t.id === col.type ? 'is-on' : ''} aria-pressed={t.id === col.type} onClick={() => tableOps.setType(table.id, col.id, t.id)}>
            <i>{t.glyph}</i>{t.label}
          </button>
        ))}
      </div>
      {hasOptions(col.type) && (
        <>
          <div className="wb-kicker"><span>Options</span></div>
          <div className="wb-propmenu-options">
            {options.map((o, i) => (
              <div key={o.id}>
                <button className="wb-dot" style={{ background: o.color }} title="Change colour" aria-label={`Colour of ${o.name}`}
                  onClick={() => setOptions(options.map((x) => (x.id === o.id ? { ...x, color: OPTION_COLORS[(OPTION_COLORS.indexOf(x.color) + 1) % OPTION_COLORS.length] } : x)))} />
                <input value={o.name} maxLength={40} aria-label={`Option ${i + 1}`} onChange={(e) => setOptions(options.map((x) => (x.id === o.id ? { ...x, name: e.target.value.replace(/,/g, ' ') } : x)))} />
                <button aria-label={`Delete option ${o.name}`} onClick={() => setOptions(options.filter((x) => x.id !== o.id))}>✕</button>
              </div>
            ))}
            <button className="wb-propmenu-add" onClick={() => setOptions([...options, newOption(`Option ${options.length + 1}`, options.length)])}>+ Add option</button>
          </div>
        </>
      )}
      {table.columns.length > 1 && <button className="wb-propmenu-del" onClick={() => { tableOps.removeColumn(table.id, col.id); onClose() }}>Delete property</button>}
    </div>
  )
}

/**
 * Database + spreadsheet in one grid. Each column is a property with a type (the menu behind its header); text
 * and number cells are typed freely and may hold "=formula" with A1-style references. While a formula is being
 * typed, clicking another cell (or dragging across several) writes its reference in, as a spreadsheet does.
 * Each row is a page: the button beside its number opens it.
 */
export default function TableCard({ el, selected, onSelect, onOpenRow }: TableCardProps): JSX.Element {
  const nodes = useBoardStore((s) => s.nodes) // formulas may read the owning card, so recompute when work changes
  const computed = useMemo(() => computeTable(el), [el.columns, el.rows, el.scopeId, nodes]) // eslint-disable-line react-hooks/exhaustive-deps
  const [edit, setEdit] = useState<{ rowId: string; colId: string } | null>(null) // the cell being typed in
  const [caret, setCaret] = useState(0)
  const [menu, setMenu] = useState<string | null>(null)
  const inputOf = (rowId: string, colId: string): HTMLInputElement | null => document.querySelector(`[data-cell="${el.id}:${rowId}:${colId}"]`)

  const editRaw = edit ? el.rows.find((r) => r.id === edit.rowId)?.cells[edit.colId] ?? '' : ''
  const typingFormula = !!edit && editRaw.startsWith('=')

  // ---- click (or drag) another cell to write its reference into the formula being typed ----
  const pick = useRef<{ start: number; len: number; anchor: { r: number; c: number } } | null>(null)
  const swallow = useRef(false)   // the click that inserted a reference must not also move the focus
  const caretTo = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (caretTo.current == null || !edit) return
    const input = inputOf(edit.rowId, edit.colId)
    input?.focus()
    input?.setSelectionRange(caretTo.current, caretTo.current)
    setCaret(caretTo.current)
    caretTo.current = null
  })
  useEffect(() => {
    const up = (): void => { pick.current = null; swallow.current = false }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])
  const writeRef = (text: string): void => {
    if (!edit || !pick.current) return
    const { start, len } = pick.current
    tableOps.setCell(el.id, edit.rowId, edit.colId, editRaw.slice(0, start) + text + editRaw.slice(start + len))
    pick.current.len = text.length
    caretTo.current = start + text.length
  }
  const onCellDown = (r: number, c: number, e: React.PointerEvent): void => {
    e.stopPropagation()
    if (!edit || !typingFormula) return
    if (el.rows[r].id === edit.rowId && el.columns[c].id === edit.colId) return
    const at = inputOf(edit.rowId, edit.colId)?.selectionStart ?? editRaw.length
    if (!wantsReference(editRaw.slice(0, at))) return
    swallow.current = true
    pick.current = { start: at, len: 0, anchor: { r, c } }
    writeRef(refOf(r, c))
  }
  const onCellEnter = (r: number, c: number, e: React.PointerEvent): void => {
    if (pick.current && e.buttons === 1) writeRef(rangeOf(pick.current.anchor, { r, c }))
  }

  /** Enter moves down a row, adding one at the bottom: a column of values goes in without leaving the keyboard. */
  const pendingFocus = useRef<{ rowId: string; colId: string } | null>(null)
  useEffect(() => {
    const p = pendingFocus.current
    if (p) { const cell = inputOf(p.rowId, p.colId); if (cell) { cell.focus(); pendingFocus.current = null } }
  })
  const onEnter = (rowIndex: number, colId: string): void => {
    if (rowIndex + 1 < el.rows.length) inputOf(el.rows[rowIndex + 1].id, colId)?.focus()
    else pendingFocus.current = { rowId: tableOps.addRow(el.id), colId }
  }

  /**
   * Arrow keys move between cells as in a spreadsheet. Up and down always move. Left and right move once the
   * caret is at that end of the text (or the whole cell is selected), so text can still be edited with them.
   * Cells that are not typed into (selects, dates, checkboxes) are stepped over.
   */
  const onArrow = (e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number): void => {
    const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if ((!dr && !dc) || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return
    const t = e.currentTarget, a = t.selectionStart ?? 0, b = t.selectionEnd ?? 0, all = a === 0 && b === t.value.length
    if (dc === -1 && !(all || (a === 0 && b === 0))) return
    if (dc === 1 && !(all || (a === t.value.length && b === a))) return
    for (let r = ri + dr, c = ci + dc; r >= 0 && r < el.rows.length && c >= 0 && c < el.columns.length; r += dr, c += dc) {
      const cell = inputOf(el.rows[r].id, el.columns[c].id)
      if (cell) { e.preventDefault(); cell.focus(); cell.select(); return }
    }
  }

  // hint line: what the function being typed expects
  const hints = useMemo(() => {
    if (!typingFormula) return []
    const fn = functionAtCaret(editRaw.slice(0, caret))
    if (!fn) return []
    return FUNCTION_HELP[fn] ? [FUNCTION_HELP[fn]] : Object.keys(FUNCTION_HELP).filter((k) => k.startsWith(fn)).slice(0, 4).map((k) => FUNCTION_HELP[k])
  }, [typingFormula, editRaw, caret])

  return (
    <Shell el={el} selected={selected} className="wb-table" onTap={() => onSelect(selected ? null : el.id)}>
      <div className="wb-table-head">
        <span>Table</span>
        <input value={el.title ?? ''} placeholder="Name this table" maxLength={60} aria-label="Table name"
          onPointerDown={stop} onChange={(e) => tableOps.setTitle(el.id, e.target.value)} />
        <span>{el.rows.length} row{el.rows.length === 1 ? '' : 's'}</span>
      </div>
      <table onPointerDown={stop}>
        <thead>
          <tr>
            <th className="wb-table-corner" />
            {el.columns.map((c, ci) => (
              <th key={c.id}>
                <div className="wb-th">
                  <i>{colLetter(ci)}</i>
                  <input value={c.name} placeholder="Property" maxLength={40} aria-label={`Column ${colLetter(ci)} name`}
                    onChange={(e) => tableOps.patchColumn(el.id, c.id, { name: e.target.value })} />
                  <button title={`${typeInfo(c.type).label}: change type or options`} aria-label={`Property settings for ${c.name || colLetter(ci)}`} aria-expanded={menu === c.id}
                    onClick={() => setMenu(menu === c.id ? null : c.id)}>{typeInfo(c.type).glyph}</button>
                </div>
                {menu === c.id && <PropertyMenu table={el} col={c} onClose={() => setMenu(null)} />}
              </th>
            ))}
            <th className="wb-table-plus"><button title="Add a property" aria-label="Add a property" onClick={() => tableOps.addColumn(el.id)}>+</button></th>
          </tr>
        </thead>
        <tbody>
          {el.rows.map((r, ri) => (
            <tr key={r.id}>
              <th className="wb-table-rownum">
                <button title="Open this row as a page" aria-label={`Open row ${ri + 1}`} onClick={() => onOpenRow(el.id, r.id)}>{ri + 1}<span>⤢</span></button>
              </th>
              {el.columns.map((c, ci) => {
                const pickable = { onPointerDown: (e: React.PointerEvent) => onCellDown(ri, ci, e), onPointerEnter: (e: React.PointerEvent) => onCellEnter(ri, ci, e),
                  onMouseDown: (e: React.MouseEvent) => { if (swallow.current) e.preventDefault() } }
                if (!isTyped(c.type)) return <td key={c.id} data-peer-cell={`${el.id}:${r.id}:${c.id}`} className={`is-${c.type}`} {...pickable}><PropertyValue table={el} row={r} col={c} /><PeerMark id={`${el.id}:${r.id}:${c.id}`} /></td>
                const raw = r.cells[c.id] ?? ''
                const value = computed[ri]?.[ci] ?? ''
                const typing = edit?.rowId === r.id && edit.colId === c.id
                const formula = isFormula(raw)
                const picture = value instanceof ImageValue && !typing ? value.src : null
                return (
                  <td key={c.id} {...pickable} className={`${c.type === 'number' || typeof value === 'number' ? 'is-num' : ''} ${value instanceof FormulaError ? 'is-err' : ''} ${formula ? 'is-formula' : ''} ${picture ? 'is-picture' : ''}`}>
                    {picture && <img src={picture} alt="" draggable={false} referrerPolicy="no-referrer" />}
                    <input data-cell={`${el.id}:${r.id}:${c.id}`} aria-label={`${c.name || colLetter(ci)} ${ri + 1}`} autoComplete="off" spellCheck={false}
                      value={typing ? raw : display(value)}
                      onFocus={(e) => { setEdit({ rowId: r.id, colId: c.id }); setCaret(e.target.selectionStart ?? raw.length) }}
                      onBlur={() => {
                        const closed = closeBrackets(raw)
                        if (closed !== raw) tableOps.setCell(el.id, r.id, c.id, closed)
                        setEdit((cur) => (cur?.rowId === r.id && cur.colId === c.id ? null : cur))
                      }}
                      onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
                      onChange={(e) => { tableOps.setCell(el.id, r.id, c.id, e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter(ri, c.id) } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); else onArrow(e, ri, ci) }} />
                    <PeerMark id={`${el.id}:${r.id}:${c.id}`} />
                  </td>
                )
              })}
              <td className="wb-table-plus" />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="wb-table-foot" onPointerDown={stop}>
        <button className="wb-table-addrow" onClick={() => tableOps.addRow(el.id)}>+ New row</button>
        {typingFormula && (
          <div className="wb-formula-hint" role="status">
            {hints.length ? hints.map((h) => <div key={h}>{h}</div>) : <div>Click a cell to use it, or drag across several for a range.</div>}
          </div>
        )}
      </div>
    </Shell>
  )
}
