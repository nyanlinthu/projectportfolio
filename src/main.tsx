import './migrateStorage'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// The agent tools are reachable from the page console in development only. In a production build an agent must
// import the tools and run behind the app's own sign-in, never through an open global.
if (import.meta.env.DEV) void import('./ai/bridge').then((m) => m.installAgentBridge())

// Development only. Other projects run on the same localhost ports at other times and leave their service
// workers behind; those keep intercepting requests here and serve stale files, so edits appear not to apply.
// Remove any service worker on this origin, then load once more without it. (Production registers its own.)
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs.length) return
    await Promise.all(regs.map((r) => r.unregister()))
    if (navigator.serviceWorker.controller && !sessionStorage.getItem('projectportfolio-sw-cleared')) {
      sessionStorage.setItem('projectportfolio-sw-cleared', '1')
      window.location.reload()
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)