// Seeds a small workspace into the Firestore EMULATOR for the end-to-end test. Never point this at a real project.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only')
initializeApp({ projectId: process.env.PP_FIREBASE_PROJECT })
const db = getFirestore()
const wid = 'w-test', t = Date.now()
const n = (id, kind, parentId, title, extra = {}) => ({ id, kind, parentId, title, x: 0, y: 0, weight: 1, after: [], createdAt: t, updatedAt: t, ...extra })
const nodes = [
  n('portfolio', 'portfolio', undefined, 'Test Portfolio'),
  n('p1', 'project', 'portfolio', 'Website relaunch'),
  n('m1', 'milestone', 'p1', 'Design'),
  n('t1', 'task', 'm1', 'Wireframes', { status: 'doing', assignee: 'Op', assigneeUid: 'u-op', updatedAt: t - 10 * 86400000 }),
  n('t2', 'task', 'm1', 'Visual design', { status: 'backlog', after: ['t1'] }),
  n('t3', 'task', 'm1', 'Build pages', { status: 'backlog', after: ['t2'], end: '2026-01-01' }),
  n('t4', 'task', 'm1', 'Copy', { status: 'blocked', assignee: 'Op', assigneeUid: 'u-op' }),
]
const anc = (id) => { const by = Object.fromEntries(nodes.map((x) => [x.id, x])); const out = []; let c = by[id]; while (c) { out.unshift(c.id); c = c.parentId ? by[c.parentId] : null } return out }
const b = db.batch()
b.set(db.doc(`workspaces/${wid}`), { name: 'Test WS', ownerUid: 'u-man', createdAt: t })
b.set(db.doc(`workspaces/${wid}/members/u-man`), { uid: 'u-man', role: 'manager', email: 'man@example.com', name: 'Manager' })
b.set(db.doc(`workspaces/${wid}/members/u-op`), { uid: 'u-op', role: 'operator', email: 'op@example.com', name: 'Op' })
b.set(db.doc(`workspaces/${wid}/members/u-sc`), { uid: 'u-sc', role: 'manager', email: 'sc@example.com', name: 'Scoped', scopes: ['p1'] })
for (const x of nodes) b.set(db.doc(`workspaces/${wid}/nodes/${x.id}`), JSON.parse(JSON.stringify({ ...x, anc: anc(x.id) })))
await b.commit()
console.log('seeded')
process.exit(0)
