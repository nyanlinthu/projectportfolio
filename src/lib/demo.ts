/** True only in the public demo build (npm run build:demo): no sign-in, no cloud, everything stays in the browser. */
export const DEMO = import.meta.env.VITE_DEMO === '1'
/** Browser-storage names. The demo uses its own, so it can never mix with a real board on the same site. */
export const STORE_KEYS = DEMO
  ? { board: 'projectportfolio-demo-board-v1', elements: 'projectportfolio-demo-elements-v1', view: 'projectportfolio-demo-view' }
  : { board: 'projectportfolio-board-v1', elements: 'projectportfolio-elements-v1', view: 'projectportfolio-view' }
export function resetDemo(): void {
  for (const k of Object.values(STORE_KEYS)) localStorage.removeItem(k)
  window.location.hash = ''
  window.location.reload()
}
