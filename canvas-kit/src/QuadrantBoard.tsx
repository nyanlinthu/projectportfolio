import { useEffect, useRef, useState } from "react";

// Kanban grouped by urgency (Eisenhower). Columns are the quadrants; cards drag between them (mouse: drag; touch: long-press
// then drag, so the board still scrolls normally). Tap opens the card. Presentational: the host decides what a move means.

export interface BoardColumn { id: string; label: string; hint: string; color: string }
export interface BoardCard {
  id: string;
  title: string;
  col: string;
  chip: { label: string; color: string };
  stateLabel: string;
  stateColor: string;
  /** 0..1 */
  progress: number;
  dates?: string;
  areas?: string[];
  late?: boolean;
  /** swimlane id (e.g. project) and a secondary line (e.g. the gate it belongs to) */
  group?: string;
  sub?: string;
}
export interface BoardGroup { id: string; label: string; color: string }

const SLOP = 6, HOLD_MS = 260;

export function QuadrantBoard({ columns, cards, groups, selectedId, onSelect, onMove, onAdd, note }: {
  columns: BoardColumn[]; cards: BoardCard[]; groups?: BoardGroup[]; selectedId?: string | null;
  onSelect: (id: string) => void; onMove: (id: string, col: string, group?: string) => void; onAdd?: (col: string, group?: string) => void; note?: string;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; w: number; over: string | null } | null>(null);
  const st = useRef<{ id: string; px: number; py: number; ox: number; oy: number; w: number; started: boolean; timer: number; pointerType: string } | null>(null);
  const dragging = useRef(false);

  // while dragging, stop the page/board from scrolling under the finger
  useEffect(() => {
    const block = (e: TouchEvent) => { if (dragging.current) e.preventDefault(); };
    window.addEventListener("touchmove", block, { passive: false });
    return () => window.removeEventListener("touchmove", block);
  }, []);

  const colAt = (x: number, y: number) => (document.elementsFromPoint(x, y).find((el) => (el as HTMLElement).dataset?.col) as HTMLElement | undefined)?.dataset.col ?? null;

  function begin(el: HTMLElement, e: React.PointerEvent, id: string) {
    const s = st.current!; const r = el.getBoundingClientRect();
    s.started = true; dragging.current = true; s.ox = e.clientX - r.left; s.oy = e.clientY - r.top; s.w = r.width;
    setDrag({ id, x: e.clientX - s.ox, y: e.clientY - s.oy, w: r.width, over: colAt(e.clientX, e.clientY) });
  }
  function down(e: React.PointerEvent<HTMLDivElement>, id: string) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    st.current = { id, px: e.clientX, py: e.clientY, ox: 0, oy: 0, w: 0, started: false, timer: 0, pointerType: e.pointerType };
    if (e.pointerType !== "mouse") st.current.timer = window.setTimeout(() => { if (st.current && !st.current.started) { try { el.setPointerCapture(e.pointerId); } catch { /* noop */ } begin(el, e, id); } }, HOLD_MS);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const s = st.current; if (!s) return;
    const dist = Math.hypot(e.clientX - s.px, e.clientY - s.py);
    if (!s.started) {
      if (s.pointerType === "mouse" && dist > SLOP) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ } begin(e.currentTarget, e, s.id); }
      else if (s.pointerType !== "mouse" && dist > SLOP * 2) { window.clearTimeout(s.timer); st.current = null; } // it was a scroll
      return;
    }
    setDrag({ id: s.id, x: e.clientX - s.ox, y: e.clientY - s.oy, w: s.w, over: colAt(e.clientX, e.clientY) });
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    const s = st.current; if (!s) return;
    window.clearTimeout(s.timer); st.current = null;
    if (s.started) {
      const over = colAt(e.clientX, e.clientY); const card = cards.find((c) => c.id === s.id);
      if (over && card && over !== card.col) onMove(s.id, over);
      dragging.current = false; setDrag(null);
    } else onSelect(s.id);
  }
  function cancel() { if (st.current) window.clearTimeout(st.current.timer); st.current = null; dragging.current = false; setDrag(null); }

  const ghost = drag ? cards.find((c) => c.id === drag.id) : undefined;

  const cardEl = (c: BoardCard, grouped: boolean) => (
    <div key={c.id} onPointerDown={(e) => down(e, c.id)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
      className="rounded-lg bg-slate-800 border p-2.5 select-none cursor-grab"
      style={{ borderColor: selectedId === c.id ? "#F5EFE2" : "#2E4370", borderLeft: `3px solid ${c.stateColor}`, opacity: drag?.id === c.id ? 0.35 : 1, touchAction: "pan-x pan-y" }}>
      <div className="text-[13px] leading-snug text-slate-100">{c.title}</div>
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        {grouped
          ? c.sub && <span className="text-[10px] text-slate-400 underline decoration-slate-600 underline-offset-2">{c.sub}</span>
          : <span className="inline-flex items-center gap-1 text-[10px] text-slate-300"><i className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: c.chip.color }} />{c.chip.label}</span>}
        <span className="text-[10px]" style={{ color: c.stateColor }}>{c.stateLabel}</span>
        {c.late && !/^late/i.test(c.stateLabel) && <span className="text-[10px] font-mono text-[#D9822B]">late</span>}
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.round(c.progress * 100)}%`, background: c.stateColor }} /></div>
      {(c.dates || (c.areas && c.areas.length > 0)) && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {c.dates && <span className="text-[10px] font-mono text-slate-400">{c.dates}</span>}
          {c.areas?.slice(0, 2).map((a) => <span key={a} className="text-[9px] px-1.5 py-0.5 rounded-full border border-slate-600 text-slate-400">{a}</span>)}
        </div>
      )}
    </div>
  );
  const MIN = columns.length * 232;
  const cell = (col: BoardColumn, list: BoardCard[], grouped: boolean, gid?: string) => {
    const over = drag?.over === col.id;
    return (
      <div key={col.id} data-col={col.id} className="flex-1 min-w-[220px] rounded-xl border p-2 space-y-2"
        style={{ background: over ? col.color + "18" : "rgba(27,49,89,.30)", borderColor: over ? col.color : "#2E4370", transition: "background .15s, border-color .15s" }}>
        {list.map((c) => cardEl(c, grouped))}
        {onAdd && <button className="w-full text-left text-[12px] rounded-lg px-2.5 py-2 border border-dashed" style={{ color: col.color, borderColor: col.color + "66" }} onClick={() => onAdd(col.id, gid)}>+ New</button>}
        {list.length === 0 && !onAdd && <div className="text-[11px] text-slate-600 px-1 py-2">{over ? "Drop here" : "Nothing here"}</div>}
      </div>
    );
  };
  const header = (
    <div className="sticky top-0 flex gap-2 px-2 pt-2 pb-1 bg-slate-900" style={{ zIndex: 5, minWidth: MIN }}>
      {columns.map((col) => (
        <div key={col.id} className="flex-1 min-w-[220px] rounded-lg px-3 py-2" style={{ background: col.color + "22" }}>
          <div className="flex items-center gap-2"><span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: col.color }}>{col.label}</span>
            <span className="text-[12px] tabular-nums" style={{ color: col.color }}>{cards.filter((c) => c.col === col.id).length}</span></div>
          <div className="text-[10px] text-slate-500 mt-0.5">{col.hint}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="h-full flex flex-col">
      {note && <div className="shrink-0 px-4 py-1.5 text-[11px] text-slate-400 border-b border-slate-800">{note}</div>}
      <div className="flex-1 min-h-0 overflow-auto">
        {header}
        {groups ? groups.map((g) => {
          const mine = cards.filter((c) => c.group === g.id), open = !folded.has(g.id);
          return (
            <div key={g.id} className="pb-2" style={{ minWidth: MIN }}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button className="text-slate-300 text-xs w-4" onClick={() => setFolded((f) => { const n = new Set(f); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}>{open ? "▼" : "▶"}</button>
                <i className="w-2 h-2 rounded-full inline-block" style={{ background: g.color }} />
                <span className="text-[13px] font-semibold uppercase tracking-wide text-slate-100">{g.label}</span>
                <span className="text-[11px] text-slate-500 tabular-nums">{mine.length}</span>
              </div>
              {open && <div className="flex gap-2 px-2">{columns.map((col) => cell(col, mine.filter((c) => c.col === col.id), true, g.id))}</div>}
            </div>
          );
        }) : <div className="flex gap-2 px-2 pb-2" style={{ minWidth: MIN }}>{columns.map((col) => cell(col, cards.filter((c) => c.col === col.id), false))}</div>}
      </div>
      {drag && ghost && (
        <div className="fixed pointer-events-none rounded-lg bg-slate-700 border p-2.5 shadow-2xl"
          style={{ left: drag.x, top: drag.y, width: drag.w, zIndex: 60, borderColor: "#C9A64B", transform: "rotate(1.5deg) scale(1.03)" }}>
          <div className="text-[13px] leading-snug text-slate-100">{ghost.title}</div>
        </div>
      )}
    </div>
  );
}
