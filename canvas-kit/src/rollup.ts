// Roll-up engine: Operator -> Task -> Milestone -> Project -> Portfolio. Pure functions, no I/O.
//
// Design rules (from the OpenProject evaluation brief):
//  - Completion and health are SEPARATE. 80% done can still be at risk.
//  - Progress is DERIVED from task status. Nothing here stores a percentage.
//  - A task counts fully only when `done`. Partial credit exists ONLY when there is evidence: `progress` (0..1),
//    which the app derives from checked checklist items. A bare `doing` is worth 0.
//  - Dates: a task that is not done and whose `end` is before `asOf` is LATE (schedule health), whatever its %.
//  - Weight (1-5) means "how much this gates the outcome", not effort.

export type Status = "backlog" | "doing" | "blocked" | "done";

export interface RTask {
  id: string;
  status: Status;
  weight: number;
  /** finish-to-start predecessors (task ids) */
  after: string[];
  /** 0..1 evidence-based partial progress (e.g. checklist ratio). Ignored once status is `done`. */
  progress?: number;
  /** planned window, "YYYY-MM-DD" */
  start?: string;
  end?: string;
  /** id of the parent task. A task that has subtasks is a CONTAINER: it is never counted itself, its state and
   *  progress derive from its subtasks (leaves), so nothing is counted twice. */
  parent?: string;
}
export interface RMilestone { id: string; gate?: boolean; tasks: RTask[] }
export interface RProject { id: string; milestones: RMilestone[] }
export interface RPortfolio { projects: RProject[] }

/** Derived, per task. */
export type TaskState =
  | "done"
  | "doing"
  | "blocked"        // explicitly marked blocked
  | "ready"          // backlog, every predecessor done: can start now
  | "late"           // not done and planned end is before asOf
  | "waiting"        // backlog, a predecessor is not done
  | "out-of-sequence"; // doing/done while a predecessor is NOT done (e.g. a reopened upstream task)

export type Health = "on-track" | "at-risk" | "blocked";

export interface Progress { done: number; total: number; weightDone: number; weightTotal: number; pct: number }
export interface MilestoneResult extends Progress { id: string; gateOpen: boolean | null; health: Health }
export interface ProjectResult extends Progress { id: string; health: Health; milestones: Record<string, MilestoneResult> }
export interface RollupOptions { asOf?: string }
export interface RollupResult {
  portfolio: Progress & { health: Health };
  projects: Record<string, ProjectResult>;
  taskState: Record<string, TaskState>;
  /** days past planned end, for late tasks */
  lateDays: Record<string, number>;
  /** 0..1 credit each task contributes (done = 1) */
  credit: Record<string, number>;
  /** Tasks that can be started right now, heaviest first: what to pull next. */
  ready: string[];
}

const worst = (hs: Health[]): Health => (hs.includes("blocked") ? "blocked" : hs.includes("at-risk") ? "at-risk" : "on-track");

export const credit = (t: RTask) => (t.status === "done" ? 1 : Math.max(0, Math.min(1, t.progress ?? 0)));

function progress(tasks: RTask[]): Progress {
  let done = 0, weightDone = 0, weightTotal = 0;
  for (const t of tasks) {
    weightTotal += t.weight;
    weightDone += t.weight * credit(t);
    if (t.status === "done") done++;
  }
  return { done, total: tasks.length, weightDone, weightTotal, pct: weightTotal ? Math.round((weightDone / weightTotal) * 100) : 0 };
}

const DAY = 86_400_000;
const ymd = (s?: string) => (s ? Date.parse(s + "T00:00:00Z") : NaN);

