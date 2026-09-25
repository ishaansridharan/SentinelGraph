// Muted, CVD-validated-as-far-as-possible categorical palette for the threat
// graph's 5 node types, tuned for the app's dark navy surface. Kept in one
// place so InvestigateView (which computes each node's `color` field) and
// CytoscapeGraph (which renders it) never drift apart.
export const NODE_TYPE_COLORS: Record<string, string> = {
  Incident:    '#e66767',
  Domain:      '#3987e5',
  IPAddress:   '#008300',
  Malware:     '#c98500',
  ThreatActor: '#7c5cbf',
};

export const NODE_TYPE_ORDER = ['Incident', 'Malware', 'Domain', 'IPAddress', 'ThreatActor'];

export const DEFAULT_NODE_COLOR = '#718096';

// Darkened variant of each node color, used as a subtle border ring so nodes
// read as one solid shape instead of a flat color swatch.
export function darken(hex: string, amount = 0.35): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
