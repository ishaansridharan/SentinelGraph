import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Maximize2, MessageSquarePlus } from 'lucide-react';
import { api, type CampaignMap, type CaseFile, type GNode } from '../lib/api';
import { useSchema } from '../lib/schema';
import { metaFor } from '../theme/graphColors';
import GraphCanvas from '../components/GraphCanvas';
import ContextPanel from '../components/ContextPanel';
import { EntityIcon, Spinner, fmtDate, timeAgo, useToast } from '../components/ui';

export function PriorityPill({ p }: { p: string }) {
  return <span className={`prio prio-${p}`}>{p}</span>;
}

export function EntityChip({ k, entities, onClick }: { k: string; entities?: Record<string, GNode>; onClick?: (n: GNode) => void }) {
  const n = entities?.[k];
  if (!n) return <span className="tag">{k}</span>;
  return (
    <button className="chip" style={{ height: 24 }} onClick={() => onClick?.(n)} title={metaFor(n.label).singular}>
      <span className="nav-dot" style={{ background: metaFor(n.label).color }} /> {n.name}
    </button>
  );
}

export default function CaseView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { version } = useSchema();
  const [c, setC] = useState<CaseFile | null>(null);
  const [map, setMap] = useState<CampaignMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setErr(null);
    setSelected(null);
    api.caseFile(id).then((cf) => {
      setC(cf);
      api.map(cf.campaignIds).then(setMap).catch(() => setMap(null));
    }).catch((e) => setErr(e.message));
  }, [id, version]);

  if (err) return <div className="page"><div className="error-box">{err}</div></div>;
  if (!c) return <div className="empty" style={{ paddingTop: 120 }}><Spinner /></div>;

  const s = c.stats;
  const pick = (n: GNode) => setSelected(n);
  const toggleRec = async (i: number) => {
    const recs = c.recommendations.map((r, j) => (j === i ? { ...r, done: !r.done } : r));
    setC({ ...c, recommendations: recs });
    try {
      setC(await api.updateCase(c.id, { recommendations: recs }));
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const setStatus = async (status: CaseFile['status']) => {
    try {
      setC(await api.updateCase(c.id, { status }));
      toast(`Case marked ${status}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      setC(await api.addCaseNote(c.id, note.trim(), selected ? [selected.key] : []));
      setNote('');
      toast('Note added to timeline');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  };
  const timeline = [...(c.timeline ?? [])].reverse();
  const done = c.recommendations.filter((r) => r.done).length;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <div className="page" style={{ maxWidth: 1400 }}>
          <Link to="/" className="row muted" style={{ fontSize: 12.5, marginBottom: 14, gap: 6, width: 'fit-content' }}>
            <ArrowLeft size={13} /> All cases
          </Link>
          <div className="row" style={{ gap: 10, marginBottom: 6 }}>
            <PriorityPill p={c.priority} />
            <span className="tag">{c.id}</span>
            <select className="select" style={{ width: 130, height: 26, fontSize: 12.5 }} value={c.status} onChange={(e) => setStatus(e.target.value as CaseFile['status'])}>
              <option value="open">Open</option>
              <option value="monitoring">Monitoring</option>
              <option value="closed">Closed</option>
            </select>
            <span className="muted" style={{ fontSize: 12.5 }}>Owner <strong style={{ color: 'var(--text)' }}>{c.owner}</strong> · opened {fmtDate(c.openedAt)} · updated {timeAgo(c.updatedAt)}</span>
          </div>
          <h1 className="page-title" style={{ fontSize: 24 }}>{c.title}</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 14.5, lineHeight: 1.6, maxWidth: 900, margin: '10px 0 18px' }}>{c.summary}</p>

          {s && (
            <div className="kpi-strip" style={{ marginBottom: 18 }}>
              <div><span className="kpi-num">{s.incidents}</span><span className="kpi-label">incidents</span></div>
              <div><span className="kpi-num">{s.open}</span><span className="kpi-label">still open</span></div>
              <div><span className="kpi-num" style={{ color: s.critical ? 'var(--critical)' : undefined }}>{s.critical}</span><span className="kpi-label">critical open</span></div>
              <div><span className="kpi-num">{s.victims}</span><span className="kpi-label">organizations hit</span></div>
              <div><span className="kpi-num" style={{ color: s.exposedNotHit ? 'var(--warning)' : undefined }}>{s.exposedNotHit}</span><span className="kpi-label">exposed, not hit yet</span></div>
            </div>
          )}

          <div className="card" style={{ height: 470, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginBottom: 16 }}>
            <div className="card-head" style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <div>
                <h3 className="card-title">How the campaign fits together</h3>
                <p className="card-sub">Read left to right: group, campaign, tools, websites and servers, victims.</p>
              </div>
              <button className="btn sm" onClick={() => navigate(`/map?story=${c.campaignIds[0]}`)}><Maximize2 size={14} /> Walk through the attack</button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              {map ? (
                <GraphCanvas layout="lanes" lanes={map.lanes} nodes={map.nodes} edges={map.edges} selectedId={selected?.id} onSelect={setSelected} labelThreshold={0} maxZoom={0.95} />
              ) : <div className="empty"><Spinner /></div>}
            </div>
          </div>

          <div className="grid-case">
            <div className="card">
              <div className="card-head"><h3 className="card-title">Timeline</h3><span className="muted" style={{ fontSize: 12 }}>{c.timeline?.length ?? 0} events</span></div>
              <div className="card-body">
                <div className="row" style={{ gap: 8, marginBottom: 14 }}>
                  <input className="input" value={note} placeholder={selected ? `Add a note about ${selected.name}…` : 'Add an analyst note…'}
                    onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
                  <button className="btn primary" disabled={!note.trim() || saving} onClick={addNote}><MessageSquarePlus size={14} /> Add</button>
                </div>
                <div className="timeline">
                  {timeline.map((e, i) => (
                    <div key={i} className={`tl-item${e.note ? ' note' : ''}`}>
                      <span className={`tl-dot ${e.severity ?? ''}`} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 500, fontSize: 13.5 }}>{e.title}</span>
                          <span className="faint" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{fmtDate(e.at, true)}</span>
                        </div>
                        {e.detail && <div className="muted" style={{ fontSize: 12.5 }}>{e.detail}</div>}
                        {!!e.entityKeys?.length && (
                          <div className="row" style={{ gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                            {e.entityKeys.map((k) => <EntityChip key={k} k={k} entities={c.entities} onClick={pick} />)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="stack" style={{ gap: 16 }}>
              <div className="card">
                <div className="card-head"><h3 className="card-title">Key findings</h3></div>
                <div className="card-body stack" style={{ gap: 14 }}>
                  {c.findings.map((f, i) => (
                    <div key={i}>
                      <div style={{ fontWeight: 600, fontSize: 13.5 }}>{f.title}</div>
                      {f.detail && <div style={{ color: 'var(--text-2)', fontSize: 13, margin: '3px 0 6px' }}>{f.detail}</div>}
                      <div className="row" style={{ gap: 5, flexWrap: 'wrap' }}>
                        {f.entityKeys?.map((k) => <EntityChip key={k} k={k} entities={c.entities} onClick={pick} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-head"><h3 className="card-title">Recommended actions</h3><span className="muted" style={{ fontSize: 12 }}>{done}/{c.recommendations.length} done</span></div>
                <div className="card-body stack" style={{ gap: 2 }}>
                  {c.recommendations.map((r, i) => (
                    <button key={i} className="conn" onClick={() => toggleRec(i)} style={{ alignItems: 'flex-start' }}>
                      <span className={`check${r.done ? ' on' : ''}`}>{r.done && <Check size={12} />}</span>
                      <span style={{ fontSize: 13, textDecoration: r.done ? 'line-through' : undefined, color: r.done ? 'var(--muted)' : 'var(--text)' }}>{r.text}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-head"><h3 className="card-title">Campaigns in this case</h3></div>
                <div className="card-body" style={{ paddingTop: 8 }}>
                  {c.campaigns.map((cp) => {
                    const n = c.entities?.[cp.key];
                    return (
                      <button key={cp.key} className="conn" onClick={() => n && pick(n)}>
                        <EntityIcon label="Campaign" size={26} />
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{cp.name}</span>
                        <span className="faint" style={{ fontSize: 12 }}>{String(n?.props.status ?? '')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {selected && (
        <aside className="drawer">
          <ContextPanel entityKey={selected.key} onClose={() => setSelected(null)} onNavigate={(n) => setSelected(n)} onDeleted={() => setSelected(null)} />
        </aside>
      )}
    </div>
  );
}
