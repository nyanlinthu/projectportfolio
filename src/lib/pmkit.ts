import { useElementStore } from '@/store/useElementStore'
import { BoardElement, ChecklistEl, ColumnType, PageEl, TableColumn, TableEl } from '@/types'
import { newColumn, newOption, newRow } from './table'

// The project plans kit: the documents a PMP-run project keeps (PMBOK knowledge areas), as templates.
// A project starts with the five every project needs; the rest are added from its Plans sheet when wanted.
// Scope and Schedule are not here on purpose: the card tree IS the WBS and the dates on it ARE the schedule,
// so separate documents would only drift from the board.
//
// Plans are ordinary tables and pages on the project's board (scopeId = the project) marked with `kit`, so
// search, access, sync and links all treat them like anything else; the canvas leaves them out and the
// project's Plans sheet lists them instead.

export type KnowledgeArea = 'Integration' | 'Scope' | 'Stakeholder' | 'Risk' | 'Cost' | 'Communications' | 'Resource' | 'Procurement' | 'Quality' | 'Benefits'
export type Plan = TableEl | PageEl | ChecklistEl

interface ColSpec { name: string; type: ColumnType; options?: string[] }
interface Template {
  id: string
  title: string
  area: KnowledgeArea
  /** PMBOK 7 performance domain, shown small */
  domain: string
  /** one line on what it is for */
  hint: string
  starter?: boolean
  columns?: ColSpec[]
  /** a page instead of a table: section headings to fill in */
  sections?: string[]
  /** a checklist instead: groups of things to tick off */
  checklist?: { title: string; items: string[] }[]
}

const HML = ['High', 'Medium', 'Low']
const ENGAGEMENT = ['Unaware', 'Resistant', 'Neutral', 'Supportive', 'Leading']

