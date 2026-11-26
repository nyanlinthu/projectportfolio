import { useContext, useRef, createContext, PointerEvent as ReactPointerEvent } from "react";

/** Live zoom of the enclosing MobileCanvas, as a ref so draggables can read it
 *  at pointer time without re-rendering on every pinch/wheel tick. Defaults to
 *  1 for anything rendered outside a canvas. */
export const CanvasZoomContext = createContext<{ current: number }>({ current: 1 });

/** Fired on `window` (rAF-coalesced) while a canvas item is being dragged, so
 *  ConnectionLines can follow the node without prop-drilling live positions. */
export const CANVAS_DRAG_EVENT = "lifeos:canvas-drag";

const TAP_SLOP = 4;

interface Options {
  /** Current committed position, in canvas units. */
  x: number;
  y: number;
  /** Called once on release with the new canvas-unit position. */
  onMove: (x: number, y: number) => void;
  /** Called on release when the pointer never left the tap slop. */
  onTap?: () => void;
  /** Scale applied while dragging (visual lift). */
  liftScale?: number;
  /** z-index while dragging. */
  dragZ?: number;
  /** Resting z-index. */
  baseZ?: number;
  /** Spring feel (wbs values: tension 300, friction 30). Pass `false` for a rigid drag. Ignored under prefers-reduced-motion. */
  spring?: false | { tension?: number; friction?: number };
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Pointer dragging for every canvas item (task/milestone/project nodes,
 * freeform text & images, cross-module cards) — one implementation so the
 * feel is identical everywhere and only one file changes when it's tuned.
 *
 * Two things it does that the old per-component copies didn't:
 * - **Zoom-correct.** The canvas content lives inside a `scale(zoom)` wrapper,
 *   so a raw screen delta moves the card by `delta * zoom` on screen while the
 *   committed position was written in canvas units — the card drifted away
 *   from the finger and landed somewhere else on release at any zoom ≠ 1.
 *   Screen deltas are divided by the live zoom here.
 * - **No React state per pointermove.** The transform is written straight to
 *   the node inside one rAF per frame; React only re-renders once, on release.
 */
export function useCanvasDrag({ x, y, onMove, onTap, liftScale = 1.03, dragZ = 50, baseZ, spring }: Options) {
  const zoomRef = useContext(CanvasZoomContext);
  const nodeRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ px: number; py: number } | null>(null);
  /** The element the transform is written to. For canvas nodes that's the
   *  positioned `[data-canvas-id]` wrapper, not the inner card — ConnectionLines
   *  measures the wrapper, so moving only the card left the lines anchored at
   *  the old spot until the drop committed. */
  const movedEl = useRef<HTMLElement | null>(null);
  const delta = useRef({ dx: 0, dy: 0 });
  const moved = useRef(false);
  const raf = useRef(0);

  // --- spring state (plain refs: the whole animation lives outside React) ---------------------
  const cfg = spring === false ? null : { tension: 300, friction: 30, ...(spring ?? {}) };
  const sp = useRef({ x: 0, y: 0, vx: 0, vy: 0, s: 1, vs: 0, tx: 0, ty: 0, ts: 1, last: 0, settling: false });

  function clearStyles() {
    const el = movedEl.current;
    movedEl.current = null;
    if (!el) return;
    el.style.transform = "";
    el.style.transition = "";
    el.style.willChange = "";
    el.style.zIndex = baseZ == null ? "" : String(baseZ);
  }

