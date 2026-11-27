import { create } from 'zustand'

export type Role = 'owner' | 'manager' | 'operator'
/** `scopes`: the cards this person is limited to (and everything under them). Empty or absent: the whole workspace. */
export interface Member { uid: string; email: string; name: string; role: Role; scopes?: string[] }
export interface Invite { email: string; role: Role; scopes?: string[] }
export interface WorkspaceRef { id: string; name: string; role: Role; scopes: string[] }
export interface SessionUser { uid: string; email: string; name: string; provider?: 'google' | 'email' }

interface Session {
  /** local = no project configured; the board lives in this browser only */
  status: 'local' | 'loading' | 'signed-out' | 'unverified' | 'opening' | 'ready' | 'error'
  user: SessionUser | null
  workspaces: WorkspaceRef[]
  workspaceId: string | null
  members: Member[]
  invites: Invite[]
  sync: 'saved' | 'saving' | 'offline'
  /** short message shown over the board for a few seconds */
  notice: string | null
  error: string | null
  /** may open the admin panel (an `admins/{uid}` document, written only from the console) */
  isAdmin: boolean
}

export const useSession = create<Session>()(() => ({
  status: 'loading', user: null, workspaces: [], workspaceId: null, members: [], invites: [], sync: 'saved', notice: null, error: null, isAdmin: false,
}))

let noticeTimer = 0
export function notify(message: string): void {
  window.clearTimeout(noticeTimer)
  useSession.setState({ notice: message })
  noticeTimer = window.setTimeout(() => useSession.setState({ notice: null }), 5000)
}

/** The signed-in person's role in the open workspace. In local mode you are the owner of your own browser. */
export const myRole = (s: Session): Role => (s.status === 'local' ? 'owner' : s.workspaces.find((w) => w.id === s.workspaceId)?.role ?? 'operator')
export const canEdit = (s: Session): boolean => myRole(s) !== 'operator'
/** The cards the signed-in person is limited to in the open workspace; empty means they see all of it. */
export const myScopes = (s: Session): string[] => (s.status === 'local' ? [] : s.workspaces.find((w) => w.id === s.workspaceId)?.scopes ?? [])
