import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Crosshair, Play, Route, Timer } from 'lucide-react';
import { api, type BlastRadius, type GNode, type PathResult } from '../lib/api';
import { metaFor } from '../theme/graphColors';
import GraphCanvas from '../components/GraphCanvas';
import ContextPanel from '../components/ContextPanel';
import { CodeBlock, EntityIcon, EntityPicker, Spinner } from '../components/ui';

type Mode = 'blast' | 'path';

function relationalSql(key: string, depth: number) {
  const joins = Array.from({ length: depth }, (_, i) =>
    i === 0 ? `FROM edges e1` : `JOIN edges e${i + 1} ON e${i + 1}.src IN (e${i}.src, e${i}.dst)`,
  );
  return [
    `-- ${depth}-hop expansion over a relational edges table`,
    `SELECT DISTINCT e${depth}.dst`,
    ...joins,
    `WHERE '${key}' IN (e1.src, e1.dst)`,
    `-- …repeated per entity table (9) and per direction,`,
    `-- or a recursive CTE with cycle detection.`,
  ].join('\n');
}

export default function InvestigateView() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'path' ? 'path' : 'blast';
  const setMode = (m: Mode) => setParams(m === 'path' ? { mode: 'path' } : {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="row" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', gap: 16 }}>
        <div className="tabs">
          <button className={`tab${mode === 'blast' ? ' on' : ''}`} onClick={() => setMode('blast')}><Crosshair size={13} style={{ verticalAlign: -2 }} /> Blast radius</button>
          <button className={`tab${mode === 'path' ? ' on' : ''}`} onClick={() => setMode('path')}><Route size={13} style={{ verticalAlign: -2 }} /> Path finder</button>
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {mode === 'blast'
            ? 'Everything reachable from one entity within N hops: the multi-hop question relational joins struggle with.'
            : 'How are two entities connected? All shortest paths, any relationship type.'}
        </span>
      </div>
      {mode === 'blast' ? <BlastRadiusPanel initialKey={params.get('key')} /> : <PathPanel />}
    </div>
  );
}

