import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { notify, useSession } from '@/store/useSession'
import { db } from './firebase'

// In-app notifications. Each person has an inbox at users/{uid}/inbox, so the bell shows mentions from every
// workspace they belong to. A teammate can drop one in; only the owner of the inbox can read, mark or delete it.
// The id is fixed per (workspace, page, sender): mentioning someone again on the same page refreshes that one
// notification instead of piling up new ones. No text from the page is copied into it.

export interface InboxItem {
  id: string
  /** workspace, and the page the mention is on (a page element id, or tableId:rowId) */
  wid: string
  wsName: string
  key: string
  title: string
  from: string
  fromName: string
  at: number
  read: boolean
}

const okKey = (k: string): boolean => /^[A-Za-z0-9:_-]{1,200}$/.test(k)

/** Tell `to` that the signed-in person mentioned them on page `key`. `anc` = the cards above that page, which
 *  the rules check against what the recipient is allowed to see. */
export async function sendMention(to: string, key: string, title: string, anc: string[]): Promise<void> {
  const s = useSession.getState()
  if (!db || !s.user || !s.workspaceId || to === s.user.uid || !okKey(key)) return
  const ws = s.workspaces.find((w) => w.id === s.workspaceId)
  const item: Omit<InboxItem, 'id'> & { anc: string[] } = {
    wid: s.workspaceId, wsName: (ws?.name ?? 'Workspace').slice(0, 80), key, title: (title || 'Untitled').slice(0, 120),
    from: s.user.uid, fromName: s.user.name.slice(0, 80), at: Date.now(), read: false, anc: anc.slice(0, 60),
  }
  try { await setDoc(doc(db, 'users', to, 'inbox', `${s.workspaceId}~${key}~${s.user.uid}`), item) }
  catch (e) { console.warn('mention not delivered', e); notify('That person could not be notified (they may not have access to this page).') }
}

/** Follow the signed-in person's inbox; returns the stop function. */
export function watchInbox(uid: string, on: (items: InboxItem[]) => void): () => void {
  if (!db) return () => undefined
  return onSnapshot(query(collection(db, 'users', uid, 'inbox'), orderBy('at', 'desc'), limit(50)),
    (snap) => on(snap.docs.map((d) => ({ ...(d.data() as Omit<InboxItem, 'id'>), id: d.id }))),
    (e) => console.warn('inbox unavailable', e))
}

export async function markRead(uid: string, ids: string[]): Promise<void> {
  if (!db || !ids.length) return
  const b = writeBatch(db)
  for (const id of ids.slice(0, 400)) b.update(doc(db, 'users', uid, 'inbox', id), { read: true })
  try { await b.commit() } catch (e) { console.warn(e) }
}
export async function markOneRead(uid: string, id: string): Promise<void> {
  if (db) try { await updateDoc(doc(db, 'users', uid, 'inbox', id), { read: true }) } catch (e) { console.warn(e) }
}
export async function dismiss(uid: string, id: string): Promise<void> {
  if (db) try { await deleteDoc(doc(db, 'users', uid, 'inbox', id)) } catch (e) { console.warn(e) }
}
