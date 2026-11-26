import { useEffect, useRef, useState } from 'react'
import { KIND_COLOR, KIND_LABEL } from '@/lib/board'
import { NodeKind } from '@/types'

interface InlineEditorProps {
  kind: NodeKind
  x: number
  y: number
  /** `again` = saved with Enter: the host opens the next one right away so a list can be typed in one go. */
  onSave: (title: string, again: boolean) => void
  onCancel: () => void
}

/** Type a card's title right where the card will appear. Enter saves and starts the next; Esc or tapping away ends. */
/** The name box stands in for the card it will become, so the line from its parent can point at it. */
export const NEW_CARD_ID = 'new-card'

export default function InlineEditor({ kind, x, y, onSave, onCancel }: InlineEditorProps): JSX.Element {
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const finished = useRef(false)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])

  const finish = (again: boolean): void => {
    if (finished.current) return
    finished.current = true
    const t = title.trim()
    if (t) onSave(t, again); else onCancel()
  }

  return (
    <div className="freeform-el wb-editor" data-canvas-id={NEW_CARD_ID} style={{ left: x, top: y, '--accent': KIND_COLOR[kind] } as React.CSSProperties}>
      <div className="wb-kicker"><span>New {KIND_LABEL[kind].toLowerCase()}</span><span>Enter ↵</span></div>
      <input
        ref={ref}
        value={title}
        maxLength={100}
        placeholder="Name it…"
        enterKeyHint="next"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true) }
          else if (e.key === 'Escape') { finished.current = true; onCancel() }
        }}
        onBlur={() => finish(false)}
      />
    </div>
  )
}