function BlastRadiusPanel({ initialKey }: { initialKey: string | null }) {
  const [origin, setOrigin] = useState<GNode | null>(null);
  const [depth, setDepth] = useState(3);
  const [result, setResult] = useState<BlastRadius | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [hideIncidents, setHideIncidents] = useState(false);

  // Resolve the starting entity (URL param, else the Review 1 demo IP)
  useEffect(() => {
    const key = initialKey ?? 'ip:198.51.100.77';
    api.entity(key).then((d) => setOrigin(d.entity)).catch(() => setOrigin(null));
  }, [initialKey]);

  const run = (o = origin, d = depth) => {
    if (!o) return;
    setLoading(true);
    setErr(null);
    setSelected(null);
    api.blastRadius(o.key, d).then(setResult).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (origin) run(origin, depth); }, [origin, depth]);

  const view = useMemo(() => {
    if (!result) return null;
    if (!hideIncidents) return result;
    const keep = new Set(result.nodes.filter((n) => n.label !== 'Incident').map((n) => n.id));
    return { ...result, nodes: result.nodes.filter((n) => keep.has(n.id)), edges: result.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }, [result, hideIncidents]);

  const s = result?.summary;
  const reached = result ? result.nodes.length - 1 : 0;

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="row" style={{ padding: '12px 20px', gap: 10, borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: 360 }}>
            <EntityPicker value={origin} onChange={setOrigin} placeholder="Origin: IP, domain, malware, actor…" />
          </div>
          <span className="muted" style={{ fontSize: 12.5 }}>within</span>
          <div className="tabs" style={{ padding: 2 }}>
            {[1, 2, 3, 4].map((d) => (
              <button key={d} className={`tab${depth === d ? ' on' : ''}`} style={{ height: 26, padding: '0 12px' }} onClick={() => setDepth(d)}>{d} hop{d > 1 ? 's' : ''}</button>
            ))}
          </div>
          <button className="btn primary sm" onClick={() => run()} disabled={!origin || loading}>
            {loading ? <Spinner size={13} /> : <Play size={13} />} Run
          </button>
          <span className="spacer" />
          <label className="row muted" style={{ gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={hideIncidents} onChange={(e) => setHideIncidents(e.target.checked)} /> Hide incidents
          </label>
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {err && <div className="empty"><div className="error-box" style={{ display: 'inline-block' }}>{err}</div></div>}
          {!view && !err && <div className="empty" style={{ paddingTop: 120 }}><Spinner /></div>}
          {view && (
            <GraphCanvas
              nodes={view.nodes}
              edges={view.edges}
              centerId={view.center.id}
              selectedId={selected?.id}
              onSelect={setSelected}
              showCross={false}
              minimap
              labelThreshold={20}
            />
          )}
          {view && (
            <div className="canvas-overlay tl">
              <div className="glass row" style={{ padding: '6px 12px', gap: 14, fontSize: 12 }}>
                {Object.entries(s?.byHop ?? {}).map(([h, c]) => (
                  <span key={h} className="muted">Hop {h} <strong style={{ color: 'var(--text)' }}>{c}</strong></span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="drawer" style={{ width: 400 }}>
        {selected ? (
          <ContextPanel entityKey={selected.key} onClose={() => setSelected(null)} onNavigate={(n) => setSelected(n)} />
        ) : (
          <div className="drawer-body">
            {!result && <div className="skeleton" style={{ height: 120 }} />}
            {result && s && (
              <div className="stack" style={{ gap: 18 }}>
                <div>
                  <div className="muted" style={{ fontSize: 12 }}>Blast radius of</div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <EntityIcon label={result.center.label} size={32} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }} className="ellipsis">{result.center.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{metaFor(result.center.label).singular}</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div className="card" style={{ padding: '10px 12px' }}>
                    <div className="muted" style={{ fontSize: 11.5 }}>Entities reached</div>
                    <div className="stat-num">{reached}</div>
                  </div>
                  <div className="card" style={{ padding: '10px 12px' }}>
                    <div className="muted" style={{ fontSize: 11.5 }}><Timer size={11} style={{ verticalAlign: -1 }} /> Query time</div>
                    <div className="stat-num">{result.ms}<span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> ms</span></div>
                  </div>
                </div>

                <div>
                  <div className="card-sub" style={{ marginBottom: 6 }}>Reached by type</div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(s.byLabel).sort((a, b) => b[1] - a[1]).map(([l, c]) => (
                      <span key={l} className="chip"><span className="nav-dot" style={{ background: metaFor(l).color }} />{metaFor(l).plural} <strong style={{ color: 'var(--text)' }}>{c}</strong></span>
                    ))}
                  </div>
                </div>

                <ImpactList title="Organizations at risk" items={s.organizations} onPick={setSelected} />
                <ImpactList title="Threat actors in range" items={s.actors} onPick={setSelected} />
                <ImpactList title="Related incidents" items={s.incidents.slice(0, 6)} onPick={setSelected} more={s.incidents.length - 6} />

                <div>
                  <div className="card-sub" style={{ marginBottom: 6 }}>Cypher that produced this</div>
                  <CodeBlock code={result.cypher} />
                </div>
                <div>
                  <div className="card-sub" style={{ marginBottom: 6 }}>The same question in SQL</div>
                  <CodeBlock code={relationalSql(result.center.key, depth)} lang="sql" />
                  <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                    In Neo4j each hop is a pointer chase from the node, so cost grows with the neighbourhood actually visited, not with the size of every table joined.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function ImpactList({ title, items, onPick, more = 0 }: { title: string; items: GNode[]; onPick: (n: GNode) => void; more?: number }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="card-sub" style={{ marginBottom: 4 }}>{title} · {items.length + Math.max(0, more)}</div>
      {items.map((n) => (
        <button key={n.id} className="conn" onClick={() => onPick(n)}>
          <EntityIcon label={n.label} size={24} />
          <span className="ellipsis" style={{ flex: 1, fontSize: 13 }}>{n.name}{n.label === 'Incident' && n.props.title ? <span className="muted"> · {String(n.props.title)}</span> : null}</span>
          {n.label === 'Incident' && <span className={`sev ${n.props.severity}`} />}
          <span className="tag">{n.hop} hop{n.hop === 1 ? '' : 's'}</span>
        </button>
      ))}
      {more > 0 && <div className="faint" style={{ fontSize: 12, padding: '4px 8px' }}>+{more} more in the graph</div>}
    </div>
  );
}

const PRESETS = [
  { from: 'TA-CRIMSONFOX', to: 'ORG-LAKEVIEW-MEDICAL-CENTRE', text: 'Bank phishers → hospital?' },
  { from: 'INC-2701', to: 'TA-BLACKLOTUS', text: 'Who is behind INC-2701?' },
  { from: 'ORG-LEDGERSOFT', to: 'ORG-HELIX-UNIVERSITY', text: 'Vendor → university' },
];

function PathPanel() {
  const [params] = useSearchParams();
  const [from, setFrom] = useState<GNode | null>(null);
  const [to, setTo] = useState<GNode | null>(null);
  const [result, setResult] = useState<PathResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);

  const run = (a = from, b = to) => {
    if (!a || !b) return;
    setLoading(true);
    setErr(null);
    api.path(a.key, b.key).then(setResult).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  };

  const preset = async (p: (typeof PRESETS)[number]) => {
    const [a, b] = await Promise.all([api.entity(p.from), api.entity(p.to)]);
    setFrom(a.entity);
    setTo(b.entity);
    run(a.entity, b.entity);
  };

  const qFrom = params.get('from'), qTo = params.get('to');
  useEffect(() => {
    preset(qFrom && qTo ? { from: qFrom, to: qTo, text: '' } : PRESETS[0]).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qFrom, qTo]);

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="row" style={{ padding: '12px 20px', gap: 10, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <div style={{ width: 300 }}><EntityPicker value={from} onChange={setFrom} placeholder="From…" /></div>
          <ArrowRight size={16} className="muted" />
          <div style={{ width: 300 }}><EntityPicker value={to} onChange={setTo} placeholder="To…" /></div>
          <button className="btn primary sm" disabled={!from || !to || loading} onClick={() => run()}>
            {loading ? <Spinner size={13} /> : <Route size={13} />} Find paths
          </button>
          <span className="spacer" />
          {PRESETS.map((p) => <button key={p.text} className="chip" onClick={() => preset(p)}>{p.text}</button>)}
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {err && <div className="empty"><div className="error-box" style={{ display: 'inline-block' }}>{err}</div></div>}
          {result && result.paths === 0 && <div className="empty" style={{ paddingTop: 120 }}>No path within 6 hops.</div>}
          {result && result.paths > 0 && (
            <GraphCanvas
              nodes={result.nodes}
              edges={result.edges}
              centerId={result.nodes.find((n) => n.hop === 0)?.id}
              selectedId={selected?.id}
              onSelect={setSelected}
              labelThreshold={60}
            />
          )}
        </div>
      </div>
      <aside className="drawer" style={{ width: 400 }}>
        {selected ? (
          <ContextPanel entityKey={selected.key} onClose={() => setSelected(null)} onNavigate={setSelected} />
        ) : (
          <div className="drawer-body">
            {!result && <div className="skeleton" style={{ height: 120 }} />}
            {result && (
              <div className="stack" style={{ gap: 18 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <div className="card" style={{ padding: '10px 12px' }}>
                    <div className="muted" style={{ fontSize: 11.5 }}>Hops</div>
                    <div className="stat-num">{result.length ?? '—'}</div>
                  </div>
                  <div className="card" style={{ padding: '10px 12px' }}>
                    <div className="muted" style={{ fontSize: 11.5 }}>Paths</div>
                    <div className="stat-num">{result.paths}</div>
                  </div>
                  <div className="card" style={{ padding: '10px 12px' }}>
                    <div className="muted" style={{ fontSize: 11.5 }}>Time</div>
                    <div className="stat-num">{result.ms}<span className="muted" style={{ fontSize: 13 }}> ms</span></div>
                  </div>
                </div>
                <div>
                  <div className="card-sub" style={{ marginBottom: 6 }}>Entities on the shortest paths</div>
                  {[...result.nodes].sort((a, b) => (a.hop ?? 0) - (b.hop ?? 0)).map((n) => (
                    <button key={n.id} className="conn" onClick={() => setSelected(n)}>
                      <span className="tag">{n.hop}</span>
                      <EntityIcon label={n.label} size={24} />
                      <span className="ellipsis" style={{ flex: 1, fontSize: 13 }}>{n.name}</span>
                      <span className="faint" style={{ fontSize: 11.5 }}>{metaFor(n.label).singular}</span>
                    </button>
                  ))}
                </div>
                <div>
                  <div className="card-sub" style={{ marginBottom: 6 }}>Cypher</div>
                  <CodeBlock code={result.cypher} />
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
