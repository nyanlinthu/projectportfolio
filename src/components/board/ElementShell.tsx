import { useCanvasDrag } from 'canvas-kit'
import { topZ } from '@/lib/stack'
import { useElementStore } from '@/store/useElementStore'
import { BoardElement } from '@/types'
import { PeerMark } from './Presence'
import { groupMoved, pick, pickModifier, usePicked } from '@/store/usePicked'

export const DRAG_Z = 100000 // above any stacking value while something is being carried

interface ShellProps { el: BoardElement; selected: boolean; onTap: () => void; className?: string; children: React.ReactNode }

/**
 * Draggable wrapper. `freeform-el` tells the canvas not to pan when the pointer starts here; `data-rel-id` lets
 * arrows find it. Dropping an element puts it on top of whatever it was dropped onto.
 */
export default function Shell({ el, selected, onTap, className, children }: ShellProps): JSX.Element {
  const update = useElementStore((s) => s.update)
  const picked = usePicked((s) => s.ids.includes(el.id))
  const drag = useCanvasDrag({ x: el.x, y: el.y,
    onMove: (x, y) => {
      const dx = x - el.x, dy = y - el.y
      // a swimlane board stays behind what is on it, and carries what sits on it
      update(el.id, { x, y, z: el.kind === 'pool' ? el.z : topZ() })
      if (el.kind === 'pool') {
        for (const e of useElementStore.getState().elements)
          if (e.id !== el.id && e.scopeId === el.scopeId && e.kind !== 'connector' && e.x >= el.x && e.y >= el.y && e.x <= el.x + el.w && e.y <= el.y + el.h) update(e.id, { x: e.x + dx, y: e.y + dy })
      }
      groupMoved(el.id, dx, dy)
    },
    onTap: () => { if (pickModifier()) pick(el.id); else onTap() }, liftScale: 1.02, dragZ: DRAG_Z })
  // Stacking goes through a CSS variable, not an inline z-index: the drag hook writes inline z-index itself while
  // carrying and clears it afterwards, which would wipe out (or go stale against) a value set here.
  return (
    <div ref={drag.ref} data-rel-id={el.id} className={`freeform-el wb-el ${className ?? ''} ${selected ? 'is-selected' : ''} ${picked ? 'is-picked' : ''}`}
      style={{ ...drag.style, left: el.x, top: el.y, '--z': el.z ?? 0 } as React.CSSProperties} {...drag.handlers}>
      {children}
      <PeerMark id={el.id} />
    </div>
  )
}
