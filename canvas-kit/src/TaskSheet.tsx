import { useEffect, useLayoutEffect, useRef, useState } from "react";

// lifeos-style task sheet: a bottom sheet over the current view (never a navigation), with title, status,
// progress, dates, knowledge areas, notes and checklists. Presentational: the host owns the data and
// receives every edit through onChange. Same checklist shape as lifeos (ChecklistGroup / ChecklistItem).

export interface ChecklistItem { id: string; text: string; done: boolean; note?: string; /** host-defined links written in the text (e.g. wbs @links) */ links?: { key: string; title: string }[] }
export interface ChecklistGroup { id: string; title: string; items: ChecklistItem[] }

export function AutosizeTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} style={{ resize: "none", overflow: "hidden", ...props.style }} />;
}

const uid = () => Math.random().toString(36).slice(2, 9);

/** Lines of a pasted list, one item each, with bullets ("- ", "• ", "[ ] ") and numbering ("1. ", "2) ") removed. */
export function parseChecklistPaste(text: string): string[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim().replace(/^[◦•∙▪·o*-]\s+/, "").replace(/^\[[ xX]?\]\s*/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean);
}

/** What a host's own item-text field gets: the item, a way to change it, and the default field behaviour. */
export interface ItemTextProps {
  item: ChecklistItem;
  onPatch: (p: Partial<ChecklistItem>) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  className: string;
}

