import { useEffect, useMemo, useState } from 'react';
import { Play, Table2, Timer, Waypoints } from 'lucide-react';
import { api, type CypherResult, type GNode } from '../lib/api';
import GraphCanvas from '../components/GraphCanvas';
import ContextPanel from '../components/ContextPanel';
import { CodeBlock, EntityIcon, Spinner } from '../components/ui';

interface Saved {
  id: string;
  title: string;
  description: string;
  hops: string;
  cypher: string;
  sql?: string;
}

const SAVED: Saved[] = [
  {
    id: 'pivot',
    title: 'Pivot: what is this IP?',
    description: 'An alert fires on 198.51.100.77. Within three hops: which campaigns use it, and who runs them?',
    hops: '≤ 3 hops',
    cypher: `MATCH (ip:IPAddress {name: '198.51.100.77'})
MATCH p = shortestPath((ip)-[*..3]-(c:Campaign))
MATCH q = (c)<-[:RUNS]-(:ThreatActor)
RETURN p, q`,
    sql: `-- unknown path length: recursive CTE
WITH RECURSIVE walk(id, depth) AS (
  SELECT 'ip:198.51.100.77', 0
  UNION
  SELECT r.other_id, w.depth + 1
  FROM walk w
  -- both directions of all 13
  -- relationship types
  JOIN relationships_both_ways r
    ON r.id = w.id
  WHERE w.depth < 3
)
SELECT c.name, a.name
FROM walk
JOIN campaigns c ON c.id = walk.id
JOIN threat_actors a ON a.id = c.actor_id;`,
  },
  {
    id: 'overlap',
    title: 'Attribution: campaigns sharing infrastructure',
    description: 'Two campaigns whose tools talk to the same server. Here it exposes CrimsonFox selling bank access to BlackLotus.',
    hops: '3 + 3 hops',
    cypher: `MATCH p1 = (c1:Campaign)-[:USES]->(:Malware)-[:CONTACTS]->(shared:Indicator)
MATCH p2 = (c2:Campaign)-[:USES]->(:Malware)-[:CONTACTS]->(shared)
WHERE c1.name < c2.name
RETURN p1, p2`,
    sql: `SELECT c1.name, c2.name, i.value
FROM campaigns c1
JOIN campaign_malware u1
  ON u1.campaign_id = c1.id
JOIN malware_contacts k1
  ON k1.malware_id = u1.malware_id
JOIN indicators i ON i.id = k1.ind_id
JOIN malware_contacts k2
  ON k2.ind_id = i.id
JOIN campaign_malware u2
  ON u2.malware_id = k2.malware_id
JOIN campaigns c2 ON c2.id = u2.campaign_id
WHERE c1.name < c2.name;
-- 7 joins, one self-join chain per side`,
  },
  {
    id: 'next',
    title: "Who's next: exposed but not hit",
    description: 'Organizations running a product that an active campaign is exploiting, with no incident from that campaign yet. This is the patch-first list.',
    hops: '2 hops + negation',
    cypher: `MATCH (c:Campaign {status: 'active'})-[:EXPLOITS]->(v:Vulnerability)
      <-[:EXPOSED_TO]-(o:Organization)
WHERE NOT EXISTS {
  (o)<-[:AFFECTED]-(:Incident)-[:ATTRIBUTED_TO]->(c)
}
MATCH p = (c)-[:EXPLOITS]->(v)<-[:EXPOSED_TO]-(o)
OPTIONAL MATCH q = (o)<-[:AFFECTED]-(:Incident)-[:OBSERVED]->()
RETURN p, q`,
    sql: `SELECT o.name, v.cve_id, c.name
FROM campaigns c
JOIN campaign_cves x ON x.campaign_id = c.id
JOIN vulnerabilities v ON v.cve_id = x.cve_id
JOIN org_exposures e ON e.cve_id = v.cve_id
JOIN organizations o ON o.id = e.org_id
WHERE c.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM incident_orgs io
    JOIN incident_campaign ic
      ON ic.incident_id = io.incident_id
    WHERE io.org_id = o.id
      AND ic.campaign_id = c.id);`,
  },
  {
    id: 'supply',
    title: 'Supply chain: one vendor, many victims',
    description: "LedgerSoft's customers and what the poisoned update did to each of them.",
    hops: '1 + 2 hops',
    cypher: `MATCH p = (:Organization {name: 'LedgerSoft'})-[:SUPPLIES]->(customer:Organization)
OPTIONAL MATCH q = (customer)<-[:AFFECTED]-(:Incident)-[:INVOLVED]->(:Malware)
RETURN p, q`,
    sql: `SELECT cu.name, i.title, m.name
FROM organizations v
JOIN supplies s ON s.vendor_id = v.id
JOIN organizations cu ON cu.id = s.customer_id
LEFT JOIN incident_orgs io
  ON io.org_id = cu.id
LEFT JOIN incidents i ON i.id = io.incident_id
LEFT JOIN incident_malware im
  ON im.incident_id = i.id
LEFT JOIN malware m ON m.id = im.malware_id
WHERE v.name = 'LedgerSoft';`,
  },
  {
    id: 'triage',
    title: 'Triage: attribute new incidents',
    description: 'Unattributed incidents that observed an indicator already seen in an attributed incident. The graph proposes the campaign.',
    hops: '3 hops',
    cypher: `MATCH (i:Incident) WHERE NOT EXISTS { (i)-[:ATTRIBUTED_TO]->() }
MATCH (i)-[:OBSERVED]->(ind:Indicator)<-[:OBSERVED]-(known:Incident)
      -[:ATTRIBUTED_TO]->(c:Campaign)
WITH i, ind, c, collect(known)[0] AS known
MATCH p = (i)-[:OBSERVED]->(ind)<-[:OBSERVED]-(known)-[:ATTRIBUTED_TO]->(c)
RETURN p`,
  },
  {
    id: 'killchain',
    title: 'Actor to victim: APT-Saffron',
    description: 'From the actor through its campaign, tools and C2 servers to the incidents and organizations where they showed up.',
    hops: '4 + 2 hops',
    cypher: `MATCH p = (:ThreatActor {name: 'APT-Saffron'})-[:RUNS]->(:Campaign)
          -[:USES]->(:Malware)-[:CONTACTS]->(ind:Indicator)
OPTIONAL MATCH q = (ind)<-[:OBSERVED]-(:Incident)-[:AFFECTED]->(:Organization)
RETURN p, q`,
  },
  {
    id: 'sectors',
    title: 'Incidents by sector',
    description: 'Which industries are being hit, and by which campaigns.',
    hops: 'aggregate',
    cypher: `MATCH (i:Incident)-[:AFFECTED]->(o:Organization)
OPTIONAL MATCH (i)-[:ATTRIBUTED_TO]->(c:Campaign)
RETURN o.sector AS sector, count(i) AS incidents,
       collect(DISTINCT c.name) AS campaigns
ORDER BY incidents DESC`,
  },
  {
    id: 'degree',
    title: 'Most connected indicators',
    description: 'IPs, domains and registrant e-mails ranked by how many records reference them.',
    hops: 'degree',
    cypher: `MATCH (i:Indicator)
RETURN i.name AS indicator,
       [l IN labels(i) WHERE NOT l IN ['Entity', 'Indicator']][0] AS type,
       COUNT { (i)--() } AS links
ORDER BY links DESC
LIMIT 12`,
  },
];

