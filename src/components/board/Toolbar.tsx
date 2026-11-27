import { useRef } from 'react'
import { Eraser, FileText, Image as ImageIcon, Kanban, ListChecks, MousePointer2, MoveUpRight, Pencil, Rows3, Shapes, StickyNote, Table2, Trash2, Type } from 'lucide-react'
import { Tool } from '@/types'

interface ToolbarProps {
  tool: Tool
  onTool: (t: Tool) => void
  onImage: (file: File) => void
  /** contextual row shown above the tools: colours, shape picker, layer order, connector label, hints */
  context?: React.ReactNode
  canDelete: boolean
  onDelete: () => void
  /** swimlanes on/off for the open card's children */
  lanesOn?: boolean
  onLanes?: () => void
}

const TOOLS: { id: Tool; label: string; Icon: typeof Type }[] = [
  { id: 'select', label: 'Move and select', Icon: MousePointer2 },
  { id: 'page', label: 'Page: tap the board to place', Icon: FileText },
  { id: 'text', label: 'Text: tap the board to place', Icon: Type },
  { id: 'sticky', label: 'Sticky note: tap the board to place', Icon: StickyNote },
  { id: 'checklist', label: 'Checklist: tap the board to place', Icon: ListChecks },
  { id: 'shape', label: 'Flowchart shape: tap the board to place', Icon: Shapes },
  { id: 'connect', label: 'Arrow: tap one item, then the item it points to', Icon: MoveUpRight },
  { id: 'draw', label: 'Draw', Icon: Pencil },
  { id: 'erase', label: 'Erase drawing', Icon: Eraser },
  { id: 'kanban', label: 'Kanban board: tap the board to place', Icon: Kanban },
  { id: 'table', label: 'Table (database + formulas): tap the board to place', Icon: Table2 },
]

/** Floating tool strip at the bottom of the board, within thumb reach on a phone. Scrolls sideways if it must. */
export default function Toolbar({ tool, onTool, onImage, context, canDelete, onDelete, lanesOn, onLanes }: ToolbarProps): JSX.Element {
  const file = useRef<HTMLInputElement>(null)
  return (
    <div className="wb-tools-wrap">
      {context && <div className="wb-context">{context}</div>}
      <div className="wb-tools" role="toolbar" aria-label="Whiteboard tools">
        {TOOLS.map(({ id, label, Icon }) => (
          <button key={id} title={label} aria-label={label} aria-pressed={tool === id} className={tool === id ? 'is-on' : ''}
            onClick={() => onTool(tool === id ? 'select' : id)}><Icon size={20} /></button>
        ))}
        {onLanes && <button title="Swimlanes: group the cards into lanes" aria-label="Swimlanes" aria-pressed={!!lanesOn} className={lanesOn ? 'is-on' : ''} onClick={onLanes}><Rows3 size={20} /></button>}
        <button title="Add an image (or just paste one)" aria-label="Add an image" onClick={() => file.current?.click()}><ImageIcon size={20} /></button>
        <input ref={file} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = '' }} />
        {/* always present, so the other tools never shift under the finger when something gets selected */}
        <button className="is-danger" title="Delete selected" aria-label="Delete selected" disabled={!canDelete} onClick={onDelete}><Trash2 size={20} /></button>
      </div>
    </div>
  )
}