/** `renderItemText` (optional) replaces the plain item textarea, e.g. with one that supports @links. */
export function ChecklistEditor({ groups, onChange, renderItemText }: { groups: ChecklistGroup[]; onChange: (g: ChecklistGroup[]) => void; renderItemText?: (p: ItemTextProps) => React.ReactNode }) {
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const setGroup = (gid: string, fn: (g: ChecklistGroup) => ChecklistGroup) => onChange(groups.map((g) => (g.id === gid ? fn(g) : g)));
  const patchItem = (gid: string, iid: string, p: Partial<ChecklistItem>) => setGroup(gid, (g) => ({ ...g, items: g.items.map((i) => (i.id === iid ? { ...i, ...p } : i)) }));
  const addItem = (gid: string) => {
    const text = (draft[gid] ?? "").trim(); if (!text) return;
    setGroup(gid, (g) => ({ ...g, items: [...g.items, { id: uid(), text, done: false }] }));
    setDraft((d) => ({ ...d, [gid]: "" }));
  };
  /** Cmd/Ctrl+V of several lines adds them all as items (after item `afterId`, or at the end of the list). */
  const pasteLines = (e: React.ClipboardEvent, gid: string, afterId?: string): void => {
    const lines = parseChecklistPaste(e.clipboardData.getData("text"));
    if (lines.length < 2) return; // a single line is ordinary typing: let the field take it
    e.preventDefault();
    const made = lines.map((text) => ({ id: uid(), text, done: false }));
    setGroup(gid, (g) => {
      const at = afterId ? g.items.findIndex((i) => i.id === afterId) + 1 : g.items.length;
      return { ...g, items: [...g.items.slice(0, at), ...made, ...g.items.slice(at)] };
    });
  };
  const duplicate = (gid: string): void => {
    const at = groups.findIndex((g) => g.id === gid);
    const src = groups[at];
    if (!src) return;
    const copy: ChecklistGroup = { ...src, id: uid(), title: src.title ? `${src.title} (copy)` : "", items: src.items.map((i) => ({ ...i, id: uid(), done: false })) };
    onChange([...groups.slice(0, at + 1), copy, ...groups.slice(at + 1)]);
  };
  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const done = g.items.filter((i) => i.done).length;
        return (
          <div key={g.id} className="bg-slate-900/70 rounded-xl p-2.5 space-y-1">
            <div className="flex items-center gap-2">
              <input value={g.title} onChange={(e) => setGroup(g.id, (x) => ({ ...x, title: e.target.value }))} placeholder="Checklist"
                className="flex-1 min-w-0 bg-transparent text-[11px] uppercase tracking-wide text-slate-400 placeholder:text-slate-600 font-medium py-0.5 outline-none" />
              <span className="text-[10px] text-slate-500 tabular-nums">{done}/{g.items.length}</span>
              <button className="text-slate-600 text-xs px-1" title="Duplicate list (unticked)" aria-label="Duplicate list" onClick={() => duplicate(g.id)}>⧉</button>
              <button className="text-slate-600 text-xs px-1" title="Delete list" onClick={() => onChange(groups.filter((x) => x.id !== g.id))}>✕</button>
            </div>
            {g.items.map((i) => (
              <div key={i.id}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={i.done} onChange={(e) => patchItem(g.id, i.id, { done: e.target.checked })} className="mt-1 shrink-0 w-4 h-4 accent-[#C9A64B]" />
                  {renderItemText ? renderItemText({ item: i, onPatch: (p) => patchItem(g.id, i.id, p), onPaste: (e) => pasteLines(e, g.id, i.id),
                    className: `flex-1 min-w-0 bg-transparent text-sm py-0.5 leading-snug outline-none ${i.done ? "line-through text-slate-500" : "text-slate-200"}` }) : (
                  <AutosizeTextarea value={i.text} onChange={(e) => patchItem(g.id, i.id, { text: e.target.value })} onPaste={(e) => pasteLines(e, g.id, i.id)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
                    className={`flex-1 min-w-0 bg-transparent text-sm py-0.5 leading-snug outline-none ${i.done ? "line-through text-slate-500" : "text-slate-200"}`} />)}
                  <button title="Note" className={`shrink-0 px-1 text-xs ${i.note || noteOpen[i.id] ? "text-[#C9A64B]" : "text-slate-600"}`} onClick={() => setNoteOpen((n) => ({ ...n, [i.id]: !n[i.id] }))}>✎</button>
                  <button className="shrink-0 text-slate-600 text-xs px-1" onClick={() => setGroup(g.id, (x) => ({ ...x, items: x.items.filter((y) => y.id !== i.id) }))}>✕</button>
                </div>
                {(noteOpen[i.id] || i.note) && (
                  <input value={i.note ?? ""} onChange={(e) => patchItem(g.id, i.id, { note: e.target.value || undefined })} placeholder="Note…"
                    className="ml-6 mt-0.5 block w-[calc(100%-1.5rem)] bg-slate-950/60 rounded px-2 py-1 text-xs text-[#E4D5A8] placeholder:text-slate-600 outline-none" />
                )}
              </div>
            ))}
            <input value={draft[g.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [g.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && addItem(g.id)}
              onPaste={(e) => pasteLines(e, g.id)}
              onBlur={() => addItem(g.id)} placeholder="+ Add item, or paste a list" className="w-full bg-transparent text-sm text-slate-300 placeholder:text-slate-600 py-1 outline-none" />
          </div>
        );
      })}
      <button className="text-xs text-slate-400 border border-slate-700 rounded-lg px-2.5 py-1.5 active:bg-slate-800" onClick={() => onChange([...groups, { id: uid(), title: "", items: [] }])}>+ New checklist</button>
    </div>
  );
}

// ---- the sheet -------------------------------------------------------------------------------------------
export interface SheetStatus { id: string; name: string; color: string }
export interface SheetLink { id: string; title: string; note?: string }
export interface SheetQuadrant { id: string; label: string; color: string }
export interface SheetTask {
  id: string;
  title: string;
  breadcrumb: string;
  status: string;
  statuses: SheetStatus[];
  stateLabel: string;
  stateColor: string;
  /** 0..1 */
  progress: number;
  /** true: progress comes from the checklist, so manual progress chips are hidden */
  progressFromChecklist: boolean;
  notes: string;
  checklists: ChecklistGroup[];
  start?: string;
  end?: string;
  phase?: string;
  areas: string[];
  allAreas: string[];
  /** Eisenhower disposition + whether it was auto-sorted (until the user picks one) */
  quadrants?: SheetQuadrant[];
  quadrant?: string;
  quadrantAuto?: boolean;
  needsFirst: SheetLink[];
  unblocks: SheetLink[];
  /** e.g. "5 days past planned end" */
  warning?: string;
}
export type SheetPatch = Partial<Pick<SheetTask, "title" | "notes" | "checklists" | "start" | "end" | "areas" | "quadrant">> & { status?: string; progress?: number };

