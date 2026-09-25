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

// One shape for every node type — identity is carried by color + the legend,
// never by a zoo of diamonds/triangles/stars.
const NODE_SHAPE = 'ellipse';
const NODE_SIZE = 22;
const HIGHLIGHT = '#8fa3c4';

const buildStylesheet = (showEdgeLabels: boolean) => [
  {
    selector: 'node',
    style: {
      'shape': NODE_SHAPE,
      'background-color': 'data(color)',
      'width': NODE_SIZE,
      'height': NODE_SIZE,
      'border-width': 1.5,
      'border-color': 'data(borderColor)',
      'border-opacity': 0.9,
      'color': '#e2e8f0',
      'font-size': '10px',
      'font-family': 'system-ui, sans-serif',
      'font-weight': 500,
      'text-valign': 'bottom',
      'text-halign': 'center',
      'text-margin-y': 5,
      'text-wrap': 'ellipsis',
      'text-max-width': '120px',
      'text-background-color': '#0d0d1a',
      'text-background-opacity': 0.85,
      'text-background-padding': '3px',
      'text-background-shape': 'roundrectangle',
    }
  },
  // Node label only shown when hovered or selected
  {
    selector: 'node.hovered, node:selected',
    style: {
      'label': 'data(label)',
      'border-width': 2,
      'border-color': HIGHLIGHT,
      'border-opacity': 1,
      'shadow-blur': 6,
      'shadow-color': HIGHLIGHT,
      'shadow-opacity': 0.45,
      'z-index': 9999,
    }
  },
  {
    selector: 'edge',
    style: {
      'width': 1,
      'line-color': '#33334d',
      'target-arrow-color': '#4a5568',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 0.7,
      'label': showEdgeLabels ? 'data(type)' : '',
      'font-size': '8px',
      'font-family': 'system-ui, sans-serif',
      'color': '#8992a8',
      'curve-style': 'bezier',
      'opacity': 0.7,
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
      'width': 1.75,
      'line-color': HIGHLIGHT,
      'target-arrow-color': HIGHLIGHT,
      'color': '#e2e8f0',
      'opacity': 1,
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
