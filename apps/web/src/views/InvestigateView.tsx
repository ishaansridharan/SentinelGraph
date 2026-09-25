import { useState, useEffect, useCallback } from 'react';
import CytoscapeGraph from '../components/CytoscapeGraph';
import ContextPanel from '../components/ContextPanel';
import { NODE_TYPE_COLORS, NODE_TYPE_ORDER, DEFAULT_NODE_COLOR, darken } from '../theme/graphColors';

const API_BASE = 'http://localhost:8000';

interface RawNode   { [key: string]: unknown }
interface RawEdge   { [key: string]: unknown }
interface GraphData { nodes: RawNode[]; edges: RawEdge[] }

// Neo4j element_id format "4:uuid:N" contains colons which Cytoscape
// misparses as CSS attribute selectors — sanitize by replacing with underscores.
const safeId = (raw: unknown) => String(raw).replace(/:/g, '_');

function toElements(data: GraphData) {
  const nodes = data.nodes.map((n) => {
    const labels = (n['_labels'] as string[]) ?? [];
    const primaryLabel = labels[0] ?? 'Unknown';
    const color = NODE_TYPE_COLORS[primaryLabel] ?? DEFAULT_NODE_COLOR;
    return {
      data: {
        ...n,   // spread first so our explicit fields below override API's own 'id'
        id:    safeId(n['_element_id'] ?? n['id'] ?? Math.random()),
        label: String(n['name'] ?? n['value'] ?? n['entityKey'] ?? n['id'] ?? primaryLabel),
        type:  primaryLabel,
        color,
        borderColor: darken(color),
      },
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.data.id));
  const edges = data.edges
    .map((e, i) => ({
      data: {
        id:     safeId(e['_element_id'] ?? `e${i}`),
        source: safeId(e['_start_id']),
        target: safeId(e['_end_id']),
        type:   String(e['_type'] ?? e['type'] ?? ''),
      },
    }))
    .filter((e) => nodeIds.has(e.data.source) && nodeIds.has(e.data.target));

  return [...nodes, ...edges];
}

// Converts blast-radius response format → unified GraphData
function blastToGraphData(raw: { origin: RawNode; nodes: RawNode[]; edges: RawEdge[] }): GraphData {
  // Deduplicate nodes (origin is also in nodes list)
  const seen = new Set<string>();
  const nodes: RawNode[] = [];
  for (const n of raw.nodes) {
    const key = String(n['_element_id'] ?? n['id']);
    if (!seen.has(key)) { seen.add(key); nodes.push(n); }
  }
  return { nodes, edges: raw.edges };
}

export default function InvestigateView() {
  const [entityKey, setEntityKey]   = useState('');
  const [loading, setLoading]       = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [elements, setElements]     = useState<ReturnType<typeof toElements>>([]);
  const [selectedNode, setSelectedNode] = useState<RawNode | null>(null);
  const [mode, setMode]             = useState<'full' | 'blast'>('full');

  // Load full graph on mount
  const loadFullGraph = useCallback(async () => {
    setInitialLoad(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/graph/full`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data: GraphData = await res.json();
      setElements(toElements(data));
      setSelectedNode(null);
      setMode('full');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => { loadFullGraph(); }, [loadFullGraph]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityKey.trim()) { loadFullGraph(); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/graph/blast-radius/${encodeURIComponent(entityKey)}`
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const raw = await res.json();
      if (!raw.nodes || raw.nodes.length === 0) {
        setError(`No entity found matching "${entityKey}". Try searching for an ID (e.g. ta-apt28) or name (e.g. APT28).`);
        setElements([]);
        setSelectedNode(null);
        setMode('blast');
        return;
      }
      const data = blastToGraphData(raw);
      setElements(toElements(data));
      setSelectedNode(raw.origin ?? null);
      setMode('blast');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => { setEntityKey(''); loadFullGraph(); };

  return (
    <div style={{ padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: '#e2e8f0' }}>Threat Graph</h2>
        <span style={{
          padding: '3px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700,
          background: mode === 'blast' ? '#44337a' : '#1a365d',
          color:      mode === 'blast' ? '#d6bcfa' : '#90cdf4',
        }}>
          {mode === 'blast' ? `BLAST RADIUS: ${entityKey}` : 'FULL GRAPH'}
        </span>
        {mode === 'blast' && (
          <button
            onClick={handleReset}
            style={{ padding: '4px 12px', background: 'transparent', border: '1px solid #4a5568', borderRadius: '6px', color: '#a0aec0', cursor: 'pointer', fontSize: '12px' }}
          >
            ← Show Full Graph
          </button>
        )}
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <input
          type="text"
          value={entityKey}
          onChange={(e) => setEntityKey(e.target.value)}
          placeholder="Enter entity key to focus blast radius (e.g. update-srv01.ru)"
          style={{
            flex: 1,
            padding: '10px 16px',
            background: '#1a1a2e',
            border: '1px solid #2a2a4e',
            borderRadius: '6px',
            color: '#e2e8f0',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 24px',
            background: loading ? '#2d3748' : '#3182ce',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {loading ? 'Loading…' : 'Focus'}
        </button>
      </form>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {NODE_TYPE_ORDER.map((label) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: NODE_TYPE_COLORS[label] }} />
            <span style={{ fontSize: '12px', color: '#a0aec0' }}>{label}</span>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#742a2a', borderRadius: '6px', color: '#fed7d7', marginBottom: '16px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {/* Main panel */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <ContextPanel selectedNode={selectedNode} />
        <div style={{
          flex: 1,
          background: '#1a1a2e',
          border: '1px solid #2a2a4e',
          borderRadius: '8px',
          overflow: 'hidden',
          position: 'relative',
        }}>
          {initialLoad || loading ? (
            <div style={{ height: '600px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontSize: '14px' }}>
              {initialLoad ? 'Loading full threat graph…' : 'Focusing on blast radius…'}
            </div>
          ) : (
            <CytoscapeGraph
              elements={elements}
              showEdgeLabels={mode === 'blast'}
              onNodeClick={(data) => setSelectedNode(data)}
            />
          )}
          <div style={{ position: 'absolute', bottom: 12, right: 12, fontSize: '11px', color: '#4a5568' }}>
            {elements.filter(e => !('source' in e.data)).length} nodes · {elements.filter(e => 'source' in e.data).length} edges
          </div>
        </div>
      </div>
    </div>
  );
}
