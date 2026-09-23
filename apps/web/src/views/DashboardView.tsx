import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:8000';

interface Metrics {
  totalIncidents: number;
  pendingOutbox: number;
  graphNodes: number;
  graphRelationships: number;
  bySeverity: Record<string, number>;
  byEventType: Record<string, number>;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#e74c3c',
  high:     '#e67e22',
  medium:   '#f1c40f',
  low:      '#2ecc71',
};

const EVENT_COLORS: Record<string, string> = {
  phishing_email:    '#9b59b6',
  malware_execution: '#e74c3c',
  network_scan:      '#3498db',
};

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div style={{
      background: '#1a1a2e',
      border: `1px solid ${color}33`,
      borderLeft: `4px solid ${color}`,
      borderRadius: '8px',
      padding: '20px 24px',
    }}>
      <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </p>
      <p style={{ margin: '0 0 4px', fontSize: '32px', fontWeight: 700, color: '#e2e8f0', lineHeight: 1 }}>
        {value}
      </p>
      {sub && <p style={{ margin: 0, fontSize: '12px', color: '#4a5568' }}>{sub}</p>}
    </div>
  );
}

function BreakdownBar({ title, data, colorMap }: { title: string; data: Record<string, number>; colorMap: Record<string, string> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  return (
    <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: '8px', padding: '20px 24px' }}>
      <h3 style={{ margin: '0 0 16px', color: '#a0aec0', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([key, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          const color = colorMap[key] ?? '#718096';
          return (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '13px', color: '#e2e8f0' }}>{key}</span>
                <span style={{ fontSize: '13px', color: '#718096' }}>{count}</span>
              </div>
              <div style={{ background: '#2d3748', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardView() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/metrics`)
      .then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(setMetrics)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div style={{ padding: '24px' }}>
      <h2 style={{ margin: '0 0 24px', color: '#e2e8f0' }}>Overview</h2>

      {error && (
        <div style={{ padding: '12px 16px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', marginBottom: '20px', fontSize: '14px' }}>
          Failed to load metrics: {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <StatCard label="Total Incidents"     value={metrics?.totalIncidents   ?? '…'} color="#e74c3c" />
        <StatCard label="Outbox Lag (Pending)"value={metrics?.pendingOutbox    ?? '…'} color="#f39c12" sub="events awaiting processing" />
        <StatCard label="Graph Nodes"         value={metrics?.graphNodes       ?? '…'} color="#3498db" />
        <StatCard label="Graph Relationships" value={metrics?.graphRelationships ?? '…'} color="#2ecc71" />
      </div>

      {metrics && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <BreakdownBar title="Incidents by Severity"   data={metrics.bySeverity}  colorMap={SEVERITY_COLORS} />
          <BreakdownBar title="Incidents by Event Type" data={metrics.byEventType} colorMap={EVENT_COLORS} />
        </div>
      )}

      {!metrics && !error && (
        <div style={{ color: '#4a5568', fontSize: '14px' }}>Loading metrics…</div>
      )}
    </div>
  );
}
