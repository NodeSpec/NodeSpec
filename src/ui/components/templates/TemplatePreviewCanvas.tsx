import { useMemo, useEffect, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Controls } from '@xyflow/react';
import type { Graph } from '@nodespec/core/types.js';
import { mapGraphToRFNodes, mapGraphToRFEdges } from '../../adapters/graph-to-reactflow.js';
import { computePreviewLayout } from '../../utils/preview-layout.js';
import { edgeTypes } from '../edges/index.js';
import { ThemeProvider } from '../../theme/ThemeContext.js';
import { CatalogService } from '../../services/CatalogService.js';
import type { CatalogResolver } from '../../../persistence/supabase/catalog-repository.js';
import { TemplatePreviewNode } from '../nodes/TemplatePreviewNode.js';
import { TemplatePreviewContainerNode } from '../nodes/TemplatePreviewContainerNode.js';
import { nodeTypes as fullNodeTypes } from '../nodes/index.js';

interface TemplatePreviewCanvasProps {
  graphData: Graph;
  height?: number | string;
  variant?: 'mini' | 'detail';
  fullscreen?: boolean;
}

const previewNodeTypes = {
  ...fullNodeTypes,
  icon: TemplatePreviewNode,
  service: TemplatePreviewNode,
  database: TemplatePreviewNode,
  api: TemplatePreviewNode,
  queue: TemplatePreviewNode,
  cache: TemplatePreviewNode,
  external: TemplatePreviewNode,
  library: TemplatePreviewNode,
  compactIcon: TemplatePreviewNode,
  container: TemplatePreviewContainerNode,
  logicalBoundary: TemplatePreviewContainerNode,
};

function useCatalogResolver(): CatalogResolver | null {
  const [resolver, setResolver] = useState<CatalogResolver | null>(null);

  useEffect(() => {
    let cancelled = false;
    CatalogService.getResolver().then(r => {
      if (!cancelled) setResolver(r);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return resolver;
}

const MUTED_STYLE = { background: 'transparent', opacity: 0.85 };

function TemplatePreviewCanvasInner({ graphData, height = 200, fullscreen = false }: TemplatePreviewCanvasProps) {
  const catalog = useCatalogResolver();

  const { layoutNodes, layoutEdges } = useMemo(() => {
    const rfNodes = mapGraphToRFNodes(graphData, 'nested', catalog).filter(n => !n.hidden);
    const rfEdges = mapGraphToRFEdges(graphData, 'nested', catalog);

    const { positions, sizes } = computePreviewLayout(rfNodes, rfEdges);
    const posMap = new Map(positions.map(p => [p.id, { x: p.x, y: p.y }]));
    const sizeMap = new Map(sizes.map(s => [s.id, { width: s.width, height: s.height }]));

    let fallbackIdx = 0;
    const positioned = rfNodes.map(node => {
      const pos = posMap.get(node.id);
      const size = sizeMap.get(node.id);
      const updates: Record<string, unknown> = {};
      if (pos) {
        updates.position = pos;
      } else if (!node.parentId) {
        updates.position = { x: 60 + fallbackIdx * 160, y: 60 };
        fallbackIdx++;
      }
      if (size) {
        updates.width = size.width;
        updates.height = size.height;
      }
      return Object.keys(updates).length > 0
        ? { ...node, ...updates }
        : node;
    });

    return { layoutNodes: positioned, layoutEdges: rfEdges };
  }, [graphData, catalog]);

  const interactive = fullscreen;

  return (
    <div style={{
      width: '100%',
      height,
      ...(!interactive ? { pointerEvents: 'none' as const } : {}),
    }}>
      <ReactFlow
        nodes={layoutNodes}
        edges={layoutEdges}
        nodeTypes={previewNodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={interactive
          ? { padding: 0.2, minZoom: 0.05, maxZoom: 1.5 }
          : { padding: 0.35, minZoom: 0.15, maxZoom: 0.85 }
        }
        minZoom={interactive ? 0.05 : 0.1}
        maxZoom={interactive ? 2 : 1}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={interactive}
        preventScrolling={fullscreen}
        proOptions={{ hideAttribution: true }}
        style={MUTED_STYLE}
      >
        {interactive && (
          <Controls
            showInteractive={false}
            position="bottom-right"
            style={{
              borderRadius: '8px',
              border: '1px solid rgba(0, 0, 0, 0.1)',
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(8px)',
            }}
          />
        )}
      </ReactFlow>
    </div>
  );
}

export function TemplatePreviewCanvas(props: TemplatePreviewCanvasProps) {
  return (
    <ThemeProvider defaultMode="light" readOnly>
      <ReactFlowProvider>
        <TemplatePreviewCanvasInner {...props} />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}
