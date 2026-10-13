export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3031';

export type Props = Record<string, unknown>;

export interface GNode {
  id: string;
  key: string;
  label: string;
  labels: string[];
  name: string;
  props: Props;
  degree?: number;
  hop?: number;
  via?: boolean;
  score?: number;
  incidents?: number;
  lane?: string;
  col?: number;
  status?: 'hit' | 'exposed' | 'targeted';
  badge?: { text: string; tone: string };
}

export interface Lane {
  id: string;
  kind: 'campaign' | 'shared';
  title: string;
  subtitle: string;
  campaigns: string[];
  status?: string;
}

export interface CampaignMap {
  lanes: Lane[];
  nodes: GNode[];
  edges: GEdge[];
  ms: number;
}

export interface CaseStats {
  incidents: number;
  open: number;
  critical: number;
  victims: number;
  exposedNotHit: number;
  lastActivity: string | null;
}

export interface CaseEvent {
  at: string;
  title: string;
  detail?: string;
  entityKeys?: string[];
  severity?: string;
  note?: boolean;
}

export interface CaseFile {
  id: string;
  title: string;
  priority: 'P1' | 'P2' | 'P3';
  status: 'open' | 'monitoring' | 'closed';
  owner: string;
  campaignIds: string[];
  campaigns: { key: string; name: string; actor?: string }[];
  openedAt: string;
  updatedAt: string;
  summary: string;
  findings: { title: string; detail?: string; entityKeys?: string[] }[];
  recommendations: { text: string; done: boolean }[];
  timeline?: CaseEvent[];
  stats?: CaseStats;
  entities?: Record<string, GNode>;
}

export interface AttentionItem {
  kind: 'attribution' | 'exposure' | 'overlap' | 'critical';
  severity: string;
  title: string;
  detail: string;
  entityKeys: string[];
  focus: string;
  path?: [string, string];
}

export interface StoryStep {
  stage: string;
  title: string;
  text: string;
  entityKeys?: string[];
}

export interface StoryRef {
  campaign: string;
  campaignKey: string;
  index: number;
  of: number;
  stage: string;
  title: string;
  text: string;
}

export interface CampaignStory {
  key: string;
  name: string;
  status: string;
  objective: string;
  summary: string;
  realWorld: string;
  actor: { key: string; name: string; alias: string; description: string } | null;
  story: StoryStep[];
}

export interface RelationshipExplanation {
  type: string;
  from: { key: string; name: string; label: string };
  to: { key: string; name: string; label: string };
  sentence: string;
  evidence: { confidence: number | null; source: string | null; firstSeen: string | null; lastSeen: string | null };
  steps: StoryRef[];
}

export interface EntityExplanation {
  key: string;
  name: string;
  label: string;
  title?: string;
  text: string | null;
  steps: StoryRef[];
}

export interface Overview {
  kpis: { activeCampaigns: number; openIncidents: number; criticalOpen: number; orgsAffected: number; exposedNotHit: number; unattributed: number };
  campaigns: Record<string, CaseStats>;
}

export interface GEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  props: Props;
  kind?: 'tree' | 'cross';
}

export interface Subgraph {
  center: GNode;
  nodes: GNode[];
  edges: GEdge[];
  reached: number;
  truncated: boolean;
  cypher: string;
  ms: number;
}

export interface BlastRadius extends Subgraph {
  summary: {
    byLabel: Record<string, number>;
    byHop: Record<string, number>;
    organizations: GNode[];
    incidents: GNode[];
    actors: GNode[];
    campaigns: GNode[];
  };
}

export interface PathResult {
  nodes: GNode[];
  edges: GEdge[];
  paths: number;
  length: number | null;
  cypher: string;
  ms: number;
}

export interface Connection {
  relationship: GEdge;
  direction: 'in' | 'out';
  node: GNode;
}

export interface EntityDetail {
  entity: GNode;
  connections: Connection[];
  incidents: GNode[];
  cases: { id: string; title: string; priority: string; status: string }[];
}

export interface FieldDef {
  name: string;
  type: 'text' | 'textarea' | 'number' | 'bool' | 'select' | 'list' | 'date' | 'datetime';
  label: string;
  options: string[] | null;
  required: boolean;
}

export interface LabelSchema {
  label: string;
  plural: string;
  collection: string;
  fields: FieldDef[];
}

export interface Schema {
  labels: LabelSchema[];
  relationships: { type: string; pairs: [string, string][] }[];
  relationshipFields: FieldDef[];
  collections: Record<string, number>;
}

export interface Stats {
  labels: Record<string, { count: number; delta: number }>;
  nodes: number;
  relationships: number;
}

