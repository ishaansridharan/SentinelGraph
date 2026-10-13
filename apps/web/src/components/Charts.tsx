import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / step;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * step;
}

export interface SeriesPoint {
  x: string; // ISO date (week start)
  y: number;
  extra?: Record<string, number>;
}

/** Single-series area chart with a crosshair tooltip. The card title names the series, so no legend. */
export function AreaChart({ data, height = 190, color = 'var(--accent)', unit = 'incidents' }: {
  data: SeriesPoint[]; height?: number; color?: string; unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 28, r: 8, t: 10, b: 24 };
  const iw = Math.max(0, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...data.map((d) => d.y)));
  const x = (i: number) => pad.l + (data.length <= 1 ? 0 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;

  const { line, area } = useMemo(() => {
    if (!data.length || !iw) return { line: '', area: '' };
    // monotone-ish smoothing via midpoint cubic segments
    let d = `M ${x(0)} ${y(data[0].y)}`;
    for (let i = 1; i < data.length; i++) {
      const xm = (x(i - 1) + x(i)) / 2;
      d += ` C ${xm} ${y(data[i - 1].y)}, ${xm} ${y(data[i].y)}, ${x(i)} ${y(data[i].y)}`;
    }
    return { line: d, area: `${d} L ${x(data.length - 1)} ${pad.t + ih} L ${x(0)} ${pad.t + ih} Z` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, iw, max]);

  const ticks = [0, max / 2, max];
  const monthTicks = data
    .map((d, i) => ({ i, d: new Date(d.x) }))
    .filter(({ d, i }) => i === 0 || new Date(data[i - 1].x).getMonth() !== d.getMonth());

  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} style={{ position: 'relative', height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left - pad.l;
            const i = Math.round((px / iw) * (data.length - 1));
            setHover(i >= 0 && i < data.length ? i : null);
          }}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label={`Weekly ${unit} over time`}
        >
          <defs>
            <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={pad.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>{t}</text>
            </g>
          ))}
          {monthTicks.map(({ i, d }) => (
            <text key={i} x={x(i)} y={height - 6} fontSize={10.5} fill="var(--muted)" textAnchor={i === 0 ? 'start' : 'middle'}>
              {d.toLocaleDateString(undefined, { month: 'short' })}
            </text>
          ))}
          <path d={area} fill="url(#area-fill)" />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--border-strong)" strokeDasharray="3 3" />
              <circle cx={x(hover)} cy={y(h.y)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div
          className="glass"
          style={{
            position: 'absolute', top: 4, pointerEvents: 'none', padding: '8px 10px', fontSize: 12, minWidth: 130,
            left: Math.min(Math.max(x(hover) - 65, 0), width - 140),
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>Week of {new Date(h.x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{h.y} {unit}</div>
          {h.extra && Object.entries(h.extra).map(([k, v]) => (
            <div key={k} className="row" style={{ justifyContent: 'space-between', color: 'var(--text-2)' }}>
              <span className={`sev ${k}`}>{k}</span><span>{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars, one series, value labels in text ink. */
export function BarList({ items, color = 'var(--accent)', onClick }: {
  items: { key: string; label: ReactNode; value: number; title?: string }[];
  color?: string;
  onClick?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="stack" style={{ gap: 4 }}>
      {items.map((it) => (
        <div
          key={it.key}
          className={onClick ? 'conn' : undefined}
          style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 120px) minmax(40px, 1fr) 32px', alignItems: 'center', gap: 12, padding: '6px 8px' }}
          onClick={() => onClick?.(it.key)}
          title={it.title}
        >
          <div className="ellipsis" style={{ fontSize: 13 }}>{it.label}</div>
          <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 4 }}>
            <div style={{ width: `${(it.value / max) * 100}%`, height: '100%', background: color, borderRadius: 4, transition: 'width .4s' }} />
          </div>
          <div style={{ fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}
