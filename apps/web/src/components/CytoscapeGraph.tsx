import { useEffect, useRef } from 'react';
// @ts-expect-error - no type declaration file for react-cytoscapejs
import CytoscapeComponent from 'react-cytoscapejs';
import cytoscape from 'cytoscape';
// @ts-expect-error – no type declarations for fcose
import fcose from 'cytoscape-fcose';

try {
  cytoscape.use(fcose);
} catch {
  // Already registered
}

const layoutConfig = {
  name: 'fcose',
  quality: 'default',
  randomize: true,
  animate: false,
  nodeRepulsion: 7500,
  idealEdgeLength: 80,
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.3,
  numIter: 2500,
  tile: true,
  tilingPaddingVertical: 30,
  tilingPaddingHorizontal: 30,
  padding: 40,
};

const buildStylesheet = (showEdgeLabels: boolean) => [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      'color': '#ffffff',
      'font-size': '11px',
      'font-family': 'sans-serif',
      'font-weight': 'bold',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 6,
      'text-wrap': 'ellipsis',
      'text-max-width': '120px',
      'text-background-color': '#0d0d1a',
      'text-background-opacity': 0.85,
      'text-background-padding': '3px',
      'text-background-shape': 'roundrectangle',
      'width': 26,
      'height': 26,
      'border-width': 2,
      'border-color': '#1a202c',
    }
  },
  {
    selector: 'node[type="Incident"]',
    style: { 'background-color': '#e74c3c', 'shape': 'diamond', 'width': 24, 'height': 24 }
  },
  {
    selector: 'node[type="Domain"]',
    style: { 'background-color': '#3498db', 'shape': 'round-rectangle', 'width': 26, 'height': 26 }
  },
  {
    selector: 'node[type="Malware"]',
    style: { 'background-color': '#e67e22', 'shape': 'triangle', 'width': 30, 'height': 30 }
  },
  {
    selector: 'node[type="ThreatActor"]',
    style: { 'background-color': '#9b59b6', 'shape': 'star', 'width': 38, 'height': 38 }
  },
  {
    selector: 'node[type="IPAddress"]',
    style: { 'background-color': '#2ecc71', 'shape': 'ellipse', 'width': 26, 'height': 26 }
  },
  // Node label only shown when hovered or selected
  {
    selector: 'node.hovered, node:selected',
    style: {
      'label': 'data(label)',
      'border-width': 3,
      'border-color': '#f6ad55',
      'shadow-blur': 12,
      'shadow-color': '#f6ad55',
      'shadow-opacity': 0.8,
      'z-index': 9999,
    }
  },
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#4a5568',
      'target-arrow-color': '#718096',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.8,
      'label': showEdgeLabels ? 'data(type)' : '',
      'font-size': '8px',
      'color': '#a0aec0',
      'curve-style': 'bezier',
      'text-background-color': '#0d0d1a',
      'text-background-opacity': 0.85,
      'text-background-padding': '2px',
      'text-rotation': 'autorotate',
    }
  },
  {
    selector: 'edge.hovered, edge:selected',
    style: {
      'label': 'data(type)',
      'width': 2.5,
      'line-color': '#f6ad55',
      'target-arrow-color': '#f6ad55',
      'color': '#f6ad55',
      'z-index': 9999,
    }
  }
];

interface GraphElement {
  data: Record<string, unknown>;
}

interface CytoscapeGraphProps {
  elements: GraphElement[];
  showEdgeLabels?: boolean;
  onNodeClick?: (nodeData: Record<string, unknown>) => void;
}

export default function CytoscapeGraph({
  elements,
  showEdgeLabels = false,
  onNodeClick
}: CytoscapeGraphProps) {
  const cyRef = useRef<cytoscape.Core | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentStylesheet: any[] = buildStylesheet(showEdgeLabels);

  useEffect(() => {
    if (cyRef.current && elements.length > 0) {
      const cy = cyRef.current;
      const l = cy.layout(layoutConfig);
      l.run();
      cy.fit(undefined, 40);
    }
  }, [elements]);

  return (
    <CytoscapeComponent
      elements={elements}
      layout={layoutConfig}
      stylesheet={currentStylesheet}
      style={{ width: '100%', height: '600px', background: '#0d0d1a' }}
      cy={(cy: cytoscape.Core) => {
        cyRef.current = cy;
        
        cy.off('tap', 'node');
        cy.on('tap', 'node', (evt: cytoscape.EventObject) => {
          const nodeData = evt.target.data();
          if (onNodeClick) {
            onNodeClick(nodeData);
          }
        });

        cy.off('mouseover', 'node');
        cy.on('mouseover', 'node', (evt: cytoscape.EventObject) => {
          evt.target.addClass('hovered');
        });

        cy.off('mouseout', 'node');
        cy.on('mouseout', 'node', (evt: cytoscape.EventObject) => {
          evt.target.removeClass('hovered');
        });

        cy.off('mouseover', 'edge');
        cy.on('mouseover', 'edge', (evt: cytoscape.EventObject) => {
          evt.target.addClass('hovered');
        });

        cy.off('mouseout', 'edge');
        cy.on('mouseout', 'edge', (evt: cytoscape.EventObject) => {
          evt.target.removeClass('hovered');
        });
      }}
    />
  );
}
