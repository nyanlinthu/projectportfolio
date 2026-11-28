import { addPlan, addStarterKit, TEMPLATES } from '@/lib/pmkit'
import { childKind, deriveBoard, KIND_LABEL, nextChildSpot, PRIORITIES, STATUSES } from '@/lib/board'
import { display } from '@/lib/formula'
import { copyPayload, pastePayload } from '@/lib/clipboard'
import { redo, undo } from '@/lib/history'
import { buildIndex, searchIndex } from '@/lib/search'
import { topZ } from '@/lib/stack'
import { computeTable, newRow, rowBody, tableOps } from '@/lib/table'
import { ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'
import { useSession } from '@/store/useSession'
import { pageAnc } from '@/lib/scope'
import { sendMention } from '@/services/inbox'
import { BoardElement, BoardNode, Priority, Status } from '@/types'

// The agent seam. Everything an AI agent may read or change on the board is a tool here, in the Anthropic
// tool-use shape (name, description, JSON-schema input). The tools call the same stores and the same derived
// logic (roll-up, formulas, search) the UI uses, so the agent sees exactly what a person sees and cannot
// write anything the UI could not have written.
//
// To use them in-app with a model: send TOOL_DEFS as `tools`, and run each tool_use block through callTool().
// agent/ serves this same list over MCP (Hermes, Claude Code, Codex, ...): it runs these functions server-side
// against a workspace loaded from Firestore. See agent/README.md.

export interface ToolDef {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}
interface Tool extends ToolDef { run: (args: Record<string, unknown>) => unknown }

const str = (v: unknown, name: string): string => { if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required`); return v }
const optStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const nodes = (): Record<string, BoardNode> => useBoardStore.getState().nodes
const elements = (): BoardElement[] => useElementStore.getState().elements
const needNode = (id: unknown): BoardNode => { const n = nodes()[str(id, 'id')]; if (!n) throw new Error(`No work item with id ${String(id)}`); return n }
const needTable = (id: unknown): Extract<BoardElement, { kind: 'table' }> => {
  const e = elements().find((x) => x.id === id)
  if (!e || e.kind !== 'table') throw new Error(`No table with id ${String(id)}`)
  return e
}
const STATUS_IDS = STATUSES.map((s) => s.id)
const PRIORITY_IDS = PRIORITIES.map((p) => p.id)

/** A work item as the agent sees it: stored fields plus what the roll-up derives. */
function describeNode(n: BoardNode, board = deriveBoard(nodes())): Record<string, unknown> {
  const v = board.view(n)
  return {
    id: n.id, kind: n.kind, title: n.title, parent_id: n.parentId ?? null,
    ...(n.kind === 'task' ? { status: n.status ?? 'backlog', priority: n.priority ?? null, state: v.label, assignee: n.assignee ?? null, start: n.start ?? null, end: n.end ?? null, actual_start: n.actualStart ?? null, actual_end: n.actualEnd ?? null }
      : { progress_pct: v.pct, tasks_done: v.done, tasks_total: v.total, health: v.label }),
    children: (board.kids.get(n.id) ?? []).map((k) => k.id),
  }
}
function describeElement(e: BoardElement): Record<string, unknown> {
  const base = { id: e.id, kind: e.kind, on_board_of: e.scopeId }
  if (e.kind === 'image') return { ...base, width: e.w, height: e.h } // pixels are never sent to the agent
  if (e.kind === 'stroke') return { ...base, note: 'freehand ink' }
  if (e.kind === 'table') {
    const computed = computeTable(e)
    return { ...base, title: e.title ?? '', columns: e.columns.map((c) => ({ name: c.name, type: c.type })),
      rows: e.rows.map((r, ri) => ({ row: ri + 1, values: Object.fromEntries(e.columns.map((c, ci) => [c.name || `col${ci + 1}`, display(computed[ri][ci])])),
        formulas: Object.fromEntries(e.columns.filter((c) => (r.cells[c.id] ?? '').startsWith('=')).map((c) => [c.name, r.cells[c.id]])), page_text: rowBody(r), links: (r.links ?? []).map((l) => l.title) })) }
  }
  if (e.kind === 'pool') return { ...base, title: e.title ?? '', direction: e.dir === 'rows' ? 'horizontal lanes' : 'vertical lanes', lanes: e.lanes.map((l) => l.title), width: e.w, height: e.h }
  if (e.kind === 'page') return { ...base, title: e.title, text: e.body, links: (e.links ?? []).map((l) => l.title) }
  if (e.kind === 'link') return { ...base, links_to: e.key, title: e.title }
  if (e.kind === 'connector') return { ...base, from_id: e.fromId, to_id: e.toId, label: e.label ?? '' }
  if (e.kind === 'checklist') return { ...base, lists: e.groups.map((g) => ({ title: g.title, items: g.items.map((i) => ({ text: i.text, done: i.done })) })) }
  if (e.kind === 'kanban') return { ...base, title: e.title ?? '', cards: (e.cards ?? []).map((c) => ({ id: c.id, text: c.text, column: STATUSES[c.col]?.name, page_text: c.body ?? '' })) }
  return { ...base, text: e.text, ...(e.kind === 'shape' ? { shape: e.shape } : {}) }
}

const TOOLS: Tool[] = [
  {
    name: 'get_schema',
    description: 'Explain what exists on the board and how the pieces relate. Call this first.',
    input_schema: { type: 'object', properties: {} },
    run: () => ({
      work_items: 'A tree: portfolio > project > milestone > task (tasks may have sub-tasks). Only tasks without sub-tasks carry a status. Progress and health of everything above are derived from task status and are never set directly.',
      task_statuses: STATUS_IDS,
      task_priorities: 'Eisenhower disposition of a task, or null when not sorted yet: ' + PRIORITIES.map((p) => `${p.id} (${p.hint.toLowerCase()})`).join(', ') + '. Independent of status; a done task keeps its priority.',
      board_elements: 'Free-form things placed on a work item\'s board: page (title + text + @links), pool (a swimlane board: lanes for process flows by department / team; other items sit on top of it), text, sticky, shape, checklist, kanban (its own cards, independent of tasks), table (typed properties; each row is a page; text/number cells may be "=formulas" with A1 references and can read their card via PROGRESS(), TASKS(), DONE(), CARD()), connector (an arrow between any two items), image, stroke.',
      ids: 'Every work item and element has an id. The portfolio id is "' + ROOT_ID + '".',
    }),
  },
  {
    name: 'get_outline',
    description: 'The whole work breakdown as a tree with ids, task status, assignees and rolled-up progress. Optionally start from one work item.',
    input_schema: { type: 'object', properties: { root_id: { type: 'string', description: 'Start from this work item instead of the portfolio.' } } },
    run: (a) => {
      const all = nodes(), board = deriveBoard(all)
      const walk = (n: BoardNode): Record<string, unknown> => ({ ...describeNode(n, board), children: (board.kids.get(n.id) ?? []).map(walk) })
      return walk(optStr(a.root_id) ? needNode(a.root_id) : all[ROOT_ID])
    },
  },
  {
    name: 'search',
    description: 'Full-text search across everything: work items, notes, shapes, checklist items, kanban cards, table rows, arrow labels. Same index as the search bar.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    run: (a) => searchIndex(buildIndex(nodes(), elements()), str(a.query, 'query'), typeof a.limit === 'number' ? a.limit : 20)
      .map((h) => ({ kind: h.kind, title: h.title, where: h.context, id: h.nodeId ?? h.elementId, row_id: h.rowId })),
  },
  {
    name: 'get_item',
    description: 'Full detail of one work item or one board element by id. For a work item, also lists the elements on its board.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (a) => {
      const id = str(a.id, 'id')
      const n = nodes()[id]
      if (n) return { ...describeNode(n), on_its_board: elements().filter((e) => e.scopeId === id).map(describeElement) }
      const e = elements().find((x) => x.id === id)
      if (e) return describeElement(e)
      throw new Error(`Nothing with id ${id}`)
    },
  },
  {
    name: 'add_work_item',
    description: 'Add a work item under a parent. The kind follows from the parent: a project under the portfolio, a milestone under a project, a task under a milestone, a sub-task under a task.',
    input_schema: { type: 'object', properties: { parent_id: { type: 'string' }, title: { type: 'string' }, assignee: { type: 'string' } }, required: ['parent_id', 'title'] },
    run: (a) => {
      const parent = needNode(a.parent_id)
      const spot = nextChildSpot(parent, deriveBoard(nodes()).kids)
      const store = useBoardStore.getState()
      const id = store.addNode(childKind(parent.kind), parent.id, spot.x, spot.y, str(a.title, 'title'))
      store.setZ({ [id]: topZ() })
      if (optStr(a.assignee)) store.updateNode(id, { assignee: optStr(a.assignee) })
      return describeNode(nodes()[id])
    },
  },
  {
    name: 'update_work_item',
    description: 'Change a work item: title, and for tasks the status, priority (empty string clears it), assignee and planned dates (YYYY-MM-DD). Progress cannot be set; it follows from task status.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: STATUS_IDS }, priority: { type: 'string', enum: [...PRIORITY_IDS, ''] }, assignee: { type: 'string' }, start: { type: 'string', description: 'planned start YYYY-MM-DD (any kind)' }, end: { type: 'string', description: 'planned finish' }, actual_start: { type: 'string', description: 'tasks: when work really started' }, actual_end: { type: 'string', description: 'tasks: when it really finished' } }, required: ['id'] },
    run: (a) => {
      const n = needNode(a.id)
      const patch: Partial<BoardNode> = {}
      if (optStr(a.title)) patch.title = optStr(a.title)
      if (a.status !== undefined) {
        if (n.kind !== 'task') throw new Error(`${KIND_LABEL[n.kind]} status is derived from its tasks and cannot be set`)
        if (!STATUS_IDS.includes(a.status as Status)) throw new Error(`status must be one of ${STATUS_IDS.join(', ')}`)
        patch.status = a.status as Status
      }
      if (a.priority !== undefined) {
        if (n.kind !== 'task') throw new Error('Only tasks have a priority')
        if (a.priority !== '' && !PRIORITY_IDS.includes(a.priority as Priority)) throw new Error(`priority must be one of ${PRIORITY_IDS.join(', ')} or empty`)
        patch.priority = (a.priority as Priority) || undefined
      }
      for (const k of ['assignee', 'start', 'end'] as const) if (typeof a[k] === 'string') patch[k] = (a[k] as string) || undefined
      if (typeof a.actual_start === 'string') patch.actualStart = (a.actual_start as string) || undefined
      if (typeof a.actual_end === 'string') patch.actualEnd = (a.actual_end as string) || undefined
      useBoardStore.getState().updateNode(n.id, patch)
      return describeNode(nodes()[n.id])
    },
  },
  {
    name: 'delete_work_item',
    description: 'Delete a work item and everything under it. Cannot be undone. The portfolio itself cannot be deleted.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: (a) => { const n = needNode(a.id); if (n.id === ROOT_ID) throw new Error('The portfolio cannot be deleted'); useBoardStore.getState().deleteNode(n.id); return { deleted: n.id } },
  },
  {
    name: 'add_note',
    description: 'Put a text label or a sticky note on a work item\'s board.',
    input_schema: { type: 'object', properties: { on_board_of: { type: 'string', description: 'Work item id.' }, text: { type: 'string' }, kind: { type: 'string', enum: ['text', 'sticky'] } }, required: ['on_board_of', 'text'] },
    run: (a) => {
      const n = needNode(a.on_board_of)
      const mine = elements().filter((e) => e.scopeId === n.id && (e.kind === 'text' || e.kind === 'sticky')).length
      const at = { scopeId: n.id, z: topZ(), x: n.x + 230, y: n.y + mine * 140, text: str(a.text, 'text') }
      const id = a.kind === 'text' ? useElementStore.getState().add({ ...at, kind: 'text' }) : useElementStore.getState().add({ ...at, kind: 'sticky', color: '#E8C96A' })
      return { id }
    },
  },
  {
    name: 'add_page',
    description: 'Create a standalone page (title + text) on a work item\'s board.',
    input_schema: { type: 'object', properties: { on_board_of: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } }, required: ['on_board_of', 'title'] },
    run: (a) => {
      const n = needNode(a.on_board_of)
      return { id: useElementStore.getState().add({ kind: 'page', scopeId: n.id, z: topZ(), x: n.x + 230, y: n.y - 120, title: str(a.title, 'title'), body: optStr(a.text) ?? '' }) }
    },
  },
  {
    name: 'mention_teammate',
    description: 'Notify a teammate about a page (a page element id, or tableId:rowId for a table row): adds "@Name" to the page text and puts a notification in their bell that opens this page. Use list_teammates for ids. Only teammates who can see the page can be mentioned.',
    input_schema: { type: 'object', properties: { page_key: { type: 'string' }, uid: { type: 'string' } }, required: ['page_key', 'uid'] },
    run: (a) => {
      const key = str(a.page_key, 'page_key'), uid = str(a.uid, 'uid')
      const m = useSession.getState().members.find((x) => x.uid === uid)
      if (!m) throw new Error(`No teammate with uid "${uid}" in this workspace`)
      const anc = pageAnc(key, nodes(), elements())
      if (m.scopes?.length && !anc.some((id) => m.scopes!.includes(id))) throw new Error(`${m.name} cannot see that page`)
      const [eid, rid] = key.split(':')
      const el = elements().find((e) => e.id === eid)
      const link = { key: `person:${uid}`, title: m.name }
      let title = ''
      if (el?.kind === 'page' && !rid) {
        title = el.title
        useElementStore.getState().update(el.id, { body: `${el.body}${el.body ? ' ' : ''}@${m.name} `, links: [...(el.links ?? []).filter((l) => l.key !== link.key), link] })
      } else if (el?.kind === 'table' && rid) {
        const row = el.rows.find((r) => r.id === rid)
        if (!row) throw new Error(`No row "${rid}" in table ${eid}`)
        title = `${el.title || 'Table'} row`
        tableOps.patchRow(el.id, rid, { body: `${rowBody(row)}${rowBody(row) ? ' ' : ''}@${m.name} `, links: [...(row.links ?? []).filter((l) => l.key !== link.key), link] })
      } else throw new Error(`No page "${key}"`)
      void sendMention(uid, key, title, anc)
      return { notified: m.name }
    },
  },
  {
    name: 'list_teammates',
    description: 'The people in this workspace: uid, name, email, role, and the cards they are limited to (empty = everything).',
    input_schema: { type: 'object', properties: {} },
    run: () => useSession.getState().members.map((m) => ({ uid: m.uid, name: m.name, email: m.email, role: m.role, scopes: m.scopes ?? [] })),
  },
  {
    name: 'add_plan',
    description: `Add a project plan (PMBOK knowledge-area document) to a project; it appears in that project's Plans sheet. Templates: ${TEMPLATES.map((t) => `${t.id} (${t.title}, ${t.area})`).join('; ')}. Use "starter" for the five every project starts with.`,
    input_schema: { type: 'object', properties: { project_id: { type: 'string' }, template: { type: 'string' } }, required: ['project_id', 'template'] },
    run: (a) => {
      const n = needNode(a.project_id)
      const t = str(a.template, 'template')
      if (t === 'starter') { addStarterKit(n.id); return { ok: true } }
      const id = addPlan(n.id, t)
      if (!id) throw new Error(`No plan template "${t}"`)
      return { id }
    },
  },
  {
    name: 'connect',
    description: 'Draw an arrow from one item to another (work items or board elements), with an optional label.',
    input_schema: { type: 'object', properties: { from_id: { type: 'string' }, to_id: { type: 'string' }, label: { type: 'string' } }, required: ['from_id', 'to_id'] },
    run: (a) => {
      const from = str(a.from_id, 'from_id'), to = str(a.to_id, 'to_id')
      const exists = (id: string): string | undefined => (nodes()[id] ? id : elements().find((e) => e.id === id)?.scopeId)
      const scope = exists(from)
      if (!scope || !exists(to)) throw new Error('Both ends must be existing items')
      return { id: useElementStore.getState().add({ kind: 'connector', scopeId: nodes()[scope]?.parentId ?? scope, x: 0, y: 0, fromId: from, toId: to, label: optStr(a.label) }) }
    },
  },
  {
    name: 'table_set_cell',
    description: 'Write one table cell. Row is 1-based; column is its name or its letter (A, B, …). A value starting with "=" is a formula. Returns the computed result.',
    input_schema: { type: 'object', properties: { table_id: { type: 'string' }, row: { type: 'number' }, column: { type: 'string' }, value: { type: 'string' } }, required: ['table_id', 'row', 'column', 'value'] },
    run: (a) => {
      const t = needTable(a.table_id)
      const col = str(a.column, 'column')
      const ci = t.columns.findIndex((c, i) => c.name.toLowerCase() === col.toLowerCase() || String.fromCharCode(65 + i) === col.toUpperCase())
      const ri = Number(a.row) - 1
      if (ci < 0) throw new Error(`No column "${col}"`)
      if (!(ri >= 0 && ri < t.rows.length)) throw new Error(`Row ${String(a.row)} does not exist (table has ${t.rows.length})`)
      const rows = t.rows.map((r, i) => (i === ri ? { ...r, cells: { ...r.cells, [t.columns[ci].id]: String(a.value ?? '') } } : r))
      useElementStore.getState().update(t.id, { rows })
      return { result: display(computeTable({ ...t, rows })[ri][ci]) }
    },
  },
  {
    name: 'table_add_row',
    description: 'Append a row to a table. `values` maps column names to values (formulas allowed).',
    input_schema: { type: 'object', properties: { table_id: { type: 'string' }, values: { type: 'object' } }, required: ['table_id'] },
    run: (a) => {
      const t = needTable(a.table_id)
      const row = newRow()
      for (const [k, v] of Object.entries((a.values as Record<string, unknown>) ?? {})) {
        const c = t.columns.find((x) => x.name.toLowerCase() === k.toLowerCase())
        if (!c) throw new Error(`No column "${k}"`)
        row.cells[c.id] = String(v)
      }
      useElementStore.getState().update(t.id, { rows: [...t.rows, row] })
      return { row: t.rows.length + 1, row_id: row.id }
    },
  },
  {
    name: 'undo',
    description: 'Take back the most recent change made on this device (a person\'s Cmd/Ctrl+Z).',
    input_schema: { type: 'object', properties: {} },
    run: () => ({ undone: undo() }),
  },
  {
    name: 'redo',
    description: 'Re-apply the change that was just undone.',
    input_schema: { type: 'object', properties: {} },
    run: () => ({ redone: redo() }),
  },
  {
    name: 'duplicate',
    description: 'Copy a work item (with everything under it) or a board element and place the copy at x, y. Pass exactly one of `id` (work item) or `element_id`. A work item copy goes beside the original, under the same parent.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, element_id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } },
    run: (a) => {
      const data = copyPayload({ elementId: optStr(a.element_id), nodeId: optStr(a.id) })
      if (!data) throw new Error('Nothing to copy with that id (the portfolio and arrows cannot be copied)')
      const src = optStr(a.id) ? nodes()[a.id as string] : elements().find((e) => e.id === a.element_id)
      const at = { x: typeof a.x === 'number' ? a.x : (src?.x ?? 0) + 40, y: typeof a.y === 'number' ? a.y : (src?.y ?? 0) + 40 }
      const made = pastePayload(data.json, at, { scopeId: (src && 'scopeId' in src ? src.scopeId : ROOT_ID), focusId: ROOT_ID, selectedNodeId: null, allowNodes: true })
      if (!made) throw new Error('The copy has nowhere to go')
      return made
    },
  },
]

/** What to hand a model as `tools`. */
export const TOOL_DEFS: ToolDef[] = TOOLS.map(({ run: _run, ...def }) => def)

/** Run one tool call. Never throws: a failure comes back as { error }, which is what a model needs to recover. */
export function callTool(name: string, args: Record<string, unknown> = {}): unknown {
  const tool = TOOLS.find((t) => t.name === name)
  if (!tool) return { error: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}` }
  try { return tool.run(args) } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
}
