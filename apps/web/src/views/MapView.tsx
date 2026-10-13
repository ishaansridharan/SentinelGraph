import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type CampaignMap, type CaseFile, type GNode } from '../lib/api';
import { useSchema } from '../lib/schema';
import GraphCanvas from '../components/GraphCanvas';
import ContextPanel from '../components/ContextPanel';
import { Spinner } from '../components/ui';

/**
 * The whole threat picture on one canvas, organised instead of dumped: a lane
 * per campaign reading actor → victims, with anything two campaigns share
 * pulled into its own lane between them.
 */
export default function MapView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { version } = useSchema();
  const [map, setMap] = useState<CampaignMap | null>(null);
  const [cases, setCases] = useState<CaseFile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<GNode | null>(null);

  const only = params.get('campaigns')?.split(',').filter(Boolean) ?? null;

  useEffect(() => {
    setErr(null);
    api.map(only ?? undefined).then(setMap).catch((e) => setErr(e.message));
    api.cases().then(setCases).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('campaigns'), version]);

  const allCampaigns = useMemo(() => cases.flatMap((c) => c.campaigns).filter((c, i, a) => a.findIndex((x) => x.key === c.key) === i), [cases]);

  const toggle = (key: string) => {
    const cur = new Set(only ?? allCampaigns.map((c) => c.key));
    if (cur.has(key)) cur.delete(key); else cur.add(key);
    if (cur.size === 0 || cur.size === allCampaigns.length) setParams({});
    else setParams({ campaigns: [...cur].join(',') });
  };

  const caseFor = (campaignKey: string) =>
    cases.find((c) => c.campaignIds.length === 1 && c.campaignIds[0] === campaignKey) ?? cases.find((c) => c.campaignIds.includes(campaignKey));

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', gap: 6, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12.5, marginRight: 6 }}>Campaigns</span>
          {allCampaigns.map((c) => {
            const on = !only || only.includes(c.key);
            return (
              <button key={c.key} className={`chip${on ? ' on' : ''}`} style={{ opacity: on ? 1 : 0.55 }} onClick={() => toggle(c.key)}>
                <span className="nav-dot" style={{ background: 'var(--c-Campaign)' }} /> {c.name}
                {c.actor && <span className="faint">· {c.actor}</span>}
              </button>
            );
          })}
          <span className="spacer" />
          <span className="row faint" style={{ fontSize: 12, gap: 14 }}>
            <span className="row" style={{ gap: 6 }}><span className="sev critical" />hit</span>
            <span className="row" style={{ gap: 6 }}><span className="sev warning" />exposed, not hit</span>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 14, height: 9, border: '1.5px dashed var(--accent)', borderRadius: 3 }} />shared lane</span>
          </span>
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {err && <div className="empty"><div className="error-box" style={{ display: 'inline-block' }}>{err}</div></div>}
          {!map && !err && <div className="empty" style={{ paddingTop: 120 }}><Spinner /></div>}
          {map && (
            <GraphCanvas
              layout="lanes"
              lanes={map.lanes}
              nodes={map.nodes}
              edges={map.edges}
              selectedId={selected?.id}
              onSelect={setSelected}
              onOpenLane={(lane) => {
                const c = caseFor(lane.campaigns[0]);
                if (c) navigate(`/cases/${c.id}`);
              }}
              labelThreshold={0}
              minFitZoom={0.62}
              maxZoom={0.9}
              minimap
            />
          )}
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