export const TEMPLATES: Template[] = [
  { id: 'business', title: 'Business case', area: 'Benefits', domain: 'Development approach', starter: true,
    hint: 'Why the project is worth doing.',
    sections: ['Business need', 'Options considered', 'Recommended option', 'Costs and benefits', 'Risks of doing nothing'] },
  { id: 'benefits', title: 'Benefits register', area: 'Benefits', domain: 'Measurement', starter: true,
    hint: 'The benefits promised, how they are measured, and when they land.',
    columns: [{ name: 'Benefit', type: 'text' }, { name: 'Measure', type: 'text' }, { name: 'Target', type: 'text' },
      { name: 'Owner', type: 'person' }, { name: 'Realised by', type: 'date' }, { name: 'Delivered by', type: 'link' }] },
  { id: 'charter', title: 'Project charter', area: 'Integration', domain: 'Planning', starter: true,
    hint: 'Authorises the project and the project manager. Signed by the sponsor.',
    sections: ['Purpose and business need', 'Objectives and success criteria', 'High-level scope and deliverables', 'Key milestones',
      'Budget summary', 'Sponsor and project manager (authority)', 'High-level risks', 'Assumptions and constraints', 'Approval (name, date)'] },
  { id: 'stakeholders', title: 'Stakeholder register', area: 'Stakeholder', domain: 'Stakeholders', starter: true,
    hint: 'Who is affected, how engaged they are now, and how engaged they need to be.',
    columns: [{ name: 'Name', type: 'text' }, { name: 'Role / group', type: 'multiselect' },
      { name: 'Current engagement', type: 'select', options: ENGAGEMENT }, { name: 'Desired engagement', type: 'select', options: ENGAGEMENT },
      { name: 'Strategy', type: 'select', options: ['Manage closely', 'Keep satisfied', 'Keep informed', 'Monitor'] },
      { name: 'Expectation', type: 'text' }, { name: 'Email', type: 'email' }, { name: 'Related', type: 'link' }] },
  { id: 'risks', title: 'Risk register', area: 'Risk', domain: 'Uncertainty', starter: true,
    hint: 'What could go wrong (or right), how likely, how bad, and what is being done.',
    columns: [{ name: 'Risk', type: 'text' }, { name: 'Probability', type: 'select', options: HML }, { name: 'Impact', type: 'select', options: HML },
      { name: 'Strategy', type: 'select', options: ['Escalate', 'Avoid', 'Mitigate', 'Transfer', 'Accept'] },
      { name: 'Owner', type: 'person' }, { name: 'Trigger to watch', type: 'text' }, { name: 'Response', type: 'text' },
      { name: 'Status', type: 'status', options: ['Watching', 'Occurred', 'Closed'] }, { name: 'Affects', type: 'link' }] },
  { id: 'changes', title: 'Change log', area: 'Integration', domain: 'Delivery', starter: true,
    hint: 'Every requested change to scope, schedule or cost, and what was decided.',
    columns: [{ name: 'Change', type: 'text' }, { name: 'Requested by', type: 'person' }, { name: 'Date', type: 'date' },
      { name: 'Affects', type: 'multiselect', options: ['Scope', 'Schedule', 'Cost', 'Quality', 'Risk'] },
      { name: 'Decision', type: 'status', options: ['Pending', 'Approved', 'Rejected'] }, { name: 'Linked work', type: 'link' }] },
  { id: 'assumptions', title: 'Assumption log', area: 'Integration', domain: 'Planning', starter: true,
    hint: 'What the plan takes for granted, and the limits it must work within.',
    columns: [{ name: 'Assumption or constraint', type: 'text' }, { name: 'Type', type: 'select', options: ['Assumption', 'Constraint'] },
      { name: 'Owner', type: 'person' }, { name: 'Validated', type: 'checkbox' }, { name: 'Linked work', type: 'link' }] },

  { id: 'issues', title: 'Issue log', area: 'Integration', domain: 'Project work',
    hint: 'Risks that happened and problems that need an owner and a date.',
    columns: [{ name: 'Issue', type: 'text' }, { name: 'Raised', type: 'date' }, { name: 'Priority', type: 'select', options: HML },
      { name: 'Owner', type: 'person' }, { name: 'Status', type: 'status', options: ['Open', 'In progress', 'Resolved'] },
      { name: 'Resolution', type: 'text' }, { name: 'Affects', type: 'link' }] },
  { id: 'requirements', title: 'Requirements traceability', area: 'Scope', domain: 'Delivery',
    hint: 'Each requirement, who asked for it, how it is accepted, and the work that delivers it.',
    columns: [{ name: 'Requirement', type: 'text' }, { name: 'Priority', type: 'select', options: ['Must', 'Should', 'Could', "Won't"] },
      { name: 'Asked by', type: 'link' }, { name: 'Acceptance criteria', type: 'text' }, { name: 'Delivered by', type: 'link' }, { name: 'Verified', type: 'checkbox' }] },
  { id: 'raci', title: 'RACI matrix', area: 'Resource', domain: 'Team',
    hint: 'For each deliverable: who does it, who answers for it, who is asked, who is told.',
    columns: [{ name: 'Deliverable / activity', type: 'text' }, { name: 'Responsible', type: 'person' }, { name: 'Accountable', type: 'person' },
      { name: 'Consulted', type: 'person' }, { name: 'Informed', type: 'person' }, { name: 'Work', type: 'link' }] },
  { id: 'decisions', title: 'Decision log', area: 'Integration', domain: 'Project work',
    hint: 'What was decided, by whom, why, and what else was on the table.',
    columns: [{ name: 'Decision', type: 'text' }, { name: 'Date', type: 'date' }, { name: 'Made by', type: 'person' },
      { name: 'Options considered', type: 'text' }, { name: 'Rationale', type: 'text' }, { name: 'Affects', type: 'link' }] },
  { id: 'closing', title: 'Closing checklist', area: 'Integration', domain: 'Delivery',
    hint: 'Everything a project must do before it is formally closed.',
    checklist: [
      { title: 'Deliverables', items: ['All deliverables accepted by the sponsor, in writing', 'Open change requests closed or deferred', 'Outstanding issues handed over with owners'] },
      { title: 'Contracts', items: ['Procurements closed and final invoices paid', 'Vendor performance recorded'] },
      { title: 'Team and knowledge', items: ['Lessons learned written up', 'Project documents archived', 'Team released and recognised'] },
      { title: 'Handover', items: ['Benefits owner confirmed for measuring after the project', 'Final report sent to stakeholders'] },
    ] },

  { id: 'budget', title: 'Cost baseline', area: 'Cost', domain: 'Measurement',
    hint: 'Estimates, actuals and the basis of each estimate.',
    columns: [{ name: 'Item', type: 'text' }, { name: 'Category', type: 'select', options: ['Labour', 'Materials', 'Equipment', 'Services', 'Contingency'] },
      { name: 'Estimate', type: 'number' }, { name: 'Actual', type: 'number' }, { name: 'Basis of estimate', type: 'text' }, { name: 'For', type: 'link' }] },
  { id: 'comms', title: 'Communications plan', area: 'Communications', domain: 'Stakeholders',
    hint: 'Who gets told what, how, and how often.',
    columns: [{ name: 'What', type: 'text' }, { name: 'Audience', type: 'multiselect' },
      { name: 'Channel', type: 'select', options: ['Meeting', 'Email', 'Report', 'Chat', 'Dashboard'] },
      { name: 'Frequency', type: 'select', options: ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'At milestones'] }, { name: 'Owner', type: 'person' }] },
  { id: 'resources', title: 'Resource plan', area: 'Resource', domain: 'Team',
    hint: 'People, equipment and materials the work needs, and when.',
    columns: [{ name: 'Resource / role', type: 'text' }, { name: 'Type', type: 'select', options: ['People', 'Equipment', 'Material'] },
      { name: 'Assigned', type: 'person' }, { name: 'From', type: 'date' }, { name: 'To', type: 'date' }, { name: 'For', type: 'link' }] },
  { id: 'team', title: 'Team charter', area: 'Resource', domain: 'Team',
    hint: 'How the team works together: values, agreements, decisions, conflict.',
    sections: ['Team values', 'Working agreements', 'Meeting guidelines', 'Communication norms', 'Decision-making process', 'Conflict process'] },
  { id: 'procurement', title: 'Procurement log', area: 'Procurement', domain: 'Delivery',
    hint: 'What is bought, from whom, on what contract, and where it stands.',
    columns: [{ name: 'Item', type: 'text' }, { name: 'Vendor', type: 'text' },
      { name: 'Contract type', type: 'select', options: ['Fixed price', 'Time & materials', 'Cost-reimbursable'] },
      { name: 'Status', type: 'status', options: ['Sourcing', 'Ordered', 'Delivered'] }, { name: 'Due', type: 'date' }, { name: 'For', type: 'link' }] },
  { id: 'quality', title: 'Quality checklist', area: 'Quality', domain: 'Delivery',
    hint: 'What "done well" means, measured.',
    columns: [{ name: 'Requirement / metric', type: 'text' }, { name: 'Target', type: 'text' }, { name: 'How it is checked', type: 'text' },
      { name: 'Owner', type: 'person' }, { name: 'Met', type: 'checkbox' }, { name: 'For', type: 'link' }] },
  { id: 'lessons', title: 'Lessons learned', area: 'Integration', domain: 'Project work',
    hint: 'What to repeat and what to avoid, written while it is fresh.',
    columns: [{ name: 'Lesson', type: 'text' }, { name: 'Category', type: 'select', options: ['Went well', 'To improve'] },
      { name: 'Recommendation', type: 'text' }, { name: 'From', type: 'link' }] },
]

