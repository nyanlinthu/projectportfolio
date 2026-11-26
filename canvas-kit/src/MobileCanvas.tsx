import { useRef, useState, ReactNode, PointerEvent, useImperativeHandle, forwardRef, useEffect, useCallback } from "react";
import { CanvasZoomContext } from "./useCanvasDrag";

export interface CanvasHandle {
  pan: { x: number; y: number };
  zoom: number;
  /** Move/zoom the view programmatically (e.g. keep a node under the finger when the layout reflows). */
  /** Pass `animateMs` to glide there (CSS transition on the canvas transform) instead of jumping. */
  setView: (v: Partial<{ x: number; y: number; zoom: number }>, opts?: { animateMs?: number; easing?: string }) => void;
}

interface Props {
  children: ReactNode;
  className?: string;
  toolMode?: string; // when non-"select", disable canvas pan
  onCanvasTap?: (canvasX: number, canvasY: number) => void;
  /** Opening pan/zoom (e.g. fit-to-width on a phone). Read once on mount; default is the origin at zoom 1. */
  initialView?: { x: number; y: number; zoom: number };
}

type View = { x: number; y: number; zoom: number };

/** Pinch / ctrl-wheel sensitivity: zoom changes by e^(-deltaY * this), so it feels the same at any zoom. */
const ZOOM_SENSITIVITY = 0.0085;
const MIN_ZOOM = 0.3, MAX_ZOOM = 2.5;
/** Momentum after a drag: velocity is multiplied by FRICTION every 16.7 ms, and stops under MIN_SPEED px/ms. */
const FRICTION = 0.94, MIN_SPEED = 0.02, MAX_SPEED = 4;
/** React hears about the view only once movement settles; the DOM is written every frame. */
const COMMIT_IDLE_MS = 140;

