import { useState } from 'react';

const API_BASE = 'http://localhost:8000';

interface AnalyticsResult {
  runId: string;
  algorithm: string;
  status: string;
  metrics: Record<string, unknown>;
}

function MetricTable({ metrics }: { metrics: Record<string, unknown> }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <tbody>
        {Object.entries(metrics).map(([k, v]) => (
          <tr key={k} style={{ borderBottom: '1px solid #2a2a4e' }}>
            <td style={{ padding: '8px 12px', color: '#718096', fontFamily: 'monospace' }}>{k}</td>
            <td style={{ padding: '8px 12px', color: '#e2e8f0', fontFamily: 'monospace' }}>
              {Array.isArray(v) ? v.join(', ') : String(v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AnalyticsView() {
  const [pagerankResult, setPagerankResult] = useState<AnalyticsResult | null>(null);
  const [leidenResult, setLeidenResult] = useState<AnalyticsResult | null>(null);
  const [pagerankLoading, setPagerankLoading] = useState(false);
  const [leidenLoading, setLeidenLoading] = useState(false);
  const [pagerankError, setPagerankError] = useState<string | null>(null);
  const [leidenError, setLeidenError] = useState<string | null>(null);

  const runPageRank = async () => {
    setPagerankLoading(true);
    setPagerankError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/analytics/pagerank/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dampingFactor: 0.85, maxIterations: 20, weightProperty: 'confidence' }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setPagerankResult(await res.json());
    } catch (err) {
      setPagerankError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setPagerankLoading(false);
    }
  };

  const runLeiden = async () => {
    setLeidenLoading(true);
    setLeidenError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/analytics/communities/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weightProperty: 'confidence', relationshipWeightProperty: 'confidence', includeIntermediateCommunities: false }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setLeidenResult(await res.json());
    } catch (err) {
      setLeidenError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLeidenLoading(false);
    }
  };

  const btnStyle = (loading: boolean, color: string) => ({
    padding: '10px 24px',
    background: loading ? '#2d3748' : color,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: loading ? 'not-allowed' : 'pointer',
    fontSize: '14px',
    fontWeight: 600 as const,
    transition: 'background 0.2s',
  });

  return (
    <div style={{ padding: '24px' }}>
      <h2 style={{ margin: '0 0 24px', color: '#e2e8f0' }}>Graph Analytics</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* PageRank */}
        <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: '8px', padding: '24px' }}>
          <h3 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: '16px' }}>Weighted PageRank</h3>
          <p style={{ margin: '0 0 16px', color: '#718096', fontSize: '13px' }}>
            Scores nodes by weighted in-link authority to surface operationally critical infrastructure.
          </p>
          <button onClick={runPageRank} disabled={pagerankLoading} style={btnStyle(pagerankLoading, '#3182ce')}>
            {pagerankLoading ? 'Running…' : 'Run PageRank'}
          </button>
          {pagerankError && (
            <div style={{ marginTop: '12px', padding: '10px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', fontSize: '13px' }}>
              {pagerankError}
            </div>
          )}
          {pagerankResult && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700,
                  background: pagerankResult.status === 'completed' ? '#22543d' : '#744210',
                  color: pagerankResult.status === 'completed' ? '#9ae6b4' : '#fbd38d',
                }}>
                  {pagerankResult.status.toUpperCase()}
                </span>
                <span style={{ color: '#4a5568', fontSize: '11px', fontFamily: 'monospace' }}>{pagerankResult.runId}</span>
              </div>
              <MetricTable metrics={pagerankResult.metrics} />
            </div>
          )}
        </div>

        {/* Leiden */}
        <div style={{ background: '#1a1a2e', border: '1px solid #2a2a4e', borderRadius: '8px', padding: '24px' }}>
          <h3 style={{ margin: '0 0 8px', color: '#e2e8f0', fontSize: '16px' }}>Leiden Community Detection</h3>
          <p style={{ margin: '0 0 16px', color: '#718096', fontSize: '13px' }}>
            Clusters graph nodes into campaign communities using modularity optimisation.
          </p>
          <button onClick={runLeiden} disabled={leidenLoading} style={btnStyle(leidenLoading, '#805ad5')}>
            {leidenLoading ? 'Running…' : 'Run Leiden Community Detection'}
          </button>
          {leidenError && (
            <div style={{ marginTop: '12px', padding: '10px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', fontSize: '13px' }}>
              {leidenError}
            </div>
          )}
          {leidenResult && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700,
                  background: leidenResult.status === 'completed' ? '#22543d' : '#744210',
                  color: leidenResult.status === 'completed' ? '#9ae6b4' : '#fbd38d',
                }}>
                  {leidenResult.status.toUpperCase()}
                </span>
                <span style={{ color: '#4a5568', fontSize: '11px', fontFamily: 'monospace' }}>{leidenResult.runId}</span>
              </div>
              <MetricTable metrics={leidenResult.metrics} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