export const templateOf = (id: string | undefined): Template | undefined => TEMPLATES.find((t) => t.id === id)
export const STARTER = TEMPLATES.filter((t) => t.starter)

/** The plans a project has, in kit order. */
export const isPlan = (e: BoardElement): e is Plan => (e.kind === 'table' || e.kind === 'page' || e.kind === 'checklist') && !!e.kit
export function plansOf(projectId: string, elements: BoardElement[]): Plan[] {
  const mine = elements.filter((e): e is Plan => isPlan(e) && e.scopeId === projectId)
  const order = (e: Plan): number => { const i = TEMPLATES.findIndex((t) => t.id === e.kit); return i < 0 ? 999 : i }
  return mine.sort((a, b) => order(a) - order(b))
}

/** Started = someone has written in it (a row with any cell filled, or page text beyond the headings). */
export function isStarted(e: Plan): boolean {
  if (e.kind === 'checklist') return e.groups.some((g) => g.items.some((i) => i.done))
  if (e.kind === 'table') return e.rows.some((r) => Object.values(r.cells).some((v) => v && v.trim()))
  const t = templateOf(e.kit)
  return e.body.trim() !== (t?.sections ? sectionsBody(t.sections) : '').trim()
}

const sectionsBody = (sections: string[]): string => sections.map((s) => `## ${s}\n\n`).join('\n')

function column(spec: ColSpec): TableColumn {
  const c = newColumn(spec.name, spec.type)
  return spec.options ? { ...c, options: spec.options.map((o, i) => newOption(o, i)) } : c
}

/** Add one plan to a project. Returns its id, or the existing one if the project already has it. */
export function addPlan(projectId: string, templateId: string): string | undefined {
  const t = templateOf(templateId)
  if (!t) return undefined
  const els = useElementStore.getState()
  const have = els.elements.find((e) => isPlan(e) && e.kit === t.id && e.scopeId === projectId)
  if (have) return have.id
  const base = { scopeId: projectId, x: 0, y: 0, kit: t.id }
  if (t.sections) return els.add({ ...base, kind: 'page', title: t.title, body: sectionsBody(t.sections) })
  const uid = (): string => Math.random().toString(36).slice(2, 10)
  if (t.checklist) return els.add({ ...base, kind: 'checklist', groups: t.checklist.map((g) => ({ id: uid(), title: g.title, items: g.items.map((text) => ({ id: uid(), text, done: false })) })) })
  return els.add({ ...base, kind: 'table', title: t.title, columns: (t.columns ?? []).map(column), rows: [newRow()] })
}

/** The five every project starts with. */
export function addStarterKit(projectId: string): void { for (const t of STARTER) addPlan(projectId, t.id) }
