import crypto from 'node:crypto'
import { db } from './firestore'
import type { Member, Role } from '@/store/useSession'

/**
 * Agent tokens. A token stands for ONE member of ONE workspace, and the agent acts with exactly that member's
 * rights: an owner/manager's agent may change anything, an operator's agent may only move the status of tasks
 * assigned to that person (the same operator rule as firestore.rules).
 *
 * - Only a SHA-256 hash is stored, at agentTokens/{hash}. The plain token is shown once, when it is made.
 * - The member's role and scopes are re-read on EVERY call, so removing someone from the workspace (or demoting
 *   them) cuts their agent off at its next request, whatever the token says.
 * - agentTokens/ and workspaces/{wid}/agentLog/ are server-only: firestore.rules has no rule for them, so no
 *   browser can read or write them (test/rules.test.mjs checks this).
 * - v1 refuses members limited to certain cards (scopes). Serving a partial board safely needs the same
 *   "stand-in portfolio card" handling as the web app (services/cloud.ts); until that is ported, refuse.
 * - Fails closed: no token, an unknown token, or a revoked one is refused.
 */
export interface Caller { wid: string; wsName: string; uid: string; name: string; email: string; role: Role; tokenId: string }

export const hashToken = (t: string): string => crypto.createHash('sha256').update(t).digest('hex')
export const newToken = (): string => 'ppa_' + crypto.randomBytes(32).toString('base64url')

export async function resolveCaller(token: string | undefined): Promise<Caller> {
  if (!token || !token.startsWith('ppa_') || token.length < 40) throw new Error('Missing or malformed agent token')
  const id = hashToken(token)
  const snap = await db.collection('agentTokens').doc(id).get()
  const t = snap.data() as { wid?: string; uid?: string; revoked?: boolean } | undefined
  if (!t?.wid || !t.uid || t.revoked) throw new Error('Unknown or revoked agent token')
  const [ws, mem] = await Promise.all([db.doc(`workspaces/${t.wid}`).get(), db.doc(`workspaces/${t.wid}/members/${t.uid}`).get()])
  const m = mem.data() as Member | undefined
  if (!ws.exists || !m) throw new Error('The person this token belongs to is no longer in that workspace')
  if (m.scopes?.length) throw new Error('Agent access for members limited to certain cards is not supported yet')
  if (!['owner', 'manager', 'operator'].includes(m.role)) throw new Error('Unknown role')
  void snap.ref.update({ lastUsedAt: Date.now() }).catch(() => undefined)
  return { wid: t.wid, wsName: String(ws.data()?.name ?? 'Workspace'), uid: t.uid, name: m.name, email: m.email, role: m.role, tokenId: id }
}
