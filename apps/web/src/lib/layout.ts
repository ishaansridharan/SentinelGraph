import dagre from '@dagrejs/dagre';
import type { GEdge, GNode } from './api';

export const NODE_W = 208;
export const NODE_H = 54;

export type Positions = Map<string, { x: number; y: number }>;

/**
 * Left-to-right layered layout for traversal results: column = hop distance
 * from the focus entity. Rows inside a column are ordered by the barycenter of
 * their tree-parents so edges flow mostly straight, and very tall columns wrap
 * into sub-columns so a 60-node hop doesn't become a 4000px strip.
 */
export function layoutByHop(nodes: GNode[], edges: GEdge[], maxRows = Math.max(12, Math.ceil(Math.sqrt(nodes.length) * 2.2))): Positions {
  const byHop = new Map<number, GNode[]>();
  nodes.forEach((n) => {
    const h = n.hop ?? 0;
    if (!byHop.has(h)) byHop.set(h, []);
    byHop.get(h)!.push(n);
  });
  const hopOf = new Map(nodes.map((n) => [n.id, n.hop ?? 0]));

  // parents = neighbours one hop closer to the focus
  const parents = new Map<string, string[]>();
  edges.forEach((e) => {
    const hs = hopOf.get(e.source), ht = hopOf.get(e.target);
    if (hs === undefined || ht === undefined) return;
    if (ht === hs + 1) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);
    else if (hs === ht + 1) parents.set(e.source, [...(parents.get(e.source) ?? []), e.target]);
  });

  const order = new Map<string, number>();
  const hops = [...byHop.keys()].sort((a, b) => a - b);
  const pos: Positions = new Map();
  const colGap = 96;
  const rowGap = 16;
  let x = 0;

  for (const h of hops) {
    const col = byHop.get(h)!;
    const bary = (n: GNode) => {
      const ps = (parents.get(n.id) ?? []).map((p) => order.get(p)).filter((v): v is number => v !== undefined);
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
    };
    col.sort((a, b) => bary(a) - bary(b) || a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
    col.forEach((n, i) => order.set(n.id, i));

    const subCols = Math.ceil(col.length / maxRows);
    const rows = Math.ceil(col.length / subCols);
    col.forEach((n, i) => {
      const sc = Math.floor(i / rows);
      const r = i % rows;
      const colHeight = rows * (NODE_H + rowGap) - rowGap;
      pos.set(n.id, { x: x + sc * (NODE_W + 28), y: r * (NODE_H + rowGap) - colHeight / 2 });
    });
    x += subCols * (NODE_W + 28) - 28 + colGap;
  }
  return pos;
}

/** General-purpose layered layout (dagre) for graphs without hop distances. */
export function layoutDagre(nodes: GNode[], edges: GEdge[], rankdir: 'LR' | 'TB' = 'LR'): Positions {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 18, ranksep: 90, marginx: 10, marginy: 10 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  });
  dagre.layout(g);
  const pos: Positions = new Map();
  nodes.forEach((n) => {
    const p = g.node(n.id);
    if (p) pos.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  });
  return pos;
}

export const LANE_COLUMNS = ['Actor', 'Campaign', 'Tools & CVEs', 'Domains', 'IPs & registrants', 'Victims'];
const COL_STEP = NODE_W + 46;
const ROW_STEP = NODE_H + 14;
const LANE_HEAD = 46;
const LANE_PAD = 18;
const LANE_GAP = 22;

export interface LaneRect { id: string; x: number; y: number; w: number; h: number }

const ORG_ORDER: Record<string, number> = { hit: 0, targeted: 1, exposed: 2 };

/**
 * Swim-lane layout for the campaign map: one horizontal band per lane (a
 * campaign, or infrastructure shared by several), fixed columns inside it that
 * follow the attack from actor to victim.
 */
export function layoutLanes(nodes: GNode[], laneIds: string[]): { positions: Positions; rects: LaneRect[] } {
  const positions: Positions = new Map();
  const rects: LaneRect[] = [];
  const width = LANE_COLUMNS.length * COL_STEP - 46 + LANE_PAD * 2;
  let y = 0;
  for (const lid of laneIds) {
    const inLane = nodes.filter((n) => n.lane === lid);
    const cols = new Map<number, GNode[]>();
    inLane.forEach((n) => {
      const c = n.col ?? 0;
      cols.set(c, [...(cols.get(c) ?? []), n]);
    });
    const rows = Math.max(1, ...[...cols.values()].map((c) => c.length));
    const h = LANE_HEAD + rows * ROW_STEP - 14 + LANE_PAD;
    cols.forEach((list, c) => {
      list.sort((a, b) => (ORG_ORDER[a.status ?? ''] ?? 9) - (ORG_ORDER[b.status ?? ''] ?? 9)
        || a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
      const offset = ((rows - list.length) * ROW_STEP) / 2;
      list.forEach((n, i) => positions.set(n.id, { x: LANE_PAD + c * COL_STEP, y: y + LANE_HEAD + offset + i * ROW_STEP }));
    });
    rects.push({ id: lid, x: 0, y, w: width, h });
    y += h + LANE_GAP;
  }
  return { positions, rects };
}

export function columnX(col: number) {
  return LANE_PAD + col * COL_STEP;
}
