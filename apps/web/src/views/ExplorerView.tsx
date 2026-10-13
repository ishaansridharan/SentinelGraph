import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RotateCcw, Waypoints } from 'lucide-react';
import { api, type GEdge, type GNode } from '../lib/api';
import { useSchema } from '../lib/schema';
import { ENTITY_ORDER, metaFor } from '../theme/graphColors';
import GraphCanvas from '../components/GraphCanvas';
import ContextPanel from '../components/ContextPanel';
import { EntityIcon, EntityPicker, Spinner, useToast } from '../components/ui';

interface GraphState {
  nodes: Map<string, GNode>;
  edges: Map<string, GEdge>;
  centerId: string;
  ms: number;
  truncated: boolean;
}

export default function ExplorerView() {
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');
  const { version } = useSchema();
  const toast = useToast();
  const [depth, setDepth] = useState(1);
  const [types, setTypes] = useState<Set<string>>(new Set(ENTITY_ORDER));
  const [showCross, setShowCross] = useState(true);
  const [graph, setGraph] = useState<GraphState | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [reloads, setReloads] = useState(0);

  const typeList = useMemo(() => (types.size === ENTITY_ORDER.length ? undefined : [...types]), [types]);

  useEffect(() => {
    if (!focus) { setGraph(null); return; }
    setLoading(true);
    setErr(null);
    api.neighborhood(focus, depth, depth === 1 ? 60 : 70, typeList)
      .then((g) => {
        setGraph({
          nodes: new Map(g.nodes.map((n) => [n.id, n])),
          edges: new Map(g.edges.map((e) => [e.id, e])),
          centerId: g.center.id,
          ms: g.ms,
          truncated: g.truncated,
        });
        setSelected((s) => (s && g.nodes.some((n) => n.key === s.key) ? s : g.center));
      })
      .catch((e) => { setErr(e.message); setGraph(null); })
      .finally(() => setLoading(false));
  }, [focus, depth, typeList, version, reloads]);

  const expand = useCallback((n: GNode) => {
    api.neighborhood(n.key, 1, 30, typeList).then((g) => {
      setGraph((cur) => {
        if (!cur) return cur;
        const nodes = new Map(cur.nodes);
        const edges = new Map(cur.edges);
        const base = cur.nodes.get(n.id)?.hop ?? 0;
        let added = 0;
        g.nodes.forEach((m) => {
          if (!nodes.has(m.id)) { nodes.set(m.id, { ...m, hop: base + (m.hop ?? 1) }); added++; }
        });
        g.edges.forEach((e) => edges.has(e.id) || edges.set(e.id, e));
        toast(added ? `Expanded ${n.name}: +${added} entities` : `${n.name} has no hidden neighbours`);
        return { ...cur, nodes, edges };
      });
    }).catch((e) => toast(e.message, true));
  }, [typeList, toast]);

  const nodes = useMemo(() => (graph ? [...graph.nodes.values()] : []), [graph]);
  const edges = useMemo(() => (graph ? [...graph.edges.values()] : []), [graph]);
  const center = graph?.nodes.get(graph.centerId);

  const toggleType = (l: string) => setTypes((s) => {
    const n = new Set(s);
    if (n.has(l)) n.delete(l); else n.add(l);
    return n.size === 0 ? new Set(ENTITY_ORDER) : n;
  });

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        {focus && graph && (
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            centerId={graph.centerId}
            selectedId={selected?.id}
            onSelect={setSelected}
            onExpand={expand}
            showCross={showCross}
            minimap={nodes.length > 30}
          />
        )}
        {!focus && <StartHere onPick={(k) => setParams({ focus: k })} />}
        {focus && !graph && (
          <div className="empty" style={{ paddingTop: 120 }}>{err ? <div className="error-box" style={{ display: 'inline-block' }}>{err}</div> : <Spinner />}</div>
        )}

        {focus && (
          <div className="canvas-overlay tl" style={{ flexDirection: 'column', alignItems: 'stretch', width: 320 }}>
            <div className="glass" style={{ padding: 10 }}>
              <EntityPicker
                value={center ?? null}
                onChange={(n) => (n ? setParams({ focus: n.key }) : setParams({}))}
                placeholder="Focus on an entity…"
              />
              <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                <span className="muted" style={{ fontSize: 12 }}>Hops</span>
                <div className="tabs" style={{ padding: 2 }}>
                  {[1, 2, 3].map((d) => (
                    <button key={d} className={`tab${depth === d ? ' on' : ''}`} style={{ height: 24, padding: '0 12px' }} onClick={() => setDepth(d)}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 5 }}>
                {ENTITY_ORDER.map((l) => (
                  <button
                    key={l}
                    className={`chip${types.has(l) ? ' on' : ''}`}
                    style={{ height: 22, fontSize: 11, opacity: types.has(l) ? 1 : 0.55 }}
                    onClick={() => toggleType(l)}
                    title={`Show ${metaFor(l).plural}`}
                  >
                    <span className="nav-dot" style={{ background: metaFor(l).color, width: 7, height: 7 }} /> {metaFor(l).plural}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {focus && graph && (
          <div className="canvas-overlay bl">
            <div className="glass row" style={{ padding: '6px 10px', gap: 12, fontSize: 12, color: 'var(--text-2)' }}>
              {loading ? <Spinner size={13} /> : <Waypoints size={13} />}
              <span>{nodes.length} entities · {edges.length} relationships</span>
              <span className="faint">traversal {graph.ms} ms</span>
              {graph.truncated && <span style={{ color: 'var(--warning)' }}>capped — raise filters</span>}
              <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={showCross} onChange={(e) => setShowCross(e.target.checked)} /> cross-links
              </label>
              <button className="btn ghost sm" style={{ height: 22 }} onClick={() => { setDepth(1); setTypes(new Set(ENTITY_ORDER)); setReloads((r) => r + 1); }}>
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>
        )}
        {focus && graph && (
          <div className="canvas-overlay tr">
            <div className="glass" style={{ padding: '6px 10px', fontSize: 11.5, color: 'var(--muted)' }}>
              Click to inspect · double-click or <strong>+</strong> to expand
            </div>
          </div>
        )}
      </div>

      {focus && selected && (
        <aside className="drawer">
          <ContextPanel
            entityKey={selected.key}
            onNavigate={(n) => {
              const inGraph = graph && [...graph.nodes.values()].find((m) => m.key === n.key);
              if (inGraph) setSelected(inGraph); else setParams({ focus: n.key });
            }}
            onClose={() => setSelected(null)}
            onDeleted={() => (selected.id === graph?.centerId ? setParams({}) : setSelected(null))}
          />
        </aside>
      )}
    </div>
  );
}

function StartHere({ onPick }: { onPick: (key: string) => void }) {
  const [groups, setGroups] = useState<{ title: string; items: GNode[] }[] | null>(null);
  useEffect(() => {
    Promise.all([
      api.entities('Campaign', { sort: 'degree', limit: 4 }).then((r) => r.items),
      api.entities('Incident', { sort: 'severity', limit: 4 }),
      api.entities('IPAddress', { sort: 'degree', limit: 4 }),
      api.entities('Vulnerability', { sort: 'degree', limit: 4 }),
    ]).then(([a, i, ip, v]) => setGroups([
      { title: 'Campaigns', items: a },
      { title: 'Critical incidents', items: i.items },
      { title: 'Most connected IPs', items: ip.items },
      { title: 'Most exploited vulnerabilities', items: v.items },
    ])).catch(() => setGroups([]));
  }, []);

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '64px 28px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-grid', placeItems: 'center', width: 48, height: 48, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 14 }}>
          <Waypoints size={22} />
        </div>
        <h1 className="page-title">Where do you want to start?</h1>
        <p className="page-sub">Pick an entity and the explorer shows only what it is connected to. Expand outward one hop at a time.</p>
      </div>
      <div style={{ maxWidth: 520, margin: '0 auto 32px' }}>
        <EntityPicker value={null} onChange={(n) => n && onPick(n.key)} placeholder="Search an IP, domain, actor, CVE, incident…" autoFocus />
      </div>
      {!groups && <div className="empty"><Spinner /></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
        {groups?.map((g) => (
          <div key={g.title} className="card" style={{ padding: 8 }}>
            <div className="muted" style={{ fontSize: 12, padding: '6px 8px' }}>{g.title}</div>
            {g.items.map((n) => (
              <button key={n.id} className="conn" onClick={() => onPick(n.key)}>
                <EntityIcon label={n.label} size={26} />
                <span className="ellipsis" style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{n.name}</span>
                {n.label === 'Incident' ? <span className={`sev ${n.props.severity}`}>{String(n.props.severity)}</span>
                  : <span className="faint mono" style={{ fontSize: 11 }}>{n.incidents !== undefined ? `${n.incidents} incidents` : `${n.degree ?? 0} links`}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
