interface ContextPanelProps {
  selectedNode: Record<string, unknown> | null;
}

export default function ContextPanel({ selectedNode }: ContextPanelProps) {
  return (
    <div style={{
      width: '320px',
      flexShrink: 0,
      background: '#1a1a2e',
      border: '1px solid #2a2a4e',
      borderRadius: '8px',
      padding: '16px',
      overflowY: 'auto',
      maxHeight: '600px',
    }}>
      <h3 style={{ margin: '0 0 12px', color: '#a0aec0', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Node Context
      </h3>
      {selectedNode ? (
        <pre style={{
          margin: 0,
          fontSize: '12px',
          color: '#e2e8f0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: 'monospace',
        }}>
          {JSON.stringify(selectedNode, null, 2)}
        </pre>
      ) : (
        <p style={{ color: '#4a5568', fontSize: '13px', margin: 0 }}>
          Search for an entity to inspect its blast radius context.
        </p>
      )}
    </div>
  );
}
