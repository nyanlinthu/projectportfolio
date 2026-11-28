// The app's stores were written for a browser. On the server they run against an in-memory localStorage (their
// persist middleware writes there and nothing reads it back) and a `window` that is just the global scope.
// This file must be imported before anything from ../src.
const mem = new Map<string, string>()
const storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
const g = globalThis as Record<string, unknown>
if (!g.localStorage) g.localStorage = storage
if (!g.window) g.window = globalThis
export {}
