import { useRef } from 'react'

/**
 * The picture on the sign-in page: what the product is, in three tilted tiles (a work-breakdown tree that rolls up,
 * swimlanes, sticky notes with a checklist). Pure inline SVG/CSS, no images to load, and no data. The tiles follow the
 * pointer a little (set as CSS variables) and float gently; both stop for people who asked for less motion.
 */
export default function LoginStage(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const track = (e: React.PointerEvent): void => {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', String(((e.clientX - r.left) / r.width - 0.5).toFixed(3)))
    el.style.setProperty('--my', String(((e.clientY - r.top) / r.height - 0.5).toFixed(3)))
  }
  const leave = (): void => { ref.current?.style.setProperty('--mx', '0'); ref.current?.style.setProperty('--my', '0') }
  return (
    <div className="wb-stage3d" ref={ref} onPointerMove={track} onPointerLeave={leave} aria-hidden="true">
      <div className="wb-fan">
        {/* 1 — the work breakdown tree, progress rolling up */}
        <figure className="wb-tile wb-tile-a">
          <svg viewBox="0 0 320 210" role="img" aria-label="A work breakdown tree">
            <g className="ln"><path d="M160 52 C160 76 70 70 70 98" /><path d="M160 52 L160 98" /><path d="M160 52 C160 76 250 70 250 98" /><path d="M70 130 C70 150 40 148 40 168" /><path d="M70 130 C70 150 100 148 100 168" /></g>
            <Node x={100} y={14} w={120} h={38} title="Portfolio" pct={0.84} tone="gold" />
            <Node x={20} y={98} w={100} h={32} title="Project" pct={1} tone="green" />
            <Node x={110} y={98} w={100} h={32} title="Project" pct={0.6} tone="orange" />
            <Node x={200} y={98} w={100} h={32} title="Project" pct={0.3} tone="orange" />
            <Task x={6} y={168} done /><Task x={76} y={168} done /><Task x={146} y={168} /><Task x={216} y={168} />
          </svg>
          <figcaption><b>Project breakdown</b> Progress rolls up from finished tasks</figcaption>
        </figure>
        {/* 2 — swimlanes */}
        <figure className="wb-tile wb-tile-b">
          <svg viewBox="0 0 320 210" role="img" aria-label="Swimlanes">
            <Lane y={10} h={92} color="#C9A64B" label="ESPORTS" />
            <Lane y={112} h={92} color="#7FB3D5" label="CORPORATE" />
            <Card x={16} y={34} pct={0.9} /><Card x={118} y={34} pct={0.7} /><Card x={220} y={34} pct={1} />
            <Card x={16} y={136} pct={0.5} /><Card x={118} y={136} pct={1} />
          </svg>
          <figcaption><b>Swimlanes</b> By team, department or company</figcaption>
        </figure>
        {/* 3 — sticky notes and a checklist */}
        <figure className="wb-tile wb-tile-c">
          <svg viewBox="0 0 320 210" role="img" aria-label="Sticky notes and a checklist">
            <g transform="rotate(-6 80 80)"><rect className="st st1" x="26" y="26" width="104" height="88" rx="3" /><rect className="tx" x="40" y="46" width="62" height="5" rx="2" /><rect className="tx" x="40" y="60" width="74" height="5" rx="2" /><rect className="tx" x="40" y="74" width="44" height="5" rx="2" /></g>
            <g transform="rotate(5 220 70)"><rect className="st st2" x="170" y="30" width="104" height="80" rx="3" /><rect className="tx" x="184" y="50" width="70" height="5" rx="2" /><rect className="tx" x="184" y="64" width="52" height="5" rx="2" /></g>
            <g className="chk"><rect className="box on" x="46" y="140" width="14" height="14" rx="3" /><path d="M49 147 l4 4 l7 -8" /><rect className="tx lt" x="70" y="144" width="110" height="6" rx="2" />
              <rect className="box on" x="46" y="164" width="14" height="14" rx="3" /><path d="M49 171 l4 4 l7 -8" /><rect className="tx lt" x="70" y="168" width="84" height="6" rx="2" />
              <rect className="box" x="46" y="188" width="14" height="14" rx="3" /><rect className="tx lt" x="70" y="192" width="96" height="6" rx="2" /></g>
          </svg>
          <figcaption><b>Notes &amp; checklists</b> Draw the process around the work</figcaption>
        </figure>
        {/* 4 — pages: writing with @ mentions, and pages inside pages */}
        <figure className="wb-tile wb-tile-d">
          <svg viewBox="0 0 320 210" role="img" aria-label="A page with an @ mention and a page embedded in it">
            <rect className="pgbox" x="14" y="10" width="292" height="190" rx="6" />
            <rect className="tx hd" x="30" y="26" width="120" height="9" rx="3" />
            <rect className="tx" x="30" y="46" width="250" height="5" rx="2" /><rect className="tx" x="30" y="58" width="200" height="5" rx="2" />
            <g><rect className="chip" x="30" y="72" width="52" height="18" rx="9" /><text className="chipt" x="40" y="85">@ John</text></g>
            <rect className="tx" x="90" y="78" width="130" height="5" rx="2" />
            <g><rect className="embed" x="30" y="102" width="260" height="84" rx="5" /><path className="fold" d="M262 102 h28 v28 z" />
              <rect className="tx hd" x="44" y="116" width="96" height="8" rx="3" />
              <rect className="tx" x="44" y="134" width="190" height="5" rx="2" /><rect className="tx" x="44" y="146" width="150" height="5" rx="2" />
              <g><rect className="chip lk" x="44" y="158" width="104" height="18" rx="9" /><text className="chipt" x="54" y="171">@ Roster plan</text></g></g>
          </svg>
          <figcaption><b>Pages</b> Pages inside pages, with @ mentions</figcaption>
        </figure>
        {/* 5 — the whiteboard: shapes, arrows, ink */}
        <figure className="wb-tile wb-tile-e">
          <svg viewBox="0 0 320 210" role="img" aria-label="A whiteboard with a flowchart and a pen stroke">
            <defs><marker id="wbarrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L8 4 L0 8 z" className="ah" /></marker></defs>
            <ellipse className="shp" cx="52" cy="46" rx="38" ry="18" /><text className="shpt" x="52" y="49" textAnchor="middle">Start</text>
            <rect className="shp" x="116" y="28" width="84" height="36" rx="4" /><text className="shpt" x="158" y="50" textAnchor="middle">Review</text>
            <path className="shp" d="M262 20 L300 46 L262 72 L224 46 z" /><text className="shpt" x="262" y="49" textAnchor="middle">OK?</text>
            <rect className="shp" x="224" y="120" width="84" height="36" rx="4" /><text className="shpt" x="266" y="142" textAnchor="middle">Done</text>
            <rect className="shp" x="116" y="120" width="84" height="36" rx="4" /><text className="shpt" x="158" y="142" textAnchor="middle">Fix</text>
            <g className="arw"><path d="M90 46 H114" markerEnd="url(#wbarrow)" /><path d="M200 46 H222" markerEnd="url(#wbarrow)" /><path d="M262 72 V118" markerEnd="url(#wbarrow)" /><path d="M224 138 H202" markerEnd="url(#wbarrow)" /><path d="M158 120 V66" markerEnd="url(#wbarrow)" /></g>
            <path className="ink" d="M24 168 C50 150 70 190 100 172 S140 186 176 176" />
            <g transform="rotate(-5 60 196)"><rect className="st st1" x="28" y="182" width="52" height="22" rx="2" /></g>
          </svg>
          <figcaption><b>Whiteboard</b> Draw, arrange and connect anything</figcaption>
        </figure>
      </div>
    </div>
  )
}

