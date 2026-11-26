// One-time rename of browser storage from the app's old name (FlowBoard) to ProjectPortfolio. Imported FIRST in
// main.tsx so it runs before any store reads its saved state. Copies each old key to its new name (unless the new
// one already exists), then removes the old one, so nobody loses a local board or their remembered workspace.
for (const store of [localStorage, sessionStorage]) {
  try {
    for (const key of Object.keys(store)) {
      if (!key.startsWith('flowboard')) continue
      const next = 'projectportfolio' + key.slice('flowboard'.length)
      if (store.getItem(next) === null) store.setItem(next, store.getItem(key) ?? '')
      store.removeItem(key)
    }
  } catch { /* storage blocked (private mode): nothing to move */ }
}
export {}