export interface Activity {
  id: string;
  at: string;
  action: 'create' | 'update' | 'delete';
  kind: 'node' | 'relationship';
  label: string;
  entityKey: string;
  summary: string;
  actor: string;
}

export interface CypherResult {
  columns: string[];
  rows: unknown[][];
  graph: { nodes: GNode[]; edges: GEdge[]; starts: string[] };
  ms: number;
  count: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error(`Cannot reach the API at ${API_BASE}`);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const q = (params: Record<string, string | number | boolean | undefined>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && s.set(k, String(v)));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const api = {
  schema: () => request<Schema>('/api/v2/schema'),
  stats: () => request<Stats>('/api/v2/stats'),
  search: (query: string, limit = 8, label?: string) =>
    request<GNode[]>(`/api/v2/search${q({ q: query, limit, label })}`),
  entities: (label: string, opts: { q?: string; sort?: string; skip?: number; limit?: number } = {}) =>
    request<{ total: number; items: GNode[] }>(`/api/v2/entities${q({ label, ...opts })}`),
  entity: (key: string) => request<EntityDetail>(`/api/v2/entities/${encodeURIComponent(key)}`),
  createEntity: (label: string, properties: Props) =>
    request<GNode>('/api/v2/entities', { method: 'POST', body: JSON.stringify({ label, properties }) }),
  updateEntity: (key: string, properties: Props) =>
    request<GNode>(`/api/v2/entities/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify({ properties }) }),
  deleteEntity: (key: string) =>
    request<{ deleted: string; relationshipsRemoved: number }>(`/api/v2/entities/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  createRelationship: (type: string, source: string, target: string, properties: Props) =>
    request<{ id: string }>('/api/v2/relationships', { method: 'POST', body: JSON.stringify({ type, source, target, properties }) }),
  updateRelationship: (id: string, properties: Props) =>
    request<{ id: string }>(`/api/v2/relationships/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ properties }) }),
  deleteRelationship: (id: string) =>
    request<{ deleted: string }>(`/api/v2/relationships/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  neighborhood: (key: string, depth = 1, limit = 40, labels?: string[]) =>
    request<Subgraph>(`/api/v2/graph/neighborhood/${encodeURIComponent(key)}${q({ depth, limit, labels: labels?.join(',') })}`),
  blastRadius: (key: string, depth = 3, limit = 150) =>
    request<BlastRadius>(`/api/v2/graph/blast-radius/${encodeURIComponent(key)}${q({ depth, limit })}`),
  path: (source: string, target: string) => request<PathResult>(`/api/v2/graph/path${q({ source, target })}`),
  cypher: (query: string) => request<CypherResult>('/api/v2/cypher', { method: 'POST', body: JSON.stringify({ query }) }),
  breakdown: () => request<Record<'severity' | 'incidentType' | 'status' | 'sector', Record<string, number>>>('/api/v2/insights/breakdown'),
  activity: (limit = 8) => request<Activity[]>(`/api/v2/activity${q({ limit })}`),
  overview: () => request<Overview>('/api/v2/overview'),
  attention: () => request<AttentionItem[]>('/api/v2/attention'),
  map: (campaigns?: string[]) => request<CampaignMap>(`/api/v2/map${q({ campaigns: campaigns?.join(',') })}`),
  cases: () => request<CaseFile[]>('/api/v2/cases'),
  caseFile: (id: string) => request<CaseFile>(`/api/v2/cases/${encodeURIComponent(id)}`),
  updateCase: (id: string, patch: Partial<Pick<CaseFile, 'status' | 'priority' | 'owner' | 'recommendations'>>) =>
    request<CaseFile>(`/api/v2/cases/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addCaseNote: (id: string, text: string, entityKeys: string[] = []) =>
    request<CaseFile>(`/api/v2/cases/${encodeURIComponent(id)}/notes`, { method: 'POST', body: JSON.stringify({ text, entityKeys }) }),
  pagerank: () => request<{ ms: number; nodesWritten: number; iterations: number; top: GNode[] }>('/api/v2/analytics/pagerank', { method: 'POST' }),
  communities: () =>
    request<{
      ms: number;
      communityCount: number;
      modularity: number;
      communities: { id: number; size: number; hubs: GNode[]; actors: string[]; campaigns: string[]; organizations: string[]; incidents: number }[];
    }>('/api/v2/analytics/communities', { method: 'POST' }),
  campaignStory: (key: string) => request<CampaignStory>(`/api/v2/campaigns/${encodeURIComponent(key)}/story`),
  explainRelationship: (id: string) => request<RelationshipExplanation>(`/api/v2/explain/relationship/${encodeURIComponent(id)}`),
  explainEntity: (key: string) => request<EntityExplanation>(`/api/v2/explain/entity/${encodeURIComponent(key)}`),
  health: () => request<{ status: string }>('/health'),
};
