import './shims/env'
import { db } from './firestore'
import { hashToken, newToken } from './auth'

// Manage agent tokens with your own admin credentials (the same ones the server uses).
//   npm run token -- create --workspace <wid> --member <email or uid> [--label hermes]
//   npm run token -- list --workspace <wid>
//   npm run token -- revoke --id <first 12+ characters of the id shown by list>
const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = (k: string): string | undefined => { const i = argv.indexOf(`--${k}`); return i > 0 ? argv[i + 1] : undefined }
const need = (k: string): string => { const v = opt(k); if (!v) { console.error(`--${k} is required`); process.exit(1) } return v }

if (cmd === 'create') {
  const wid = need('workspace'), who = need('member')
  const members = await db.collection(`workspaces/${wid}/members`).get()
  const m = members.docs.map((d) => d.data()).find((x) => x.uid === who || String(x.email).toLowerCase() === who.toLowerCase())
  if (!m) { console.error(`No member "${who}" in workspace ${wid}`); process.exit(1) }
  if (m.scopes?.length) { console.error('That member is limited to certain cards; agent tokens for them are not supported yet'); process.exit(1) }
  const token = newToken()
  await db.collection('agentTokens').doc(hashToken(token)).set({ wid, uid: m.uid, label: opt('label') ?? 'agent', createdAt: Date.now(), lastUsedAt: null, revoked: false })
  console.log(`Agent token for ${m.name} (${m.role}) in ${wid}. Shown once; store it like a password:\n\n${token}\n`)
} else if (cmd === 'list') {
  const wid = need('workspace')
  const snap = await db.collection('agentTokens').where('wid', '==', wid).get()
  for (const d of snap.docs) { const x = d.data(); console.log(`${d.id.slice(0, 16)}  ${x.revoked ? 'REVOKED' : 'active '}  ${x.label}  uid=${x.uid}  last used ${x.lastUsedAt ? new Date(x.lastUsedAt).toISOString() : 'never'}`) }
} else if (cmd === 'revoke') {
  const prefix = need('id')
  if (prefix.length < 12) { console.error('Give at least 12 characters of the id'); process.exit(1) }
  const snap = await db.collection('agentTokens').get()
  const hits = snap.docs.filter((d) => d.id.startsWith(prefix))
  if (hits.length !== 1) { console.error(`${hits.length} tokens match; give more characters`); process.exit(1) }
  await hits[0].ref.update({ revoked: true, revokedAt: Date.now() })
  console.log('Revoked.')
} else { console.error('Usage: npm run token -- create|list|revoke ...'); process.exit(1) }
process.exit(0)
