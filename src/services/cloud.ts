import {
  createUserWithEmailAndPassword, GoogleAuthProvider, isSignInWithEmailLink, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, sendSignInLinkToEmail,
  signInWithCredential, signInWithEmailAndPassword, signInWithEmailLink, signInWithPopup,
  signOut as fbSignOut, User,
} from 'firebase/auth'
import {
  arrayUnion, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, getDocsFromServer, limit, onSnapshot, query, runTransaction,
  setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { owningNodeId } from '@/lib/scope'
import { seedNodes, ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import { useElementStore } from '@/store/useElementStore'
import { clearHistory, pauseHistory } from '@/lib/history'
import { merge3 } from '@/lib/merge'
import { newRoomKey } from '@/store/usePresence'
import { Invite, Member, notify, Role, SessionUser, useSession, WorkspaceRef } from '@/store/useSession'
import { BoardElement, BoardNode } from '@/types'
import { auth, cloudEnabled, db, usingEmulators } from './firebase'

// Everything that talks to Firebase lives in src/services (this file for the board and the team, presence.ts for
// who-is-here), so the rest of the app never imports the SDK and a different backend could replace it later. What a signed-in person may read or write is decided by
// firestore.rules on the server; nothing here is a security control.

const LAST_WS = 'projectportfolio-workspace'
const IMPORTED = 'projectportfolio-imported'
const BACKED_UP = 'projectportfolio-backed-up'
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const fdb = (): NonNullable<typeof db> => { if (!db) throw new Error('Cloud is not configured'); return db }

// ---- sign-in ------------------------------------------------------------------------------------------------
export async function signIn(): Promise<void> {
  if (!auth) return
  try { await signInWithPopup(auth, new GoogleAuthProvider()) }
  catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return
    useSession.setState({ error: code === 'auth/operation-not-allowed' ? 'Google sign-in is not switched on for this project yet.' : `Sign-in failed (${code || 'unknown'})` })
  }
}
// Email sign-up: we email a one-time link. Opening it is both the proof that the address is real and the sign-in,
// so an unverified account never exists. Google accounts are verified by Google and skip this.
const LINK_EMAIL = 'projectportfolio-link-email'
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export async function sendEmailLink(email: string): Promise<boolean> {
  if (!auth) return false
  const clean = email.trim().toLowerCase()
  if (!EMAIL_RE.test(clean)) { useSession.setState({ error: 'That does not look like an email address.' }); return false }
  if (!allowed('link', 45, 4)) return false
  try {
    await sendSignInLinkToEmail(auth, clean, { url: `${window.location.origin}/`, handleCodeInApp: true })
    localStorage.setItem(LINK_EMAIL, clean)
    useSession.setState({ error: null })
    return true
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    useSession.setState({ error: code === 'auth/quota-exceeded' ? 'Too many sign-up emails today. Try again tomorrow, or continue with Google.' : `Could not send the link (${code || 'unknown'})` })
    return false
  }
}
// ---- email + password --------------------------------------------------------------------------------------
// Everything that sends an email or guesses a password goes through `allowed`: a brake kept in this browser (at least
// `gapS` seconds apart, at most `max` an hour). It stops a stuck button or a script on one device; the project-wide
// sign-up quota and Firebase's own per-address limits are the server side of the same protection.
export const PASSWORD_MIN = 8
const BRAKE = 'projectportfolio-brake-'
const waitText = (s: number): string => (s >= 90 ? `${Math.ceil(s / 60)} minutes` : `${s} seconds`)
function allowed(action: string, gapS: number, max: number): boolean {
  const now = Date.now()
  let list: number[] = []
  try { list = (JSON.parse(localStorage.getItem(BRAKE + action) ?? '[]') as number[]).filter((t) => now - t < 3_600_000) } catch { list = [] }
  const sinceLast = list.length ? (now - list[list.length - 1]) / 1000 : Infinity
  let wait = 0
  if (sinceLast < gapS) wait = Math.ceil(gapS - sinceLast)
  else if (list.length >= max) wait = Math.ceil((3_600_000 - (now - list[0])) / 1000)
  if (wait > 0) { useSession.setState({ error: `Please wait ${waitText(wait)} and try again.` }); return false }
  list.push(now)
  try { localStorage.setItem(BRAKE + action, JSON.stringify(list)) } catch { /* private mode: the server limits still apply */ }
  return true
}
const codeOf = (e: unknown): string => (e as { code?: string } | null)?.code ?? ''
const setError = (error: string | null): void => useSession.setState({ error })

/** Make an account with an address and a password. The address is confirmed by an emailed link before anyone gets in. */
export async function signUpWithPassword(email: string, password: string): Promise<boolean> {
  if (!auth) return false
  const clean = email.trim().toLowerCase()
  if (!EMAIL_RE.test(clean)) { setError('That does not look like an email address.'); return false }
  if (password.length < PASSWORD_MIN) { setError(`Use at least ${PASSWORD_MIN} characters for the password.`); return false }
  if (!allowed('signup', 20, 5)) return false
  try {
    setError(null)
    const cred = await createUserWithEmailAndPassword(auth, clean, password)
    try { await sendEmailVerification(cred.user, { url: `${window.location.origin}/` }) } catch { /* the next screen has "Send it again" */ }
    return true
  } catch (e) {
    const c = codeOf(e)
    setError(c === 'auth/email-already-in-use' ? 'That address already has an account. Sign in, or use "Forgot password" to set a password.'
      : c === 'auth/weak-password' || c === 'auth/password-does-not-meet-requirements' ? `Choose a stronger password (at least ${PASSWORD_MIN} characters).`
      : c === 'auth/too-many-requests' ? 'Too many attempts from this device. Wait a few minutes.'
      : `Could not create the account (${c || 'unknown'})`)
    return false
  }
}
export async function signInWithPassword(email: string, password: string): Promise<boolean> {
  if (!auth) return false
  const clean = email.trim().toLowerCase()
  if (!EMAIL_RE.test(clean) || !password) { setError('Enter your email address and password.'); return false }
  if (!allowed('signin', 2, 15)) return false
  try { setError(null); await signInWithEmailAndPassword(auth, clean, password); return true }
  catch (e) {
    const c = codeOf(e)
    // one message for "no such account" and "wrong password": it never reveals which addresses have accounts
    setError(c === 'auth/too-many-requests' ? 'Too many attempts. Wait a few minutes, or reset your password.'
      : c === 'auth/user-disabled' ? 'This account has been disabled.'
      : c === 'auth/network-request-failed' ? 'No connection. Check your internet and try again.'
      : 'Wrong email or password.')
    return false
  }
}
/** Send a reset link. Always reports success for a well-formed address, so it cannot be used to find out who has an account. */
export async function resetPassword(email: string): Promise<boolean> {
  if (!auth) return false
  const clean = email.trim().toLowerCase()
  if (!EMAIL_RE.test(clean)) { setError('That does not look like an email address.'); return false }
  if (!allowed('reset', 45, 4)) return false
  try { setError(null); await sendPasswordResetEmail(auth, clean, { url: `${window.location.origin}/` }) }
  catch (e) {
    const c = codeOf(e)
    if (c === 'auth/too-many-requests' || c === 'auth/quota-exceeded') { setError('Too many reset emails. Try again later.'); return false }
    if (c === 'auth/network-request-failed') { setError('No connection. Check your internet and try again.'); return false }
    // user-not-found and anything else: same answer as success
  }
  return true
}
/** The "confirm your email" screen: send the link again. */
export async function resendVerification(): Promise<boolean> {
  const u = auth?.currentUser
  if (!u) return false
  if (!allowed('verify', 45, 5)) return false
  try { setError(null); await sendEmailVerification(u, { url: `${window.location.origin}/` }); return true }
  catch (e) { setError(codeOf(e) === 'auth/too-many-requests' ? 'Too many emails. Try again later.' : `Could not send it (${codeOf(e) || 'unknown'})`); return false }
}
/** After opening the emailed link (here or on another device): look again, and open the workspace if the address is now confirmed. */
export async function checkVerified(quiet = false): Promise<void> {
  const u = auth?.currentUser
  if (!u) return
  try {
    await u.reload()
    if (u.emailVerified) { await u.getIdToken(true); void onUser(u); return }
    if (!quiet) setError('Not confirmed yet. Open the link in the email, then press Continue again.')
  } catch { if (!quiet) setError('Could not check. Try again.') }
}

/** True when this page was opened from a sign-in link. */
export const openedFromEmailLink = (): boolean => !!auth && isSignInWithEmailLink(auth, window.location.href)
/** The address the link was sent to, if it was sent from this browser. */
export const linkEmail = (): string => localStorage.getItem(LINK_EMAIL) ?? ''
export async function finishEmailLink(email: string): Promise<void> {
  if (!auth) return
  try {
    await signInWithEmailLink(auth, email.trim().toLowerCase(), window.location.href)
    localStorage.removeItem(LINK_EMAIL)
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    useSession.setState({ error: code === 'auth/invalid-action-code' || code === 'auth/expired-action-code'
      ? 'This link has expired or was already used. Send yourself a new one.'
      : code === 'auth/invalid-email' ? 'That is not the address the link was sent to.' : `Sign-in failed (${code || 'unknown'})` })
  }
}

/** Emulator only: sign in as a made-up Google account, for local end-to-end testing. */
export async function signInAsTestUser(name: string): Promise<void> {
  if (!auth || !usingEmulators) return
  const email = `${name}@example.com`
  await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `test-${name}`, email, email_verified: true, name })))
}
export async function signOut(): Promise<void> {
  stopSync()
  // leave nothing of the workspace behind in this browser for the next person who uses it
  pauseHistory(true)
  useBoardStore.setState({ nodes: seedNodes(), selectedId: null })
  useElementStore.setState({ elements: [] })
  pauseHistory(false); clearHistory()
  if (auth) await fbSignOut(auth)
}