function Node({ x, y, w, h, title, pct, tone }: { x: number; y: number; w: number; h: number; title: string; pct: number; tone: 'gold' | 'green' | 'orange' }): JSX.Element {
  return (
    <g>
      <rect className="nd" x={x} y={y} width={w} height={h} rx="5" />
      <rect className={`ac ${tone}`} x={x} y={y} width="4" height={h} rx="2" />
      <text className="tt" x={x + 14} y={y + 15}>{title.toUpperCase()}</text>
      <rect className="bar" x={x + 14} y={y + h - 11} width={w - 54} height="4" rx="2" />
      <rect className={`fill ${tone}`} x={x + 14} y={y + h - 11} width={(w - 54) * pct} height="4" rx="2" />
      <text className="pc" x={x + w - 12} y={y + h - 6} textAnchor="end">{Math.round(pct * 100)}%</text>
    </g>
  )
}
function Task({ x, y, done }: { x: number; y: number; done?: boolean }): JSX.Element {
  return (
    <g>
      <rect className="nd sm" x={x} y={y} width="68" height="30" rx="4" />
      <circle className={done ? 'dot ok' : 'dot'} cx={x + 12} cy={y + 15} r="4" />
      <rect className="tx" x={x + 22} y={y + 12} width="34" height="5" rx="2" />
    </g>
  )
}
function Lane({ y, h, color, label }: { y: number; h: number; color: string; label: string }): JSX.Element {
  return (
    <g>
      <rect x="6" y={y} width="308" height={h} rx="6" style={{ fill: color, fillOpacity: 0.09, stroke: color, strokeOpacity: 0.5 }} />
      <text className="lab" x="16" y={y + 15} style={{ fill: color }}>{label}</text>
    </g>
  )
}
function Card({ x, y, pct }: { x: number; y: number; pct: number }): JSX.Element {
  return (
    <g>
      <rect className="nd" x={x} y={y} width="88" height="56" rx="4" />
      <rect className="tx" x={x + 10} y={y + 12} width="54" height="6" rx="2" />
      <rect className="tx" x={x + 10} y={y + 24} width="38" height="5" rx="2" />
      <rect className="bar" x={x + 10} y={y + 40} width="58" height="4" rx="2" />
      <rect className="fill green" x={x + 10} y={y + 40} width={58 * pct} height="4" rx="2" />
    </g>
  )
}
