// Access-rule tests, run against the local Firestore emulator:  npm run test:rules
// Each line is one promise the product makes about who can do what.
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { get as rtGet, ref as rtRef, remove as rtRemove, set as rtSet, update as rtUpdate } from 'firebase/database'
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, setLogLevel, updateDoc, where, writeBatch } from 'firebase/firestore'

setLogLevel('silent') // expected denials are noisy otherwise

const env = await initializeTestEnvironment({ projectId: 'demo-projectportfolio', firestore: { rules: readFileSync('firestore.rules', 'utf8') }, database: { rules: readFileSync('database.rules.json', 'utf8') } })
// the project owner has approved this one address to start a workspace
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'creators', 'owner@example.com'), { addedAt: 1 }))
const as = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore()
const anon = env.unauthenticatedContext().firestore()
const rt = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).database()
const owner = as('owner1', 'owner@example.com'), mgr = as('mgr1', 'mgr@example.com'), op = as('op1', 'op@example.com')
const op2 = as('op2', 'op2@example.com'), stranger = as('str1', 'stranger@example.com')
const W = 'owner1' // the owner's personal workspace
let n = 0, failed = 0
const t = async (name, p) => { n++; try { await p } catch (e) { failed++; console.error(`FAIL ${name}\n     ${String(e.message).split('\n')[0]}`) } }

// --- setting up a personal workspace
await t('cannot create own workspace naming another owner', assertFails(setDoc(doc(owner, 'workspaces', W), { name: 'x', ownerUid: 'str1' })))
{
  const b = writeBatch(owner)
  b.set(doc(owner, 'workspaces', W), { name: 'Portfolio', ownerUid: 'owner1' })
  b.set(doc(owner, 'workspaces', W, 'members', 'owner1'), { uid: 'owner1', role: 'owner', email: 'owner@example.com' })
  b.set(doc(owner, 'users', 'owner1'), { email: 'owner@example.com', name: 'Owner', workspaceIds: [W], created: 1 })
  await t('owner creates workspace + own membership in one batch', assertSucceeds(b.commit()))
}
await t('stranger cannot add themselves as a member', assertFails(setDoc(doc(stranger, 'workspaces', W, 'members', 'str1'), { uid: 'str1', role: 'manager' })))
await t('stranger cannot add themselves as owner', assertFails(setDoc(doc(stranger, 'workspaces', W, 'members', 'str1'), { uid: 'str1', role: 'owner' })))

// --- invitations
await t('owner invites a manager', assertSucceeds(setDoc(doc(owner, 'workspaces', W, 'invites', 'mgr@example.com'), { email: 'mgr@example.com', role: 'manager' })))
await t('owner invites an operator', assertSucceeds(setDoc(doc(owner, 'workspaces', W, 'invites', 'op@example.com'), { email: 'op@example.com', role: 'operator' })))
await t('owner invites a second operator', assertSucceeds(setDoc(doc(owner, 'workspaces', W, 'invites', 'op2@example.com'), { email: 'op2@example.com', role: 'operator' })))
await t('nobody can be invited as owner', assertFails(setDoc(doc(owner, 'workspaces', W, 'invites', 'x@example.com'), { email: 'x@example.com', role: 'owner' })))
await t('stranger cannot invite themselves', assertFails(setDoc(doc(stranger, 'workspaces', W, 'invites', 'stranger@example.com'), { email: 'stranger@example.com', role: 'manager' })))
await t('invitee finds their invite across workspaces', assertSucceeds(getDocs(query(collectionGroup(op, 'invites'), where('email', '==', 'op@example.com')))))
await t('nobody can search for someone else\'s invites', assertFails(getDocs(query(collectionGroup(stranger, 'invites'), where('email', '==', 'op@example.com')))))
await t('unverified email cannot use an invite', assertFails(setDoc(doc(as('fake', 'op@example.com', false), 'workspaces', W, 'members', 'fake'), { uid: 'fake', role: 'operator' })))
await t('invitee cannot take a higher role than offered', assertFails(setDoc(doc(op, 'workspaces', W, 'members', 'op1'), { uid: 'op1', role: 'manager' })))
await t('operator accepts their invite', assertSucceeds(setDoc(doc(op, 'workspaces', W, 'members', 'op1'), { uid: 'op1', role: 'operator', email: 'op@example.com' })))
await t('second operator accepts', assertSucceeds(setDoc(doc(op2, 'workspaces', W, 'members', 'op2'), { uid: 'op2', role: 'operator', email: 'op2@example.com' })))
await t('manager accepts their invite', assertSucceeds(setDoc(doc(mgr, 'workspaces', W, 'members', 'mgr1'), { uid: 'mgr1', role: 'manager', email: 'mgr@example.com' })))
await t('invitee may delete their own used invite', assertSucceeds(deleteDoc(doc(op, 'workspaces', W, 'invites', 'op@example.com'))))

