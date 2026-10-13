import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Position,
  ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type EdgeProps, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus } from 'lucide-react';
import type { GEdge, GNode, Lane } from '../lib/api';
import { LANE_COLUMNS, NODE_W, NODE_H, columnX, layoutByHop, layoutDagre, layoutLanes, type LaneRect } from '../lib/layout';
import { useTheme } from '../lib/theme';
import { metaFor, subtitleFor } from '../theme/graphColors';

type NodeData = {
  node: GNode;
  center: boolean;
  selected: boolean;
  dim: boolean;
  onExpand?: (n: GNode) => void;
};
type LaneData = { lane: Lane; rect: LaneRect; onOpen?: (lane: Lane) => void };
type EdgeData = { type: string; showLabel: boolean; state: 'normal' | 'hi' | 'dim'; cross: boolean };

const EntityNode = memo(function EntityNode({ data }: NodeProps<Node<NodeData>>) {
  const { node, center, selected, dim, onExpand } = data;
  const meta = metaFor(node.label);
  const Icon = meta.icon;
  const sub = subtitleFor(node.label, node.props) || meta.singular;
  const sev = node.label === 'Incident' ? String(node.props.severity ?? '') : '';
  return (
    <div
      className={`gnode${center ? ' center' : ''}${selected ? ' selected' : ''}${dim ? ' dim' : ''}${node.status === 'exposed' ? ' exposed' : ''}`}
      style={{ ['--ec' as string]: meta.color, width: NODE_W, height: NODE_H }}
      title={`${meta.singular}: ${node.name}`}
    >
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="target" position={Position.Right} id="rt" />
      <div className="ent-icon" style={{ width: 30, height: 30 }}>
        <Icon size={15} strokeWidth={2} />
      </div>
      <div className="gnode-text">
        <div className="gnode-name">{node.name}</div>
        {node.badge ? (
          <div className={`gnode-sub badge-${node.badge.tone}`}>
            <span className={`sev ${node.badge.tone}`} />
            <span className="ellipsis">{node.badge.text}</span>
          </div>
        ) : (
          <div className="gnode-sub">
            {sev && <span className={`sev ${sev}`} />}
            <span className="ellipsis">{sub}</span>
          </div>
        )}
      </div>
      {node.degree !== undefined && <span className="gnode-deg">{node.degree}</span>}
      {onExpand && (
        <button
          className="gnode-expand nodrag"
          title="Expand neighbours"
          onClick={(e) => {
            e.stopPropagation();
            onExpand(node);
          }}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
});

const LaneNode = memo(function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  const { lane, rect, onOpen } = data;
  return (
    <div className={`lane lane-${lane.kind}`} style={{ width: rect.w, height: rect.h }}>
      <div className="lane-head">
        <span className="lane-title">{lane.title}</span>
        <span className="lane-sub">{lane.subtitle}</span>
        {onOpen && lane.kind === 'campaign' && (
          <button className="lane-open nodrag" onClick={() => onOpen(lane)}>Open case →</button>
        )}
      </div>
    </div>
  );
});

const HeaderNode = memo(function HeaderNode() {
  return (
    <div className="lane-columns">
      {LANE_COLUMNS.map((c, i) => (
        <span key={c} style={{ left: columnX(i), width: NODE_W }}>{c}</span>
      ))}
    </div>
  );
});

function LabeledEdge(props: EdgeProps<Edge<EdgeData>>) {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, targetPosition, data, markerEnd, markerStart } = props;
  // Horizontal-tangent cubic; the label sits ~70% along so labels of edges
  // fanning out of one node spread out instead of stacking at the midpoint.
  const c = Math.max(Math.abs(tx - sx) * 0.5, 40);
  const c1x = sx + c;
  const c2x = targetPosition === Position.Right ? tx + c : tx - c;
  const path = `M ${sx},${sy} C ${c1x},${sy} ${c2x},${ty} ${tx},${ty}`;
  const t = 0.7, u = 1 - t;
  const lx = u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx;
  const ly = u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t * t * t * ty;
  const state = data?.state ?? 'normal';
  const stroke = state === 'hi' ? 'var(--accent)' : data?.cross ? 'var(--edge-cross)' : 'var(--edge)';
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{
          stroke,
          strokeWidth: state === 'hi' ? 1.75 : 1.25,
          strokeDasharray: data?.cross && state !== 'hi' ? '4 4' : undefined,
          opacity: state === 'dim' ? 0.12 : 1,
          transition: 'opacity .15s',
        }}
      />
      {data?.showLabel && state !== 'dim' && (
        <EdgeLabelRenderer>
          <div className={`gedge-label${state === 'hi' ? ' hi' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {data.type}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { entity: EntityNode, lane: LaneNode, header: HeaderNode };
const edgeTypes = { labeled: LabeledEdge };

export interface GraphCanvasProps {
  nodes: GNode[];
  edges: GEdge[];
  centerId?: string;
  selectedId?: string | null;
  onSelect?: (n: GNode | null) => void;
  onExpand?: (n: GNode) => void;
  showCross?: boolean;
  layout?: 'hop' | 'dagre' | 'lanes';
  lanes?: Lane[];
  onOpenLane?: (lane: Lane) => void;
  minimap?: boolean;
  labelThreshold?: number;
  maxZoom?: number;
  /** Never fit below this zoom; a tall graph opens at the top at this zoom instead and scrolls. */
  minFitZoom?: number;
}

function Canvas({
  size,
  nodes, edges, centerId, selectedId, onSelect, onExpand, showCross = true, layout = 'hop', lanes, onOpenLane,
  minimap = false, labelThreshold = 28, maxZoom = 1.15, minFitZoom = 0,
}: GraphCanvasProps & { size: { w: number; h: number } }) {
  const theme = useTheme();
  const { setViewport } = useReactFlow();
  const [hovered, setHovered] = useState<string | null>(null);

  const visibleEdges = useMemo(() => edges.filter((e) => showCross || e.kind !== 'cross'), [edges, showCross]);

  const { positions, rects } = useMemo(() => {
    if (layout === 'lanes' && lanes) return layoutLanes(nodes, lanes.map((l) => l.id));
    if (layout === 'hop' && nodes.every((n) => n.hop !== undefined)) return { positions: layoutByHop(nodes, edges), rects: [] };
    return { positions: layoutDagre(nodes, visibleEdges), rects: [] };
  }, [nodes, edges, visibleEdges, layout, lanes]);

  const focus = hovered ?? selectedId ?? null;
  const neighbours = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    visibleEdges.forEach((e) => {
      if (e.source === focus) s.add(e.target);
      if (e.target === focus) s.add(e.source);
    });
    return s;
  }, [focus, visibleEdges]);

  const rfNodes: Node[] = useMemo(() => {
    const background: Node[] = [];
    if (layout === 'lanes' && lanes) {
      background.push({ id: '__header', type: 'header', position: { x: 0, y: -34 }, data: {}, draggable: false, selectable: false, zIndex: -1 });
      rects.forEach((r) => {
        const lane = lanes.find((l) => l.id === r.id)!;
        background.push({
          id: `__lane:${r.id}`, type: 'lane', position: { x: r.x, y: r.y }, data: { lane, rect: r, onOpen: onOpenLane },
          draggable: false, selectable: false, zIndex: -1,
        });
      });
    }
    return [
      ...background,
      ...nodes.map((n) => ({
        id: n.id,
        type: 'entity',
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: {
          node: n,
          center: n.id === centerId,
          selected: n.id === selectedId,
          dim: !!neighbours && !neighbours.has(n.id),
          onExpand,
        },
        draggable: true,
      })),
    ];
  }, [nodes, positions, rects, lanes, layout, centerId, selectedId, neighbours, onExpand, onOpenLane]);

  const rfEdges: Edge<EdgeData>[] = useMemo(() => {
    const smallGraph = visibleEdges.length <= labelThreshold;
    return visibleEdges.map((e) => {
      const ps = positions.get(e.source), pt = positions.get(e.target);
      // Draw left-to-right for clean beziers; the arrowhead keeps the true direction.
      const sameCol = ps && pt && Math.abs(ps.x - pt.x) < NODE_W / 2;
      const flip = !!ps && !!pt && !sameCol && ps.x > pt.x;
      const active = !!focus && (e.source === focus || e.target === focus);
      const state: EdgeData['state'] = !focus ? 'normal' : active ? 'hi' : 'dim';
      const color = state === 'hi' ? 'var(--accent)' : e.kind === 'cross' ? 'var(--edge-cross)' : 'var(--edge)';
      const marker = { type: MarkerType.ArrowClosed, width: 14, height: 14, color };
      return {
        id: e.id,
        type: 'labeled',
        source: flip ? e.target : e.source,
        target: flip ? e.source : e.target,
        sourceHandle: 'r',
        targetHandle: sameCol ? 'rt' : 'l',
        markerEnd: flip ? undefined : marker,
        markerStart: flip ? marker : undefined,
        data: { type: e.type, showLabel: smallGraph || active, state, cross: e.kind === 'cross' },
        zIndex: active ? 10 : 0,
      };
    });
  }, [visibleEdges, positions, focus, labelThreshold]);

  // Fit the viewport ourselves: every card has a known size, so there is no
  // need to wait for React Flow to measure the DOM before framing the graph.
  const signature = nodes.map((n) => n.id).join('|');
  const fitted = useRef(false);
  useEffect(() => {
    const { w: W, h: H } = size;
    if (!W || !H || positions.size === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    positions.forEach((p) => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
    });
    rects.forEach((r) => {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y - 34);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    });
    const pad = 28;
    const bw = maxX - minX, bh = maxY - minY;
    let zoom = Math.min(maxZoom, (W - 2 * pad) / bw, (H - 2 * pad) / bh);
    let x = (W - bw * zoom) / 2 - minX * zoom;
    let y = (H - bh * zoom) / 2 - minY * zoom;
    if (minFitZoom && zoom < minFitZoom) {
      // Too tall to fit legibly: fit the width, start at the top, scroll down
      zoom = Math.min(maxZoom, Math.max(minFitZoom, (W - 2 * pad) / bw));
      x = (W - bw * zoom) / 2 - minX * zoom;
      y = pad - minY * zoom;
    }
    setViewport({ x, y, zoom }, { duration: fitted.current ? 250 : 0 });
    fitted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, size.w, size.h, positions, rects]);

  const isEntity = (n: Node) => n.type === 'entity';

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode={theme}
      panOnScroll={!!minFitZoom}
      minZoom={0.1}
      maxZoom={2}
      onNodeClick={(_, n) => isEntity(n) && onSelect?.((n.data as NodeData).node)}
      onNodeDoubleClick={(_, n) => isEntity(n) && onExpand?.((n.data as NodeData).node)}
      onPaneClick={() => onSelect?.(null)}
      onNodeMouseEnter={(_, n) => isEntity(n) && setHovered(n.id)}
      onNodeMouseLeave={() => setHovered(null)}
      nodesConnectable={false}
      elevateEdgesOnSelect
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="var(--canvas-dot)" />
      <Controls showInteractive={false} position="bottom-left" />
      {minimap && (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) =>
            isEntity(n)
              ? getComputedStyle(document.documentElement).getPropertyValue(`--c-${(n.data as NodeData).node.label}`).trim() || '#888'
              : 'transparent'
          }
          maskColor="var(--minimap-mask)"
          style={{ width: 160, height: 100 }}
        />
      )}
    </ReactFlow>
  );
}

export default function GraphCanvas(props: GraphCanvasProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="graph-canvas" ref={ref}>
      <ReactFlowProvider>
        <Canvas {...props} size={size} />
      </ReactFlowProvider>
    </div>
  );
}
