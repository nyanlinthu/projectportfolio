// Server stand-in for src/services/inbox.ts: same sendMention signature and the same stored shape (firestore.rules
// `mentionOk`), written with the admin SDK. The caller (the mention_teammate tool) has already checked the
// recipient can see the page; it is checked again here because the admin SDK skips the rules.
import { useSession } from '@/store/useSession'
import { queueMention } from '../context'

const okKey = (k: string): boolean => /^[A-Za-z0-9:_-]+$/.test(k) && k.length <= 200

export async function sendMention(to: string, key: string, title: string, anc: string[]): Promise<void> {
  const s = useSession.getState()
  if (!s.user || !s.workspaceId || to === s.user.uid || !okKey(key)) return
  const m = s.members.find((x) => x.uid === to)
  if (!m) return
  if (m.scopes?.length && !anc.some((id) => m.scopes!.includes(id))) return
  const ws = s.workspaces.find((w) => w.id === s.workspaceId)
  queueMention(to, `${s.workspaceId}~${key}~${s.user.uid}`, {
    wid: s.workspaceId, wsName: (ws?.name ?? 'Workspace').slice(0, 80), key, title: (title || 'Untitled').slice(0, 120),
    from: s.user.uid, fromName: s.user.name.slice(0, 80), at: Date.now(), read: false, anc: anc.slice(0, 60),
  })
}
export const watchInbox = (): (() => void) => () => undefined
export const markRead = async (): Promise<void> => undefined
export const markOneRead = async (): Promise<void> => undefined
export const dismiss = async (): Promise<void> => undefined