// --- work items
const task = { id: 't1', kind: 'task', title: 'Build login', status: 'backlog', assigneeUid: 'op1', updatedAt: 1 }
await t('manager creates a task', assertSucceeds(setDoc(doc(mgr, 'workspaces', W, 'nodes', 't1'), task)))
await t('operator cannot create a task', assertFails(setDoc(doc(op, 'workspaces', W, 'nodes', 't2'), { ...task, id: 't2' })))
await t('member reads tasks', assertSucceeds(getDoc(doc(op, 'workspaces', W, 'nodes', 't1'))))
await t('stranger cannot read tasks', assertFails(getDoc(doc(stranger, 'workspaces', W, 'nodes', 't1'))))
await t('signed-out visitor cannot read tasks', assertFails(getDoc(doc(anon, 'workspaces', W, 'nodes', 't1'))))
await t('signed-out visitor cannot read the workspace', assertFails(getDoc(doc(anon, 'workspaces', W))))
await t('OPERATOR marks their own task done', assertSucceeds(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { status: 'done', updatedAt: 2 })))
await t('operator starting their task records when it actually started', assertSucceeds(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { status: 'doing', actualStart: '2026-11-20', updatedAt: 3 })))
await t('operator finishing records the actual finish', assertSucceeds(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { status: 'done', actualEnd: '2026-11-26', updatedAt: 4 })))
await t('operator cannot store junk as an actual date', assertFails(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { actualEnd: 'x'.repeat(5000) })))
await t('operator cannot change the PLANNED dates', assertFails(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { start: '2026-01-01', end: '2026-01-02' })))
await t('operator cannot rename their own task', assertFails(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { title: 'Hacked' })))
await t('operator cannot reassign their own task', assertFails(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { assigneeUid: 'op2', status: 'doing' })))
await t('operator cannot set a made-up status', assertFails(updateDoc(doc(op, 'workspaces', W, 'nodes', 't1'), { status: 'approved' })))
await t('operator cannot touch a task assigned to someone else', assertFails(updateDoc(doc(op2, 'workspaces', W, 'nodes', 't1'), { status: 'backlog' })))
await t('operator cannot delete a task', assertFails(deleteDoc(doc(op, 'workspaces', W, 'nodes', 't1'))))
await t('stranger cannot change a task', assertFails(updateDoc(doc(stranger, 'workspaces', W, 'nodes', 't1'), { status: 'done' })))
await t('manager can edit anything on a task', assertSucceeds(updateDoc(doc(mgr, 'workspaces', W, 'nodes', 't1'), { title: 'Build sign-in', assigneeUid: 'op2' })))

// --- whiteboard elements
await t('manager adds a sticky note', assertSucceeds(setDoc(doc(mgr, 'workspaces', W, 'elements', 'e1'), { id: 'e1', kind: 'sticky', text: 'hi', scopeId: 'portfolio' })))
await t('operator reads the whiteboard', assertSucceeds(getDoc(doc(op, 'workspaces', W, 'elements', 'e1'))))
await t('operator cannot edit the whiteboard', assertFails(setDoc(doc(op, 'workspaces', W, 'elements', 'e1'), { id: 'e1', kind: 'sticky', text: 'x', scopeId: 'portfolio' })))
await t('stranger cannot read the whiteboard', assertFails(getDoc(doc(stranger, 'workspaces', W, 'elements', 'e1'))))

// --- live presence: the room name is a members-only secret (Firestore) ...
const ROOM = 'a'.repeat(48), roomDoc = (who) => doc(who, 'workspaces', W, 'private', 'presence')
await t('manager names the live room', assertSucceeds(setDoc(roomDoc(mgr), { room: ROOM })))
await t('operator reads the room name', assertSucceeds(getDoc(roomDoc(op))))
await t('operator cannot change the room name', assertFails(setDoc(roomDoc(op), { room: 'b'.repeat(48) })))
await t('stranger cannot read the room name', assertFails(getDoc(roomDoc(stranger))))
await t('signed-out visitor cannot read the room name', assertFails(getDoc(roomDoc(anon))))
await t('a guessable (short) room name is refused', assertFails(setDoc(roomDoc(mgr), { room: 'short' })))
await t('the room document holds nothing else', assertFails(setDoc(roomDoc(mgr), { room: ROOM, junk: 'x' })))
await t('no other private documents can be made', assertFails(setDoc(doc(mgr, 'workspaces', W, 'private', 'other'), { room: ROOM })))
await t('the room document cannot be deleted', assertFails(deleteDoc(roomDoc(owner))))