/** Hop distance from the start of the returned paths, so results read left to right like the pattern. */
function withHops(r: CypherResult): GNode[] | null {
  const { nodes, edges, starts } = r.graph;
  if (!starts.length) return null;
  const adj = new Map<string, string[]>();
  edges.filter((e) => e.kind !== 'cross').forEach((e) => {
    adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), e.source]);
  });
  const hop = new Map<string, number>(starts.map((id) => [id, 0]));
  let frontier = [...starts];
  while (frontier.length) {
    const next: string[] = [];
    frontier.forEach((id) => (adj.get(id) ?? []).forEach((m) => {
      if (!hop.has(m)) { hop.set(m, hop.get(id)! + 1); next.push(m); }
    }));
    frontier = next;
  }
  return nodes.map((n) => ({ ...n, hop: hop.get(n.id) ?? 0 }));
}

function isNode(v: unknown): v is GNode {
  return !!v && typeof v === 'object' && 'labels' in (v as object) && 'key' in (v as object);
}

function Cell({ v }: { v: unknown }) {
  if (isNode(v)) {
    return <span className="row" style={{ gap: 6 }}><EntityIcon label={v.label} size={18} />{v.name}</span>;
  }
  if (v && typeof v === 'object' && 'nodes' in (v as object)) {
    const p = v as { nodes: GNode[] };
    return <span className="muted">{p.nodes.map((n) => n.name).join(' → ')}</span>;
  }
  if (v && typeof v === 'object' && 'type' in (v as object) && 'source' in (v as object)) {
    return <span className="tag">{(v as { type: string }).type}</span>;
  }
  if (Array.isArray(v)) return <span>{v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')}</span>;
  if (v === null || v === undefined) return <span className="faint">null</span>;
  if (typeof v === 'number') return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number.isInteger(v) ? v : v.toFixed(3)}</span>;
  return <span>{String(v)}</span>;
}