// ---- who am I, and which workspaces can I open ----------------------------------------------------------------
/** What the admin panel shows about a person. Coarse on purpose: a time zone, not an IP address or location. */
function profileFacts(): Record<string, string> {
  const ua = navigator.userAgent
  return {
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    lang: (navigator.language || '').slice(0, 20),
    device: /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Win/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Other',
  }
}
const DAY = 86_400_000
/** How many workspaces one account may start. Raise it here and in firestore.rules together. */
export const WORKSPACE_CAP = 5

async function bootstrap(u: SessionUser): Promise<WorkspaceRef[]> {
  const d = fdb()
  const userRef = doc(d, 'users', u.uid)
  const profile = await getDoc(userRef)
  let ids: string[] = (profile.data()?.workspaceIds as string[] | undefined) ?? []
  if (!profile.exists()) {
    // First sign-in: a personal workspace, created together with your own membership so it is never ownerless.
    // Only approved accounts may start one (see `creators` in firestore.rules); everyone else joins by invitation.
    try {
      const b = writeBatch(d)
      b.set(doc(d, 'workspaces', u.uid), { name: `${u.name.split(' ')[0] || 'My'}'s portfolio`, ownerUid: u.uid, createdAt: Date.now() })
      b.set(doc(d, 'workspaces', u.uid, 'members', u.uid), { uid: u.uid, role: 'owner', email: u.email, name: u.name })
      const now = Date.now()
      b.set(userRef, { email: u.email, name: u.name, workspaceIds: [u.uid], created: 1, createdAt: now, lastActive: now, provider: u.provider, ...profileFacts() })
      await b.commit()
      ids = [u.uid]
    } catch (e) {
      if ((e as { code?: string }).code !== 'permission-denied') throw e
      const now = Date.now()
      await setDoc(userRef, { email: u.email, name: u.name, workspaceIds: [], created: 0, createdAt: now, lastActive: now, provider: u.provider, ...profileFacts() })
    }
  } else {
    // seen today? (at most one write a day per person)
    const p = profile.data() ?? {}
    if (!p.lastActive || Date.now() - (p.lastActive as number) > DAY / 2 || !p.createdAt) {
      try { await updateDoc(userRef, { lastActive: Date.now(), provider: u.provider, ...profileFacts(), ...(p.createdAt ? {} : { createdAt: Date.now() }), ...(typeof p.created === 'number' ? {} : { created: 0 }) }) }
      catch (e) { console.warn('Could not record the visit', e) }
    }
  }
  // Accept any invitations addressed to this (Google-verified) email address.
  try {
    const invites = await getDocs(query(collectionGroup(d, 'invites'), where('email', '==', u.email.toLowerCase())))
    for (const inv of invites.docs) {
      const wid = inv.ref.parent.parent?.id
      if (!wid || ids.includes(wid)) continue
      const b = writeBatch(d)
      // the invite may be for certain cards only; the rules refuse a membership that asks for more than it offers
      const scopes = (inv.data().scopes as string[] | undefined) ?? []
      b.set(doc(d, 'workspaces', wid, 'members', u.uid), { uid: u.uid, role: inv.data().role as Role, email: u.email, name: u.name, ...(scopes.length ? { scopes } : {}) })
      b.update(userRef, { workspaceIds: arrayUnion(wid) })
      b.delete(inv.ref)
      await b.commit()
      ids.push(wid)
    }
  } catch (e) { console.warn('Could not check invitations', e) }

  const out: WorkspaceRef[] = []
  for (const wid of ids) {
    try {
      const [ws, me] = await Promise.all([getDoc(doc(d, 'workspaces', wid)), getDoc(doc(d, 'workspaces', wid, 'members', u.uid))])
      if (ws.exists() && me.exists()) out.push({ id: wid, name: (ws.data().name as string) || 'Workspace', role: me.data().role as Role, scopes: (me.data().scopes as string[] | undefined) ?? [] })
    } catch { /* removed from that workspace: it simply no longer appears */ }
  }
  return out
}

