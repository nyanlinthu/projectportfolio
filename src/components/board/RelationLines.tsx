import { useContext, useLayoutEffect, useState } from 'react'
import { CANVAS_DRAG_EVENT, CanvasZoomContext } from 'canvas-kit'
import { ConnectorEl } from '@/types'

// Arrows between any two things on the board (cards or free-form elements). Unlike canvas-kit's ConnectionLines
// (parent -> child, bottom -> top), these leave and enter on whichever side faces the other end, carry an
// arrowhead and an optional label, and can be tapped. Endpoints are measured from the DOM (`data-rel-id`) on the
// same drag pulse canvas-kit emits, so an arrow follows whatever is being dragged.

interface Box { x: number; y: number; w: number; h: number }

function boxOf(id: string, zoom: number): Box | null {
  const el = document.querySelector(`[data-rel-id="${id}"]`)
  const inner = el?.closest('.canvas-inner')
  if (!el || !inner) return null
  const r = el.getBoundingClientRect(), p = inner.getBoundingClientRect(), z = zoom || 1
  return { x: (r.left - p.left) / z, y: (r.top - p.top) / z, w: r.width / z, h: r.height / z }
}

/** Where the line from this box's centre toward (tx,ty) crosses the box edge, plus a small gap. */
function edge(b: Box, tx: number, ty: number, gap: number): { x: number; y: number } {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const dx = tx - cx, dy = ty - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const k = Math.min(dx ? (b.w / 2 + gap) / Math.abs(dx) : Infinity, dy ? (b.h / 2 + gap) / Math.abs(dy) : Infinity)
  return { x: cx + dx * k, y: cy + dy * k }
}

interface Line { id: string; d: string; mx: number; my: number; label?: string }

interface RelationLinesProps {
  relations: ConnectorEl[]
  /** changes whenever anything moves, to trigger a re-measure */
  tick: unknown
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function RelationLines({ relations, tick, selectedId, onSelect }: RelationLinesProps): JSX.Element | null {
  const zoomRef = useContext(CanvasZoomContext)
  const [lines, setLines] = useState<Line[]>([])

  useLayoutEffect(() => {
    const compute = (): void => {
      const next: Line[] = []
      for (const r of relations) {
        const a = boxOf(r.fromId, zoomRef.current), b = boxOf(r.toId, zoomRef.current)
        if (!a || !b) continue
        const s = edge(a, b.x + b.w / 2, b.y + b.h / 2, 2), e = edge(b, a.x + a.w / 2, a.y + a.h / 2, 7)
        next.push({ id: r.id, d: `M ${s.x} ${s.y} L ${e.x} ${e.y}`, mx: (s.x + e.x) / 2, my: (s.y + e.y) / 2, label: r.label })
      }
      setLines(next)
    }
    const raf = requestAnimationFrame(compute)
    window.addEventListener(CANVAS_DRAG_EVENT, compute)
    return () => { cancelAnimationFrame(raf); window.removeEventListener(CANVAS_DRAG_EVENT, compute) }
  }, [relations, tick, zoomRef])

  if (!lines.length) return null
  return (
    <svg className="wb-relations">
      <defs>
        {(['#F5EFE2', '#C9A64B'] as const).map((c, i) => (
          <marker key={c} id={`wb-arrow-${i}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
          </marker>
        ))}
      </defs>
      {lines.map((l) => {
        const on = l.id === selectedId
        return (
          <g key={l.id}>
            <path d={l.d} fill="none" stroke={on ? '#C9A64B' : '#F5EFE2'} strokeWidth={on ? 2.5 : 1.75} markerEnd={`url(#wb-arrow-${on ? 1 : 0})`} />
            {/* fat invisible line: the thing a finger actually hits. `freeform-el` stops the board panning. */}
            <path d={l.d} className="freeform-el wb-relation-hit" fill="none" stroke="transparent" strokeWidth={22}
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onSelect(l.id) }} />
            {l.label && <text x={l.mx} y={l.my} className="wb-relation-label" textAnchor="middle" dominantBaseline="middle">{l.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}