  /** Semi-implicit Euler in fixed sub-steps: stable for tension 300 / friction 30 at any frame rate. */
  function step(now: number) {
    raf.current = 0;
    const el = movedEl.current;
    const c = sp.current;
    if (!el || !cfg) return;
    let dt = Math.min((now - (c.last || now)) / 1000, 0.05);
    c.last = now;
    const h = 1 / 240;
    while (dt > 0) {
      const d = Math.min(h, dt); dt -= d;
      c.vx += (-cfg.tension * (c.x - c.tx) - cfg.friction * c.vx) * d; c.x += c.vx * d;
      c.vy += (-cfg.tension * (c.y - c.ty) - cfg.friction * c.vy) * d; c.y += c.vy * d;
      c.vs += (-cfg.tension * (c.s - c.ts) - cfg.friction * c.vs) * d; c.s += c.vs * d;
    }
    el.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s})`;
    window.dispatchEvent(new Event(CANVAS_DRAG_EVENT));
    const rest = Math.abs(c.x - c.tx) < 0.05 && Math.abs(c.y - c.ty) < 0.05 && Math.abs(c.s - c.ts) < 0.0005
      && Math.abs(c.vx) < 0.05 && Math.abs(c.vy) < 0.05 && Math.abs(c.vs) < 0.005;
    if (rest && c.settling) { c.settling = false; clearStyles(); window.dispatchEvent(new Event(CANVAS_DRAG_EVENT)); return; }
    raf.current = requestAnimationFrame(step);
  }

  function paint() {
    raf.current = 0;
    const el = movedEl.current;
    if (!el) return;
    el.style.transform = `translate(${delta.current.dx}px, ${delta.current.dy}px) scale(${liftScale})`;
    window.dispatchEvent(new Event(CANVAS_DRAG_EVENT));
  }

  function schedule() {
    if (raf.current) return;
    raf.current = requestAnimationFrame(cfg && !prefersReducedMotion() ? step : paint);
  }
  const springOn = () => !!cfg && !prefersReducedMotion();

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    // A previous settle may still be running: finish it instantly, then start clean.
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    if (sp.current.settling) { sp.current.settling = false; clearStyles(); }
    start.current = { px: e.clientX, py: e.clientY };
    delta.current = { dx: 0, dy: 0 };
    moved.current = false;
    movedEl.current =
      (nodeRef.current?.closest("[data-canvas-id]") as HTMLElement | null) ?? nodeRef.current;
    const el = movedEl.current;
    if (el) {
      el.style.transition = "none";
      el.style.willChange = "transform";
      el.style.zIndex = String(dragZ);
    }
    sp.current = { x: 0, y: 0, vx: 0, vy: 0, s: 1, vs: 0, tx: 0, ty: 0, ts: liftScale, last: 0, settling: false };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const zoom = zoomRef.current || 1;
    const sdx = e.clientX - start.current.px;
    const sdy = e.clientY - start.current.py;
    if (!moved.current && (Math.abs(sdx) > TAP_SLOP || Math.abs(sdy) > TAP_SLOP)) moved.current = true;
    if (!moved.current) return;
    // Screen pixels → canvas units, so the card stays glued to the finger at
    // any zoom and the committed position matches where it was dropped.
    delta.current = { dx: sdx / zoom, dy: sdy / zoom };
    sp.current.tx = delta.current.dx; sp.current.ty = delta.current.dy;
    schedule();
  }

  function onPointerUp() {
    if (!start.current) return;
    start.current = null;
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    const fx = delta.current.dx, fy = delta.current.dy;
    if (moved.current) {
      // Commit the final position now (lines and store see the true spot at once)...
      onMove(x + fx, y + fy);
      if (springOn() && movedEl.current) {
        // ...then let the visual offset spring to zero. After the re-render the element's left/top
        // already equals the drop point, so the leftover offset is (shown - final), settling to 0
        // while the lift scale relaxes to 1: the "floating" settle.
        const c = sp.current;
        c.x -= fx; c.y -= fy; c.tx = 0; c.ty = 0; c.ts = 1; c.settling = true; c.last = 0;
        movedEl.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s})`;
        schedule();
      } else clearStyles();
    } else {
      clearStyles();
      onTap?.();
    }
    moved.current = false;
    delta.current = { dx: 0, dy: 0 };
  }

  return {
    ref: nodeRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    /** Spread onto the dragged element. */
    style: { touchAction: "none" as const, zIndex: baseZ },
  };
}
