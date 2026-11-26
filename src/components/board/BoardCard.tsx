import { usePicked } from '@/store/usePicked'
import { memo } from 'react'
import { useCanvasDrag } from 'canvas-kit'
import { KIND_COLOR, KIND_LABEL, NodeView } from '@/lib/board'
import { BoardNode } from '@/types'

interface BoardCardProps {
  node: BoardNode
  view: NodeView
  selected: boolean
  onTap: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
  onAddChild: (id: string) => void
  onCycleStatus: (id: string) => void
  /** false for operators: they cannot add work items */
  canAdd: boolean
  /** may this person change this task's status (managers always; an operator only on their own tasks) */
  canStatus: boolean
  /** how many cards hang directly under this one (0 = nothing to fold) */
  childCount: number
  onToggleFold: (id: string) => void
  /** projects: how many of their plans have been started, of how many (null = none added yet) */
  plans?: { started: number; total: number } | null
  onOpenPlans?: (id: string) => void
}

/** A card on the whiteboard. Drag behaviour comes from canvas-kit (one implementation for every canvas item). */
function BoardCard({ node, view, selected, onTap, onMove, onAddChild, onCycleStatus, canAdd, canStatus, childCount, onToggleFold, plans, onOpenPlans }: BoardCardProps): JSX.Element {
  const picked = usePicked((s) => s.ids.includes(node.id))
  const drag = useCanvasDrag({
    x: node.x,
    y: node.y,
    onMove: (x, y) => onMove(node.id, x, y),
    onTap: () => onTap(node.id),
    liftScale: 1.05,
    dragZ: 100000,
  })
  const isTask = node.kind === 'task'
  const accent = isTask ? view.color : KIND_COLOR[node.kind]

  return (
    <div
      ref={drag.ref}
      data-card={node.id}
      className={`canvas-node wb-card wb-${node.kind} ${selected ? 'is-selected' : ''} ${picked ? 'is-picked' : ''}`}
      style={{ ...drag.style, '--accent': accent } as React.CSSProperties}
      {...drag.handlers}
    >
      <div className="wb-kicker">
        <span className="wb-kind">{KIND_LABEL[node.kind]}</span>
        {onOpenPlans && plans !== undefined && (
          <button className={`wb-plans-chip ${plans && plans.started === plans.total ? 'is-full' : ''}`} onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenPlans(node.id) }}
            aria-label={plans ? `Project plans: ${plans.started} of ${plans.total} started` : 'Add project plans'}>
            ▤ {plans ? `${plans.started}/${plans.total}` : '+'}
          </button>
        )}
        {!isTask && view.total > 0 && <span>{view.done}/{view.total}</span>}
        {isTask && node.assignee && <span className="wb-who" title={node.assignee}>{node.assignee}</span>}
      </div>
      <div className="wb-title">{node.title}</div>

      {isTask && view.leaf ? (
        <button
          className="wb-pill"
          disabled={!canStatus}
          style={{ color: view.color, borderColor: view.color }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onCycleStatus(node.id) }}
          aria-label={`Status: ${view.label}. Tap to advance.`}
        >
          <i style={{ background: view.color }} />{view.label}
        </button>
      ) : (
        <div className="wb-meter">
          <div className="wb-bar"><div style={{ width: `${view.pct}%`, background: view.color }} /></div>
          <span style={{ color: view.color }}>{view.total || isTask ? `${view.pct}%` : '–'}</span>
        </div>
      )}

      {childCount > 0 && (
        <button className="wb-fold" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggleFold(node.id) }}
          aria-expanded={!node.collapsed} aria-label={node.collapsed ? `Unfold ${childCount} below` : 'Fold away what is below'}>
          {node.collapsed ? `▸ ${childCount}` : '▾'}
        </button>
      )}
      {canAdd && <button
        className="wb-add"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onAddChild(node.id) }}
        aria-label="Add below"
      >+</button>}
    </div>
  )
}

export default memo(BoardCard)
