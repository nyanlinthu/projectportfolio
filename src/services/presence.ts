import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import type { Database } from 'firebase/database'
import { useSession } from '@/store/useSession'
import { MyPresence, newRoomKey, Peer, PEER_COLORS, setPeers, usePresence } from '@/store/usePresence'
import { app, db, usingEmulators } from './firebase'

// Live presence: who is on the board, where their pointer is, what they are editing.
//
// This is the one part of the app that uses the Realtime Database rather than Firestore. A moving pointer is a
// dozen tiny updates a second; Firestore bills every one as a write plus a read per onlooker and would spend the
// whole day's allowance in an hour. The Realtime Database is built for exactly this, and it clears a person's
// entry by itself when their connection drops.
//
// Access: the Realtime Database cannot look up who is a member (that list lives in Firestore). So each workspace
// has a long random "room" name, kept in workspaces/{wid}/private/presence, which firestore.rules lets only
// members read. Presence lives at presence/{room}; database.rules.json allows nobody to list rooms, so knowing
// the name is what lets you in. Removing a member changes the name (see removeMember in cloud.ts).
// Nothing here is board content: it is positions and item ids only. Names shown come from the member list.

const DB_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined
const CURSOR_MS = 80        // pointer updates are sent at most this often
const BEAT_MS = 60_000      // "still here"
const STALE_MS = 3 * BEAT_MS // an entry this quiet is someone whose tab died without saying goodbye

let rtdb: Promise<Database> | null = null
function database(): Promise<Database> {
  rtdb ??= import('firebase/database').then((rt) => {
    if (!app) throw new Error('Cloud is not configured')
    if (!usingEmulators) return rt.getDatabase(app, DB_URL)
    const d = rt.getDatabase(app)
    rt.connectDatabaseEmulator(d, '127.0.0.1', 9000)
    return d
  })
  return rtdb
}

type Raw = { uid?: string; t?: number; scope?: string; view?: string; x?: number; y?: number; sel?: string; edit?: string }

/** Join the workspace's live session. Returns how to leave it. */
export async function startPresence(wid: string, uid: string, manage: boolean): Promise<() => void> {
  if (!app || !db || !(usingEmulators || DB_URL)) return () => undefined
  const rt = await import('firebase/database')
  const d = await database()
  const session = `${uid}_${Math.random().toString(36).slice(2, 10)}`
  let room = '', leave = (): void => undefined, made = false

  function join(name: string): () => void {
    const roomRef = rt.ref(d, `presence/${name}`), meRef = rt.child(roomRef, session)
    let raw: Record<string, Raw> = {}, offset = 0, sent: MyPresence | null = null, timer = 0, gone = false
    const fail = (): void => undefined // presence is best-effort: a refused or dropped update is simply not shown

    const publish = (): void => {
      const members = useSession.getState().members
      const order = members.map((m) => m.uid).sort()
      const now = Date.now() + offset
      const peers: Peer[] = []
      for (const [key, r] of Object.entries(raw)) {
        // only people on the member list are shown, under the name the member list gives them
        const m = members.find((x) => x.uid === r.uid)
        if (!m || r.uid === uid || !key.startsWith(`${r.uid}_`) || (r.t && now - r.t > STALE_MS)) continue
        peers.push({
          session: key, uid: m.uid, name: m.name.split(' ')[0] || m.email, color: PEER_COLORS[Math.max(0, order.indexOf(m.uid)) % PEER_COLORS.length],
          scope: r.scope ?? '', view: r.view ?? 'tree', x: r.x, y: r.y, sel: r.sel, edit: r.edit,
        })
      }
      setPeers(peers)
    }

    const whole = (me: MyPresence): object => ({ uid, t: rt.serverTimestamp(), scope: me.scope, view: me.view, x: me.x, y: me.y, sel: me.sel, edit: me.edit })
    const send = (): void => {
      window.clearTimeout(timer); timer = 0
      const me = usePresence.getState().me
      if (gone || !sent || me === sent) return
      const patch: Record<string, unknown> = {}
      for (const k of Object.keys(me) as (keyof MyPresence)[]) if (me[k] !== sent[k]) patch[k] = me[k]
      sent = me
      void rt.update(meRef, patch).catch(fail)
    }
    const unsubMe = usePresence.subscribe((s, p) => {
      if (s.me === p.me || !sent) return
      // a selection or a change of board goes out at once; a moving pointer is rationed
      const onlyPointer = s.me.scope === sent.scope && s.me.view === sent.view && s.me.sel === sent.sel && s.me.edit === sent.edit
      if (!onlyPointer) send(); else if (!timer) timer = window.setTimeout(send, CURSOR_MS)
    })
    const unsubMembers = useSession.subscribe((s, p) => { if (s.members !== p.members) publish() })

    // (Re)announce this tab every time the connection comes up; the server removes it when the connection drops.
    const unsubConn = rt.onValue(rt.ref(d, '.info/connected'), (snap) => {
      if (snap.val() !== true || gone) return
      const me = usePresence.getState().me
      void rt.onDisconnect(meRef).remove().then(() => rt.set(meRef, whole(me))).then(() => { sent = me; usePresence.setState({ live: true }); send() }).catch(fail)
    })
    const unsubOffset = rt.onValue(rt.ref(d, '.info/serverTimeOffset'), (snap) => { offset = Number(snap.val()) || 0 })
    const unsubRoom = rt.onValue(roomRef, (snap) => { raw = (snap.val() as Record<string, Raw> | null) ?? {}; publish() }, fail)
    const beat = window.setInterval(() => { if (sent) void rt.update(meRef, { t: rt.serverTimestamp() }).catch(fail); publish() }, BEAT_MS)

    return () => {
      gone = true
      window.clearTimeout(timer); window.clearInterval(beat)
      unsubMe(); unsubMembers(); unsubConn(); unsubOffset(); unsubRoom()
      void rt.onDisconnect(meRef).cancel().catch(fail)
      void rt.remove(meRef).catch(fail)
      setPeers([]); usePresence.setState({ live: false })
    }
  }

  const roomDoc = doc(db, 'workspaces', wid, 'private', 'presence')
  const unsubDoc = onSnapshot(roomDoc, (snap) => {
    const name = snap.data()?.room as string | undefined
    if (!name) {
      // first time anyone who may manage the workspace opens it: give it a room
      if (manage && !made && !snap.metadata.fromCache) { made = true; void setDoc(roomDoc, { room: newRoomKey() }).catch(() => undefined) }
      return
    }
    if (name === room) return
    leave(); room = name; leave = join(name)
  }, () => undefined)

  return () => { unsubDoc(); leave() }
}