/** Call once at start-up. Follows sign-in state and opens the last-used workspace. */
export function watchSession(): () => void {
  if (!cloudEnabled || !auth) { useSession.setState({ status: 'local' }); return () => undefined }
  return onAuthStateChanged(auth, (fu: User | null) => { void onUser(fu) })
}
// A brand-new account can ask for its data a moment before the server accepts its sign-in token and the records created
// for it a second earlier: the first request is refused ("Missing or insufficient permissions") and only a reload
// worked. So a refusal while opening is retried (fresh token, a short wait, up to 3 times) before any error is shown.
let openRetries = 0
const isDenied = (e: unknown): boolean => (e as { code?: string } | null)?.code === 'permission-denied' || (e instanceof Error && /insufficient permissions/i.test(e.message))
async function retryOpen(fu: User): Promise<boolean> {
  if (openRetries >= 3) return false
  openRetries++
  await new Promise((r) => setTimeout(r, 600 * openRetries))
  try { await fu.getIdToken(true) } catch { /* offline: the retry below reports it */ }
  void onUser(fu)
  return true
}
async function onUser(fu: User | null): Promise<void> {
  stopSync()
  if (!fu) { openRetries = 0; useSession.setState({ isAdmin: false, status: 'signed-out', user: null, workspaces: [], workspaceId: null, members: [], invites: [] }); return }
  const provider = fu.providerData.some((p) => p.providerId === 'google.com') ? 'google' : 'email'
  const user: SessionUser = { uid: fu.uid, email: fu.email ?? '', name: fu.displayName ?? (fu.email ?? 'You').split('@')[0], provider }
  // Only a verified address gets in. Google and email-link sign-ins are verified by construction; this catches anything else.
  if (!fu.emailVerified && fu.providerData.some((p) => p.providerId === 'password')) { useSession.setState({ status: 'unverified', user, error: null }); return }
  if (!fu.emailVerified) { useSession.setState({ status: 'error', user, error: `${user.email || 'This account'} is not verified. Sign out and sign in with Google or an email link.` }); return }
  useSession.setState({ status: 'opening', user, error: null })
  try {
    const workspaces = await bootstrap(user)
    // an admin is listed by uid or by verified email (admins/{uid|email}); a refused read just means "not an admin"
    const adminBy = async (key: string) => { try { return (await getDoc(doc(fdb(), 'admins', key))).exists() } catch { return false } }
    useSession.setState({ isAdmin: (await adminBy(user.uid)) || (!!user.email && (await adminBy(user.email.toLowerCase()))) })
    if (!workspaces.length) throw new Error(`${user.email} has no workspace yet. Sign out and in again to start one, or ask a team to invite this address.`)
    const last = localStorage.getItem(LAST_WS)
    const open = workspaces.find((w) => w.id === last) ?? workspaces.find((w) => w.id === user.uid) ?? workspaces[0]
    useSession.setState({ workspaces })
    await openWorkspace(open.id)
  } catch (e) {
    if (isDenied(e) && (await retryOpen(fu))) return
    useSession.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

// ---- live sync of one workspace -------------------------------------------------------------------------------
let stopCurrent: (() => void) | null = null
export function stopSync(): void { stopCurrent?.(); stopCurrent = null }

export async function openWorkspace(wid: string): Promise<void> {
  const s = useSession.getState()
  const ws = s.workspaces.find((w) => w.id === wid)
  if (!s.user || !ws) return
  stopSync()
  useSession.setState({ status: 'opening', workspaceId: wid, members: [], invites: [] })
  localStorage.setItem(LAST_WS, wid)
  stopCurrent = await startSync(wid, s.user.uid, ws.role, ws.scopes, ws.name)
}

/** What is stored: the item plus `anc`, the ids from the portfolio card down to the card it belongs to. The
 *  access rules use it to decide who may receive or change the item; the rest of the app never sees it. */
type Stored<T> = T & { anc?: string[] }

async function startSync(wid: string, uid: string, role: Role, scopes: string[], wsName: string): Promise<() => void> {
  const d = fdb()
  const nodesCol = collection(d, 'workspaces', wid, 'nodes'), elsCol = collection(d, 'workspaces', wid, 'elements')
  const manage = role !== 'operator'
  // Card-level access. Someone given certain cards only asks the server for those branches (it refuses anything
  // wider) and so never receives the rest of the portfolio, the portfolio card included.
  const scoped = scopes.length > 0
  const inMine = (anc: string[]): boolean => anc.some((id) => scopes.includes(id))
  const nodesQ = scoped ? query(nodesCol, where('anc', 'array-contains-any', scopes)) : nodesCol
  const elsQ = scoped ? query(elsCol, where('anc', 'array-contains-any', scopes)) : elsCol
  // `anc` as the server last sent it, per item
  const ancN = new Map<string, string[]>(), ancE = new Map<string, string[]>()
  // For a scoped person the cards they were given have a parent they cannot see. On this device those cards hang
  // under a stand-in portfolio card (never sent); `realParent` remembers where each one really lives.
  const realParent = new Map<string, string>()
  let ghost: BoardNode | null = null
  const nodeAnc = (id: string, nodes: Record<string, BoardNode>, depth = 0): string[] => {
    const n = nodes[id]
    if (realParent.has(id) || !n) return ancN.get(id) ?? [id]
    if (!n.parentId || id === ROOT_ID || depth > 60) return [id]
    return [...nodeAnc(n.parentId, nodes, depth + 1), id]
  }
  const elAnc = (e: BoardElement, nodes: Record<string, BoardNode>, els: BoardElement[]): string[] => {
    const owner = owningNodeId(e.scopeId, nodes, els)
    return owner ? nodeAnc(owner, nodes) : []
  }
  const nodeOut = (n: BoardNode, nodes: Record<string, BoardNode>): Stored<BoardNode> => ({ ...n, ...(realParent.has(n.id) ? { parentId: realParent.get(n.id) } : {}), anc: nodeAnc(n.id, nodes) })
  const elOut = (e: BoardElement, nodes: Record<string, BoardNode>, els: BoardElement[]): Stored<BoardElement> => ({ ...e, anc: elAnc(e, nodes, els) })
  const nodeIn = (raw: Stored<BoardNode>): BoardNode => { const { anc: _a, ...n } = raw; return realParent.has(n.id) ? { ...n, parentId: ROOT_ID } : n }
  const elIn = (raw: Stored<BoardElement>): BoardElement => { const { anc: _a, ...e } = raw; return e as BoardElement }

  // Before the cloud copy ever replaces what is in this browser, keep the browser-only board aside once.
  if (!localStorage.getItem(BACKED_UP)) {
    try {
      for (const k of ['projectportfolio-board-v1', 'projectportfolio-elements-v1']) { const v = localStorage.getItem(k); if (v) localStorage.setItem(`${k}.before-cloud`, v) }
    } catch { /* storage full: the import below still carries the board up */ }
    localStorage.setItem(BACKED_UP, '1')
  }

  // An empty workspace gets its first content exactly once: the board already in this browser (first sign-in to
  // your own workspace), otherwise a blank portfolio. Checked against the server, never the offline cache.
  try {
    const [first, firstEls] = scoped ? [null, null] : await Promise.all([getDocsFromServer(query(nodesCol, limit(2))), getDocsFromServer(query(elsCol, limit(1)))])
    // "Blank" also covers a workspace that only holds the starting portfolio card (e.g. first opened on another
    // address), so the board built in this browser is still carried up rather than left behind.
    const blank = !!first && !!firstEls && first.size <= 1 && firstEls.empty
    const localHasWork = Object.keys(useBoardStore.getState().nodes).length > 1 || useElementStore.getState().elements.length > 0
    if (manage && first && (first.empty || (blank && wid === uid && !localStorage.getItem(IMPORTED) && localHasWork))) {
      const bring = wid === uid && !localStorage.getItem(IMPORTED)
      const nodes = bring ? useBoardStore.getState().nodes : seedNodes()
      const els = bring ? useElementStore.getState().elements : []
      let b = writeBatch(d), n = 0
      for (const node of Object.values(nodes)) { b.set(doc(nodesCol, node.id), nodeOut(node, nodes)); if (++n % 300 === 0) { await b.commit(); b = writeBatch(d) } }
      await b.commit()
      for (const el of els) await setDoc(doc(elsCol, el.id), elOut(el, nodes, els)) // one by one: an image can be large
    }
    localStorage.setItem(IMPORTED, '1')
  } catch (e) { console.warn('Could not check the workspace on the server (offline?)', e) }

  let applying = false, stopped = false
  clearHistory() // undo never reaches back into another workspace
  // the last state known to be acceptable: what the server sent, plus the operator's own permitted changes
  let goodNodes: Record<string, BoardNode> | null = null
  let goodEls: BoardElement[] | null = null
  const live = { nodes: false, elements: false }
  // Things changed here and not sent yet. While an item is in this map the local version wins over anything
  // arriving from the server, so a slow echo can never overwrite what is being typed.
  const pending = new Map<string, 'set' | 'del'>()
  let timer = 0, inflight = 0, waitingSince = 0
  // Working together. `server*` is the last version of each item the server sent: the common ground a merge
  // starts from. `sending` is what is on its way up. A change arriving for an item that is also being changed
  // here is merged with it (lib/merge.ts) instead of one replacing the other, so two people can type in
  // different cells of the same table, or one can move a card while another renames it.
  let serverNodes = new Map<string, BoardNode>(), serverEls = new Map<string, BoardElement>()
  const sending = new Set<string>()
  // A write that just finished stays "ours" for a moment: a snapshot that was already on its way still carries the
  // old value, and letting it win made cards jump back and then forward again (up, down, up, down).
  const settled = new Map<string, number>()
  const SETTLE_MS = 4000
  const settle = (key: string): void => { settled.set(key, Date.now() + SETTLE_MS) }
  const busy = (key: string): boolean => {
    if (pending.has(key) || sending.has(key)) return true
    const t = settled.get(key)
    if (t === undefined) return false
    if (t < Date.now()) { settled.delete(key); return false }
    return true
  }
  // Where a card sits (and whether it is folded) is this device's latest word while its write settles. Merging it
  // against a base that predates the last move made a quick fold-after-expand look like "unchanged here, changed
  // there", so the merge wrote the expanded layout back and the cards bounced. Same-field last-writer-wins.
  const POS = ['x', 'y', 'z', 'collapsed'] as const
  const keepPos = <T,>(out: T, mine: T): T => {
    const o = out as Record<string, unknown>, m = mine as Record<string, unknown>, r: Record<string, unknown> = { ...o }
    for (const k of POS) { if (k in m) r[k] = m[k]; else delete r[k] }
    return same(r, mine) ? mine : r as T
  }
  const blend = <T,>(base: T | undefined, mine: T, remote: T): T => keepPos(merge3(base, mine, remote), mine)
  const MERGE_MAX = 20 // a bigger burst is a rearrangement (Tidy, moving a branch): sent as one batch, as before
  const setSync = (): void => useSession.setState({ sync: !navigator.onLine ? 'offline' : inflight || pending.size ? 'saving' : 'saved' })
  const ready = (): void => { if (live.nodes && live.elements && useSession.getState().status === 'opening') { openRetries = 0; useSession.setState({ status: 'ready' }) } }

  async function flush(): Promise<void> {
    window.clearTimeout(timer); timer = 0
    if (!pending.size) return
    const ops = [...pending]; pending.clear()
    const nodes = useBoardStore.getState().nodes
    const elList = useElementStore.getState().elements
    const els = new Map(elList.map((e) => [e.id, e]))
    const batches = [writeBatch(d)]
    const jobs: Promise<unknown>[] = []
    const careful = manage && navigator.onLine && ops.length <= MERGE_MAX
    // For a scoped person the server checks every new item against the card it hangs from, so parents must
    // arrive before their children (cards first, shallowest first) in small batches sent one after another.
    const PER_BATCH = scoped ? 8 : 300
    if (scoped) {
      // a board item sits on a card, or on a page that is itself a board item (pages nest)
      const hops = (id: string, n = 0): number => { const host = els.get(id)?.scopeId.split(':')[0]; return host && els.has(host) && n < 50 ? hops(host, n + 1) : n }
      const rank = (key: string): number => (key[0] === 'n' ? nodeAnc(key.slice(2), nodes).length : 1000 + hops(key.slice(2)))
      ops.sort((a, b) => rank(a[0]) - rank(b[0]))
    }
    let count = 0
    for (const [key, op] of ops) {
      const isNode = key[0] === 'n', id = key.slice(2)
      const ref = doc(isNode ? nodesCol : elsCol, id)
      const mine = isNode ? nodes[id] : els.get(id), base = isNode ? serverNodes.get(id) : serverEls.get(id)
      if (op === 'set' && careful && mine && base && !('kind' in mine && mine.kind === 'image')) {
        // Read what the server has this instant and write the merge of the two, so a teammate's change that
        // crossed with this one on the way is kept. Needs a connection; without one the plain write below queues.
        sending.add(key)
        jobs.push(runTransaction(d, async (tx) => {
          const cur = await tx.get(ref)
          const out = cur.exists() ? keepPos(merge3(base, mine, (isNode ? nodeIn(cur.data() as Stored<BoardNode>) : elIn(cur.data() as Stored<BoardElement>)) as typeof mine), mine) : mine
          tx.set(ref, isNode ? nodeOut(out as BoardNode, nodes) : elOut(out as BoardElement, nodes, elList))
        }).catch((e: { code?: string }) => {
          if (e.code === 'permission-denied') throw e
          return setDoc(ref, isNode ? nodeOut(mine as BoardNode, nodes) : elOut(mine as BoardElement, nodes, elList))
        }).finally(() => { sending.delete(key); settle(key) }))
        continue
      }
      let b = batches[batches.length - 1]
      if (count && (count % PER_BATCH === 0 || !isNode)) { b = writeBatch(d); batches.push(b) } // elements may carry images
      if (op === 'del') b.delete(ref)
      else if (isNode) {
        const n = nodes[id]
        if (!n) continue
        // an operator may only send a status change; anything else would be refused and take the status with it
        if (manage) b.set(ref, nodeOut(n, nodes)); else b.update(ref, { status: n.status, updatedAt: n.updatedAt })
      } else { const e = els.get(id); if (!e) continue; b.set(ref, elOut(e, nodes, elList)) }
      count++
    }
    // Everything in a batch is on its way up too: a snapshot taken mid-commit must not move these cards.
    for (const [k] of ops) sending.add(k)
    inflight++; setSync()
    try {
      if (scoped) { for (const b of batches) await b.commit(); await Promise.all(jobs) }
      else await Promise.all([...jobs, ...batches.map((b) => b.commit())])
    }
    catch (e) {
      const denied = (e as { code?: string }).code === 'permission-denied'
      notify(denied ? 'That change was not allowed and has been undone.' : 'A change could not be saved. Check your connection.')
    } finally { for (const [k] of ops) { sending.delete(k); settle(k) } inflight--; setSync() }
  }
  // Sent shortly after the last change, but never held back longer than MAX_WAIT while someone keeps typing:
  // teammates watching should see the words arrive, not a paragraph landing at once.
  const QUIET_MS = 450, MAX_WAIT = 1200
  const queue = (key: string, op: 'set' | 'del'): void => {
    pending.set(key, op)
    const now = Date.now()
    if (!timer) waitingSince = now
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { void flush() }, Math.max(0, Math.min(QUIET_MS, waitingSince + MAX_WAIT - now)))
    setSync()
  }

  // server -> this device
  const unsubNodes = onSnapshot(nodesQ, (snap) => {
    const local = useBoardStore.getState().nodes
    const next: Record<string, BoardNode> = {}
    const fresh = new Map<string, BoardNode>()
    ancN.clear()
    if (scoped) {
      // the cards this person was given: the ones whose parent the server did not send
      const got = new Set(snap.docs.map((x) => x.id))
      realParent.clear()
      snap.forEach((docu) => { const pid = (docu.data() as BoardNode).parentId; if (pid && !got.has(pid)) realParent.set(docu.id, pid) })
    }
    snap.forEach((docu) => {
      const raw = docu.data() as Stored<BoardNode>
      ancN.set(docu.id, raw.anc ?? [])
      const remote = nodeIn(raw), mine = local[docu.id], key = `n/${docu.id}`
      fresh.set(docu.id, remote)
      next[docu.id] = !mine ? remote
        : busy(key) ? (manage && pending.get(key) !== 'del' ? blend(serverNodes.get(docu.id), mine, remote) : mine)
        : same(mine, remote) ? mine : remote
    })
    serverNodes = fresh
    for (const [key, op] of pending) {
      if (key[0] !== 'n') continue
      const id = key.slice(2)
      if (op === 'del') delete next[id]; else if (local[id] && !next[id]) next[id] = local[id]
    }
    if (scoped) {
      // The stand-in portfolio card: named after the workspace, placed above the cards this person was given,
      // kept wherever they then drag it. It exists on this device only.
      const tops = [...realParent.keys()].map((id) => next[id]).filter(Boolean)
      const was = live.nodes ? local[ROOT_ID] : undefined
      ghost = {
        ...(ghost ?? { id: ROOT_ID, kind: 'portfolio' as const, weight: 1, after: [], createdAt: 0, updatedAt: 0,
          x: tops.length ? tops.reduce((a, n) => a + n.x, 0) / tops.length : 400, y: tops.length ? Math.min(...tops.map((n) => n.y)) - 220 : 80 }),
        ...(was ? { x: was.x, y: was.y, z: was.z, collapsed: was.collapsed } : {}), title: wsName,
      } as BoardNode
      next[ROOT_ID] = was && same(was, ghost) ? was : ghost
    }
    if (!next[ROOT_ID]) return // nothing usable yet (an empty workspace an operator cannot seed)
    applying = true; pauseHistory(true)
    useBoardStore.setState((s) => ({ nodes: next, selectedId: s.selectedId && next[s.selectedId] ? s.selectedId : null }))
    applying = false; pauseHistory(false)
    goodNodes = useBoardStore.getState().nodes
    live.nodes = true; ready(); restamp()
  }, (err) => {
    if (stopped) return
    // refused before anything ever arrived = still opening (see retryOpen); refused later = access was taken away
    const cu = auth?.currentUser
    if (err.code === 'permission-denied' && !live.nodes && cu) { void retryOpen(cu).then((again) => { if (!again) useSession.setState({ status: 'error', error: 'You no longer have access to this workspace.' }) }); return }
    useSession.setState({ status: 'error', error: err.code === 'permission-denied' ? 'You no longer have access to this workspace.' : err.message })
  })

  const unsubEls = onSnapshot(elsQ, (snap) => {
    const local = new Map(useElementStore.getState().elements.map((e) => [e.id, e]))
    const next: BoardElement[] = []
    const seen = new Set<string>()
    const fresh = new Map<string, BoardElement>()
    ancE.clear()
    snap.forEach((docu) => {
      const raw = docu.data() as Stored<BoardElement>
      ancE.set(docu.id, raw.anc ?? [])
      const remote = elIn(raw), mine = local.get(docu.id), key = `e/${docu.id}`
      fresh.set(docu.id, remote)
      if (pending.get(key) === 'del') return
      next.push(!mine ? remote : busy(key) ? blend(serverEls.get(docu.id), mine, remote) : same(mine, remote) ? mine : remote)
      seen.add(docu.id)
    })
    serverEls = fresh
    for (const [key, op] of pending) {
      const id = key.slice(2), mine = local.get(id)
      if (key[0] === 'e' && op === 'set' && mine && !seen.has(id)) next.push(mine)
    }
    applying = true; pauseHistory(true)
    useElementStore.setState({ elements: next })
    applying = false; pauseHistory(false)
    goodEls = next
    live.elements = true; ready(); restamp()
  }, () => undefined)

  // Keep every item's `anc` true. Whoever can see the whole workspace does this quietly: it stamps boards made
  // before card-level access existed, and repairs anything a stale copy of the app wrote without it. Until an
  // item is stamped, nobody with limited access receives it.
  let stampTimer = 0
  function restamp(): void {
    if (!manage || scoped) return
    window.clearTimeout(stampTimer)
    stampTimer = window.setTimeout(() => { void (async () => {
      if (stopped || !live.nodes || !live.elements || !navigator.onLine) return
      if (pending.size || sending.size || inflight) { restamp(); return }
      const nodes = useBoardStore.getState().nodes, els = useElementStore.getState().elements
      const fix: [ReturnType<typeof doc>, string[]][] = []
      for (const [id, have] of ancN) { if (!nodes[id]) continue; const want = nodeAnc(id, nodes); if (!same(have, want)) fix.push([doc(nodesCol, id), want]) }
      for (const e of els) { const have = ancE.get(e.id); if (!have) continue; const want = elAnc(e, nodes, els); if (!same(have, want)) fix.push([doc(elsCol, e.id), want]) }
      try {
        for (let i = 0; i < fix.length; i += 300) {
          const b = writeBatch(d)
          for (const [ref, anc] of fix.slice(i, i + 300)) b.update(ref, { anc })
          await b.commit()
        }
      } catch (e) { console.warn('Could not stamp items with their branch', e) }
    })() }, 1500)
  }

  const unsubMembers = onSnapshot(collection(d, 'workspaces', wid, 'members'), (snap) => {
    const members = snap.docs.map((m) => m.data() as Member).sort((a, b) => a.name.localeCompare(b.name))
    useSession.setState({ members })
    // The owner changed what this person may see or do: open the workspace afresh with exactly that.
    const me = members.find((m) => m.uid === uid)
    if (me && !snap.metadata.fromCache && !stopped && (me.role !== role || !same([...(me.scopes ?? [])].sort(), [...scopes].sort()))) {
      useSession.setState((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wid ? { ...w, role: me.role, scopes: me.scopes ?? [] } : w)) }))
      void flush().then(() => openWorkspace(wid))
    }
  }, () => undefined)
  const unsubInvites = manage
    ? onSnapshot(collection(d, 'workspaces', wid, 'invites'), (snap) => { useSession.setState({ invites: snap.docs.map((i) => i.data() as Invite) }) }, () => undefined)
    : (): void => undefined

  // this device -> server
  // Operators: the only change that is theirs to make is the status of a task assigned to them. Moving things
  // around stays on their own screen. Anything else is put back at once, so the screen never shows a change
  // the server would refuse.
  const LAYOUT = ['x', 'y', 'z', 'collapsed', 'updatedAt']
  const sameExcept = (a: object, b: object, skip: string[]): boolean => {
    const strip = (o: object): unknown => Object.fromEntries(Object.entries(o).filter(([k]) => !skip.includes(k)))
    return same(strip(a), strip(b))
  }
  let warned = 0
  const refuse = (undo: () => void, why = 'You can only change the status of tasks assigned to you.'): void => {
    queueMicrotask(() => { applying = true; pauseHistory(true); undo(); applying = false; pauseHistory(false) })
    if (Date.now() - warned > 4000) { warned = Date.now(); notify(why) }
  }

  const unsubBoard = useBoardStore.subscribe((s, p) => {
    if (applying || !live.nodes || s.nodes === p.nodes) return
    if (manage) {
      if (scoped) {
        // only inside the cards they were given: the stand-in portfolio card can be moved about but holds nothing
        // (measured against the last state known to be fine, not the previous one: one action is often several
        // store changes in a row, and the previous one may already hold what is about to be put back)
        const base = goodNodes ?? p.nodes
        let outside = !s.nodes[ROOT_ID]
        for (const id in s.nodes) {
          const a = s.nodes[id], b = base[id]
          if (a === b) continue
          if (id === ROOT_ID ? !!b && !sameExcept(a, b, LAYOUT) : !inMine(nodeAnc(id, s.nodes))) outside = true
        }
        if (outside) { refuse(() => useBoardStore.setState({ nodes: base }), 'You can add and change things inside the cards shared with you.'); return }
        goodNodes = s.nodes
      }
      for (const id in s.nodes) if (s.nodes[id] !== p.nodes[id] && !(scoped && id === ROOT_ID)) queue(`n/${id}`, 'set')
      for (const id in p.nodes) if (!s.nodes[id]) queue(`n/${id}`, 'del')
      return
    }
    let bad = false
    const allowed: string[] = []
    const base = goodNodes ?? p.nodes
    for (const id in s.nodes) {
      const a = s.nodes[id], b = base[id]
      if (a === b) continue
      if (b && sameExcept(a, b, LAYOUT)) continue // rearranging: local only
      if (b && b.assigneeUid === uid && a.status !== b.status && sameExcept(a, b, ['status', ...LAYOUT])) { allowed.push(id); continue }
      bad = true
    }
    for (const id in base) if (!s.nodes[id]) bad = true
    if (bad) { refuse(() => useBoardStore.setState({ nodes: base })); return }
    goodNodes = s.nodes
    for (const id of allowed) queue(`n/${id}`, 'set')
  })
  const unsubElStore = useElementStore.subscribe((s, p) => {
    if (applying || !live.elements || s.elements === p.elements) return
    if (!manage) {
      const base = goodEls ?? p.elements
      const was = new Map(base.map((e) => [e.id, e]))
      const ok = s.elements.length === base.length && s.elements.every((e) => { const b = was.get(e.id); return !!b && (b === e || sameExcept(e, b, LAYOUT)) })
      if (ok) goodEls = s.elements; else refuse(() => useElementStore.setState({ elements: base }))
      return
    }
    const before = new Map(p.elements.map((e) => [e.id, e]))
    if (scoped) {
      const nodes = useBoardStore.getState().nodes
      const base = goodEls ?? p.elements
      const was = new Map(base.map((e) => [e.id, e]))
      if (s.elements.some((e) => was.get(e.id) !== e && !inMine(elAnc(e, nodes, s.elements)))) {
        refuse(() => useElementStore.setState({ elements: base }), 'Open one of the cards shared with you to add things there.'); return
      }
      goodEls = s.elements
    }
    for (const e of s.elements) { if (before.get(e.id) !== e) queue(`e/${e.id}`, 'set'); before.delete(e.id) }
    for (const id of before.keys()) queue(`e/${id}`, 'del')
  })

  // who else is here: pointers, selections, what is being typed in (best-effort, loaded on its own)
  let stopPresence = (): void => undefined
  void import('./presence').then((m) => m.startPresence(wid, uid, manage)).then((stop) => { if (stopped) stop(); else stopPresence = stop })
    .catch((e) => console.warn('Live presence is unavailable', e))

  const onLeave = (): void => { void flush() }
  const onNet = (): void => setSync()
  window.addEventListener('pagehide', onLeave)
  window.addEventListener('online', onNet)
  window.addEventListener('offline', onNet)

  return () => {
    stopped = true
    window.clearTimeout(stampTimer)
    stopPresence()
    void flush()
    unsubNodes(); unsubEls(); unsubMembers(); unsubInvites(); unsubBoard(); unsubElStore()
    window.removeEventListener('pagehide', onLeave); window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet)
  }
}

