import { useMemo } from 'react'
import { KIND_LABEL } from '@/lib/board'
import { setMemberScopes } from '@/services/cloud'
import { ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import { myRole, useSession } from '@/store/useSession'

// Card-level access, in one place. A person's `scopes` are the cards they are limited to (each with everything
// under it); none means the whole workspace. The limit itself is enforced by firestore.rules, not here.

const MAX_SCOPES = 10

/** Pick which cards someone is limited to. Used for a member, and for an invitation before they have joined. */
export function ScopeEditor({ scopes, onChange, who }: { scopes: string[]; onChange: (next: string[]) => void; who: string }): JSX.Element {
  const nodes = useBoardStore((s) => s.nodes)
  const groups = useMemo(() => {
    const all = Object.values(nodes)
    const byTitle = (a: { title: string }, b: { title: string }): number => a.title.localeCompare(b.title)
    return all.filter((n) => n.kind === 'project').sort(byTitle)
      .map((p) => ({ project: p, milestones: all.filter((m) => m.parentId === p.id && m.kind === 'milestone').sort(byTitle) }))
  }, [nodes])
  return (
    <div className="wb-scope">
      <div className="wb-scope-chips">
        {scopes.length === 0 && <span className="wb-scope-all">Sees the whole workspace</span>}
        {scopes.map((id) => (
          <span key={id} className="wb-scope-chip" title={nodes[id] ? KIND_LABEL[nodes[id].kind] : undefined}>
            <span>{nodes[id]?.title ?? 'A card that no longer exists'}</span>
            <button type="button" onClick={() => onChange(scopes.filter((x) => x !== id))} aria-label={`Stop limiting ${who} to ${nodes[id]?.title ?? 'this card'}`}>✕</button>
          </span>
        ))}
      </div>
      {scopes.length < MAX_SCOPES && (
        <select value="" aria-label={`Limit ${who} to a card`} onChange={(e) => { if (e.target.value) onChange([...scopes, e.target.value]) }}>
          <option value="">{scopes.length ? 'Add another card…' : 'Limit to one card…'}</option>
          {groups.map(({ project, milestones }) => (
            <optgroup key={project.id} label={project.title}>
              <option value={project.id} disabled={scopes.includes(project.id)}>{project.title} (whole project)</option>
              {milestones.map((m) => <option key={m.id} value={m.id} disabled={scopes.includes(m.id)}>{m.title}</option>)}
            </optgroup>
          ))}
        </select>
      )}
    </div>
  )
}

/** On a card's own sheet, for the owner: who has been given exactly this card, and a way to give it to someone. */
export function CardAccess({ nodeId }: { nodeId: string }): JSX.Element | null {
  const s = useSession()
  if (s.status !== 'ready' || myRole(s) !== 'owner' || nodeId === ROOT_ID) return null
  const others = s.members.filter((m) => m.role !== 'owner')
  if (!others.length) return null
  const has = others.filter((m) => m.scopes?.includes(nodeId))
  const can = others.filter((m) => !m.scopes?.includes(nodeId) && (m.scopes?.length ?? 0) < MAX_SCOPES)
  return (
    <div className="wb-scope wb-card-access">
      <span className="wb-scope-label">Shared with</span>
      <div className="wb-scope-chips">
        {has.length === 0 && <span className="wb-scope-all">Nobody is limited to this card</span>}
        {has.map((m) => (
          <span key={m.uid} className="wb-scope-chip">
            <span>{m.name}</span>
            <button type="button" onClick={() => void setMemberScopes(m.uid, (m.scopes ?? []).filter((x) => x !== nodeId))} aria-label={`Take this card away from ${m.name}`}>✕</button>
          </span>
        ))}
      </div>
      {can.length > 0 && (
        <select value="" aria-label="Give someone this card" onChange={(e) => { const m = others.find((x) => x.uid === e.target.value); if (m) void setMemberScopes(m.uid, [...(m.scopes ?? []), nodeId]) }}>
          <option value="">Give someone this card…</option>
          {can.map((m) => <option key={m.uid} value={m.uid}>{m.name}{m.scopes?.length ? '' : ' (now sees everything)'}</option>)}
        </select>
      )}
      <p>They get this card and everything under it, and nothing else. Anyone who sees the whole workspace sees it too.</p>
    </div>
  )
}