// --- ... and the room itself (Realtime Database): you may only ever write your own entry
{
  const opRt = rt('op1', 'op@example.com'), strRt = rt('str1', 'stranger@example.com'), anonRt = env.unauthenticatedContext().database()
  const mine = (dbx, session = 'op1_tab1') => rtRef(dbx, `presence/${ROOM}/${session}`)
  const entry = { uid: 'op1', t: Date.now(), scope: 'portfolio', view: 'tree', x: 10, y: 20 }
  await t('a member announces themselves', assertSucceeds(rtSet(mine(opRt), entry)))
  await t('a member moves their pointer', assertSucceeds(rtUpdate(mine(opRt), { x: 11, y: 21, sel: 't1' })))
  await t('whoever knows the room name sees who is there', assertSucceeds(rtGet(rtRef(opRt, `presence/${ROOM}`))))
  await t('rooms cannot be listed', assertFails(rtGet(rtRef(opRt, 'presence'))))
  await t('the database root cannot be read', assertFails(rtGet(rtRef(opRt, '/'))))
  await t('signed-out visitor cannot look into a room', assertFails(rtGet(rtRef(anonRt, `presence/${ROOM}`))))
  await t('signed-out visitor cannot write into a room', assertFails(rtSet(rtRef(anonRt, `presence/${ROOM}/op1_x`), entry)))
  await t('nobody can write an entry under someone else\'s id', assertFails(rtSet(mine(strRt, 'op1_tab9'), entry)))
  await t('nobody can claim to be someone else inside their own entry', assertFails(rtSet(mine(strRt, 'str1_tab1'), entry)))
  await t('nobody can move someone else\'s pointer', assertFails(rtUpdate(mine(strRt), { x: 999 })))
  await t('nobody can remove someone else\'s entry', assertFails(rtRemove(mine(strRt))))
  await t('an entry cannot carry arbitrary data', assertFails(rtUpdate(mine(opRt), { junk: 'x' })))
  await t('an entry cannot carry a huge string', assertFails(rtUpdate(mine(opRt), { sel: 'x'.repeat(5000) })))
  await t('an entry must say whose it is', assertFails(rtSet(mine(opRt, 'op1_tab2'), { t: Date.now(), x: 1 })))
  await t('a short room name is not a room', assertFails(rtSet(rtRef(opRt, 'presence/short/op1_tab1'), entry)))
  await t('nothing outside presence can be written', assertFails(rtSet(rtRef(opRt, 'other/x'), { a: 1 })))
  await t('a member leaves', assertSucceeds(rtRemove(mine(opRt))))
}

