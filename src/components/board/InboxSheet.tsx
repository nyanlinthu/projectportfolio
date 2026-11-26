import { useEffect, useState } from 'react'
import { openWorkspace } from '@/services/cloud'
import { dismiss, InboxItem, markOneRead, markRead, watchInbox } from '@/services/inbox'
import { notify, useSession } from '@/store/useSession'
import { PeerMark } from './Presence'
import { useElementStore } from '@/store/useElementStore'
import { useBoardStore } from '@/store/useBoardStore'

/** Follows the signed-in person's notifications. One subscription, shared by the bell and the sheet. */
export function useInbox(): InboxItem[] {
  const uid = useSession((s) => s.user?.uid)
  const [items, setItems] = useState<InboxItem[]>([])
  useEffect(() => (uid ? watchInbox(uid, setItems) : undefined), [uid])
  return items
}

const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

/** Take the person to the page they were mentioned on: switch workspace if needed, then open the page in place. */
export async function goToMention(n: InboxItem): Promise<void> {
  const s = useSession.getState()
  if (s.user) void markOneRead(s.user.uid, n.id)
  if (s.workspaceId !== n.wid) {
    if (!s.workspaces.some((w) => w.id === n.wid)) { notify('You are no longer in that workspace.'); return }
    await openWorkspace(n.wid)
  }
  // a card: go into it (its details sit beside its board); a thing on a board: open that board; else a page
  if (n.key.startsWith('card:')) { window.location.hash = `/${n.key.slice(5)}`; return }
  if (n.key.startsWith('el:')) {
    const el = useElementStore.getState().elements.find((e) => e.id === n.key.slice(3))
    if (!el) { notify('That is no longer there.'); return }
    window.location.hash = useBoardStore.getState().nodes[el.scopeId] ? `/${el.scopeId}` : `/p/${el.scopeId}`
    return
  }
  window.location.hash = `/p/${n.key}`
}

/** The bell's sheet. Docked like every other sheet, so the board stays where it was behind it. */
export default function InboxSheet({ items, onClose }: { items: InboxItem[]; onClose: () => void }): JSX.Element {
  const uid = useSession((s) => s.user?.uid ?? '')
  const unread = items.filter((i) => !i.read)
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <aside className="wb-sheet" aria-label="Notifications">
      <PeerMark id="inbox" />
      <div className="wb-sheet-head">
        <span className="wb-kicker" style={{ flex: 1 }}><span>Notifications</span><span>{unread.length ? `${unread.length} new` : ''}</span></span>
        {unread.length > 0 && <button className="wb-tidy" onClick={() => void markRead(uid, unread.map((i) => i.id))}>Mark all read</button>}
        <button className="wb-x" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {items.length === 0 && <p className="wb-inbox-empty">Nothing yet. When a teammate types @ and your name on a page, it shows up here.</p>}
      <ul className="wb-inbox">
        {items.map((n) => (
          <li key={n.id} className={n.read ? '' : 'is-new'}>
            <button className="wb-inbox-go" onClick={() => { onClose(); void goToMention(n) }}>
              <b>{n.fromName}</b> mentioned you on <b>{n.title}</b>
              <span>{n.wsName} · {ago(n.at)}</span>
            </button>
            <button className="wb-x" onClick={() => void dismiss(uid, n.id)} aria-label="Dismiss">✕</button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