/**
 * layout "modal": dimmed overlay (blocks the page behind it).
 * layout "panel": NO overlay. The host docks it beside/below the canvas, so the view behind stays pannable, zoomable
 * and tappable while a task is open. (The modal made navigation impossible until you closed it.)
 */
export function TaskSheet({ task, onChange, onClose, onJump, layout = "modal", onDelete, collapsed, onToggleCollapse }: {
  task: SheetTask; onChange: (p: SheetPatch) => void; onClose: () => void; onJump?: (id: string) => void;
  layout?: "modal" | "panel"; onDelete?: () => void; collapsed?: boolean; onToggleCollapse?: () => void;
}) {
  const [full, setFull] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setConfirmDel(false); }, [task.id]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && (full ? setFull(false) : onClose()); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [full, onClose]);
  const pct = Math.round(task.progress * 100);
  const toggleArea = (a: string) => onChange({ areas: task.areas.includes(a) ? task.areas.filter((x) => x !== a) : [...task.areas, a] });
  const panel = layout === "panel";

  const header = (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0 text-[11px] text-slate-500 truncate">{collapsed ? task.title : `${task.breadcrumb}${task.phase ? ` · ${task.phase}` : ""}`}</div>
      {panel && onToggleCollapse && <button className="md:hidden text-slate-400 text-base px-2" title={collapsed ? "Expand" : "Peek: show more of the canvas"} onClick={onToggleCollapse}>{collapsed ? "⌃" : "⌄"}</button>}
      {!panel && <button className="text-slate-500 text-base px-2" title={full ? "Back to sheet" : "Full screen"} onClick={() => setFull(!full)}>{full ? "⤡" : "⤢"}</button>}
      <button className="text-slate-400 text-lg px-2" onClick={onClose} aria-label="Close">✕</button>
    </div>
  );

  const body = (
    <>
      <AutosizeTextarea value={task.title} onChange={(e) => onChange({ title: e.target.value })} className="w-full bg-transparent font-serif text-xl font-semibold text-slate-100 leading-snug outline-none" />

      <div className="flex flex-wrap gap-1.5">
        {task.statuses.map((s) => (
          <button key={s.id} onClick={() => onChange({ status: s.id })}
            className="px-3 py-1.5 rounded-full text-xs font-medium border"
            style={task.status === s.id ? { background: s.color + "33", color: s.color, borderColor: s.color } : { color: "#8A93A6", borderColor: "#2E4370" }}>{s.name}</button>
        ))}
        <span className="ml-auto self-center text-[11px]" style={{ color: task.stateColor }}>{task.stateLabel}</span>
      </div>

      {task.quadrants && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Urgency (Eisenhower){task.quadrantAuto ? " · auto-sorted, tap to override" : ""}</div>
          <div className="flex flex-wrap gap-1.5">
            {task.quadrants.map((q) => (
              <button key={q.id} onClick={() => onChange({ quadrant: q.id })} className="px-2.5 py-1 rounded-full text-[11px] border"
                style={task.quadrant === q.id ? { background: q.color + "30", color: q.color, borderColor: q.color } : { color: "#8A93A6", borderColor: "#2E4370" }}>{q.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-slate-900/70 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Progress{task.progressFromChecklist ? " (from checklist)" : ""}</span>
          <span className="text-slate-200 tabular-nums">{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: task.stateColor, transition: "width .3s" }} /></div>
        {!task.progressFromChecklist && (
          <div className="flex gap-1.5 pt-1">
            {[0, 25, 50, 75, 100].map((v) => (
              <button key={v} onClick={() => onChange({ progress: v / 100 })} className={`flex-1 py-1.5 rounded-lg text-xs border ${pct === v ? "border-[#C9A64B] text-[#C9A64B]" : "border-slate-700 text-slate-400"}`}>{v}%</button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["start", "end"] as const).map((k) => (
          <label key={k} className="bg-slate-900/70 rounded-xl px-3 py-2 block">
            <span className="block text-[10px] uppercase tracking-wide text-slate-500">{k === "start" ? "Planned start" : "Planned end"}</span>
            <input type="date" value={task[k] ?? ""} onChange={(e) => onChange({ [k]: e.target.value })} className="w-full bg-transparent text-sm text-slate-200 outline-none [color-scheme:dark]" />
          </label>
        ))}
      </div>
      {task.warning && <div className="text-xs text-[#D9822B]">⚠ {task.warning}</div>}

      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Knowledge areas</div>
        <div className="flex flex-wrap gap-1.5">
          {task.allAreas.map((a) => (
            <button key={a} onClick={() => toggleArea(a)} className={`px-2.5 py-1 rounded-full text-[11px] border ${task.areas.includes(a) ? "border-[#C9A64B] text-[#C9A64B] bg-[#C9A64B]/10" : "border-slate-700 text-slate-500"}`}>{a}</button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Notes</div>
        <AutosizeTextarea value={task.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Write notes…"
          className="w-full min-h-[3.5rem] bg-slate-900/70 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 leading-relaxed outline-none" />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">Checklist</div>
        <ChecklistEditor groups={task.checklists} onChange={(g) => onChange({ checklists: g })} />
      </div>

      {(task.needsFirst.length > 0 || task.unblocks.length > 0) && (
        <div className="space-y-2">
          {([["Needs first", task.needsFirst], ["Unblocks", task.unblocks]] as const).map(([label, list]) => list.length > 0 && (
            <div key={label}>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
              <div className="flex flex-wrap gap-1.5">
                {list.map((l) => (
                  <button key={l.id} onClick={() => onJump?.(l.id)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-900/70 text-slate-300 border border-slate-700 text-left">
                    {l.title}{l.note ? <span className="text-slate-500"> · {l.note}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {onDelete && (
        <div className="pt-2">
          {!confirmDel
            ? <button className="text-xs text-[#e8a39b] border border-[#5a2a30] rounded-lg px-3 py-2" onClick={() => setConfirmDel(true)}>Delete task</button>
            : <div className="flex items-center gap-2 text-xs"><span className="text-[#e8a39b]">Delete this task and its links?</span>
                <button className="rounded-lg px-3 py-2 bg-[#C0392B] text-white" onClick={onDelete}>Delete</button>
                <button className="rounded-lg px-3 py-2 border border-slate-600 text-slate-300" onClick={() => setConfirmDel(false)}>Keep</button></div>}
        </div>
      )}
    </>
  );

  if (panel) {
    return (
      <div className="h-full overflow-y-auto bg-slate-950 p-3 space-y-3 pb-8" data-testid="task-panel">
        {header}
        {!collapsed && body}
      </div>
    );
  }
  return (
    <div className={`fixed inset-0 flex ${full ? "" : "bg-black/60 items-end"}`} style={{ zIndex: 50 }} onClick={full ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={full ? "bg-slate-950 w-full h-full overflow-y-auto p-3 space-y-3 pb-8" : "bg-slate-950 w-full max-w-2xl mx-auto rounded-t-3xl p-3 space-y-3 max-h-[92vh] overflow-y-auto pb-8"}>
        {header}
        {body}
      </div>
    </div>
  );
}