// --- card-level access: a manager who is given one project only ever receives, and can only touch, that branch
{
  const pmA = as('pma', 'pma@example.com'), pmB = as('pmb', 'pmb@example.com'), opA = as('opa', 'opa@example.com')
  const N = (who, id) => doc(who, 'workspaces', W, 'nodes', id), E = (who, id) => doc(who, 'workspaces', W, 'elements', id)
  const node = (id, parentId, anc, extra = {}) => ({ id, kind: 'task', title: id, parentId, anc, updatedAt: 1, ...extra })
  // the owner's board: portfolio > projA > msA > tA   and   portfolio > projB > tB, each with a note on its board
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore(), b = writeBatch(d)
    b.set(N(d, 'portfolio'), { id: 'portfolio', kind: 'portfolio', title: 'All', anc: ['portfolio'], notes: 'board-level secret' })
    b.set(N(d, 'projA'), node('projA', 'portfolio', ['portfolio', 'projA']))
    b.set(N(d, 'msA'), node('msA', 'projA', ['portfolio', 'projA', 'msA']))
    b.set(N(d, 'tA'), node('tA', 'msA', ['portfolio', 'projA', 'msA', 'tA'], { status: 'backlog', assigneeUid: 'opa' }))
    b.set(N(d, 'projB'), node('projB', 'portfolio', ['portfolio', 'projB']))
    b.set(N(d, 'tB'), node('tB', 'projB', ['portfolio', 'projB', 'tB'], { status: 'backlog', assigneeUid: 'opa' }))
    b.set(N(d, 'old'), { id: 'old', kind: 'task', title: 'made before stamps existed', parentId: 'projA' })
    b.set(E(d, 'eA'), { id: 'eA', kind: 'page', title: 'A page', scopeId: 'projA', anc: ['portfolio', 'projA'] })
    b.set(E(d, 'eB'), { id: 'eB', kind: 'sticky', text: 'B secret', scopeId: 'projB', anc: ['portfolio', 'projB'] })
    b.set(E(d, 'eRoot'), { id: 'eRoot', kind: 'sticky', text: 'portfolio note', scopeId: 'portfolio', anc: ['portfolio'] })
    await b.commit()
  })
  const inv = (who, email) => doc(who, 'workspaces', W, 'invites', email)
  await t('owner invites a manager to one project', assertSucceeds(setDoc(inv(owner, 'pma@example.com'), { email: 'pma@example.com', role: 'manager', scopes: ['projA'] })))
  await t('owner invites another manager to another project', assertSucceeds(setDoc(inv(owner, 'pmb@example.com'), { email: 'pmb@example.com', role: 'manager', scopes: ['projB'] })))
  await t('an invite cannot carry an endless list of cards', assertFails(setDoc(inv(owner, 'x@example.com'), { email: 'x@example.com', role: 'manager', scopes: Array.from({ length: 11 }, (_, i) => `c${i}`) })))
  await t('invitee cannot drop the limit on the way in', assertFails(setDoc(doc(pmA, 'workspaces', W, 'members', 'pma'), { uid: 'pma', role: 'manager', email: 'pma@example.com' })))
  await t('invitee cannot pick a different project on the way in', assertFails(setDoc(doc(pmA, 'workspaces', W, 'members', 'pma'), { uid: 'pma', role: 'manager', scopes: ['projB'] })))
  await t('invitee cannot add a second project on the way in', assertFails(setDoc(doc(pmA, 'workspaces', W, 'members', 'pma'), { uid: 'pma', role: 'manager', scopes: ['projA', 'projB'] })))
  await t('project manager A joins with exactly their project', assertSucceeds(setDoc(doc(pmA, 'workspaces', W, 'members', 'pma'), { uid: 'pma', role: 'manager', email: 'pma@example.com', scopes: ['projA'] })))
  await t('project manager B joins', assertSucceeds(setDoc(doc(pmB, 'workspaces', W, 'members', 'pmb'), { uid: 'pmb', role: 'manager', email: 'pmb@example.com', scopes: ['projB'] })))
  await t('a scoped manager cannot widen their own access', assertFails(updateDoc(doc(pmA, 'workspaces', W, 'members', 'pma'), { scopes: [] })))
  await t('a scoped manager cannot change someone else\'s access', assertFails(updateDoc(doc(pmA, 'workspaces', W, 'members', 'pmb'), { scopes: ['projA'] })))

  // reading
  const mine = (who, col, scopes) => getDocs(query(collection(who, 'workspaces', W, col), where('anc', 'array-contains-any', scopes)))
  await t('SCOPED MANAGER loads their own branch', assertSucceeds(mine(pmA, 'nodes', ['projA'])))
  await t('scoped manager loads the board items of their branch', assertSucceeds(mine(pmA, 'elements', ['projA'])))
  await t('scoped manager cannot load the whole board', assertFails(getDocs(collection(pmA, 'workspaces', W, 'nodes'))))
  await t('scoped manager cannot load all board items', assertFails(getDocs(collection(pmA, 'workspaces', W, 'elements'))))
  await t('scoped manager cannot load another project by asking for it', assertFails(mine(pmA, 'nodes', ['projB'])))
  await t('scoped manager cannot slip another project in beside their own', assertFails(mine(pmA, 'nodes', ['projA', 'projB'])))
  await t('scoped manager cannot load everything via the portfolio card', assertFails(mine(pmA, 'nodes', ['portfolio'])))
  await t('scoped manager reads a card in their project', assertSucceeds(getDoc(N(pmA, 'tA'))))
  await t('scoped manager cannot read a card in another project', assertFails(getDoc(N(pmA, 'tB'))))
  await t('scoped manager cannot read another project\'s card itself', assertFails(getDoc(N(pmA, 'projB'))))
  await t('scoped manager cannot read the portfolio card', assertFails(getDoc(N(pmA, 'portfolio'))))
  await t('scoped manager cannot read an item that was never stamped', assertFails(getDoc(N(pmA, 'old'))))
  await t('scoped manager cannot read another project\'s notes', assertFails(getDoc(E(pmA, 'eB'))))
  await t('scoped manager cannot read the portfolio board\'s notes', assertFails(getDoc(E(pmA, 'eRoot'))))
  await t('the owner still loads everything', assertSucceeds(getDocs(collection(owner, 'workspaces', W, 'nodes'))))

  // writing inside the branch
  await t('scoped manager renames a card in their project', assertSucceeds(updateDoc(N(pmA, 'tA'), { title: 'renamed' })))
  await t('scoped manager renames their project card', assertSucceeds(updateDoc(N(pmA, 'projA'), { title: 'Project A' })))
  await t('scoped manager adds a task under their milestone', assertSucceeds(setDoc(N(pmA, 'tA2'), node('tA2', 'msA', ['portfolio', 'projA', 'msA', 'tA2']))))
  {
    const b = writeBatch(pmA)
    b.set(N(pmA, 'tA4'), node('tA4', 'tA3', ['portfolio', 'projA', 'msA', 'tA3', 'tA4']))
    b.set(N(pmA, 'tA3'), node('tA3', 'msA', ['portfolio', 'projA', 'msA', 'tA3']))
    await t('scoped manager pastes a small branch in one go', assertSucceeds(b.commit()))
  }
  await t('scoped manager adds a note on their project board', assertSucceeds(setDoc(E(pmA, 'eA2'), { id: 'eA2', kind: 'sticky', text: 'hi', scopeId: 'msA', anc: ['portfolio', 'projA', 'msA'] })))
  await t('scoped manager adds a note inside a page of their project', assertSucceeds(setDoc(E(pmA, 'eA3'), { id: 'eA3', kind: 'sticky', text: 'hi', scopeId: 'eA', anc: ['portfolio', 'projA'] })))
  await t('scoped manager adds a note inside a table row page', assertSucceeds(setDoc(E(pmA, 'eA4'), { id: 'eA4', kind: 'sticky', text: 'hi', scopeId: 'eA:row1', anc: ['portfolio', 'projA'] })))
  await t('scoped manager edits a note in their project', assertSucceeds(updateDoc(E(pmA, 'eA2'), { text: 'changed' })))
  await t('scoped manager deletes a card in their project', assertSucceeds(deleteDoc(N(pmA, 'tA2'))))
  await t('scoped manager deletes a note in their project', assertSucceeds(deleteDoc(E(pmA, 'eA3'))))

  // and nowhere else
  await t('scoped manager cannot rename a card in another project', assertFails(updateDoc(N(pmA, 'tB'), { title: 'hacked' })))
  await t('scoped manager cannot delete a card in another project', assertFails(deleteDoc(N(pmA, 'tB'))))
  await t('scoped manager cannot delete another project', assertFails(deleteDoc(N(pmA, 'projB'))))
  await t('scoped manager cannot overwrite another project\'s card by its id', assertFails(setDoc(N(pmA, 'tB'), node('tB', 'msA', ['portfolio', 'projA', 'msA', 'tB']))))
  await t('scoped manager cannot change the portfolio card', assertFails(updateDoc(N(pmA, 'portfolio'), { title: 'mine now' })))
  await t('scoped manager cannot add a project to the portfolio', assertFails(setDoc(N(pmA, 'projC'), node('projC', 'portfolio', ['portfolio', 'projC']))))
  await t('scoped manager cannot add a card under another project', assertFails(setDoc(N(pmA, 'x1'), node('x1', 'projB', ['portfolio', 'projB', 'x1']))))
  await t('scoped manager cannot plant a card in another project by faking its path', assertFails(setDoc(N(pmA, 'x2'), node('x2', 'msA', ['portfolio', 'projA', 'projB', 'x2']))))
  await t('scoped manager cannot hang a card under another project while claiming their own path', assertFails(setDoc(N(pmA, 'x3'), node('x3', 'projB', ['portfolio', 'projA', 'x3']))))
  await t('scoped manager cannot add a card with no path', assertFails(setDoc(N(pmA, 'x4'), { id: 'x4', kind: 'task', title: 'x', parentId: 'msA' })))
  await t('scoped manager cannot move a card of theirs into another project', assertFails(updateDoc(N(pmA, 'tA'), { parentId: 'projB', anc: ['portfolio', 'projB', 'tA'] })))
  await t('scoped manager cannot re-tag a card of theirs to show in another project', assertFails(updateDoc(N(pmA, 'tA'), { anc: ['portfolio', 'projA', 'msA', 'projB', 'tA'] })))
  await t('scoped manager cannot strip the path off a card', assertFails(setDoc(N(pmA, 'tA'), { id: 'tA', kind: 'task', title: 'x', parentId: 'msA' })))
  await t('scoped manager cannot edit another project\'s note', assertFails(updateDoc(E(pmA, 'eB'), { text: 'hacked' })))
  await t('scoped manager cannot delete another project\'s note', assertFails(deleteDoc(E(pmA, 'eB'))))
  await t('scoped manager cannot put a note on another project\'s board', assertFails(setDoc(E(pmA, 'y1'), { id: 'y1', kind: 'sticky', text: 'x', scopeId: 'projB', anc: ['portfolio', 'projB'] })))
  await t('scoped manager cannot put a note on another board by faking its path', assertFails(setDoc(E(pmA, 'y2'), { id: 'y2', kind: 'sticky', text: 'x', scopeId: 'projB', anc: ['portfolio', 'projA'] })))
  await t('scoped manager cannot make a note of theirs show in another project', assertFails(setDoc(E(pmA, 'y3'), { id: 'y3', kind: 'sticky', text: 'x', scopeId: 'msA', anc: ['portfolio', 'projA', 'msA', 'projB'] })))
  await t('scoped manager cannot put a note on the portfolio board', assertFails(setDoc(E(pmA, 'y4'), { id: 'y4', kind: 'sticky', text: 'x', scopeId: 'portfolio', anc: ['portfolio'] })))
  await t('scoped manager cannot move a note of theirs onto another board', assertFails(updateDoc(E(pmA, 'eA2'), { scopeId: 'projB', anc: ['portfolio', 'projB'] })))
  await t('the other project\'s manager is confined the same way', assertFails(getDoc(N(pmB, 'tA'))))
  await t('the other project\'s manager works in their own project', assertSucceeds(updateDoc(N(pmB, 'tB'), { title: 'B task' })))

  // inviting: a scoped manager may bring people into their own cards only
  await t('scoped manager invites an operator into their project', assertSucceeds(setDoc(inv(pmA, 'opa@example.com'), { email: 'opa@example.com', role: 'operator', scopes: ['projA'] })))
  await t('scoped manager cannot invite someone to the whole workspace', assertFails(setDoc(inv(pmA, 'z1@example.com'), { email: 'z1@example.com', role: 'manager' })))
  await t('scoped manager cannot invite someone into another project', assertFails(setDoc(inv(pmA, 'z2@example.com'), { email: 'z2@example.com', role: 'manager', scopes: ['projB'] })))
  await t('scoped manager cannot invite someone into their project plus another', assertFails(setDoc(inv(pmA, 'z3@example.com'), { email: 'z3@example.com', role: 'manager', scopes: ['projA', 'projB'] })))
  await t('owner invites someone to everything', assertSucceeds(setDoc(inv(owner, 'z4@example.com'), { email: 'z4@example.com', role: 'manager' })))
  await t('scoped manager cannot narrow-then-reuse a whole-workspace invite', assertFails(setDoc(inv(pmA, 'z4@example.com'), { email: 'z4@example.com', role: 'manager', scopes: ['projA'] })))
  await t('scoped manager cannot cancel a whole-workspace invite', assertFails(deleteDoc(inv(pmA, 'z4@example.com'))))

  // a scoped operator: sees only that project, and still only moves the status of their own tasks
  await t('scoped operator joins', assertSucceeds(setDoc(doc(opA, 'workspaces', W, 'members', 'opa'), { uid: 'opa', role: 'operator', email: 'opa@example.com', scopes: ['projA'] })))
  await t('scoped operator loads their project', assertSucceeds(mine(opA, 'nodes', ['projA'])))
  await t('scoped operator marks their task done', assertSucceeds(updateDoc(N(opA, 'tA'), { status: 'done', updatedAt: 5 })))
  await t('scoped operator cannot touch a task assigned to them in a project they cannot see', assertFails(updateDoc(N(opA, 'tB'), { status: 'done', updatedAt: 5 })))
  await t('scoped operator cannot read the other project', assertFails(getDoc(N(opA, 'tB'))))

  // the owner changes who has what
  await t('owner gives a manager a second project', assertSucceeds(updateDoc(doc(owner, 'workspaces', W, 'members', 'pma'), { scopes: ['projA', 'projB'] })))
  await t('with it, that manager reads the second project', assertSucceeds(getDoc(N(pmA, 'tB'))))
  await t('and loads both in one go', assertSucceeds(mine(pmA, 'nodes', ['projA', 'projB'])))
  await t('owner takes the first project away', assertSucceeds(updateDoc(doc(owner, 'workspaces', W, 'members', 'pma'), { scopes: ['projB'] })))
  await t('after that the manager can no longer read it', assertFails(getDoc(N(pmA, 'tA'))))
  await t('nor write to it', assertFails(updateDoc(N(pmA, 'tA'), { title: 'still here?' })))
  await t('owner cannot store an endless list of cards on a member', assertFails(updateDoc(doc(owner, 'workspaces', W, 'members', 'pma'), { scopes: Array.from({ length: 11 }, (_, i) => `c${i}`) })))
  await t('owner lifts the limit: the manager sees everything', assertSucceeds(updateDoc(doc(owner, 'workspaces', W, 'members', 'pma'), { scopes: [] })))
  await t('an unlimited manager loads the whole board', assertSucceeds(getDocs(collection(pmA, 'workspaces', W, 'nodes'))))
}

