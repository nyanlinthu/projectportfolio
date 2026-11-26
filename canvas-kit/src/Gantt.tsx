import { useMemo } from "react";

// Gantt over the same work-package data as the canvas: project > gate > task rows, planned bars with progress,
// finish-to-start dependency arrows, an "as of" line and late markers. Presentational and read-only: the host
// supplies rows and receives taps. Dates are "YYYY-MM-DD" and are shown WITHOUT a year (the demo data is fictional).

export interface GanttRow {
  id: string;
  label: string;
  kind: "project" | "gate" | "parent" | "task";
  /** indent level for subtasks (2) */
  depth?: number;
  start: string;
  end: string;
  /** 0..1 */
  progress: number;
  color: string;
  late?: boolean;
  /** small text after the label, e.g. phase */
  sub?: string;
  /** project rows: show a chevron */
  open?: boolean;
}
export interface GanttDep { from: string; to: string }

const DAY = 86_400_000;
const ms = (s: string) => Date.parse(s + "T00:00:00Z");
const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
const ROW_H = 38, LABEL_W = 176, HEAD_H = 28, PAD = 4;

export function Gantt({ rows, deps = [], asOf, selectedId, onSelect, onToggle, dayW = 9 }: {
  rows: GanttRow[]; deps?: GanttDep[]; asOf?: string; selectedId?: string | null;
  onSelect?: (id: string) => void; onToggle?: (id: string) => void; dayW?: number;
}) {
  const { t0, days, ticks } = useMemo(() => {
    const lo = Math.min(...rows.map((r) => ms(r.start)), asOf ? ms(asOf) : Infinity) - PAD * DAY;
    const hi = Math.max(...rows.map((r) => ms(r.end)), asOf ? ms(asOf) : -Infinity) + PAD * DAY;
    const days = Math.round((hi - lo) / DAY);
    const ticks: { x: number; label: string }[] = [];
    for (let d = 0; d <= days; d += 7) ticks.push({ x: d * dayW, label: fmt(lo + d * DAY) });
    return { t0: lo, days, ticks };
  }, [rows, asOf, dayW]);
  const x = (s: string) => ((ms(s) - t0) / DAY) * dayW;
  const xe = (s: string) => ((ms(s) - t0) / DAY + 1) * dayW; // end is inclusive
  const W = days * dayW;
  const rowIdx = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  return (
    <div className="h-full overflow-auto bg-slate-900" style={{ touchAction: "pan-x pan-y" }}>
      <div style={{ width: LABEL_W + W + 24, minHeight: "100%", position: "relative" }}>
        {/* week header */}
        <div className="flex sticky top-0 bg-slate-900 border-b border-slate-600" style={{ height: HEAD_H, zIndex: 5 }}>
          <div className="sticky left-0 bg-slate-900 shrink-0" style={{ width: LABEL_W, zIndex: 6 }} />
          <div className="relative" style={{ width: W }}>
            {ticks.map((t, i) => <div key={i} className="absolute top-0 text-[10px] text-slate-500 font-mono pt-1.5 whitespace-nowrap" style={{ left: t.x + 3 }}>{t.label}</div>)}
          </div>
        </div>

        <div className="relative">
          {rows.map((r) => {
            const sx = x(r.start), ex = xe(r.end), w = Math.max(ex - sx, 6);
            const isTask = r.kind === "task", isProj = r.kind === "project", isPar = r.kind === "parent";
            const barH = isProj ? 8 : isTask ? 20 : isPar ? 10 : 12;
            const sel = selectedId === r.id;
            return (
              <div key={r.id} className="flex border-b border-slate-800/80" style={{ height: ROW_H }}>
                <button onClick={() => (isProj ? onToggle?.(r.id) : isTask ? onSelect?.(r.id) : undefined)}
                  className="sticky left-0 shrink-0 bg-slate-900 flex items-center gap-1.5 text-left overflow-hidden border-r border-slate-700"
                  style={{ width: LABEL_W, zIndex: 3, paddingLeft: 8 + (isProj ? 0 : isTask ? (r.depth === 2 ? 40 : 22) : isPar ? 22 : 11) }}>
                  {isProj && <span className="text-slate-400 text-[10px] w-3">{r.open ? "▾" : "▸"}</span>}
                  {r.kind === "gate" && <span className="text-[10px]" style={{ color: r.color }}>◆</span>}
                  <span className={`truncate leading-tight ${isProj ? "text-[12px] font-semibold text-slate-100" : isTask ? "text-[11px] text-slate-300" : isPar ? "text-[11px] font-medium text-slate-100" : "text-[11px] text-slate-200"}`}>{r.label}</span>
                </button>
                <div className="relative" style={{
                  width: W,
                  backgroundImage: "linear-gradient(to right, rgba(138,147,166,.14) 1px, transparent 1px)",
                  backgroundSize: `${7 * dayW}px 100%`,
                }}>
                  <button disabled={!isTask} onClick={() => onSelect?.(r.id)} className="absolute"
                    style={{ left: sx, width: w, height: barH, top: (ROW_H - barH) / 2, borderRadius: isProj || isPar ? 2 : 4, background: r.color + (isProj || isPar ? "99" : "30"),
                      border: `1.5px solid ${r.color}`, outline: sel ? "2px solid #F5EFE2" : undefined, outlineOffset: 1, overflow: "hidden", padding: 0 }}>
                    <span className="absolute inset-y-0 left-0" style={{ width: `${Math.round(r.progress * 100)}%`, background: r.color + (isProj || isPar ? "" : "cc") }} />
                    {isTask && w > 70 && <span className="relative px-1.5 text-[10px] font-medium text-slate-100 whitespace-nowrap">{Math.round(r.progress * 100)}%</span>}
                  </button>
                  {r.late && <span className="absolute text-[10px] font-mono text-[#D9822B]" style={{ left: ex + 4, top: (ROW_H - 12) / 2 }}>late</span>}
                  {r.sub && !isTask && <span className="absolute text-[10px] text-slate-500 whitespace-nowrap" style={{ left: ex + 6, top: (ROW_H - 12) / 2 }}>{r.sub}</span>}
                </div>
              </div>
            );
          })}

          {/* overlay: dependencies + as-of line, aligned to the timeline column */}
          <svg className="absolute pointer-events-none" style={{ left: LABEL_W, top: 0, width: W, height: rows.length * ROW_H, zIndex: 2, overflow: "visible" }}>
            <defs>
              <marker id="gArr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#8A93A6" /></marker>
              <marker id="gArrHi" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#C9A64B" /></marker>
            </defs>
            {asOf && <g><line x1={x(asOf)} x2={x(asOf)} y1={0} y2={rows.length * ROW_H} stroke="#C9A64B" strokeDasharray="4 4" strokeWidth={1.5} />
              <text x={x(asOf) + 4} y={rows.length * ROW_H - 6} fontSize={10} fill="#C9A64B" fontFamily="monospace">as of {fmt(ms(asOf))}</text></g>}
            {deps.map((d) => {
              const a = rowIdx.get(d.from), b = rowIdx.get(d.to);
              if (a === undefined || b === undefined) return null;
              const fa = rows[a], tb = rows[b];
              const x1 = xe(fa.end), y1 = a * ROW_H + ROW_H / 2, x2 = x(tb.start), y2 = b * ROW_H + ROW_H / 2;
              const hi = selectedId === d.from || selectedId === d.to;
              const mx = Math.max(x1 + 10, Math.min(x2 - 10, (x1 + x2) / 2));
              return <path key={d.from + d.to} d={`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`} fill="none" stroke={hi ? "#C9A64B" : "#8A93A6"}
                strokeOpacity={hi ? 1 : 0.4} strokeWidth={hi ? 2 : 1.25} markerEnd={`url(#${hi ? "gArrHi" : "gArr"})`} />;
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