const clampZoom = (z: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/**
 * Pan/zoom surface. Motion runs outside React: the live view sits in a ref and is written straight to the
 * transform once per animation frame, so trackpads (which fire faster than the screen refreshes) and fingers
 * never wait on a re-render. React state follows when things settle, for anything that renders from it.
 * Drags carry their speed on release and coast to a stop (macOS-trackpad-like); trackpad scrolling already has
 * the OS's own momentum, so wheel deltas are applied as they come, coalesced per frame.
 */
const MobileCanvas = forwardRef<CanvasHandle, Props>(function MobileCanvas(
  { children, className, toolMode = "select", onCanvasTap, initialView },
  ref
) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>(initialView ?? { x: 0, y: 0, zoom: 1 });
  const live = useRef<View>(view);
  // Draggable children read the live zoom through this ref (see useCanvasDrag).
  const zoomRef = useRef(view.zoom);

  const frame = useRef(0);
  const commitTimer = useRef(0);
  const momentum = useRef(0);
  const glideTimer = useRef(0);

  /** Write the live view to the DOM on the next frame (one write per frame however many events arrive). */
  const paint = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = innerRef.current, v = live.current;
      if (!el) return;
      el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.zoom})`;
      el.style.setProperty("--canvas-zoom", String(v.zoom));
    });
  }, []);
  const commitSoon = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => setViewState({ ...live.current }), COMMIT_IDLE_MS);
  }, []);
  const move = useCallback((next: View) => {
    live.current = next;
    zoomRef.current = next.zoom;
    paint();
    commitSoon();
  }, [paint, commitSoon]);
  const stopMomentum = (): void => { cancelAnimationFrame(momentum.current); momentum.current = 0; };
  const stopGlide = (): void => {
    window.clearTimeout(glideTimer.current);
    const el = innerRef.current;
    if (el && el.style.transition) {
      // freeze wherever the glide has got to, so a new gesture starts from what is on screen
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      el.style.transition = "";
      live.current = { x: m.e, y: m.f, zoom: m.a || live.current.zoom };
      zoomRef.current = live.current.zoom;
      paint();
    }
  };

  useImperativeHandle(ref, () => ({
    get pan() { return { x: live.current.x, y: live.current.y }; },
    get zoom() { return live.current.zoom; },
    setView: (v, opts) => {
      stopMomentum();
      const el = innerRef.current;
      window.clearTimeout(glideTimer.current);
      if (el) el.style.transition = opts?.animateMs ? `transform ${opts.animateMs}ms ${opts.easing ?? "cubic-bezier(.22,1,.36,1)"}` : "";
      if (opts?.animateMs) glideTimer.current = window.setTimeout(() => { if (innerRef.current) innerRef.current.style.transition = ""; }, opts.animateMs + 60);
      move({ ...live.current, ...v, zoom: clampZoom(v.zoom ?? live.current.zoom) });
    },
  }), [move]);

  /** Zoom about a screen point, so the canvas point under the cursor (or between the fingers) stays put. */
  function zoomAt(clientX: number, clientY: number, factor: number, panBy = { x: 0, y: 0 }) {
    const rect = outerRef.current?.getBoundingClientRect();
    const vx = clientX - (rect?.left ?? 0), vy = clientY - (rect?.top ?? 0);
    const v = live.current, z = clampZoom(v.zoom * factor);
    const cx = (vx - v.x) / v.zoom, cy = (vy - v.y) / v.zoom;
    move({ x: vx - cx * z + panBy.x, y: vy - cy * z + panBy.y, zoom: z });
  }

  // Trackpad / wheel. Native passive:false listener so preventDefault() blocks the browser's own page zoom.
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      stopMomentum(); stopGlide();
      // line/page deltas (some mice) are scaled to pixels
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el!.clientHeight : 1;
      if (e.ctrlKey) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * k * ZOOM_SENSITIVITY));
      else move({ ...live.current, x: live.current.x - e.deltaX * k, y: live.current.y - e.deltaY * k });
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; stopMomentum(); window.clearTimeout(commitTimer.current); window.clearTimeout(glideTimer.current); }, []);

  const canPan = toolMode === "select";
  const panStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const samples = useRef<{ t: number; x: number; y: number }[]>([]);
  const touches = useRef(0);
  const lastPinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    stopMomentum(); stopGlide();
    if (!canPan || touches.current >= 2) return;
    const target = e.target as HTMLElement;
    if (target.closest(".canvas-node") || target.closest("button") || target.closest(".freeform-el")) return;
    try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch { /* capture is a nicety: pan still works without it */ }
    panStart.current = { px: e.clientX, py: e.clientY, x: live.current.x, y: live.current.y };
    samples.current = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    moved.current = false;
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!panStart.current || touches.current >= 2) return;
    const dx = e.clientX - panStart.current.px, dy = e.clientY - panStart.current.py;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved.current = true;
    samples.current.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (samples.current.length > 8) samples.current.shift();
    move({ ...live.current, x: panStart.current.x + dx, y: panStart.current.y + dy });
  }

  /** Carry the release speed and let it die away, frame by frame. */
  function coast(releaseT: number) {
    const s = samples.current, last = s[s.length - 1];
    if (!last || releaseT - last.t > 100) return; // held still before letting go: no throw
    const first = s.find((p) => last.t - p.t <= 90) ?? s[0];
    const dt = last.t - first.t;
    if (dt <= 0) return;
    let vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp < 0.15) return;
    if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
    let prev = performance.now();
    const step = (now: number) => {
      const t = Math.min(48, now - prev); prev = now;
      const decay = Math.pow(FRICTION, t / 16.7);
      vx *= decay; vy *= decay;
      move({ ...live.current, x: live.current.x + vx * t, y: live.current.y + vy * t });
      momentum.current = Math.hypot(vx, vy) > MIN_SPEED ? requestAnimationFrame(step) : 0;
    };
    momentum.current = requestAnimationFrame(step);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (panStart.current && !moved.current) {
      const rect = outerRef.current?.getBoundingClientRect();
      const v = live.current;
      onCanvasTap?.((e.clientX - (rect?.left ?? 0) - v.x) / v.zoom, (e.clientY - (rect?.top ?? 0) - v.y) / v.zoom);
    } else if (panStart.current && moved.current && e.type === "pointerup") coast(e.timeStamp);
    panStart.current = null;
  }

  function pinchState(e: React.TouchEvent<HTMLDivElement>) {
    const [a, b] = [e.touches[0], e.touches[1]];
    return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
  }
  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    touches.current = e.touches.length;
    if (e.touches.length === 2) { stopMomentum(); stopGlide(); panStart.current = null; lastPinch.current = pinchState(e); }
  }
  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    touches.current = e.touches.length;
    if (e.touches.length === 2 && lastPinch.current) {
      const next = pinchState(e), prev = lastPinch.current;
      // pinch zooms about the fingers' midpoint, and moving both fingers pans: one gesture, no fighting
      zoomAt(next.cx, next.cy, next.dist / prev.dist, { x: next.cx - prev.cx, y: next.cy - prev.cy });
      lastPinch.current = next;
    }
  }
  function onTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    touches.current = e.touches.length;
    if (e.touches.length < 2) lastPinch.current = null;
  }

  return (
    <div
      ref={outerRef}
      className={`overflow-hidden bg-slate-950 ${className ?? ""}`}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div
        ref={innerRef}
        style={{
          position: "absolute",
          width: "4000px",
          height: "4000px",
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
          transformOrigin: "0 0",
          // Lets a child stay the same size on screen at any zoom: scale(calc(1 / var(--canvas-zoom))).
          ["--canvas-zoom" as string]: view.zoom,
        }}
      >
        <CanvasZoomContext.Provider value={zoomRef}>{children}</CanvasZoomContext.Provider>
      </div>
    </div>
  );
});

export default MobileCanvas;
