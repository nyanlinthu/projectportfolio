import { useEscape } from '@/hooks/useEscape'
import { useEffect, useState } from 'react'
import { cancelInvite, createWorkspace, inviteMember, openWorkspace, removeMember, renameWorkspace, setMemberRole, setMemberScopes, signOut } from '@/services/cloud'
import { useBoardStore } from '@/store/useBoardStore'
import { usePresence } from '@/store/usePresence'
import { myRole, myScopes, Role, useSession } from '@/store/useSession'
import { ScopeEditor } from './Access'

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', manager: 'Manager', operator: 'Operator' }
const ROLE_HINT: Record<Exclude<Role, 'owner'>, string> = {
  manager: 'can edit everything they can see',
  operator: 'can only update the status of tasks assigned to them',
}

/** Account, workspace and team. Docked like every other sheet: the board stays visible behind it. */
export default function AccountSheet({ onClose, onAdmin }: { onClose: () => void; onAdmin?: () => void }): JSX.Element | null {
  const s = useSession()
  const role = myRole(s)
  const here = usePresence((p) => p.people)
  const live = usePresence((p) => p.live)
  const ws = s.workspaces.find((w) => w.id === s.workspaceId)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Exclude<Role, 'owner'>>('operator')
  const [name, setName] = useState(ws?.name ?? '')
  const [newWs, setNewWs] = useState('')
  const [inviteScopes, setInviteScopes] = useState<string[]>([])
  const nodes = useBoardStore((b) => b.nodes)
  const mine = myScopes(s)
  useEffect(() => { setInviteScopes([]) }, [ws?.id])
  useEffect(() => { setName(ws?.name ?? '') }, [ws?.id, ws?.name])
  useEscape(onClose)
  if (!s.user || !ws) return null
  const manage = role !== 'operator'

  return (
    <aside className="wb-sheet" aria-label="Account and team">
      <div className="wb-sheet-head">
        <span className="wb-kicker" style={{ flex: 1, minWidth: 0 }}><span className="truncate">{s.user.email}</span></span>
        <button className="wb-x" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {role === 'owner'
        ? <input className="wb-sheet-title" value={name} maxLength={60} aria-label="Workspace name"
            onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== ws.name) void renameWorkspace(name.trim()) }} />
        : <div className="wb-sheet-title" style={{ borderBottom: 0 }}>{ws.name}</div>}
      <div className="wb-acct-role">You are {role === 'owner' ? 'the owner' : `a${role === 'operator' ? 'n' : ''} ${role}`} here.
        {mine.length > 0 && ` You have been given ${mine.map((id) => nodes[id]?.title).filter(Boolean).join(', ') || 'certain cards'}; the rest of this workspace is not shared with you.`}</div>

      <div className="wb-acct-section">
        <div className="wb-kicker"><span>Workspaces</span><span>{s.workspaces.length}</span></div>
        <ul className="wb-acct-list">
          {s.workspaces.map((w) => (
            <li key={w.id} className={w.id === ws.id ? 'is-current' : ''}>
              <button className="wb-acct-ws" onClick={() => { if (w.id !== ws.id) void openWorkspace(w.id) }} aria-current={w.id === ws.id}>
                <b>{w.name}</b><span>{w.id === ws.id ? 'open now' : 'tap to open'}</span>
              </button>
              <em>{ROLE_LABEL[w.role]}</em>
            </li>
          ))}
        </ul>
        <form className="wb-acct-row" onSubmit={(e) => { e.preventDefault(); if (newWs.trim()) { void createWorkspace(newWs); setNewWs('') } }}>
          <input className="wb-acct-new" value={newWs} placeholder="New workspace, e.g. Job" maxLength={60} aria-label="New workspace name" onChange={(e) => setNewWs(e.target.value)} />
          <button type="submit" disabled={!newWs.trim()}>Create</button>
        </form>
      </div>

      <div className="wb-acct-section">
        <div className="wb-kicker"><span>Team</span><span>{s.members.length}</span></div>
        <ul className="wb-acct-list">
          {s.members.map((m) => (
            <li key={m.uid} className={role === 'owner' && m.role !== 'owner' ? 'has-scope' : ''}>
              <div><b>{m.name}{(m.uid === s.user?.uid ? live : here.some((p) => p.uid === m.uid)) && <i className="wb-online" title="Here now" aria-label="here now" />}</b><span>{m.email}</span></div>
              {role === 'owner' && m.role !== 'owner' ? (
                <>
                  <select value={m.role} aria-label={`Role of ${m.name}`} onChange={(e) => void setMemberRole(m.uid, e.target.value as Exclude<Role, 'owner'>)}>
                    <option value="manager">Manager</option><option value="operator">Operator</option>
                  </select>
                  <button onClick={() => void removeMember(m.uid)} aria-label={`Remove ${m.name}`}>✕</button>
                </>
              ) : <em>{ROLE_LABEL[m.role]}{m.scopes?.length ? ' · limited' : ''}</em>}
              {role === 'owner' && m.role !== 'owner' && <ScopeEditor scopes={m.scopes ?? []} who={m.name} onChange={(next) => void setMemberScopes(m.uid, next)} />}
            </li>
          ))}
          {s.invites.map((i) => (
            <li key={i.email} className="is-pending">
              <div><b>{i.email}</b><span>invited{i.scopes?.length ? ` to ${i.scopes.map((id) => nodes[id]?.title ?? 'a card').join(', ')}` : ''}, has not signed in yet</span></div>
              <em>{ROLE_LABEL[i.role]}</em>
              <button onClick={() => void cancelInvite(i.email)} aria-label={`Cancel invitation for ${i.email}`}>✕</button>
            </li>
          ))}
        </ul>
      </div>

      {manage && (
        <form className="wb-acct-invite" onSubmit={(e) => { e.preventDefault(); if (email.trim()) { void inviteMember(email, inviteRole, mine.length ? mine : inviteScopes); setEmail(''); setInviteScopes([]) } }}>
          <div className="wb-kicker"><span>Invite by email</span></div>
          <input type="email" value={email} placeholder="name@example.com" autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
          <div className="wb-acct-row">
            <select value={inviteRole} aria-label="Role" onChange={(e) => setInviteRole(e.target.value as Exclude<Role, 'owner'>)}>
              <option value="operator">Operator</option><option value="manager">Manager</option>
            </select>
            <button type="submit" disabled={!email.trim()}>Invite</button>
          </div>
          {mine.length === 0 && <ScopeEditor scopes={inviteScopes} who="this person" onChange={setInviteScopes} />}
          <p>{ROLE_LABEL[inviteRole]}: {ROLE_HINT[inviteRole]}. {mine.length ? 'They will be given the same cards as you, and nothing else. ' : inviteScopes.length ? 'They will only ever receive the cards chosen above. ' : ''}They join the next time they sign in with that address.</p>
        </form>
      )}

      {onAdmin && <button className="wb-gate-btn is-quiet" onClick={onAdmin}>Admin · users and analytics</button>}
      <button className="wb-del" onClick={() => void signOut()}>Sign out</button>
    </aside>
  )
}
