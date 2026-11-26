import { useMemo, useState } from 'react'
import { ChecklistEditor } from 'canvas-kit'
import { addPlan, addStarterKit, isStarted, Plan, plansOf, STARTER, templateOf, TEMPLATES } from '@/lib/pmkit'
import { useElementStore } from '@/store/useElementStore'
import { BoardNode } from '@/types'
import { AutosizeTextarea } from 'canvas-kit'
import TableCard from './TableCard'

interface PlansSheetProps {
  project: BoardNode
  canEdit: boolean
  /** start on this plan (e.g. arriving from search) */
  openId?: string
  onOpenRow: (tableId: string, rowId: string) => void
  onClose: () => void
}

/**
 * A project's plans (lib/pmkit.ts), over the board: the list with what has been started, one plan open at a time,
 * and the other knowledge areas to add. The board stays where it was underneath.
 */
export default function PlansSheet({ project, canEdit, openId, onOpenRow, onClose }: PlansSheetProps): JSX.Element {
  const elements = useElementStore((s) => s.elements)
  const update = useElementStore((s) => s.update)
  const plans = useMemo(() => plansOf(project.id, elements), [project.id, elements])
  const [open, setOpen] = useState<string | null>(openId ?? null)
  const [adding, setAdding] = useState(false)
  const doc = plans.find((p) => p.id === open)
  const missing = TEMPLATES.filter((t) => !plans.some((p) => p.kit === t.id))
  const started = plans.filter(isStarted).length

  return (
    <div className="wb-plans-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="wb-plans" role="dialog" aria-label={`Plans for ${project.title}`}
        onKeyDown={(e) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.stopPropagation(); doc ? setOpen(null) : onClose() } }}>
        <header className="wb-plans-head">
          {doc ? <button className="wb-x" onClick={() => setOpen(null)} aria-label="Back to all plans">‹</button> : null}
          <div className="wb-plans-titles">
            <span className="wb-kicker"><span>{doc ? `${templateOf(doc.kit)?.area ?? ''} · ${project.title}` : `Project plans · ${started}/${plans.length} started`}</span></span>
            <h2>{doc ? ('title' in doc && doc.title) || templateOf(doc.kit)?.title : project.title}</h2>
          </div>
          <button className="wb-x" onClick={onClose} aria-label="Close plans">✕</button>
        </header>

        {doc ? <PlanDoc doc={doc} canEdit={canEdit} onOpenRow={onOpenRow} onTitle={(title) => update(doc.id, { title })} onBody={(body) => update(doc.id, { body })}
          onGroups={(groups) => update(doc.id, { groups })} /> : (
          <div className="wb-plans-body">
            {plans.length === 0 && (
              <div className="wb-plans-empty">
                <p>No plans yet. The starter kit is what PMI expects every project to keep:</p>
                <p className="wb-plans-names">{STARTER.map((t) => t.title).join(' · ')}</p>
                {canEdit && <button className="wb-plans-cta" onClick={() => addStarterKit(project.id)}>Add the starter kit</button>}
              </div>
            )}
            <ul className="wb-plans-list">
              {plans.map((p) => {
                const t = templateOf(p.kit)
                return (
                  <li key={p.id}>
                    <button onClick={() => setOpen(p.id)}>
                      <i className={`wb-plans-dot ${isStarted(p) ? 'is-on' : ''}`} aria-label={isStarted(p) ? 'Started' : 'Not started'} />
                      <span className="wb-plans-name">{('title' in p && p.title) || t?.title}<small>{t?.hint}</small></span>
                      <span className="wb-plans-area">{t?.area}<small>{t?.domain}</small></span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {canEdit && plans.length > 0 && missing.length > 0 && (
              adding ? (
                <div className="wb-plans-add">
                  <div className="wb-kicker"><span>Add a plan, by knowledge area</span></div>
                  {missing.map((t) => (
                    <button key={t.id} onClick={() => { const id = addPlan(project.id, t.id); setAdding(false); if (id) setOpen(id) }}>
                      <span className="wb-plans-name">{t.title}<small>{t.hint}</small></span>
                      <span className="wb-plans-area">{t.area}<small>{t.domain}</small></span>
                    </button>
                  ))}
                </div>
              ) : <button className="wb-plans-more" onClick={() => setAdding(true)}>+ Add a plan ({missing.length} more)</button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function PlanDoc({ doc, canEdit, onOpenRow, onTitle, onBody, onGroups }: { doc: Plan; canEdit: boolean; onOpenRow: PlansSheetProps['onOpenRow']; onTitle: (t: string) => void; onBody: (b: string) => void; onGroups: (g: Extract<Plan, { kind: 'checklist' }>['groups']) => void }): JSX.Element {
  const t = templateOf(doc.kit)
  if (doc.kind === 'checklist') {
    const items = doc.groups.flatMap((g) => g.items)
    return (
      <div className="wb-plans-body wb-plans-check">
        {t?.hint && <p className="wb-plans-hint">{t.hint} <b>{items.filter((i) => i.done).length}/{items.length} done</b></p>}
        <ChecklistEditor groups={doc.groups} onChange={(groups) => { if (canEdit) onGroups(groups) }} />
      </div>
    )
  }
  if (doc.kind === 'table') {
    return (
      <div className="wb-plans-body wb-plans-doc">
        {t?.hint && <p className="wb-plans-hint">{t.hint}</p>}
        {doc.kit === 'risks' && <RiskMatrix table={doc} />}
        <TableCard el={doc} selected onSelect={() => undefined} onOpenRow={onOpenRow} />
      </div>
    )
  }
  return (
    <div className="wb-plans-body wb-plans-page">
      {t?.hint && <p className="wb-plans-hint">{t.hint}</p>}
      <input className="wb-peek-title" value={doc.title} disabled={!canEdit} maxLength={120} aria-label="Title" onChange={(e) => onTitle(e.target.value)} />
      <AutosizeTextarea value={doc.body} disabled={!canEdit} aria-label={doc.title} onChange={(e) => onBody(e.target.value)} />
    </div>
  )
}

/**
 * PMBOK's probability × impact matrix, read from the register itself: how many open risks sit in each cell.
 * Top right is where attention goes first.
 */
function RiskMatrix({ table }: { table: Extract<Plan, { kind: 'table' }> }): JSX.Element {
  const col = (name: string): string | undefined => table.columns.find((c) => c.name === name)?.id
  const p = col('Probability'), i = col('Impact'), st = col('Status')
  const LEVELS = ['Low', 'Medium', 'High']
  const count = (pl: string, il: string): number => table.rows.filter((r) => p && i && r.cells[p] === pl && r.cells[i] === il && (!st || r.cells[st] !== 'Closed')).length
  const heat = (pi: number, ii: number): string => ['#3d6b4a', '#7a7a3a', '#9a5a2e', '#a33a32'][Math.min(3, Math.floor((pi + ii) * 0.75))]
  const unrated = table.rows.filter((r) => p && i && (!r.cells[p] || !r.cells[i]) && Object.values(r.cells).some((v) => v)).length
  return (
    <figure className="wb-riskmx" aria-label="Probability and impact matrix">
      <div className="wb-riskmx-grid">
        <span className="wb-riskmx-y">Probability</span>
        {[...LEVELS].reverse().map((pl, row) => (
          <div key={pl} className="wb-riskmx-row">
            <span className="wb-riskmx-lab">{pl}</span>
            {LEVELS.map((il, ii) => { const n = count(pl, il); return <span key={il} className={`wb-riskmx-cell ${n ? 'is-on' : ''}`} style={{ background: heat(2 - row, ii) }}>{n || ''}</span> })}
          </div>
        ))}
        <div className="wb-riskmx-row"><span className="wb-riskmx-lab" />{LEVELS.map((l) => <span key={l} className="wb-riskmx-lab is-x">{l}</span>)}</div>
        <span className="wb-riskmx-x">Impact</span>
      </div>
      <figcaption>Open risks by probability and impact. Work the top-right first.{unrated ? ` ${unrated} not rated yet.` : ''}</figcaption>
    </figure>
  )
}
