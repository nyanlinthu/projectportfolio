// End-to-end against the Firestore emulator: a real MCP client talks to dist/stdio.js.
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 PP_FIREBASE_PROJECT=demo-projectportfolio npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('skipped: set FIRESTORE_EMULATOR_HOST'); process.exit(0) }
const env = { ...process.env }
execFileSync('node', ['test/seed.mjs'], { env, stdio: 'inherit' })
const mint = (member) => /ppa_\S+/.exec(execFileSync('node', ['dist/token.js', 'create', '--workspace', 'w-test', '--member', member], { env }).toString())[0]
initializeApp({ projectId: env.PP_FIREBASE_PROJECT })
const db = getFirestore()

async function connect(token) {
  const c = new Client({ name: 'test', version: '1' })
  await c.connect(new StdioClientTransport({ command: 'node', args: ['dist/stdio.js'], env: { ...env, PP_AGENT_TOKEN: token } }))
  const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { ...r, json: (() => { try { return JSON.parse(r.content[0].text) } catch { return r.content[0].text } })() } }
  return { c, call }
}

test('manager agent: read, write, health, revert', async () => {
  const { c, call } = await connect(mint('man@example.com'))
  const names = (await c.listTools()).tools.map((t) => t.name)
  assert.ok(names.includes('update_work_item') && names.includes('project_health') && names.includes('revert_change'))
  assert.ok(!names.includes('undo'))

  const outline = (await call('get_outline')).json
  assert.equal(outline.children[0].title, 'Website relaunch')

  const up = (await call('update_work_item', { id: 't1', status: 'done' })).json
  assert.ok(up.change_id, JSON.stringify(up))
  const stored = (await db.doc('workspaces/w-test/nodes/t1').get()).data()
  assert.equal(stored.status, 'done')
  assert.deepEqual(stored.anc, ['portfolio', 'p1', 'm1', 't1'])

  const added = (await call('add_work_item', { parent_id: 'm1', title: 'QA pass' })).json
  const newId = added.result.id
  assert.deepEqual((await db.doc(`workspaces/w-test/nodes/${newId}`).get()).data().anc, ['portfolio', 'p1', 'm1', newId])

  const h = (await call('project_health', { root_id: 'p1' })).json
  assert.equal(h.blocked[0].id, 't4')
  assert.ok(h.longest_open_dependency_chain.length >= 2)

  const rv = (await call('revert_change', { change_id: up.change_id })).json
  assert.ok(rv.reverted, JSON.stringify(rv))
  assert.equal((await db.doc('workspaces/w-test/nodes/t1').get()).data().status, 'doing')
  const again = await call('revert_change', { change_id: up.change_id })
  assert.ok(again.isError)
  await c.close()
})

test('manager agent: checklist, charter text, workflow, dependencies', async () => {
  const { c, call } = await connect(mint('man@example.com'))
  const cl = (await call('add_checklist', { on_board_of: 'm1', title: 'Launch', items: ['DNS', 'SSL'] })).json
  const clId = cl.result.id
  const up = (await call('update_checklist', { id: clId, tick: ['dns'], add: ['Analytics'], remove: [2] })).json
  assert.deepEqual(up.result.items.map((i) => [i.text, i.done]), [['DNS', true], ['Analytics', false]])
  const stored = (await db.doc(`workspaces/w-test/elements/${clId}`).get()).data()
  assert.deepEqual(stored.anc, ['portfolio', 'p1', 'm1'])

  await call('add_plan', { project_id: 'p1', template: 'charter' })
  const charter = (await call('search', { query: 'Project charter' })).json.find((h) => h.title === 'Project charter')
  assert.ok(charter, 'charter page exists')
  const ed = (await call('update_element', { id: charter.id, append: 'Sponsor: Jane' })).json
  assert.match(ed.result.text, /Sponsor: Jane$/)

  const wf = (await call('add_workflow', { on_board_of: 'p1', title: 'Approval', lanes: ['PM', 'Sponsor'], steps: [{ lane: 'PM', text: 'Draft', shape: 'round' }, { lane: 'Sponsor', text: 'Approve?', shape: 'diamond' }, { lane: 'PM', text: 'Publish' }] })).json
  assert.equal(wf.result.step_ids.length, 3)
  assert.equal(wf.result.arrow_ids.length, 2)

  const loop = await call('link_dependency', { before_id: 't3', after_id: 't1' })
  assert.ok(loop.isError && /loop/.test(loop.content[0].text))
  const dep = (await call('link_dependency', { before_id: 't4', after_id: 't3' })).json
  assert.deepEqual(dep.result.after.sort(), ['t2', 't4'])
  assert.ok(!(await call('unlink_dependency', { before_id: 't4', after_id: 't3' })).isError)
  await c.close()
})

test('delete takes its board with it, and revert brings both back', async () => {
  const { c, call } = await connect(mint('man@example.com'))
  const before = (await db.collection('workspaces/w-test/elements').get()).docs.filter((d) => d.data().anc?.includes('m1')).length
  assert.ok(before > 0)
  const del = (await call('delete_work_item', { id: 'm1' })).json
  assert.ok(del.change_id)
  const left = (await db.collection('workspaces/w-test/elements').get()).docs.filter((d) => d.data().anc?.includes('m1')).length
  assert.equal(left, 0, 'notes/checklists on the deleted card are gone too')
  const rv = (await call('revert_change', { change_id: del.change_id })).json
  assert.ok(rv.reverted, JSON.stringify(rv))
  assert.ok((await db.doc('workspaces/w-test/nodes/t1').get()).exists)
  const back = (await db.collection('workspaces/w-test/elements').get()).docs.filter((d) => d.data().anc?.includes('m1')).length
  assert.equal(back, before)
  await c.close()
})

test('operator agent: only status of own tasks', async () => {
  const { c, call } = await connect(mint('op@example.com'))
  assert.ok(!(await call('update_work_item', { id: 't4', status: 'doing' })).isError)
  const rename = await call('update_work_item', { id: 't4', title: 'Renamed' })
  assert.ok(rename.isError && /operator/.test(rename.content[0].text))
  const junk = await call('update_work_item', { id: 't4', actual_end: 'x'.repeat(50) })
  assert.ok(junk.isError)
  const notMine = await call('update_work_item', { id: 't2', status: 'doing' })
  assert.ok(notMine.isError)
  assert.equal((await db.doc('workspaces/w-test/nodes/t2').get()).data().status, 'backlog')
  await c.close()
})

test('refused: no token, bad token, scoped member, removed member', async () => {
  const start = (tok) => { try { execFileSync('node', ['dist/stdio.js'], { env: { ...env, PP_AGENT_TOKEN: tok ?? '' }, input: '', timeout: 15000, stdio: 'pipe' }); return 0 } catch (e) { return e.status } }
  assert.equal(start(''), 1)
  assert.equal(start('ppa_' + 'x'.repeat(43)), 1)
  assert.throws(() => mint('sc@example.com'))
  const tok = mint('op@example.com')
  await db.doc('workspaces/w-test/members/u-op').delete()
  assert.equal(start(tok), 1)
})