// --- membership changes
await t('manager cannot promote themselves to owner', assertFails(updateDoc(doc(mgr, 'workspaces', W, 'members', 'mgr1'), { role: 'owner' })))
await t('operator cannot promote themselves', assertFails(updateDoc(doc(op, 'workspaces', W, 'members', 'op1'), { role: 'manager' })))
await t('manager cannot change someone else\'s role', assertFails(updateDoc(doc(mgr, 'workspaces', W, 'members', 'op1'), { role: 'manager' })))
await t('owner changes a role', assertSucceeds(updateDoc(doc(owner, 'workspaces', W, 'members', 'op2'), { role: 'manager' })))
await t('owner cannot make someone else owner', assertFails(updateDoc(doc(owner, 'workspaces', W, 'members', 'op2'), { role: 'owner' })))
await t('members see the team list', assertSucceeds(getDoc(doc(op, 'workspaces', W, 'members', 'mgr1'))))
await t('stranger cannot see the team list', assertFails(getDoc(doc(stranger, 'workspaces', W, 'members', 'mgr1'))))
await t('operator may leave', assertSucceeds(deleteDoc(doc(op, 'workspaces', W, 'members', 'op1'))))
await t('after leaving, the operator can no longer read', assertFails(getDoc(doc(op, 'workspaces', W, 'nodes', 't1'))))
await t('owner removes a member', assertSucceeds(deleteDoc(doc(owner, 'workspaces', W, 'members', 'mgr1'))))
await t('removed manager can no longer write', assertFails(updateDoc(doc(mgr, 'workspaces', W, 'nodes', 't1'), { title: 'still here?' })))

