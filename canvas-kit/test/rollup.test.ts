import assert from "node:assert/strict";
import { rollup, setStatus } from "../src/rollup";
const asOf = "2026-05-04";
const T = (id: string, status: any, weight = 3, after: string[] = [], extra: any = {}) => ({ id, status, weight, after, start: "2026-05-10", end: "2026-06-10", ...extra });
// fixture: project X (gates G1, G2) and project Y. P1 is a container with two subtasks.
const fx: any = { projects: [
  { id: "X", milestones: [
    { id: "G1", gate: true, tasks: [T("a", "done"), T("P1", "backlog"), T("p1a", "done", 3, ["a"], { parent: "P1" }), T("p1b", "doing", 3, ["p1a"], { parent: "P1" })] },
    { id: "G2", gate: true, tasks: [T("b", "backlog", 4, ["p1b"]), T("c", "backlog", 2, ["b"])] } ] },
  { id: "Y", milestones: [{ id: "G3", gate: true, tasks: [T("y1", "done"), T("y2", "done", 3, ["y1"])] }] } ] };
const R = (p: any) => rollup(p, { asOf });
const r0 = R(fx);
// 1. containers are never counted: leaves a,p1a,p1b,b,c,y1,y2 = 7
assert.equal(r0.portfolio.total, 7); assert.equal(r0.projects.X.total, 5);
// 2. container state derives from subtasks; progress is the weighted share of its leaves
assert.equal(r0.taskState["P1"], "doing"); assert.equal(R(setStatus(fx, "p1b", "done")).taskState["P1"], "done");
// 3. finishing a task moves task -> gate -> project -> portfolio
const r1 = R(setStatus(fx, "p1b", "done"));
assert.ok(r1.projects.X.milestones.G1.pct > r0.projects.X.milestones.G1.pct && r1.projects.X.pct > r0.projects.X.pct && r1.portfolio.pct > r0.portfolio.pct);
assert.equal(r1.projects.X.milestones.G1.gateOpen, false, "gate closes when its leaves are done");
// 4. dependencies: waiting vs ready, and finishing a predecessor releases the next task
assert.equal(r0.taskState["b"], "waiting"); assert.equal(r1.taskState["b"], "ready"); assert.ok(r1.ready.includes("b"));
// 5. reopening upstream flags downstream done/doing work as out-of-sequence (a schedule risk, not progress)
const r2 = R(setStatus(fx, "a", "backlog"));
assert.equal(r2.taskState["p1a"], "out-of-sequence"); assert.equal(r2.projects.X.health, "at-risk");
// 6. blocked beats a high percentage; completion != health
const r3 = R(setStatus(fx, "y2", "blocked")); assert.equal(r3.projects.Y.health, "blocked"); assert.equal(r3.projects.Y.pct, 50);
// 7. dates: late is schedule health, independent of %; finishing clears it
const late = { ...fx, projects: [{ ...fx.projects[0], milestones: [{ ...fx.projects[0].milestones[0], tasks: fx.projects[0].milestones[0].tasks.map((t: any) => t.id === "p1b" ? { ...t, end: "2026-05-01" } : t) }, fx.projects[0].milestones[1]] }, fx.projects[1]] };
const r4 = R(late); assert.equal(r4.taskState["p1b"], "late"); assert.equal(r4.lateDays["p1b"], 3); assert.equal(r4.taskState["P1"], "late");
assert.notEqual(R(setStatus(late, "p1b", "done")).taskState["p1b"], "late");
// 8. evidence-based partial credit moves the %, a bare 'doing' does not
const prog = { ...fx, projects: [{ ...fx.projects[0], milestones: [fx.projects[0].milestones[0], { ...fx.projects[0].milestones[1], tasks: fx.projects[0].milestones[1].tasks.map((t: any) => t.id === "b" ? { ...t, progress: 0.5 } : t) }] }, fx.projects[1]] };
assert.ok(R(prog).projects.X.pct > r0.projects.X.pct); assert.equal(R(setStatus(fx, "b", "doing")).projects.X.pct, r0.projects.X.pct);
// 9. pure: input not mutated
assert.equal(fx.projects[0].milestones[0].tasks[3].status, "doing");

console.log("all rollup tests passed");
