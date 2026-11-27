import { useEscape } from '@/hooks/useEscape'
import { useEffect, useRef, useState } from 'react'
import { Person, usePresence } from '@/store/usePresence'

// Everything a teammate's presence draws on screen. One place, so "what does someone else look like here" is
// answered once: a pointer with their name, a ring in their colour around what they have selected or are typing
// in, and their initial in the header.

const tint = (color: string): React.CSSProperties => ({ '--peer': color } as React.CSSProperties)

/** A ring, in a teammate's colour, around the card, element or table cell with this id. Draws nothing when nobody is there. */
export function PeerMark({ id }: { id: string }): JSX.Element | null {
  const m = usePresence((s) => s.marks[id])
  if (!m) return null
  return <i className={`wb-peer-ring ${m.typing ? 'is-typing' : ''}`} style={tint(m.color)} aria-hidden="true"><b>{m.name}</b></i>
}

/** Teammates' pointers. Lives inside the canvas, in board coordinates, so it pans and zooms with the board. */
export function PeerCursors({ scope, view }: { scope: string; view: string }): JSX.Element {
  const peers = usePresence((s) => s.peers)
  return (
    <>
      {peers.map((p) => (p.scope === scope && p.view === view && p.x !== undefined && p.y !== undefined) && (
        <div key={p.session} className="wb-peer-cursor" style={{ transform: `translate(${p.x}px, ${p.y}px)`, ...tint(p.color) }} aria-hidden="true">
          <div>
            <svg width="18" height="20" viewBox="0 0 18 20"><path d="M1.5 1.5 L1.5 16.5 L5.8 12.6 L8.6 18.6 L11.2 17.4 L8.4 11.5 L14.2 11.2 Z" /></svg>
            <b>{p.name}</b>
          </div>
        </div>
      ))}
    </>
  )
}

interface BarProps {
  /** where a board is, in words ("Website relaunch") */
  placeOf: (p: Person) => string
  /** take me to where they are */
  onGoTo: (uid: string) => void
}

/** Who else is in the workspace right now. Tap to see where each person is and go there. */
export function PresenceBar({ placeOf, onGoTo }: BarProps): JSX.Element | null {
  const people = usePresence((s) => s.people)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent): void => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [open])
  useEscape(() => setOpen(false), open)
  if (!people.length) return null
  return (
    <div ref={box} className="wb-peers">
      <button className="wb-peers-btn" aria-expanded={open} aria-label={`${people.length} other ${people.length === 1 ? 'person is' : 'people are'} here. Show where.`} onClick={() => setOpen(!open)}>
        {people.slice(0, 3).map((p) => <i key={p.uid} style={tint(p.color)}>{p.name.charAt(0).toUpperCase()}</i>)}
        {people.length > 3 && <em>+{people.length - 3}</em>}
      </button>
      {open && (
        <ul className="wb-peers-list" role="menu" aria-label="Here now">
          {people.map((p) => (
            <li key={p.uid} role="menuitem" tabIndex={0} onClick={() => { setOpen(false); onGoTo(p.uid) }}
              onKeyDown={(e) => { if (e.key === 'Enter') { setOpen(false); onGoTo(p.uid) } }}>
              <i style={tint(p.color)}>{p.name.charAt(0).toUpperCase()}</i>
              <span><b>{p.name}</b><small>{placeOf(p)}</small></span>
              <em>Go there</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