export default function QueryLabView() {
  const [active, setActive] = useState<Saved | null>(SAVED[0]);
  const [text, setText] = useState(SAVED[0].cypher);
  const [result, setResult] = useState<CypherResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [selected, setSelected] = useState<GNode | null>(null);
  const hopNodes = useMemo(() => (result ? withHops(result) : null), [result]);

  const run = (q = text) => {
    setLoading(true);
    setErr(null);
    setSelected(null);
    api.cypher(q)
      .then((r) => { setResult(r); setView(r.graph.nodes.length ? 'graph' : 'table'); })
      .catch((e) => { setErr(e.message); setResult(null); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    run(SAVED[0].cypher);
    // Plan the rest in the background so their first click reports warm timings
    SAVED.slice(1).forEach((s) => api.cypher(s.cypher).catch(() => {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (s: Saved) => { setActive(s); setText(s.cypher); run(s.cypher); };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: 12 }}>
        <div className="muted" style={{ fontSize: 12, padding: '4px 8px 8px' }}>Investigation queries</div>
        {SAVED.map((s) => (
          <button
            key={s.id}
            className={`nav-item${active?.id === s.id ? ' active' : ''}`}
            style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '9px 10px' }}
            onClick={() => pick(s)}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{s.title}</span>
            <span className="faint mono" style={{ fontSize: 10.5 }}>{s.hops}</span>
          </button>
        ))}
        <div className="divider" />
        <p className="muted" style={{ fontSize: 12, padding: '0 8px', lineHeight: 1.5 }}>
          The console is <strong>read-only</strong>. Create, edit and delete entities and relationships from the entity screens or any details panel.
        </p>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)' }}>
          {active && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{active.title}</div>
              <div className="muted" style={{ fontSize: 13 }}>{active.description}</div>
            </div>
          )}
          <textarea
            className="textarea mono"
            spellCheck={false}
            value={text}
            rows={Math.min(9, text.split('\n').length + 1)}
            style={{ fontSize: 12.5, lineHeight: 1.6 }}
            onChange={(e) => { setText(e.target.value); setActive(null); }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary sm" onClick={() => run()} disabled={loading || !text.trim()}>
              {loading ? <Spinner size={13} /> : <Play size={13} />} Run query
            </button>
            <span className="faint" style={{ fontSize: 12 }}>Ctrl + Enter</span>
            <span className="spacer" />
            {result && (
              <>
                <span className="row muted" style={{ fontSize: 12.5, gap: 5 }}><Timer size={13} /> {result.ms} ms · {result.count} rows</span>
                <div className="tabs" style={{ padding: 2 }}>
                  <button className={`tab${view === 'graph' ? ' on' : ''}`} style={{ height: 26 }} disabled={!result.graph.nodes.length} onClick={() => setView('graph')}><Waypoints size={12} style={{ verticalAlign: -2 }} /> Graph</button>
                  <button className={`tab${view === 'table' ? ' on' : ''}`} style={{ height: 26 }} onClick={() => setView('table')}><Table2 size={12} style={{ verticalAlign: -2 }} /> Table</button>
                </div>
              </>
            )}
          </div>
          {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, position: 'relative', minWidth: 0, overflow: view === 'table' ? 'auto' : 'hidden' }}>
            {result && view === 'graph' && result.graph.nodes.length > 0 && (
              <GraphCanvas
                nodes={hopNodes ?? result.graph.nodes}
                edges={result.graph.edges}
                layout={result.graph.starts.length ? 'hop' : 'dagre'}
                // Show only the returned relationships; fall back to links between returned nodes when the query returned none
                showCross={!result.graph.edges.some((e) => e.kind !== 'cross')}
                selectedId={selected?.id}
                onSelect={setSelected}
                labelThreshold={40}
              />
            )}
            {result && view === 'table' && (
              <table className="table">
                <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>{r.map((v, j) => <td key={j}><Cell v={v} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            )}
            {result && result.count === 0 && <div className="empty">Query returned no rows.</div>}
          </div>
          {(selected || active?.sql) && (
            <aside className="drawer" style={{ width: 380 }}>
              {selected ? (
                <ContextPanel entityKey={selected.key} onClose={() => setSelected(null)} onNavigate={setSelected} />
              ) : active?.sql ? (
                <div className="drawer-body">
                  <div className="card-sub" style={{ marginBottom: 6 }}>Equivalent relational query</div>
                  <CodeBlock code={active.sql} lang="sql" />
                  <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 12 }}>
                    Each relationship in the Cypher pattern becomes a join table plus two joins in SQL. The graph version reads like the question an analyst asks, and Neo4j answers it by walking stored relationships instead of matching keys across whole tables.
                  </p>
                </div>
              ) : null}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
