import { useEffect, useMemo, useState } from 'react'
import { listUsers, UserRow } from '@/services/admin'
import { PeerMark } from './Presence'

// Admin only (an admins/{uid} document; the rules refuse anyone else). Who signed up, when, how, from where
// (their device's time zone: coarse on purpose, no IP addresses are kept) and whether they came back.

const DAY = 86_400_000
const date = (t?: number): string => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }) : '—')
/** "Asia/Yangon" → "Yangon"; the city is what people recognise */
const place = (tz?: string): string => (tz ? tz.split('/').pop()!.replace(/_/g, ' ') : 'Unknown')

function Bars({ rows }: { rows: [string, number][] }): JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r[1]))
  return (
    <ul className="wb-adm-bars">
      {rows.map(([k, v]) => (
        <li key={k}><span className="truncate">{k}</span><i><b style={{ width: `${(v / max) * 100}%` }} /></i><em>{v}</em></li>
      ))}
    </ul>
  )
}
const count = (xs: (string | undefined)[], top = 8): [string, number][] => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x || 'Unknown', (m.get(x || 'Unknown') ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
}

export default function AdminSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = (): void => { setErr(null); listUsers().then(setUsers).catch((e) => setErr((e as { code?: string }).code === 'permission-denied' ? 'This account is not an admin.' : 'Could not load users.')) }
  useEffect(load, [])
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const stats = useMemo(() => {
    if (!users) return null
    const now = Date.now()
    const days = Array.from({ length: 30 }, (_, i) => { const start = new Date(now - (29 - i) * DAY); start.setHours(0, 0, 0, 0); return start.getTime() })
    const perDay = days.map((d) => users.filter((u) => u.createdAt && u.createdAt >= d && u.createdAt < d + DAY).length)
    return {
      total: users.length,
      week: users.filter((u) => (u.createdAt ?? 0) > now - 7 * DAY).length,
      active7: users.filter((u) => (u.lastActive ?? 0) > now - 7 * DAY).length,
      withWs: users.filter((u) => (u.created ?? 0) > 0 || (u.workspaceIds?.length ?? 0) > 0).length,
      days, perDay,
      where: count(users.map((u) => place(u.tz))),
      device: count(users.map((u) => u.device)),
      provider: count(users.map((u) => (u.provider === 'google' ? 'Google' : u.provider === 'email' ? 'Email link' : undefined))),
      lang: count(users.map((u) => u.lang?.split('-')[0])),
    }
  }, [users])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (users ?? []).filter((u) => !s || u.email.toLowerCase().includes(s) || u.name.toLowerCase().includes(s) || (u.tz ?? '').toLowerCase().includes(s))
  }, [users, q])

  const maxDay = stats ? Math.max(1, ...stats.perDay) : 1
  return (
    <aside className="wb-sheet wb-admin" aria-label="Users and analytics">
      <PeerMark id="admin" />
      <div className="wb-sheet-head">
        <span className="wb-kicker" style={{ flex: 1 }}><span>Admin · users</span><span>{users ? users.length : '…'}</span></span>
        <button className="wb-tidy" onClick={load}>Refresh</button>
        <button className="wb-x" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {err && <p className="wb-gate-err" role="alert">{err}</p>}
      {!users && !err && <p className="wb-inbox-empty">Loading…</p>}
      {stats && <>
        <div className="wb-adm-kpis">
          <div><b>{stats.total}</b><span>signed up</span></div>
          <div><b>{stats.week}</b><span>new this week</span></div>
          <div><b>{stats.active7}</b><span>active 7 days</span></div>
          <div><b>{stats.total ? Math.round((stats.withWs / stats.total) * 100) : 0}%</b><span>own a workspace</span></div>
        </div>

        <div className="wb-adm-block">
          <div className="wb-kicker"><span>Sign-ups, last 30 days</span><span>{stats.perDay.reduce((a, b) => a + b, 0)}</span></div>
          <svg className="wb-adm-spark" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="Sign-ups per day">
            {stats.perDay.map((v, i) => (
              <rect key={i} x={i * 10 + 1} width={8} y={60 - (v / maxDay) * 56} height={Math.max(v ? 2 : 0, (v / maxDay) * 56)} rx={1}>
                <title>{`${date(stats.days[i])}: ${v}`}</title>
              </rect>
            ))}
            <line x1="0" x2="300" y1="60.5" y2="60.5" />
          </svg>
          <div className="wb-adm-axis"><span>{date(stats.days[0])}</span><span>today</span></div>
        </div>

        <div className="wb-adm-grid">
          <div className="wb-adm-block"><div className="wb-kicker"><span>Where (time zone)</span></div><Bars rows={stats.where} /></div>
          <div className="wb-adm-block"><div className="wb-kicker"><span>Device</span></div><Bars rows={stats.device} /></div>
          <div className="wb-adm-block"><div className="wb-kicker"><span>Signed up with</span></div><Bars rows={stats.provider} /></div>
          <div className="wb-adm-block"><div className="wb-kicker"><span>Language</span></div><Bars rows={stats.lang} /></div>
        </div>

        <input className="wb-acct-new" value={q} placeholder="Search name, email or place" aria-label="Search users" onChange={(e) => setQ(e.target.value)} />
        <ul className="wb-acct-list wb-adm-users">
          {shown.slice(0, 300).map((u) => (
            <li key={u.uid} className={open === u.uid ? 'is-open' : ''}>
              <button className="wb-acct-ws" onClick={() => setOpen(open === u.uid ? null : u.uid)} aria-expanded={open === u.uid}>
                <b>{u.name || u.email}</b><span>{u.email}</span>
              </button>
              <em>{date(u.createdAt)}</em>
              {open === u.uid && (
                <dl className="wb-adm-detail">
                  <dt>Signed up</dt><dd>{date(u.createdAt)} via {u.provider === 'google' ? 'Google' : u.provider === 'email' ? 'email link' : '—'}</dd>
                  <dt>Last seen</dt><dd>{date(u.lastActive)}</dd>
                  <dt>Where</dt><dd>{u.tz || '—'}</dd>
                  <dt>Device · language</dt><dd>{u.device || '—'} · {u.lang || '—'}</dd>
                  <dt>Workspaces</dt><dd>{u.workspaceIds?.length ?? 0} member · {u.created ?? 0} started</dd>
                </dl>
              )}
            </li>
          ))}
        </ul>
        {shown.length > 300 && <p className="wb-inbox-empty">Showing 300 of {shown.length}. Search to narrow.</p>}
      </>}
    </aside>
  )
}
