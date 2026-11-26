import { useContext, useLayoutEffect, useRef, useState } from "react";
import { CANVAS_DRAG_EVENT, CanvasZoomContext } from "./useCanvasDrag";

interface Connection {
  fromId: string;
  toId: string;
  /** "dep" = a finish-to-start dependency: drawn dashed and amber so it reads differently from hierarchy. */
  kind?: "dep";
  /** Optional highlight colour (e.g. an expanded branch). Highlighted lines draw on top. */
  color?: string;
  /** Fade this line back, e.g. while something else is highlighted. */
  dim?: boolean;
}

interface ConnectionLinesProps {
  connections: Connection[];
  // Pass positions so we re-render whenever a node moves
  positions: Record<string, { x: number; y: number }>;
  /** "down" (default, lifeos): parent bottom -> child top. "right": parent right edge -> child left edge (left-to-right trees). */
  direction?: "down" | "right";
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Node box in **canvas units** (the SVG's own coordinate space). Client rects
 *  come back in screen pixels, i.e. already multiplied by the canvas zoom — not
 *  dividing it back out drew every path at `position * zoom`, so the lines flew
 *  off the cards as soon as you pinched or wheel-zoomed. */
function getCanvasRect(id: string, zoom: number): Rect | null {
  const el = document.querySelector(`[data-canvas-id="${id}"]`);
  if (!el) return null;
  const parent = el.closest(".canvas-inner");
  if (!parent) return null;
  const elRect = el.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const z = zoom || 1;
  return {
    x: (elRect.left - parentRect.left) / z,
    y: (elRect.top - parentRect.top) / z,
    w: elRect.width / z,
    h: elRect.height / z,
  };
}

export default function ConnectionLines({ connections, positions, direction = "down" }: ConnectionLinesProps) {
  const [paths, setPaths] = useState<{ key: string; d: string; dep?: boolean; color?: string; dim?: boolean }[]>([]);
  const rafRef = useRef<number>(0);
  const zoomRef = useContext(CanvasZoomContext);

  useLayoutEffect(() => {
    if (connections.length === 0) { setPaths([]); return; }
    const compute = () => {
      const next: { key: string; d: string; dep?: boolean; color?: string; dim?: boolean }[] = [];
      for (const { fromId, toId, kind, color, dim } of connections) {
        const from = getCanvasRect(fromId, zoomRef.current);
        const to = getCanvasRect(toId, zoomRef.current);
        if (!from || !to) continue;
        let d: string;
        if (direction === "right") {
          const sx = from.x + from.w, sy = from.y + from.h / 2;
          const ex = to.x, ey = to.y + to.h / 2;
          const cx = (sx + ex) / 2;
          d = `M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ey}, ${ex} ${ey}`;
        } else {
          const sx = from.x + from.w / 2;
          const sy = from.y + from.h;
          const ex = to.x + to.w / 2;
          const ey = to.y;
          const cy = (sy + ey) / 2;
          d = `M ${sx} ${sy} C ${sx} ${cy}, ${ex} ${cy}, ${ex} ${ey}`;
        }
        next.push({ key: `${fromId}-${toId}${kind ? "-" + kind : ""}`, d, dep: kind === "dep", color, dim });
      }
      setPaths(next);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(compute);

    // While a node is being dragged its transform is written straight to the
    // DOM (no re-render), so recompute off the drag pulse — already at most
    // one per frame — to keep the lines glued to the card.
    window.addEventListener(CANVAS_DRAG_EVENT, compute);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener(CANVAS_DRAG_EVENT, compute);
    };
  // positions object reference changes on every setPos call → triggers recompute
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(connections), positions, direction]);

  if (paths.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "4000px", height: "4000px", overflow: "visible" }}
    >
      {[...paths].sort((a, b) => (a.color ? 1 : 0) - (b.color ? 1 : 0)).map(({ key, d, dep, color, dim }) => (
        <path
          key={key}
          d={d}
          fill="none"
          stroke={color ?? (dep ? "#fbbf24" : "#475569")}
          strokeWidth={color ? 2.5 : dep ? 2.5 : 2}
          strokeOpacity={dim ? 0.2 : color ? 0.95 : dep ? 0.95 : 0.6}
          style={{ transition: "stroke 200ms, stroke-opacity 200ms" }}
          strokeDasharray={dep ? "7 5" : undefined}
        />
      ))}
    </svg>
  );
}
