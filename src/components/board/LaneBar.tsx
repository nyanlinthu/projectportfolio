import { useState } from 'react'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Columns3, Plus, Rows3, X } from 'lucide-react'
import { LANE_MAX, LaneDir, LaneEdit, UNSORTED } from '@/lib/board'

interface LaneBarProps {
  /** lane names in order, Unsorted last when it has cards */
  names: string[]
  counts: Record<string, number>
  dir: LaneDir
  onDir: (d: LaneDir) => void
  /** returns an error message to show, or undefined when the edit went through */
  onEdit: (e: LaneEdit) => string | undefined
  /** leave swimlane mode */
  onDone: () => void
}

/** The row above the bottom tools while swimlanes are on: orientation, the lanes, and add / rename / reorder / remove. */
export default function LaneBar({ names, counts, dir, onDir, onEdit, onDone }: LaneBarProps): JSX.Element {
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [fresh, setFresh] = useState('')
  const [err, setErr] = useState<string | undefined>()
  const real = names.filter((n) => n !== UNSORTED)
  const run = (e: LaneEdit): boolean => { const m = onEdit(e); setErr(m); return !m }
  const addLane = (): void => { if (run({ type: 'add', name: fresh })) setFresh('') }
  return (
    <div className="wb-lanebar" role="group" aria-label="Swimlanes">
      <div className="wb-lane-dir" role="group" aria-label="Lane direction">
        <button className={dir === 'rows' ? 'is-on' : ''} aria-pressed={dir === 'rows'} title="Horizontal lanes (rows)" aria-label="Horizontal lanes" onClick={() => onDir('rows')}><Rows3 size={18} /></button>
        <button className={dir === 'cols' ? 'is-on' : ''} aria-pressed={dir === 'cols'} title="Vertical lanes (columns)" aria-label="Vertical lanes" onClick={() => onDir('cols')}><Columns3 size={18} /></button>
      </div>
      {names.map((n, i) => {
        const editing = sel === n && n !== UNSORTED
        const at = real.indexOf(n)
        return editing ? (
          <div key={n} className="wb-lane-chip is-editing">
            <button title={dir === 'rows' ? "Move up" : "Move left"} aria-label="Move lane earlier" disabled={at <= 0} onClick={() => run({ type: 'move', name: n, by: -1 })}>{dir === 'rows' ? <ChevronUp size={16} /> : <ChevronLeft size={16} />}</button>
            <input value={draft} maxLength={LANE_MAX} aria-label="Lane name" autoFocus onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { if (run({ type: 'rename', from: n, to: draft })) setSel(draft.trim().replace(/\s+/g, ' ') || n) } if (e.key === 'Escape') { setSel(null); setErr(undefined) } }}
              onBlur={() => { if (draft.trim() && draft.trim() !== n) { if (run({ type: 'rename', from: n, to: draft })) setSel(null) } }} />
            <button title={dir === 'rows' ? "Move down" : "Move right"} aria-label="Move lane later" disabled={at < 0 || at >= real.length - 1} onClick={() => run({ type: 'move', name: n, by: 1 })}>{dir === 'rows' ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
            <button className="is-danger" title={counts[n] ? `Remove lane (its ${counts[n]} cards go to Unsorted)` : 'Remove lane'} aria-label="Remove lane"
              onMouseDown={(e) => e.preventDefault()} onClick={() => { if (run({ type: 'remove', name: n })) setSel(null) }}><X size={16} /></button>
          </div>
        ) : (
          <button key={n} className={`wb-lane-chip ${n === UNSORTED ? 'is-unsorted' : ''}`} style={{ '--lane': `var(--lane-${i % 6})` } as React.CSSProperties}
            title={n === UNSORTED ? 'Cards with no lane' : 'Tap to rename, reorder or remove'} onClick={() => { if (n !== UNSORTED) { setSel(n); setDraft(n); setErr(undefined) } }}>
            <i />{n}<b>{counts[n] ?? 0}</b>
          </button>
        )
      })}
      <div className="wb-lane-add">
        <input value={fresh} maxLength={LANE_MAX} placeholder="New lane" aria-label="New lane name" onChange={(e) => { setFresh(e.target.value); setErr(undefined) }}
          onKeyDown={(e) => { if (e.key === 'Enter') addLane() }} />
        <button title="Add lane" aria-label="Add lane" disabled={!fresh.trim()} onClick={addLane}><Plus size={18} /></button>
      </div>
      <button className="wb-lane-done" title="Leave swimlanes (the cards stay in their lanes)" onClick={onDone}>Done</button>
      {err && <span className="wb-lane-err" role="alert">{err}</span>}
    </div>
  )
}
