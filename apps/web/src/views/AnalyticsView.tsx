import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Sparkles } from 'lucide-react';
import { api, type GNode } from '../lib/api';
import { metaFor } from '../theme/graphColors';
import { BarList } from '../components/Charts';
import { EntityIcon, Spinner } from '../components/ui';

type Breakdown = Record<'severity' | 'incidentType' | 'status' | 'sector', Record<string, number>>;
type PR = Awaited<ReturnType<typeof api.pagerank>>;
type Leiden = Awaited<ReturnType<typeof api.communities>>;

const SEV_ORDER = ['critical', 'high', 'medium', 'low'];
const SEV_COLOR: Record<string, string> = { critical: 'var(--critical)', high: 'var(--serious)', medium: 'var(--warning)', low: 'var(--good)' };

export default function AnalyticsView() {
  const navigate = useNavigate();
  const [bd, setBd] = useState<Breakdown | null>(null);
  const [pr, setPr] = useState<PR | null>(null);
  const [ld, setLd] = useState<Leiden | null>(null);
  const [busy, setBusy] = useState<'pr' | 'ld' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.breakdown().then(setBd).catch((e) => setErr(e.message)); }, []);

  const runPr = () => { setBusy('pr'); setErr(null); api.pagerank().then(setPr).catch((e) => setErr(e.message)).finally(() => setBusy(null)); };
  const runLd = () => { setBusy('ld'); setErr(null); api.communities().then(setLd).catch((e) => setErr(e.message)).finally(() => setBusy(null)); };

  const sevTotal = bd ? Object.values(bd.severity).reduce((a, b) => a + b, 0) : 0;
  const open = (n: GNode) => navigate(`/explore?focus=${encodeURIComponent(n.key)}`);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Graph analytics</h1>
          <p className="page-sub">Aggregations over the incident graph, plus Neo4j Graph Data Science algorithms run on the full entity graph.</p>
        </div>
      </div>
      {err && <div className="error-box" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="grid-3" style={{ marginTop: 0 }}>
        <div className="card">
          <div className="card-head"><div><h3 className="card-title">Incidents by severity</h3><p className="card-sub">{sevTotal} incidents</p></div></div>
          <div className="card-body">
            {bd && (
              <>
                <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, marginBottom: 14 }}>
                  {SEV_ORDER.map((s) => (
                    <div key={s} title={`${s}: ${bd.severity[s] ?? 0}`} style={{ flex: bd.severity[s] ?? 0, background: SEV_COLOR[s] }} />
                  ))}
                </div>
                {SEV_ORDER.map((s) => (
                  <div key={s} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', fontSize: 13 }}>
                    <span className={`sev ${s}`}>{s}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{bd.severity[s] ?? 0} <span className="faint">· {Math.round(((bd.severity[s] ?? 0) / Math.max(1, sevTotal)) * 100)}%</span></span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3 className="card-title">Incidents by type</h3><p className="card-sub">Analyst classification</p></div></div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {bd && <BarList color="var(--c-Incident)" items={Object.entries(bd.incidentType).map(([k, v]) => ({ key: k, label: k, value: v }))} />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3 className="card-title">Targeted sectors</h3><p className="card-sub">Incidents per victim sector</p></div></div>
          <div className="card-body" style={{ paddingTop: 8 }}>
            {bd && <BarList color="var(--c-Organization)" items={Object.entries(bd.sector).map(([k, v]) => ({ key: k, label: k, value: v }))} />}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 16, marginTop: 16 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Weighted PageRank</h3>
              <p className="card-sub">Ranks entities by confidence-weighted inbound links: the infrastructure everything else depends on.</p>
            </div>
            <button className="btn primary sm" onClick={runPr} disabled={busy !== null}>{busy === 'pr' ? <Spinner size={13} /> : <Play size={13} />} Run</button>
          </div>
          <div className="card-body">
            {!pr && <div className="empty"><Sparkles size={18} /><div style={{ marginTop: 6 }}>Run PageRank to score all entities. Scores are written back as <span className="mono">pageRank</span>.</div></div>}
            {pr && (
              <>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{pr.nodesWritten} nodes scored · {pr.iterations} iterations · {pr.ms} ms</div>
                <table className="table">
                  <thead><tr><th>#</th><th>Entity</th><th>Type</th><th className="num">Score</th><th className="num">Links</th></tr></thead>
                  <tbody>
                    {pr.top.map((n, i) => (
                      <tr key={n.id} className="row-link" onClick={() => open(n)}>
                        <td className="muted">{i + 1}</td>
                        <td><span className="row" style={{ gap: 8 }}><EntityIcon label={n.label} size={22} /><span className="ellipsis" style={{ maxWidth: 220 }}>{n.name}</span></span></td>
                        <td className="muted">{metaFor(n.label).singular}</td>
                        <td className="num">{n.score?.toFixed(3)}</td>
                        <td className="num muted">{n.degree}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">Leiden community detection</h3>
              <p className="card-sub">Clusters the graph into densely linked groups, which surfaces campaign-level structure without labels.</p>
            </div>
            <button className="btn primary sm" onClick={runLd} disabled={busy !== null}>{busy === 'ld' ? <Spinner size={13} /> : <Play size={13} />} Run</button>
          </div>
          <div className="card-body">
            {!ld && <div className="empty"><Sparkles size={18} /><div style={{ marginTop: 6 }}>Run Leiden to group entities into communities. IDs are written back as <span className="mono">community</span>.</div></div>}
            {ld && (
              <>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{ld.communityCount} communities · modularity {ld.modularity.toFixed(3)} · {ld.ms} ms</div>
                <div className="stack" style={{ gap: 8 }}>
                  {ld.communities.map((c) => (
                    <div key={c.id} className="card" style={{ padding: '10px 12px', background: 'var(--surface-2)' }}>
                      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                        <strong style={{ fontSize: 13 }}>Community {c.id}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>{c.size} entities · {c.incidents} incidents</span>
                      </div>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
                        {c.hubs.map((h) => (
                          <button key={h.id} className="chip" onClick={() => open(h)}>
                            <span className="nav-dot" style={{ background: metaFor(h.label).color }} />{h.name}
                          </button>
                        ))}
                      </div>
                      {(c.actors.length > 0 || c.campaigns.length > 0) && (
                        <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>
                          {c.actors.length > 0 && <>Actors: {c.actors.join(', ')}. </>}
                          {c.campaigns.length > 0 && <>Campaigns: {c.campaigns.join(', ')}.</>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
