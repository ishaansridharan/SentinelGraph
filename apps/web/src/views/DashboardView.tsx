import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Siren, Sparkles, Waypoints } from 'lucide-react';
import { api, type AttentionItem, type CaseFile, type Overview } from '../lib/api';
import { useSchema } from '../lib/schema';
import { Spinner, timeAgo } from '../components/ui';
import { PriorityPill } from './CaseView';

const KIND = {
  attribution: { label: 'Suggested attribution', icon: Sparkles, color: 'var(--accent)' },
  exposure: { label: "Who's next", icon: ShieldAlert, color: 'var(--warning)' },
  overlap: { label: 'Shared infrastructure', icon: Waypoints, color: 'var(--c-Campaign)' },
  critical: { label: 'Critical and still open', icon: Siren, color: 'var(--critical)' },
} as const;

export default function DashboardView() {
  const navigate = useNavigate();
  const { version } = useSchema();
  const [ov, setOv] = useState<Overview | null>(null);
  const [cases, setCases] = useState<CaseFile[] | null>(null);
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [showAllCritical, setShowAllCritical] = useState(false);

  useEffect(() => {
    api.overview().then(setOv).catch(() => {});
    api.cases().then(setCases).catch(() => setCases([]));
    api.attention().then(setItems).catch(() => {});
  }, [version]);

  const k = ov?.kpis;
  const open = (item: AttentionItem) => {
    if (item.kind === 'overlap') return navigate(`/map?campaigns=${item.entityKeys.filter((x) => x.startsWith('CMP-')).join(',')}`);
    if (item.path) return navigate(`/investigate?mode=path&from=${encodeURIComponent(item.path[0])}&to=${encodeURIComponent(item.path[1])}`);
    navigate(`/explore?focus=${encodeURIComponent(item.focus)}`);
  };
  const groups = (Object.keys(KIND) as (keyof typeof KIND)[]).map((kind) => ({ kind, list: items.filter((i) => i.kind === kind) }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Threat overview</h1>
          <p className="page-sub">Three active campaigns are hitting Indian banks, hospitals and a software supply chain. Two of them share infrastructure.</p>
        </div>
      </div>

      <div className="kpi-strip" style={{ marginBottom: 20 }}>
        <div><span className="kpi-num">{k?.activeCampaigns ?? '—'}</span><span className="kpi-label">active campaigns</span></div>
        <div>
          <span className="kpi-num">{k?.openIncidents ?? '—'}</span>
          <span className="kpi-label">open incidents{k ? <> · <span style={{ color: 'var(--critical)' }}>{k.criticalOpen} critical</span></> : null}</span>
        </div>
        <div><span className="kpi-num">{k?.orgsAffected ?? '—'}</span><span className="kpi-label">organizations hit</span></div>
        <div><span className="kpi-num" style={{ color: k?.exposedNotHit ? 'var(--warning)' : undefined }}>{k?.exposedNotHit ?? '—'}</span><span className="kpi-label">exposed, not hit yet</span></div>
        <div><span className="kpi-num" style={{ color: k?.unattributed ? 'var(--accent)' : undefined }}>{k?.unattributed ?? '—'}</span><span className="kpi-label">incidents to attribute</span></div>
      </div>

      <div className="grid-overview">
        <div>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 className="card-title" style={{ fontSize: 14 }}>Cases</h3>
            <span className="muted" style={{ fontSize: 12 }}>stored in MongoDB · <span className="mono">cases</span></span>
          </div>
          {!cases && <div className="empty"><Spinner /></div>}
          <div className="stack" style={{ gap: 10 }}>
            {cases?.map((c) => (
              <div key={c.id} className="card case-card" onClick={() => navigate(`/cases/${c.id}`)} role="link">
                <div className="row" style={{ gap: 8 }}>
                  <PriorityPill p={c.priority} />
                  <span style={{ fontWeight: 600, fontSize: 14.5 }} className="ellipsis">{c.title}</span>
                  <span className="spacer" />
                  <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{c.status === 'open' ? 'Open' : c.status === 'monitoring' ? 'Monitoring' : 'Closed'} · {c.owner}</span>
                </div>
                <div className="case-summary">{c.summary}</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {c.campaigns.map((cp) => (
                    <span key={cp.key} className="chip" style={{ height: 22, fontSize: 11.5 }}>
                      <span className="nav-dot" style={{ background: 'var(--c-Campaign)', width: 7, height: 7 }} />{cp.name}
                      {cp.actor && <span className="faint">· {cp.actor}</span>}
                    </span>
                  ))}
                  <span className="spacer" />
                  {c.stats && (
                    <span className="mini-stats">
                      <span><strong>{c.stats.victims}</strong> hit</span>
                      <span><strong>{c.stats.open}</strong> open</span>
                      {c.stats.critical > 0 && <span style={{ color: 'var(--critical)' }}><strong style={{ color: 'inherit' }}>{c.stats.critical}</strong> critical</span>}
                      {c.stats.exposedNotHit > 0 && <span style={{ color: 'var(--warning)' }}><strong style={{ color: 'inherit' }}>{c.stats.exposedNotHit}</strong> exposed</span>}
                      {c.stats.lastActivity && <span>last activity {timeAgo(c.stats.lastActivity)}</span>}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ alignSelf: 'start' }}>
          <div className="card-head">
            <div>
              <h3 className="card-title">Needs attention</h3>
              <p className="card-sub">Found by following relationships in the graph</p>
            </div>
          </div>
          <div style={{ padding: '4px 4px 8px' }}>
            {groups.map(({ kind, list }) => {
              if (!list.length) return null;
              const meta = KIND[kind];
              const Icon = meta.icon;
              const shown = kind === 'critical' && !showAllCritical ? list.slice(0, 3) : list;
              return (
                <div key={kind}>
                  <div className="attn-group">{meta.label} · {list.length}</div>
                  {shown.map((i, n) => (
                    <button key={n} className="attn" onClick={() => open(i)}>
                      <span className="attn-icon" style={{ ['--ac' as string]: meta.color }}><Icon size={15} /></span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{i.title}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>{i.detail}</span>
                      </span>
                    </button>
                  ))}
                  {kind === 'critical' && list.length > 3 && (
                    <button className="btn ghost sm" style={{ margin: '0 8px' }} onClick={() => setShowAllCritical((v) => !v)}>
                      {showAllCritical ? 'Show fewer' : `Show ${list.length - 3} more`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}
