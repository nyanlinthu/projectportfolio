import type { ChecklistGroup, Status } from 'canvas-kit'

export type NodeKind = 'portfolio' | 'project' | 'milestone' | 'task'
/** Eisenhower disposition of a task. "Done" is not one of these: it is the task's status. */
export type Priority = 'urgent' | 'plan' | 'delegate' | 'defer'

/**
 * One card on the whiteboard. Flat map keyed by id; hierarchy is `parentId` only.
 * Position is wherever the user dropped it: nothing in the app ever re-lays nodes out.
 * Progress is never stored. It is derived by canvas-kit's roll-up from task `status`.
 */
export interface BoardNode {
  id: string
  kind: NodeKind
  title: string
  parentId?: string
  x: number
  y: number
  /** Tasks only. Containers (anything with children) derive theirs. */
  status?: Status
  /** Tasks only. Where it sits on the priority board; absent until someone sorts it. */
  priority?: Priority
  /** Swimlane this card sits in, among its siblings (e.g. "Esports"). Absent = the Unsorted lane. */
  lane?: string
  /** On a container: the names and order of the swimlanes of its children. */
  lanes?: string[]
  /** On a container: whether its lanes run as rows (horizontal bands) or columns. Default rows. */
  laneDir?: 'rows' | 'cols'
  /** 1-5, how much this gates the outcome. Default 1. */
  weight: number
  /** Finish-to-start predecessors (task ids). */
  after: string[]
  /** The operator who owns this task: display name. */
  assignee?: string
  /** The operator's account id. This, not the name, is what the access rules check. */
  assigneeUid?: string
  /** Free notes about this work item. */
  notes?: string
  /** @links written in the notes */
  noteLinks?: PageLink[]
  /** PLANNED window, "YYYY-MM-DD". Any kind may carry one (plan a milestone before its tasks exist). */
  start?: string
  end?: string
  /** ACTUAL window, "YYYY-MM-DD". Tasks: stamped when work starts (Doing) and finishes (Done), editable after.
   *  Containers never store one; theirs is worked out from the tasks underneath (`actualSpan`). */
  actualStart?: string
  actualEnd?: string
  /** BASELINE: the planned window as it stood when the plan was last saved as the baseline ("Save baseline" on
   *  the timeline). Re-planning moves start/end; this stays, so the slip can be seen. */
  baseStart?: string
  baseEnd?: string
  /** Stacking order, shared with free-form elements. Higher is in front. */
  z?: number
  /** Folded in the tree: the cards under it are hidden until it is unfolded or opened. */
  collapsed?: boolean
  createdAt: number
  updatedAt: number
}

export type { Status }

/**
 * Free-form things on the whiteboard that are not work items: text, sticky notes, pen strokes, images, and a
 * kanban widget. Each belongs to the card the board was opened into when it was made (`scopeId`), so it shows
 * whenever that card is on the board and travels with it when the branch is moved.
 */
interface ElementBase { id: string; scopeId: string; x: number; y: number; /** stacking order, shared with cards */ z?: number }
export interface TextEl extends ElementBase { kind: 'text'; text: string; links?: PageLink[] }
export interface StickyEl extends ElementBase { kind: 'sticky'; text: string; color: string; links?: PageLink[] }
/** `path` is an SVG path in canvas units as drawn; x/y is how far it has been shifted since. */
export interface StrokeEl extends ElementBase { kind: 'stroke'; path: string; color: string; width: number }
export interface ImageEl extends ElementBase { kind: 'image'; src: string; w: number; h: number }
/** A self-contained kanban: its own title and its own cards. Independent of the work-item tree. */
/** A kanban card is also a page (key `<kanbanId>:<cardId>`): `body`/`bodyLinks` are its writing. */
export interface KanbanCard { id: string; text: string; col: number; links?: PageLink[]; body?: string; bodyLinks?: PageLink[] }
export interface KanbanEl extends ElementBase { kind: 'kanban'; title?: string; cards?: KanbanCard[] }
/** Flowchart shapes (draw.io style): process, start/end, decision, connector point. */
export type ShapeKind = 'rect' | 'round' | 'diamond' | 'ellipse'
export interface ShapeEl extends ElementBase { kind: 'shape'; shape: ShapeKind; text: string; links?: PageLink[] }
/** An arrow from one thing on the board to another: cards and elements alike. x/y are unused. */
export interface ConnectorEl extends ElementBase { kind: 'connector'; fromId: string; toId: string; label?: string }
/** One or more tick lists. Same shape as lifeos and canvas-kit's task sheet, edited with canvas-kit's ChecklistEditor. */
export interface ChecklistEl extends ElementBase { kind: 'checklist'; groups: ChecklistGroup[]; kit?: string }
/**
 * A table that is both a small database and a spreadsheet: named, typed columns (database), and any cell may hold
 * an "=formula" using A1-style references (spreadsheet). Cells are raw strings; computed values come from
 * src/lib/formula.ts. Each row can be opened as its own page (fields + notes).
 */
export type ColumnType =
  | 'text' | 'number' | 'select' | 'multiselect' | 'status' | 'date' | 'person' | 'files' | 'checkbox'
  | 'url' | 'email' | 'phone' | 'created_time' | 'edited_time' | 'created_by' | 'edited_by'
  /** links to anything searchable (a card, a row, a page, a note): the cell holds their search keys, space-separated */
  | 'link'
export interface ColumnOption { id: string; name: string; color: string }
export interface TableColumn { id: string; name: string; type: ColumnType; /** choices for select, multi-select and status */ options?: ColumnOption[] }
/** A picture attached to a cell. Stored small, inside the table itself. */
export interface CellFile { name: string; src: string }
/** A connection made by typing @ in a page: `key` is the search key of the thing mentioned. */
export interface PageLink { key: string; title: string }
/**
 * A row is a page: its cells are the page's properties, `body` is what is written on it, `links` are its
 * @mentions. Text-like cells are raw strings (multi-select and person: names joined by ", ").
 */
export interface TableRow {
  id: string
  cells: Record<string, string>
  files?: Record<string, CellFile[]>
  body?: string
  links?: PageLink[]
  /** older rows kept their text here; read as `body` when `body` is absent */
  notes?: string
  createdAt?: number
  updatedAt?: number
  createdBy?: string
  updatedBy?: string
}
/** `kit` = which project-plan template this is (src/lib/pmkit.ts). Plans live in their project's Plans sheet, not on the canvas. */
export interface TableEl extends ElementBase { kind: 'table'; title?: string; columns: TableColumn[]; rows: TableRow[]; kit?: string }
/** A standalone page on the board: a title, free writing, and @mentions that connect it to anything else. */
export interface PageEl extends ElementBase { kind: 'page'; title: string; body: string; links?: PageLink[]; kit?: string }
/** A link dropped on the board with @: points at anything in the search index by its key; tap it to go there. */
export interface LinkEl extends ElementBase { kind: 'link'; key: string; title: string }
export type BoardElement = LinkEl | TextEl | StickyEl | StrokeEl | ImageEl | KanbanEl | ChecklistEl | ShapeEl | ConnectorEl | TableEl | PageEl
export type Tool = 'select' | 'text' | 'sticky' | 'checklist' | 'shape' | 'connect' | 'draw' | 'erase' | 'kanban' | 'table' | 'page'
