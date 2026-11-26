import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { KIND_LABEL, NodeView, PRIORITIES, STATUSES } from '@/lib/board'
import { ROOT_ID, useBoardStore } from '@/store/useBoardStore'
import { Member } from '@/store/useSession'
import { BoardNode } from '@/types'
import { CardAccess } from './Access'
import { LinkChips, useMention } from './Mention'
import { ancOf, cardMentionKey } from '@/lib/scope'
import { useElementStore } from '@/store/useElementStore'
import { createUnder } from './NodeViews'
import { actualSpan, fmtVar, linkPatch, plannedSpan, variance } from '@/lib/dates'
import { ChildMap, todayYmd } from '@/lib/board'

interface NodeSheetProps {
  node: BoardNode
  view: NodeView
  path: string
  operators: string[]
  lateDays?: number
  onClose: () => void
  /** Open the board into this card (same as double-tapping it). Absent when it is already the open one. */
  onOpen?: () => void
  /** operators see everything but may not edit it */
  readOnly: boolean
  canStatus: boolean
  /** the workspace team; when present the operator is picked from it instead of typed */
  members: Member[]
  kids: ChildMap
  /** show another card's detail (the children listed here) */
  onSelect: (id: string) => void
  /** shown beside the board you went into: no scrim, no fly-in, stays while you work */
  docked?: boolean
}