// ---- team -----------------------------------------------------------------------------------------------------
const explain = (e: unknown): void => notify((e as { code?: string }).code === 'permission-denied' ? 'You are not allowed to do that here.' : 'That did not work. Check your connection.')
const here = (): string => { const wid = useSession.getState().workspaceId; if (!wid) throw new Error('No workspace open'); return wid }

/** `scopes`: the cards this person is limited to; empty means the whole workspace. Someone who is limited
 *  themselves can only pass on their own cards (the rules enforce it). */
export async function inviteMember(email: string, role: Exclude<Role, 'owner'>, scopes: string[] = []): Promise<void> {
  const clean = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) { notify('That does not look like an email address.'); return }
  try { await setDoc(doc(fdb(), 'workspaces', here(), 'invites', clean), { email: clean, role, invitedAt: Date.now(), ...(scopes.length ? { scopes } : {}) }) } catch (e) { explain(e) }
}
/** Owner only: limit a member to certain cards (and everything under them), or to nothing less than everything. */
export async function setMemberScopes(uid: string, scopes: string[]): Promise<void> {
  if (scopes.length > 10) { notify('One person can be given at most 10 cards. Share a card higher up instead.'); return }
  try { await updateDoc(doc(fdb(), 'workspaces', here(), 'members', uid), { scopes }) } catch (e) { explain(e) }
}
export async function cancelInvite(email: string): Promise<void> {
  try { await deleteDoc(doc(fdb(), 'workspaces', here(), 'invites', email)) } catch (e) { explain(e) }
}
export async function setMemberRole(uid: string, role: Exclude<Role, 'owner'>): Promise<void> {
  try { await updateDoc(doc(fdb(), 'workspaces', here(), 'members', uid), { role }) } catch (e) { explain(e) }
}
export async function removeMember(uid: string): Promise<void> {
  const wid = here()
  try { await deleteDoc(doc(fdb(), 'workspaces', wid, 'members', uid)) } catch (e) { explain(e); return }
  // They knew the name of this workspace's live session; give it a new one so they can no longer look in.
  try { await setDoc(doc(fdb(), 'workspaces', wid, 'private', 'presence'), { room: newRoomKey() }) } catch { /* next manager to open it will */ }
}
/** Start another workspace (Job, Personal, a client…). Capped per account by a counter that only goes up; see the rules. */
export async function createWorkspace(name: string): Promise<void> {
  const s = useSession.getState(), d = fdb()
  const clean = name.trim()
  if (!s.user || !clean) return
  const wid = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  try {
    const b = writeBatch(d)
    b.set(doc(d, 'workspaces', wid), { name: clean, ownerUid: s.user.uid, createdAt: Date.now() })
    b.set(doc(d, 'workspaces', wid, 'members', s.user.uid), { uid: s.user.uid, role: 'owner', email: s.user.email, name: s.user.name })
    const me = await getDoc(doc(d, 'users', s.user.uid))
    const created = ((me.data()?.created as number | undefined) ?? 0) + 1
    if (created > WORKSPACE_CAP && !useSession.getState().isAdmin) { notify(`Each account can start up to ${WORKSPACE_CAP} workspaces.`); return }
    b.update(doc(d, 'users', s.user.uid), { workspaceIds: arrayUnion(wid), created })
    await b.commit()
    useSession.setState({ workspaces: [...s.workspaces, { id: wid, name: clean, role: 'owner', scopes: [] }] })
    await openWorkspace(wid)
  } catch (e) {
    notify((e as { code?: string }).code === 'permission-denied' ? `Each account can start up to ${WORKSPACE_CAP} workspaces.` : 'The workspace could not be created. Check your connection.')
  }
}
export async function renameWorkspace(name: string): Promise<void> {
  const wid = here()
  try {
    await updateDoc(doc(fdb(), 'workspaces', wid), { name })
    useSession.setState((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wid ? { ...w, name } : w)) }))
  } catch (e) { explain(e) }
}
