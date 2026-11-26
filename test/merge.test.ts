import { merge3 } from '../src/lib/merge'

let failed = 0
const check = (name: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) !== JSON.stringify(want)) { failed++; console.error(`FAIL ${name}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`) }
}
const row = (id: string, a: string, b: string): { id: string; cells: Record<string, string> } => ({ id, cells: { a, b } })
const table = (title: string, rows: unknown[], x = 0): unknown => ({ id: 't', kind: 'table', title, x, rows })

const base = table('Costs', [row('r1', 'Desk', '120'), row('r2', 'Chair', '45')])

// the Google-Sheets case: two people, two different cells of the same table
check('different cells both survive',
  merge3(base, table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Chair', '45')]), table('Costs', [row('r1', 'Desk', '120'), row('r2', 'Stool', '45')])),
  table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Stool', '45')]))
check('same cell: what I am typing wins',
  merge3(base, table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Chair', '45')]), table('Costs', [row('r1', 'Desk', '999'), row('r2', 'Chair', '45')])),
  table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Chair', '45')]))
check('they move the table while I type in it',
  merge3(base, table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Chair', '45')]), table('Costs', [row('r1', 'Desk', '120'), row('r2', 'Chair', '45')], 500)),
  table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Chair', '45')], 500))
check('they add a row while I edit one',
  merge3(base, table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Chair', '45')]), table('Costs', [row('r1', 'Desk', '120'), row('r2', 'Chair', '45'), row('r3', 'Lamp', '9')])),
  table('Costs', [row('r1', 'Desk', '130'), row('r2', 'Chair', '45'), row('r3', 'Lamp', '9')]))
check('both add a row: both kept, theirs after the row it followed',
  merge3(base, table('Costs', [row('r1', 'Desk', '120'), row('r2', 'Chair', '45'), row('m', 'Mine', '1')]), table('Costs', [row('r1', 'Desk', '120'), row('t', 'Theirs', '2'), row('r2', 'Chair', '45')])),
  table('Costs', [row('r1', 'Desk', '120'), row('t', 'Theirs', '2'), row('r2', 'Chair', '45'), row('m', 'Mine', '1')]))
check('they delete a row: it stays deleted',
  merge3(base, table('Mine', [row('r1', 'Desk', '120'), row('r2', 'Chair', '45')]), table('Costs', [row('r1', 'Desk', '120')])),
  table('Mine', [row('r1', 'Desk', '120')]))
check('I delete a row: it is not brought back',
  merge3(base, table('Costs', [row('r1', 'Desk', '120')]), table('Theirs', [row('r1', 'Desk', '120'), row('r2', 'Chair', '45')])),
  table('Theirs', [row('r1', 'Desk', '120')]))

// work items: flat fields
const node = { id: 'n', title: 'Build', status: 'backlog', x: 10, y: 10, after: ['a'] }
check('rename here, move there', merge3(node, { ...node, title: 'Build login' }, { ...node, x: 300, y: 40 }), { ...node, title: 'Build login', x: 300, y: 40 })
check('a field they cleared is cleared', merge3({ ...node, notes: 'x' }, { ...node, notes: 'x', title: 'T' }, node), { ...node, title: 'T' })
check('a field they added arrives', merge3(node, { ...node, title: 'T' }, { ...node, assignee: 'Aye' }), { ...node, title: 'T', assignee: 'Aye' })
check('nothing of mine changed: take theirs whole', merge3(node, node, { ...node, status: 'done' }), { ...node, status: 'done' })
check('no base: mine wins where both have a value', merge3(undefined, { a: 1, b: 2 }, { a: 9, c: 3 }), { a: 1, b: 2, c: 3 })
const mine = { ...node, title: 'Z' }
if (merge3(node, mine, node) !== mine) { failed++; console.error('FAIL unchanged on their side must return my object itself (no re-render)') }

console.log(failed ? `${failed} merge test(s) FAILED` : 'all merge tests passed')
process.exit(failed ? 1 : 0)
