import assert from 'node:assert/strict'
import { applyLaneEdit, childMap, laneAt, laneLayout, laneNames, UNSORTED } from '../src/lib/board'
import type { BoardNode } from '../src/types'

const mk = (id: string, parentId: string | undefined, extra: Partial<BoardNode> = {}): BoardNode =>
  ({ id, kind: parentId ? 'project' : 'portfolio', title: id, x: 0, y: 0, weight: 1, after: [], createdAt: 1, updatedAt: 1, parentId, ...extra } as BoardNode)
const base = (): Record<string, BoardNode> => {
  const n = [mk('root', undefined, { lanes: ['Esports', 'PM'] }), mk('a', 'root', { lane: 'Esports', x: 10 }), mk('b', 'root', { lane: 'PM', x: 20 }),
    mk('c', 'root', { lane: 'PM', x: 5 }), mk('d', 'root', { x: 1 })]
  return Object.fromEntries(n.map((x) => [x.id, x]))
}
let nodes = base()
const kids = (): ReturnType<typeof childMap> => childMap(nodes)
const apply = (e: Parameters<typeof applyLaneEdit>[3]): string | undefined => { const r = applyLaneEdit(nodes, 'root', kids(), e); if (!r.error) nodes = r.nodes; return r.error }

// names: listed lanes, then Unsorted because card d has none
assert.deepEqual(laneNames(nodes.root, kids()), ['Esports', 'PM', UNSORTED])
// add: trimmed, unique (ignoring case), never "Unsorted", never empty
assert.equal(apply({ type: 'add', name: '  Ops  ' }), undefined)
assert.deepEqual(nodes.root.lanes, ['Esports', 'PM', 'Ops'])
assert.ok(apply({ type: 'add', name: 'esports' }))
assert.ok(apply({ type: 'add', name: 'unsorted' }))
assert.ok(apply({ type: 'add', name: '   ' }))
// move
assert.equal(apply({ type: 'move', name: 'Ops', by: -1 }), undefined)
assert.deepEqual(nodes.root.lanes, ['Esports', 'Ops', 'PM'])
apply({ type: 'move', name: 'Esports', by: -1 }) // already first: no change, no error
assert.deepEqual(nodes.root.lanes, ['Esports', 'Ops', 'PM'])
// rename carries the cards; clashing names are refused
assert.equal(apply({ type: 'rename', from: 'PM', to: 'Project management' }), undefined)
assert.equal(nodes.b.lane, 'Project management'); assert.equal(nodes.c.lane, 'Project management')
assert.ok(apply({ type: 'rename', from: 'Ops', to: 'ESPORTS' }))
// remove: cards go to Unsorted, none deleted
assert.equal(apply({ type: 'remove', name: 'Project management' }), undefined)
assert.equal(nodes.b.lane, undefined); assert.equal(nodes.c.lane, undefined)
assert.equal(Object.keys(nodes).length, 5)
assert.deepEqual(laneNames(nodes.root, kids()), ['Esports', 'Ops', UNSORTED])
// a card naming a lane the parent does not list still gets a lane (nothing is lost)
nodes.a = { ...nodes.a, lane: 'Ghost' }
assert.deepEqual(laneNames(nodes.root, kids()), ['Esports', 'Ops', 'Ghost', UNSORTED])
nodes.a = { ...nodes.a, lane: 'Esports' }

// rows: lanes stack downward, cards sit inside their own band, an empty lane still has a band
const r = laneLayout(nodes.root, kids(), 5, 'rows')
const band = (name: string) => r.bands.find((b) => b.name === name)!
assert.ok(band('Ops').count === 0 && band('Ops').bottom > band('Ops').top)
assert.ok(band('Esports').top < band('Ops').top && band('Ops').top < band(UNSORTED).top)
const inside = (id: string, name: string): boolean => r.pos[id].y >= band(name).top && r.pos[id].y <= band(name).bottom
assert.ok(inside('a', 'Esports') && inside('d', UNSORTED))
assert.equal(laneAt(r.bands, 'rows', 0, (band('Ops').top + band('Ops').bottom) / 2), 'Ops')
assert.equal(laneAt(r.bands, 'rows', 0, -5000), 'Esports') // far outside: nearest lane
// cols: lanes sit side by side, every card in its own column
const c = laneLayout(nodes.root, kids(), 5, 'cols')
const col = (name: string) => c.bands.find((b) => b.name === name)!
assert.ok(col('Esports').right <= col('Ops').left + 1 && col('Ops').right <= col(UNSORTED).left + 1)
assert.ok(c.pos.a.x >= col("Esports").left && c.pos.a.x + 190 <= col("Esports").right + 24)
assert.equal(laneAt(c.bands, 'cols', c.pos.d.x + 95, 400), UNSORTED)
console.log('all lane tests passed')
