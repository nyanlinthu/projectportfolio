import { useEffect, useRef } from 'react'

/**
 * Esc closes overlays, one at a time: only the most recently opened overlay that is listening gets it.
 * Every sheet / overlay / popover uses this hook instead of its own keydown listener.
 * While typing in a field, the first Esc just leaves the field (edits save as you type); the next one closes.
 * Anything that already handled Esc itself (a mention menu, an inline editor) calls preventDefault and is left alone.
 */
const stack: { current: () => void }[] = []

const onKey = (e: KeyboardEvent): void => {
  if (e.key !== 'Escape' || e.defaultPrevented || !stack.length) return
  const t = document.activeElement
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) { t.blur(); return }
  e.preventDefault()
  stack[stack.length - 1].current()
}

export function useEscape(handler: () => void, active = true): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!active) return
    if (!stack.length) window.addEventListener('keydown', onKey)
    stack.push(ref)
    return () => {
      const i = stack.lastIndexOf(ref)
      if (i >= 0) stack.splice(i, 1)
      if (!stack.length) window.removeEventListener('keydown', onKey)
    }
  }, [active])
}