// --- open sign-up: any verified account may start workspaces, up to 5, and the counter can't be gamed
const unv = as('unv1', 'unv@example.com', false)
{
  const b = writeBatch(unv)
  b.set(doc(unv, 'workspaces', 'unv1'), { name: 'Mine', ownerUid: 'unv1' })
  b.set(doc(unv, 'workspaces', 'unv1', 'members', 'unv1'), { uid: 'unv1', role: 'owner' })
  b.set(doc(unv, 'users', 'unv1'), { email: 'unv@example.com', name: 'U', workspaceIds: ['unv1'], created: 1 })
  await t('an unverified address cannot start a workspace', assertFails(b.commit()))
}
{
  const b = writeBatch(stranger)
  b.set(doc(stranger, 'workspaces', 'str1'), { name: 'Mine', ownerUid: 'str1' })
  b.set(doc(stranger, 'workspaces', 'str1', 'members', 'str1'), { uid: 'str1', role: 'owner' })
  await t('a workspace cannot be started without raising the counter', assertFails(b.commit()))
}
{
  const b = writeBatch(stranger)
  b.set(doc(stranger, 'workspaces', 'str1'), { name: 'Mine', ownerUid: 'str1' })
  b.set(doc(stranger, 'workspaces', 'str1', 'members', 'str1'), { uid: 'str1', role: 'owner' })
  b.set(doc(stranger, 'users', 'str1'), { email: 'stranger@example.com', name: 'S', workspaceIds: ['str1'], created: 1, createdAt: 1, lastActive: 1, provider: 'email', tz: 'Asia/Yangon', lang: 'en', device: 'iOS' })
  await t('a newly signed-up verified account starts its own workspace', assertSucceeds(b.commit()))
}
const startWs = (who, uid, wid, created) => {
  const b = writeBatch(who)
  b.set(doc(who, 'workspaces', wid), { name: wid, ownerUid: uid })
  b.set(doc(who, 'workspaces', wid, 'members', uid), { uid, role: 'owner' })
  b.update(doc(who, 'users', uid), { created })
  return b.commit()
}
for (let i = 2; i <= 5; i++) await t(`workspace ${i} of 5 is allowed`, assertSucceeds(startWs(stranger, 'str1', `sw${i}`, i)))
await t('a 6th workspace is refused', assertFails(startWs(stranger, 'str1', 'sw6', 6)))
await t('the counter cannot be lowered to make room', assertFails(updateDoc(doc(stranger, 'users', 'str1'), { created: 0 })))
await t('the profile cannot be deleted to reset the counter', assertFails(deleteDoc(doc(stranger, 'users', 'str1'))))
await t('the counter cannot jump by more than one', assertFails(startWs(stranger, 'str1', 'sw7', 9)))
await t('a new profile cannot start with a high counter… (create only 0 or 1)', assertFails(setDoc(doc(as('x9', 'x9@example.com'), 'users', 'x9'), { email: 'x9@example.com', name: 'X', workspaceIds: [], created: -10 })))
await t('nobody can approve themselves', assertFails(setDoc(doc(stranger, 'creators', 'stranger@example.com'), { addedAt: 1 })))
await t('nobody can read who else is approved', assertFails(getDoc(doc(stranger, 'creators', 'owner@example.com'))))
await t('a profile cannot be used to store arbitrary data', assertFails(updateDoc(doc(stranger, 'users', 'str1'), { junk: 'x'.repeat(5000) })))
await t('a profile cannot hold an oversized time zone', assertFails(updateDoc(doc(stranger, 'users', 'str1'), { tz: 'x'.repeat(100) })))
await t('nobody can make themselves an admin', assertFails(setDoc(doc(stranger, 'admins', 'str1'), { at: 1 })))
await t('a non-admin cannot list users', assertFails(getDocs(collection(stranger, 'users'))))
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'admins', 'owner1'), { at: 1 }))
await t('an admin lists users', assertSucceeds(getDocs(collection(owner, 'users'))))
await t('an admin reads any profile', assertSucceeds(getDoc(doc(owner, 'users', 'str1'))))
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'admins', 'boss@example.com'), { at: 1 }))
await t('an admin listed by verified email lists users', assertSucceeds(getDocs(collection(as('boss1', 'Boss@Example.com'), 'users'))))
await t('the same email unverified is not an admin', assertFails(getDocs(collection(as('boss2', 'boss@example.com', false), 'users'))))
await t('nobody can add their email as an admin', assertFails(setDoc(doc(as('str9', 'str9@example.com'), 'admins', 'str9@example.com'), { at: 1 })))
await t('nobody else reads the admin list by email', assertFails(getDoc(doc(stranger, 'admins', 'boss@example.com'))))

