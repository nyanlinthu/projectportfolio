import { useCanvasDrag } from "./useCanvasDrag";

export interface CanvasNodeData {
  id: string;
  label: string;
  emoji?: string;
  color?: string;
  progress?: number;
  badge?: string;
  kind: "project" | "milestone" | "task";
}

interface Props {
  data: CanvasNodeData;
  selected?: boolean;
  onTap?: () => void;
  onAddChild?: () => void;
  onDrop?: (x: number, y: number) => void;
  posX: number;
  posY: number;
  /** When defined, shows a chevron toggle (milestone expand/collapse). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const KIND_COLOR: Record<string, string> = {
  project: "#38bdf8",
  milestone: "#fbbf24",
  task: "#34d399",
};

export default function CanvasNode({ data, selected, onTap, onAddChild, onDrop, posX, posY, collapsed, onToggleCollapse }: Props) {
  const drag = useCanvasDrag({
    x: posX,
    y: posY,
    onMove: (nx, ny) => onDrop?.(nx, ny),
    onTap: () => onTap?.(),
    liftScale: 1.05,
    baseZ: 10,
  });

  const accentColor = data.color ?? KIND_COLOR[data.kind] ?? "#94a3b8";
  const pct = data.progress ?? 0;

  return (
    <div
      ref={drag.ref}
      className={`canvas-node select-none ${selected ? "ring-2 ring-sky-400 rounded-2xl" : ""}`}
      style={{
        ...drag.style,
        width: data.kind === "task" ? 160 : 180,
        cursor: "grab",
        position: "relative",
      }}
      {...drag.handlers}
    >
      <div className="rounded-2xl bg-slate-800 shadow-lg overflow-hidden" style={{ borderLeft: `4px solid ${accentColor}` }}>
        <div className="px-3 pt-3 pb-2">
          {data.emoji && <div className="text-xl leading-none mb-1">{data.emoji}</div>}
          <div className="text-sm font-medium text-slate-100 leading-snug line-clamp-2">{data.label}</div>
          {data.badge && <div className="mt-1 text-[10px] text-slate-500">{data.badge}</div>}
        </div>
        {pct > 0 && (
          <div className="mx-3 mb-2 h-1 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accentColor }} />
          </div>
        )}
      </div>
      {onToggleCollapse && (
        <button
          className="absolute -bottom-3 -left-3 w-7 h-7 rounded-full bg-slate-700 active:bg-slate-600 text-slate-200 text-xs leading-none flex items-center justify-center shadow-lg"
          style={{ zIndex: 20 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
          title={collapsed ? "Expand tasks" : "Collapse tasks"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      )}
      {onAddChild && (
        <button
          className="absolute -bottom-3 -right-3 w-7 h-7 rounded-full bg-amber-500 active:bg-amber-600 text-white text-base leading-none flex items-center justify-center shadow-lg"
          style={{ zIndex: 20 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onAddChild(); }}
        >+</button>
      )}
    </div>
  );
}
