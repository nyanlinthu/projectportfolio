// Three-way merge for two people changing the same item at the same time.
//
// `base` is the last version both sides agreed on, `mine` is what this device has now, `theirs` is what just
// arrived from the server. Whatever only one side changed is kept from that side, at the finest grain that can be
// told apart: per field, and per row / column / card inside a list (matched by `id`). Only when both sides
// changed the very same value does one have to win, and then it is `mine`: what a person is typing must never be
// replaced under their fingers. Pure: no store, no network.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)
const hasIds = (v: unknown): v is (Obj & { id: string })[] => Array.isArray(v) && v.every((i) => isObj(i) && typeof i.id === 'string')

function mergeLists(base: (Obj & { id: string })[], mine: (Obj & { id: string })[], theirs: (Obj & { id: string })[]): unknown[] {
  const inBase = new Map(base.map((i) => [i.id, i])), inTheirs = new Map(theirs.map((i) => [i.id, i])), inMine = new Set(mine.map((i) => i.id))
  const out: (Obj & { id: string })[] = []
  for (const m of mine) {
    const t = inTheirs.get(m.id)
    if (t) out.push(merge3(inBase.get(m.id), m, t) as Obj & { id: string })
    else if (!inBase.has(m.id)) out.push(m) // added here; they removed it otherwise, and a removal stands
  }
  // what they added goes in after the neighbour it follows on their side
  theirs.forEach((t, i) => {
    if (inMine.has(t.id) || inBase.has(t.id)) return // already handled, or removed here
    let at = 0
    for (let j = i - 1; j >= 0; j--) { const k = out.findIndex((o) => o.id === theirs[j].id); if (k >= 0) { at = k + 1; break } }
    out.splice(at, 0, t)
  })
  return out
}

export function merge3<T>(base: T | undefined, mine: T, theirs: T): T {
  if (same(mine, theirs) || same(theirs, base)) return mine
  if (same(mine, base)) return theirs
  if (isObj(mine) && isObj(theirs)) {
    const b: Obj = isObj(base) ? base : {}
    const out: Obj = {}
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(b[k], mine[k], theirs[k])
      if (v !== undefined) out[k] = v
    }
    return out as T
  }
  if (hasIds(mine) && hasIds(theirs)) return mergeLists(hasIds(base) ? base : [], mine, theirs) as T
  return mine
}
