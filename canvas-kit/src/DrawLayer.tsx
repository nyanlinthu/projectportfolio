import { useRef, useState, PointerEvent } from "react";
import type { CanvasHandle } from "./MobileCanvas";

interface Props {
  active: boolean;
  eraseMode: boolean;
  color: string;
  width: number;
  canvasRef: React.RefObject<CanvasHandle>;
  onStrokeDone: (path: string, x: number, y: number) => void;
  onEraseAt: (cx: number, cy: number) => void;
}

export default function DrawLayer({ active, eraseMode, color, width, canvasRef, onStrokeDone, onEraseAt }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const pathRef = useRef<string>("");

  function clientToCanvas(cx: number, cy: number) {
    const rect = svgRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const pan = canvasRef.current?.pan ?? { x: 0, y: 0 };
    const zoom = canvasRef.current?.zoom ?? 1;
    return {
      x: (cx - rect.left - pan.x) / zoom,
      y: (cy - rect.top - pan.y) / zoom,
    };
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!active) return;
    e.stopPropagation();
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);

    if (eraseMode) {
      const { x, y } = clientToCanvas(e.clientX, e.clientY);
      onEraseAt(x, y);
      return;
    }

    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    startRef.current = { x, y };
    pathRef.current = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    setCurrentPath(pathRef.current);
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!active) return;
    if (eraseMode && (e.buttons & 1)) {
      const { x, y } = clientToCanvas(e.clientX, e.clientY);
      onEraseAt(x, y);
      return;
    }
    if (!startRef.current) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY);
    pathRef.current += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    setCurrentPath(pathRef.current);
  }

  function onPointerUp() {
    if (!active || eraseMode || !startRef.current || !pathRef.current) return;
    const path = pathRef.current;
    const start = startRef.current;
    startRef.current = null;
    pathRef.current = "";
    setCurrentPath(null);
    onStrokeDone(path, start.x, start.y);
  }

  const zoom = canvasRef.current?.zoom ?? 1;
  const pan = canvasRef.current?.pan ?? { x: 0, y: 0 };

  if (!active && !currentPath) return null;

  return (
    <svg
      ref={svgRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        zIndex: 30,
        touchAction: "none",
        cursor: active ? (eraseMode ? "cell" : "crosshair") : "default",
        pointerEvents: active ? "all" : "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {currentPath && (
          <path
            d={currentPath}
            stroke={color}
            strokeWidth={width / zoom}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </g>
    </svg>
  );
}