// --- more than one workspace
{
  const b = writeBatch(owner)
  b.set(doc(owner, 'workspaces', 'job1'), { name: 'Job', ownerUid: 'owner1' })
  b.set(doc(owner, 'workspaces', 'job1', 'members', 'owner1'), { uid: 'owner1', role: 'owner', email: 'owner@example.com' })
  b.update(doc(owner, 'users', 'owner1'), { created: 2 })
  await t('an account starts a second workspace', assertSucceeds(b.commit()))
}
await t('the second workspace is separate: its owner can write there', assertSucceeds(setDoc(doc(owner, 'workspaces', 'job1', 'nodes', 'n1'), { id: 'n1', kind: 'project', title: 'Hire' })))
await t('someone from the first workspace cannot read the second', assertFails(getDoc(doc(op2, 'workspaces', 'job1', 'nodes', 'n1'))))
await t('nobody can make themselves owner of an existing workspace', assertFails(setDoc(doc(stranger, 'workspaces', 'job1', 'members', 'str1'), { uid: 'str1', role: 'owner' })))
await t('nobody can create a workspace naming someone else as owner', assertFails(setDoc(doc(owner, 'workspaces', 'job2'), { name: 'x', ownerUid: 'str1' })))
await t('the owner field cannot be changed afterwards', assertFails(updateDoc(doc(owner, 'workspaces', 'job1'), { ownerUid: 'str1' })))