/** Where the card sits on screen right now, so the detail can grow out of it and shrink back into it. */
function cardRect(id: string): DOMRect | null {
  const el = document.querySelector(`[data-card="${CSS.escape(id)}"]`)
  return el ? el.getBoundingClientRect() : null
}
/** The transform that makes the panel look like the card it came from. */
function fromCard(panel: HTMLElement, id: string): string | null {
  const c = cardRect(id)
  if (!c) return null
  const p = panel.getBoundingClientRect()
  const dx = c.left + c.width / 2 - (p.left + p.width / 2)
  const dy = c.top + c.height / 2 - (p.top + p.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${Math.max(0.08, c.width / p.width)}, ${Math.max(0.08, c.height / p.height)})`
}
const EASE = 'cubic-bezier(.2,.8,.2,1)'

/**
 * Detail for the selected card: a card that grows out of the one pressed and comes towards you, over the board
 * (which stays where it was behind a light scrim). Top-right toggles full screen. Closing shrinks it back into the card.
 */
export default function NodeSheet({ node, view, path, operators, lateDays, onClose, onOpen, readOnly, canStatus, members, kids, onSelect, docked }: NodeSheetProps): JSX.Element {
  const updateNode = useBoardStore((s) => s.updateNode)
  const deleteNode = useBoardStore((s) => s.deleteNode)
  const [confirmDel, setConfirmDel] = useState(false)
  const nodes = useBoardStore((s) => s.nodes)
  const [newKid, setNewKid] = useState('')
  const panel = useRef<HTMLElement>(null)
  const scrim = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  useEffect(() => { setConfirmDel(false) }, [node.id])
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // fly in from the card each time a different card is opened
  useLayoutEffect(() => {
    closing.current = false
    const el = panel.current
    if (docked || !el || reduced || !el.animate) return
    const t = fromCard(el, node.id)
    el.animate(t ? [{ transform: t, opacity: 0.4, borderRadius: '8px' }, { transform: 'none', opacity: 1 }]
      : [{ transform: 'scale(.92) translateY(24px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 420, easing: EASE })
    scrim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' })
  }, [node.id, reduced])

  const close = useCallback(() => {
    const el = panel.current
    if (closing.current) return
    if (docked || !el || reduced || !el.animate) { onClose(); return }
    closing.current = true
    const t = fromCard(el, node.id)
    const a = el.animate(t ? [{ transform: 'none', opacity: 1 }, { transform: t, opacity: 0 }]
      : [{ transform: 'none', opacity: 1 }, { transform: 'scale(.92) translateY(24px)', opacity: 0 }],
    { duration: 260, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'forwards' })
    scrim.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' })
    a.onfinish = () => onClose()
  }, [node.id, onClose, reduced, docked])

  useEffect(() => {
    if (docked) return
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [close, docked])

  const els = useElementStore((s) => s.elements)
  const notesAt = useMention({ text: node.notes ?? '', links: node.noteLinks ?? [], selfKey: node.id,
    notifyAt: { key: cardMentionKey(node.id), title: node.title, anc: ancOf(node.id, nodes, els) },
    onChange: (t, l) => updateNode(node.id, { notes: t || undefined, noteLinks: l.length ? l : undefined }) })
  const isTask = node.kind === 'task'
  return (
    <>
    {!docked && <div ref={scrim} className="wb-detail-scrim" onClick={close} aria-hidden="true" />}
    <aside ref={panel} className={`wb-detail ${docked ? 'is-docked' : ''}`} role="dialog" aria-label={`${KIND_LABEL[node.kind]} details`}>
      <div className="wb-sheet-head">
        <span className="wb-kicker" style={{ flex: 1, minWidth: 0 }}><span className="truncate">{KIND_LABEL[node.kind]}{path ? ` · ${path}` : ''}</span></span>
        {onOpen && <button className="wb-open" onClick={onOpen} title="Open the board into this card">Go in →</button>}
        <button className="wb-x" onClick={close} aria-label={docked ? 'Hide details' : 'Close'} title={docked ? 'Hide details' : 'Close'}>{docked ? '»' : '✕'}</button>
      </div>

      <textarea className="wb-sheet-title" value={node.title} maxLength={100} aria-label="Name" readOnly={readOnly} rows={1}
        placeholder={`Name this ${KIND_LABEL[node.kind].toLowerCase()}`}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        onChange={(e) => updateNode(node.id, { title: e.target.value })} />

      {isTask && view.leaf ? (
        <div className="wb-statuses" role="group" aria-label="Status">
          {STATUSES.map((s) => {
            const on = (node.status ?? 'backlog') === s.id
            return (
              <button key={s.id} disabled={!canStatus} onClick={() => updateNode(node.id, { status: s.id })} aria-pressed={on}
                style={on ? { background: s.color, borderColor: s.color, color: '#16294E' } : { color: s.color }}>
                {s.name}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="wb-summary">
          <div className="wb-bar"><div style={{ width: `${view.pct}%`, background: view.color }} /></div>
          <div><b style={{ color: view.color }}>{view.pct}%</b> · {view.label}{!isTask && view.total > 0 ? ` · ${view.done} of ${view.total} tasks done` : ''}</div>
          <p>Worked out from the tasks underneath. Nobody types this number.</p>
        </div>
      )}

      {isTask && view.leaf && (
        // the same field the priority board's columns set; tapping the one that is on clears it
        <div className="wb-statuses wb-priorities" role="group" aria-label="Priority">
          {PRIORITIES.map((p) => {
            const on = node.priority === p.id
            return (
              <button key={p.id} disabled={readOnly} title={p.hint} aria-pressed={on} onClick={() => updateNode(node.id, { priority: on ? undefined : p.id })}
                style={on ? { background: p.color, borderColor: p.color, color: '#16294E' } : { color: p.color }}>
                {p.id === 'urgent' ? 'Urgent' : p.name}
              </button>
            )
          })}
        </div>
      )}

      {lateDays ? <div className="wb-warn">{lateDays} day{lateDays === 1 ? '' : 's'} past planned end</div> : null}

      {isTask && (
        <div className="wb-fields wb-fields-one">
          <label>Operator
            {members.length ? (
              // picked from the team: the account id is what gives that person the right to update this task
              <select value={node.assigneeUid ?? ''} disabled={readOnly}
                onChange={(e) => { const m = members.find((x) => x.uid === e.target.value); updateNode(node.id, { assigneeUid: m?.uid, assignee: m?.name }) }}>
                <option value="">Nobody yet</option>
                {members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
              </select>
            ) : (
              <>
                <input list="wb-operators" value={node.assignee ?? ''} placeholder="Who does this?" readOnly={readOnly}
                  onChange={(e) => updateNode(node.id, { assignee: e.target.value || undefined })} />
                <datalist id="wb-operators">{operators.map((o) => <option key={o} value={o} />)}</datalist>
              </>
            )}
          </label>
        </div>
      )}

      <Schedule node={node} nodes={nodes} kids={kids} readOnly={readOnly} canActual={canStatus} leaf={!(kids.get(node.id)?.length)} />

      <label className="wb-row-notes">
        <span>Notes</span>
        <textarea value={node.notes ?? ''} readOnly={readOnly} placeholder={readOnly ? '' : 'Anything worth remembering about this… (@ to link)'} rows={3}
          {...notesAt.fieldProps} onKeyDown={(e) => { notesAt.onKeyDown(e) }} />
        {notesAt.list}
      </label>
      <LinkChips links={node.noteLinks} />

      {node.kind !== 'task' && (
        <div className="wb-kids">
          <span className="wb-kids-h">{KIND_LABEL[childKind(node)]}s under this</span>
          {(kids.get(node.id) ?? []).map((k) => {
            const p = plannedSpan(k.id, nodes, kids)
            return (
              <button key={k.id} className="wb-kid" onClick={() => onSelect(k.id)}>
                <span className="truncate">{k.title || 'Untitled'}</span>
                <em>{p.start ? `${short(p.start)} → ${short(p.end ?? p.start)}` : 'no dates'}</em>
              </button>
            )
          })}
          {!readOnly && (
            <form className="wb-kid-add" onSubmit={(e) => { e.preventDefault(); const t = newKid.trim(); if (!t) return; createUnder(node, kids, t); setNewKid('') }}>
              <input value={newKid} maxLength={100} onChange={(e) => setNewKid(e.target.value)} placeholder={`+ Add a ${KIND_LABEL[childKind(node)].toLowerCase()}…`} aria-label={`New ${KIND_LABEL[childKind(node)].toLowerCase()}`} />
              {newKid.trim() && <button type="submit">Add</button>}
            </form>
          )}
        </div>
      )}

      <CardAccess nodeId={node.id} />

      {node.id !== ROOT_ID && !readOnly && (
        <button className={`wb-del ${confirmDel ? 'is-armed' : ''}`}
          onClick={() => (confirmDel ? deleteNode(node.id) : setConfirmDel(true))}>
          {confirmDel ? 'Tap again to delete this and everything under it' : 'Delete'}
        </button>
      )}
    </aside>
    </>
  )
}

const childKind = (n: BoardNode): BoardNode['kind'] => (n.kind === 'portfolio' ? 'project' : n.kind === 'project' ? 'milestone' : 'task')
const short = (ymd: string): string => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Planned vs actual, for every kind. Planned is typed (a milestone can be dated before it has any tasks; with none
 * of its own it shows the span of what is planned under it). Actual is a task's own (stamped by Doing/Done,
 * correctable here); a container's actual is worked out from its tasks and shown, never typed.
 */
function Schedule({ node, nodes, kids, readOnly, canActual, leaf }: { node: BoardNode; nodes: Record<string, BoardNode>; kids: ChildMap; readOnly: boolean; canActual: boolean; leaf: boolean }): JSX.Element {
  const updateNode = useBoardStore((s) => s.updateNode)
  const plan = plannedSpan(node.id, nodes, kids)
  const act = actualSpan(node.id, nodes, kids)
  const own = !!(node.start || node.end)
  const v = variance(plan, act, todayYmd())
  const setPlan = (k: 'start' | 'end', val: string): void => {
    const p: Partial<BoardNode> = { [k]: val || undefined }
    // keep the window the right way round: moving the start past the end drags the end along
    if (k === 'start' && val && node.end && val > node.end) p.end = val
    if (k === 'end' && val && node.start && val < node.start) p.start = val
    updateNode(node.id, p)
  }
  return (
    <div className="wb-sched">
      <div className="wb-sched-row">
        <span className="wb-sched-k">Planned</span>
        <input type="date" value={node.start ?? ''} disabled={readOnly} aria-label="Planned start" placeholder={plan.start}
          onChange={(e) => setPlan('start', e.target.value)} />
        <input type="date" value={node.end ?? ''} disabled={readOnly} aria-label="Planned finish"
          onChange={(e) => setPlan('end', e.target.value)} />
      </div>
      {!own && plan.start && <div className="wb-sched-note">From what is planned under it: {short(plan.start)} → {short(plan.end ?? plan.start)}</div>}
      <div className="wb-sched-row">
        <span className="wb-sched-k">Actual</span>
        {leaf && node.kind === 'task' ? (
          <>
            <input type="date" value={node.actualStart ?? ''} disabled={!canActual} aria-label="Actual start"
              onChange={(e) => updateNode(node.id, { actualStart: e.target.value || undefined })} />
            <input type="date" value={node.actualEnd ?? ''} disabled={!canActual} aria-label="Actual finish"
              onChange={(e) => updateNode(node.id, { actualEnd: e.target.value || undefined })} />
          </>
        ) : (
          <>
            <output>{act.start ? short(act.start) : 'not started'}</output>
            <output>{act.end ? short(act.end) : act.start ? 'in progress' : '—'}</output>
          </>
        )}
      </div>
      {node.baseStart && (
        <div className="wb-sched-row">
          <span className="wb-sched-k">Baseline</span>
          <output>{short(node.baseStart)}</output>
          <output>{node.baseEnd ? short(node.baseEnd) : '—'}</output>
        </div>
      )}
      {node.baseEnd && plan.end && plan.end !== node.baseEnd && (
        <div className="wb-sched-var"><span className={plan.end > node.baseEnd ? 'is-late' : 'is-ok'}>Plan {fmtVar(dayDiff(plan.end, node.baseEnd)).replace('late', 'later').replace('early', 'earlier')} than baseline</span></div>
      )}
      {(v.start !== undefined || v.end !== undefined) && (
        <div className="wb-sched-var">
          {v.start !== undefined && <span className={v.start > 0 ? 'is-late' : 'is-ok'}>Start {fmtVar(v.start)}</span>}
          {v.end !== undefined && <span className={v.end > 0 ? 'is-late' : 'is-ok'}>Finish {act.end ? fmtVar(v.end) : `${fmtVar(v.end)} so far`}</span>}
        </div>
      )}
      {leaf && node.kind === 'task' && !readOnly && <div className="wb-sched-note">Actual dates fill in when it goes to Doing and Done.</div>}
      {node.kind === 'task' && <After node={node} nodes={nodes} readOnly={readOnly} />}
    </div>
  )
}

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

/** Finish-to-start: what this task waits for. Picked from the other tasks in the same project. */
function After({ node, nodes, readOnly }: { node: BoardNode; nodes: Record<string, BoardNode>; readOnly: boolean }): JSX.Element {
  const updateNode = useBoardStore((s) => s.updateNode)
  const project = (() => { let n: BoardNode | undefined = node; while (n && n.kind !== 'project') n = n.parentId ? nodes[n.parentId] : undefined; return n })()
  const inProject = (t: BoardNode): boolean => { for (let n: BoardNode | undefined = t; n; n = n.parentId ? nodes[n.parentId] : undefined) if (n.id === project?.id) return true; return false }
  const after = node.after ?? []
  const options = project ? Object.values(nodes).filter((t) => t.kind === 'task' && t.id !== node.id && !after.includes(t.id) && inProject(t) && linkPatch(t.id, node.id, nodes))
    .sort((a, b) => (a.end ?? '9').localeCompare(b.end ?? '9')) : []
  return (
    <div className="wb-after">
      <span className="wb-sched-k">Starts after</span>
      <div className="wb-after-list">
        {after.map((id) => nodes[id] && (
          <span key={id} className={`wb-after-chip ${nodes[id].end && node.start && node.start <= nodes[id].end! ? 'is-bad' : ''}`}
            title={nodes[id].end && node.start && node.start <= nodes[id].end! ? 'Planned to start before this finishes' : undefined}>
            {nodes[id].title}{nodes[id].end ? ` · ends ${short(nodes[id].end!)}` : ''}
            {!readOnly && <button onClick={() => updateNode(node.id, { after: after.filter((x) => x !== id) })} aria-label={`Remove ${nodes[id].title}`}>×</button>}
          </span>
        ))}
        {!after.length && <span className="wb-sched-note">Nothing: it can start any time.</span>}
      </div>
      {!readOnly && options.length > 0 && (
        <select value="" aria-label="Add a task this waits for" onChange={(e) => { const a = linkPatch(e.target.value, node.id, nodes); if (a) updateNode(node.id, { after: a }) }}>
          <option value="">+ Waits for…</option>
          {options.map((t) => <option key={t.id} value={t.id}>{t.title}{t.end ? ` (ends ${short(t.end)})` : ''}</option>)}
        </select>
      )}
    </div>
  )
}
