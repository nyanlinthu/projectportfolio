import { deriveBoard } from '@/lib/board'
import { Cell, display, Env, evaluateGrid } from '@/lib/formula'
import { owningNodeId } from '@/lib/scope'
import { useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'
import { useSession } from '@/store/useSession'
import { BoardNode, CellFile, ColumnOption, ColumnType, TableColumn, TableEl, TableRow } from '@/types'

// Single place that knows how a table works: its property types, how cells are computed, how a table reads
// the card it lives on, and every way a table may be changed. The grid, the row page, global search and the
// AI tools all go through here, so they can never disagree.

export interface TypeInfo { id: ColumnType; glyph: string; label: string }
export const COLUMN_TYPES: TypeInfo[] = [
  { id: 'text', glyph: 'Aa', label: 'Text' },
  { id: 'number', glyph: '#', label: 'Number' },
  { id: 'select', glyph: '◉', label: 'Select' },
  { id: 'multiselect', glyph: '☰', label: 'Multi-select' },
  { id: 'status', glyph: '◔', label: 'Status' },
  { id: 'date', glyph: '▦', label: 'Date' },
  { id: 'person', glyph: '☺', label: 'Person' },
  { id: 'files', glyph: '▣', label: 'Files & media' },
  { id: 'checkbox', glyph: '☑', label: 'Checkbox' },
  { id: 'url', glyph: '↗', label: 'URL' },
  { id: 'email', glyph: '@', label: 'Email' },
  { id: 'phone', glyph: '☏', label: 'Phone' },
  { id: 'created_time', glyph: '◷', label: 'Created time' },
  { id: 'edited_time', glyph: '◷', label: 'Last edited time' },
  { id: 'created_by', glyph: '☺', label: 'Created by' },
  { id: 'edited_by', glyph: '☺', label: 'Last edited by' },
  { id: 'link', glyph: '⇢', label: 'Link' },
]
export const typeInfo = (t: ColumnType): TypeInfo => COLUMN_TYPES.find((x) => x.id === t) ?? COLUMN_TYPES[0]
/** filled in by the app, never typed */
export const isAuto = (t: ColumnType): boolean => t === 'created_time' || t === 'edited_time' || t === 'created_by' || t === 'edited_by'
export const hasOptions = (t: ColumnType): boolean => t === 'select' || t === 'multiselect' || t === 'status'
/** cells of these types are typed freely and may hold an =formula */
export const isTyped = (t: ColumnType): boolean => t === 'text' || t === 'number'
export const isMulti = (t: ColumnType): boolean => t === 'multiselect' || t === 'person'
export const OPTION_COLORS = ['#8A93A6', '#C9A64B', '#92A524', '#7FB3D5', '#D9822B', '#C0392B', '#B79AD6', '#E59A8C']

const id = (p: string): string => p + Math.random().toString(36).slice(2, 8)
export const newOption = (name: string, n: number): ColumnOption => ({ id: id('o'), name, color: OPTION_COLORS[n % OPTION_COLORS.length] })
export const defaultOptions = (t: ColumnType): ColumnOption[] | undefined =>
  t === 'status' ? [{ id: id('o'), name: 'Not started', color: '#8A93A6' }, { id: id('o'), name: 'In progress', color: '#C9A64B' }, { id: id('o'), name: 'Done', color: '#92A524' }]
    : hasOptions(t) ? [] : undefined
export const splitMulti = (raw: string | undefined): string[] => (raw ?? '').split(',').map((x) => x.trim()).filter(Boolean)
export const joinMulti = (values: string[]): string => [...new Set(values)].join(', ')
/** A link cell: search keys of what it points at, space-separated (keys never contain spaces). */
export const splitLinks = (raw: string | undefined): string[] => (raw ?? '').split(/\s+/).filter(Boolean)
export const joinLinks = (keys: string[]): string => [...new Set(keys)].join(' ')

export const fmtTime = (ms: number | undefined): string =>
  ms ? new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
/** What an automatic column shows for a row. */
export const autoValue = (t: ColumnType, r: TableRow): string =>
  t === 'created_time' ? fmtTime(r.createdAt) : t === 'edited_time' ? fmtTime(r.updatedAt) : t === 'created_by' ? r.createdBy ?? '' : t === 'edited_by' ? r.updatedBy ?? '' : ''
/** Only ever open these kinds of address from a cell; anything else is shown as text. */
export function safeHref(t: ColumnType, raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (t === 'url') return /^https?:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? `https://${v}` : null
  if (t === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : null
  if (t === 'phone') return /^[+\d][\d\s().-]{3,}$/.test(v) ? `tel:${v.replace(/[^\d+]/g, '')}` : null
  return null
}

// ---- how a table relates to the card it sits on -----------------------------------------------------------------
// A table belongs to one card (a project, a milestone…). Its formulas can read that card's live numbers, so a
// budget table on a project can say "=B5*PROGRESS()/100" and move as the tasks underneath get done.
let envCache: { nodes: Record<string, BoardNode>; board: ReturnType<typeof deriveBoard> } | null = null
export function cardEnv(scopeId: string): Env {
  const nodes = useBoardStore.getState().nodes
  if (envCache?.nodes !== nodes) envCache = { nodes, board: deriveBoard(nodes) }
  // a table inside a page (or a page inside a page…) still reads the card that page ultimately belongs to
  const node = nodes[owningNodeId(scopeId, nodes, useElementStore.getState().elements) ?? '']
  if (!node) return {}
  const v = envCache.board.view(node)
  return { PROGRESS: () => v.pct, TASKS: () => v.total, DONE: () => v.done, CARD: () => node.title }
}

export const rawGrid = (el: TableEl): string[][] => el.rows.map((r) => el.columns.map((c) => (isAuto(c.type) ? autoValue(c.type, r) : r.cells[c.id] ?? '')))
export const computeTable = (el: TableEl): Cell[][] => evaluateGrid(rawGrid(el), cardEnv(el.scopeId))
export const isFormula = (raw: string | undefined): boolean => !!raw && raw.startsWith('=')
/** A row's name: its first column, as shown. */
export const rowTitle = (rowIndex: number, computed: Cell[][]): string => display(computed[rowIndex]?.[0] ?? '') || `Untitled`
export const rowBody = (r: TableRow): string => r.body ?? r.notes ?? ''

// ---- changing a table -------------------------------------------------------------------------------------------
const who = (): string => useSession.getState().user?.name ?? 'You'
export const newColumn = (name: string, type: ColumnType = 'text'): TableColumn => ({ id: id('c'), name, type, ...(defaultOptions(type) ? { options: defaultOptions(type) } : {}) })
export const newRow = (): TableRow => ({ id: id('r'), cells: {}, createdAt: Date.now(), updatedAt: Date.now(), createdBy: who(), updatedBy: who() })
export const starterTable = (): Pick<TableEl, 'columns' | 'rows' | 'title'> => ({
  title: '',
  columns: [newColumn('Name'), newColumn('Status', 'status'), newColumn('Amount', 'number')],
  rows: [newRow(), newRow(), newRow()],
})

const tableOf = (tableId: string): TableEl | undefined => { const e = useElementStore.getState().elements.find((x) => x.id === tableId); return e?.kind === 'table' ? e : undefined }
const save = (tableId: string, patch: { rows?: TableRow[]; columns?: TableColumn[]; title?: string }): void => useElementStore.getState().update(tableId, patch)
/** Every edit to a row goes through here, so "last edited" is always right. */
function editRow(tableId: string, rowId: string, change: (r: TableRow) => TableRow): void {
  const t = tableOf(tableId)
  if (!t) return
  save(tableId, { rows: t.rows.map((r) => (r.id === rowId ? { ...change(r), updatedAt: Date.now(), updatedBy: who() } : r)) })
}
export const tableOps = {
  setCell: (tableId: string, rowId: string, colId: string, value: string): void => editRow(tableId, rowId, (r) => ({ ...r, cells: { ...r.cells, [colId]: value } })),
  setFiles: (tableId: string, rowId: string, colId: string, files: CellFile[]): void => editRow(tableId, rowId, (r) => ({ ...r, files: { ...r.files, [colId]: files } })),
  patchRow: (tableId: string, rowId: string, patch: Partial<Pick<TableRow, 'body' | 'links'>>): void => editRow(tableId, rowId, (r) => ({ ...r, ...patch })),
  addRow: (tableId: string): string => { const t = tableOf(tableId), r = newRow(); if (t) save(tableId, { rows: [...t.rows, r] }); return r.id },
  removeRow: (tableId: string, rowId: string): void => { const t = tableOf(tableId); if (t) save(tableId, { rows: t.rows.filter((r) => r.id !== rowId) }) },
  addColumn: (tableId: string, type: ColumnType = 'text'): void => { const t = tableOf(tableId); if (t) save(tableId, { columns: [...t.columns, newColumn('', type)] }) },
  removeColumn: (tableId: string, colId: string): void => { const t = tableOf(tableId); if (t && t.columns.length > 1) save(tableId, { columns: t.columns.filter((c) => c.id !== colId) }) },
  patchColumn: (tableId: string, colId: string, patch: Partial<TableColumn>): void => { const t = tableOf(tableId); if (t) save(tableId, { columns: t.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) }) },
  /** Changing a property's type keeps what was typed; choice types get their starting options. */
  setType: (tableId: string, colId: string, type: ColumnType): void => {
    const t = tableOf(tableId)
    if (!t) return
    // an unnamed property takes its type's name ("Person", "Created time"…), or follows it if it still has the old one
    const rename = (c: TableColumn): string => (!c.name.trim() || c.name === typeInfo(c.type).label ? typeInfo(type).label : c.name)
    save(tableId, { columns: t.columns.map((c) => (c.id === colId ? { ...c, name: rename(c), type, options: hasOptions(type) ? (c.options?.length ? c.options : defaultOptions(type)) : c.options } : c)) })
  },
  /** Typing a new choice into a cell adds it to the property, as in Notion. */
  ensureOption: (tableId: string, colId: string, name: string): void => {
    const t = tableOf(tableId), c = t?.columns.find((x) => x.id === colId)
    if (!t || !c || !name.trim() || c.options?.some((o) => o.name === name.trim())) return
    tableOps.patchColumn(tableId, colId, { options: [...(c.options ?? []), newOption(name.trim(), c.options?.length ?? 0)] })
  },
  setTitle: (tableId: string, title: string): void => save(tableId, { title }),
}