// --- everything else
await t('a user reads their own profile', assertSucceeds(getDoc(doc(owner, 'users', 'owner1'))))
await t('nobody reads another user\'s profile', assertFails(getDoc(doc(stranger, 'users', 'owner1'))))
await t('workspaces cannot be listed', assertFails(getDocs(query(collectionGroup(owner, 'workspaces')))))
await t('an unknown collection is closed', assertFails(setDoc(doc(owner, 'anything', 'x'), { a: 1 })))
await t('a workspace cannot be deleted', assertFails(deleteDoc(doc(owner, 'workspaces', W))))

// --- @mention notifications
await env.withSecurityRulesDisabled(async (ctx) => {
  const f = ctx.firestore()
  await setDoc(doc(f, 'workspaces', 'M'), { name: 'M', ownerUid: 'owner1' })
  await setDoc(doc(f, 'workspaces', 'M', 'members', 'owner1'), { uid: 'owner1', role: 'owner' })
  await setDoc(doc(f, 'workspaces', 'M', 'members', 'op2'), { uid: 'op2', role: 'operator' })
  await setDoc(doc(f, 'workspaces', 'M', 'members', 'sc1'), { uid: 'sc1', role: 'manager', scopes: ['projA'] })
})
const sc = as('sc1', 'sc@example.com')
const mention = (from, to, key, anc, extra = {}) => ({ wid: 'M', wsName: 'M', key, title: 'Kickoff', from, fromName: 'X', at: 1, read: false, anc, ...extra })
const mid = (key, from) => `M~${key}~${from}`
await t('a member mentions a teammate', assertSucceeds(setDoc(doc(owner, 'users', 'op2', 'inbox', mid('pg1', 'owner1')), mention('owner1', 'op2', 'pg1', ['root', 'projA']))))
await t('mentioning again on the same page refreshes it', assertSucceeds(setDoc(doc(owner, 'users', 'op2', 'inbox', mid('pg1', 'owner1')), mention('owner1', 'op2', 'pg1', ['root', 'projA'], { at: 2 }))))
await t('the recipient reads their inbox', assertSucceeds(getDocs(collection(op2, 'users', 'op2', 'inbox'))))
await t('the recipient marks it read', assertSucceeds(updateDoc(doc(op2, 'users', 'op2', 'inbox', mid('pg1', 'owner1')), { read: true })))
await t('the recipient cannot rewrite who sent it', assertFails(updateDoc(doc(op2, 'users', 'op2', 'inbox', mid('pg1', 'owner1')), { from: 'str1' })))
await t('the sender cannot read the recipient\'s inbox', assertFails(getDocs(collection(owner, 'users', 'op2', 'inbox'))))
await t('nobody can forge the sender', assertFails(setDoc(doc(owner, 'users', 'op2', 'inbox', mid('pg2', 'str1')), mention('str1', 'op2', 'pg2', ['root']))))
await t('the id must match workspace+page+sender (no piling up)', assertFails(setDoc(doc(owner, 'users', 'op2', 'inbox', 'random1'), mention('owner1', 'op2', 'pg2', ['root']))))
await t('an outsider cannot notify a member', assertFails(setDoc(doc(stranger, 'users', 'op2', 'inbox', mid('pg1', 'str1')), mention('str1', 'op2', 'pg1', ['root']))))
await t('a member cannot notify someone outside the workspace', assertFails(setDoc(doc(owner, 'users', 'str1', 'inbox', mid('pg1', 'owner1')), mention('owner1', 'str1', 'pg1', ['root']))))
await t('a scoped person is not told about a page outside their cards', assertFails(setDoc(doc(owner, 'users', 'sc1', 'inbox', mid('pg3', 'owner1')), mention('owner1', 'sc1', 'pg3', ['root', 'projB']))))
await t('a scoped person is told about a page inside their cards', assertSucceeds(setDoc(doc(owner, 'users', 'sc1', 'inbox', mid('pg4', 'owner1')), mention('owner1', 'sc1', 'pg4', ['root', 'projA']))))
await t('a scoped sender cannot mention from outside their cards', assertFails(setDoc(doc(sc, 'users', 'op2', 'inbox', mid('pg5', 'sc1')), mention('sc1', 'op2', 'pg5', ['root', 'projB']))))
await t('a notification cannot carry the page text', assertFails(setDoc(doc(owner, 'users', 'op2', 'inbox', mid('pg6', 'owner1')), mention('owner1', 'op2', 'pg6', ['root'], { body: 'secret' }))))
await t('another sender cannot overwrite someone else\'s notification', assertFails(setDoc(doc(op2, 'users', 'sc1', 'inbox', mid('pg4', 'owner1')), mention('op2', 'sc1', 'pg4', ['root', 'projA']))))
await t('the recipient deletes it', assertSucceeds(deleteDoc(doc(op2, 'users', 'op2', 'inbox', mid('pg1', 'owner1')))))

await env.cleanup()
console.log(failed ? `${failed} of ${n} rule tests FAILED` : `all ${n} rule tests passed`)
process.exit(failed ? 1 : 0)