export function rollup(p: RPortfolio, opts: RollupOptions = {}): RollupResult {
  const asOf = ymd(opts.asOf);
  const all = p.projects.flatMap((pr) => pr.milestones.flatMap((m) => m.tasks));
  const byId = new Map(all.map((t) => [t.id, t]));
  const kids = new Map<string, RTask[]>();
  for (const t of all) if (t.parent) kids.set(t.parent, [...(kids.get(t.parent) ?? []), t]);
  const isParent = (t: RTask) => kids.has(t.id);
  const leaves = all.filter((t) => !isParent(t));
  // effective status: leaves as recorded; a container is done when all its subtasks are, blocked if any is,
  // doing once any has started, else backlog
  const eff = new Map<string, Status>();
  const effStatus = (t: RTask): Status => {
    if (eff.has(t.id)) return eff.get(t.id)!;
    let st: Status = t.status;
    if (isParent(t)) {
      const ks = kids.get(t.id)!.map(effStatus);
      st = ks.every((k) => k === "done") ? "done" : ks.includes("blocked") ? "blocked" : ks.some((k) => k === "done" || k === "doing") ? "doing" : "backlog";
    }
    eff.set(t.id, st); return st;
  };
  all.forEach(effStatus);
  const leafCredit = (t: RTask): number => (isParent(t) ? 0 : credit(t));
  const containerCredit = (t: RTask): number => { const ks = kids.get(t.id)!; const w = ks.reduce((n, k) => n + k.weight, 0); return w ? ks.reduce((n, k) => n + k.weight * (isParent(k) ? containerCredit(k) : leafCredit(k)), 0) / w : 0; };
  const predsDone = (t: RTask) => t.after.every((a) => (byId.has(a) ? effStatus(byId.get(a)!) === "done" : false));

  const taskState: Record<string, TaskState> = {};
  const lateDays: Record<string, number> = {};
  for (const t of leaves) {
    const ok = predsDone(t);
    const endMs = ymd(t.end);
    const late = t.status !== "done" && !isNaN(asOf) && !isNaN(endMs) && endMs < asOf;
    if (late) lateDays[t.id] = Math.round((asOf - endMs) / DAY);
    taskState[t.id] =
      t.status === "blocked" ? "blocked"
      : (t.status === "done" || t.status === "doing") && !ok ? "out-of-sequence"
      : late ? "late"
      : t.status === "done" ? "done"
      : t.status === "doing" ? "doing"
      : ok ? "ready" : "waiting";
  }
  // a container shows its worst subtask condition, else its derived status
  const rank: Record<TaskState, number> = { blocked: 6, "out-of-sequence": 5, late: 4, doing: 3, ready: 2, waiting: 1, done: 0 };
  const containerState = (t: RTask): TaskState => {
    const ks = kids.get(t.id)!;
    const ss = ks.map((k) => (isParent(k) ? containerState(k) : taskState[k.id]));
    const eS = effStatus(t);
    if (eS === "done") return "done";
    const worst = ss.reduce((a, b) => (rank[b] > rank[a] ? b : a));
    return ["blocked", "out-of-sequence", "late"].includes(worst) ? worst : eS === "doing" ? "doing" : ss.includes("ready") ? "ready" : "waiting";
  };
  for (const t of all) if (isParent(t)) taskState[t.id] = containerState(t);
  for (const t of all) if (isParent(t)) { const ks = kids.get(t.id)!.map((k) => lateDays[k.id] ?? 0); const m = Math.max(0, ...ks); if (m) lateDays[t.id] = m; }
  const taskHealth = (t: RTask): Health =>
    taskState[t.id] === "blocked" ? "blocked" : taskState[t.id] === "out-of-sequence" || taskState[t.id] === "late" ? "at-risk" : "on-track";

  const projects: Record<string, ProjectResult> = {};
  for (const pr of p.projects) {
    const milestones: Record<string, MilestoneResult> = {};
    for (const m of pr.milestones) {
      const pg = progress(m.tasks.filter((t) => !isParent(t)));
      milestones[m.id] = {
        id: m.id, ...pg,
        gateOpen: m.gate ? pg.done < pg.total : null,
        health: worst(m.tasks.filter((t) => !isParent(t)).map(taskHealth)),
      };
    }
    const tasks = pr.milestones.flatMap((m) => m.tasks.filter((t) => !isParent(t)));
    projects[pr.id] = { id: pr.id, ...progress(tasks), health: worst(Object.values(milestones).map((m) => m.health)), milestones };
  }
  const allProgress = progress(leaves);
  return {
    portfolio: { ...allProgress, health: worst(Object.values(projects).map((x) => x.health)) },
    projects,
    taskState,
    lateDays,
    credit: Object.fromEntries(all.map((t) => [t.id, isParent(t) ? containerCredit(t) : credit(t)])),
    ready: leaves.filter((t) => taskState[t.id] === "ready").sort((a, b) => b.weight - a.weight).map((t) => t.id),
  };
}

/** Immutable status change, for the demo's "mark done" (nothing is persisted). */
export function setStatus<T extends RPortfolio>(p: T, taskId: string, status: Status): T {
  return {
    ...p,
    projects: p.projects.map((pr) => ({
      ...pr,
      milestones: pr.milestones.map((m) => ({ ...m, tasks: m.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)) })),
    })),
  };
}
