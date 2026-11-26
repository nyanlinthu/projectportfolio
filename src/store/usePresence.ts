import { create } from 'zustand'

// Who else is here right now, where their pointer is and what they have selected or are typing in.
// Nothing in this file talks to the network: src/services/presence.ts fills `peers` and sends `me`.
// It is deliberately separate from the board data. Presence is never saved, never undone, never searched.

/** One open tab of a teammate. The same person on a phone and a laptop is two of these. */
export interface Peer {
  session: string; uid: string; name: string; color: string
  /** the board they have open (a card id or a page key) and how its cards are shown */
  scope: string; view: string
  /** pointer, in board coordinates; absent while it is off the board */
  x?: number; y?: number
  /** the card or element they have selected */
  sel?: string
  /** what they are typing in: an element id, a card id, or `tableId:rowId:colId` for a table cell */
  edit?: string
}
/** Drawn around an item a teammate has selected (`typing` = their cursor is in it). */
export interface Mark { name: string; color: string; typing: boolean }
export interface Person { uid: string; name: string; color: string; scope: string; view: string }
export interface MyPresence { scope: string; view: string; x: number | null; y: number | null; sel: string | null; edit: string | null }

interface Presence {
  /** true once this tab has joined the workspace's live session */
  live: boolean
  peers: Peer[]
  /** peers, one entry per person. Changes only when someone arrives, leaves or goes to another board. */
  people: Person[]
  /** by item id (or cell key). Changes only when a selection changes, not when a pointer moves. */
  marks: Record<string, Mark>
  me: MyPresence
}

export const usePresence = create<Presence>()(() => ({
  live: false, peers: [], people: [], marks: {}, me: { scope: '', view: 'tree', x: null, y: null, sel: null, edit: null },
}))

/** Tell teammates something about what this tab is doing. Unchanged values cost nothing. */
export function report(patch: Partial<MyPresence>): void {
  const me = usePresence.getState().me
  for (const k in patch) if (patch[k as keyof MyPresence] !== me[k as keyof MyPresence]) { usePresence.setState({ me: { ...me, ...patch } }); return }
}

// Chosen to stay apart from the app's own signals on navy: gold is "selected by me", green/red are status.
export const PEER_COLORS = ['#4FC3F7', '#F78FB3', '#B39DDB', '#FFAB70', '#5EEAD4', '#E6EE9C', '#FF8A80', '#90CAF9']

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Replace the list of teammates. Derived lists keep their identity when nothing in them changed. */
export function setPeers(peers: Peer[]): void {
  const s = usePresence.getState()
  const people: Person[] = []
  const marks: Record<string, Mark> = {}
  for (const p of peers) {
    if (!people.some((x) => x.uid === p.uid)) people.push({ uid: p.uid, name: p.name, color: p.color, scope: p.scope, view: p.view })
    if (p.sel && !marks[p.sel]?.typing) marks[p.sel] = { name: p.name, color: p.color, typing: false }
    if (p.edit) marks[p.edit] = { name: p.name, color: p.color, typing: true }
  }
  usePresence.setState({ peers, people: sameJson(people, s.people) ? s.people : people, marks: sameJson(marks, s.marks) ? s.marks : marks })
}

/** The secret name of a workspace's live session. Only members can read it (firestore.rules). */
export function newRoomKey(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}
