import { useCallback, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Graph, PatchOperation } from '@nodespec/core/types.js';
import { canContainerHoldNode, getContainerTypeById } from '@nodespec/core/container-types.js';
import { isContainerType } from '../adapters/rf-visual-type-resolver.js';
import { createUpdateNodePatch } from '@nodespec/core/patch-factory.js';
import { effectiveTreatmentForRole } from '@nodespec/core/ontology.js';
import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';
import type { ActorType, PlacementKind } from '@nodespec/core/types.js';

// N2/N2.3: client mirror of the server-side rule in
// supabase/functions/_shared/tool-executor.ts::inferPlacementKind — the two paths (canvas
// drag here; AI/MCP set_parent there) MUST agree, so both take the child type + technology
// and apply the EFFECTIVE-boundary rule (role default, or raised by a boundary-engine
// technology like n8n — effectiveTreatment). A boundary child scopes into any non-hosting
// container; hosting infrastructure still hosts it.
function inferPlacementKindFromCatalog(
  catalog: CatalogResolver | null,
  containerType: string,
  childType?: string,
  childTechnology?: string,
): PlacementKind {
  if (!catalog) return 'contains';
  const role = catalog.getRole(containerType);
  if (!role) return 'contains';
  if (role.containerLayer === 'infrastructure') return 'hosts';
  if (childType) {
    const childRole = catalog.getRole(childType);
    const override = childTechnology
      ? (catalog.getTechnology(childTechnology)?.aiContext as Record<string, unknown> | undefined)?.treatmentOverride
      : undefined;
    if (!childRole?.isContainer &&
        effectiveTreatmentForRole({ nature: childRole?.nature, is_container: childRole?.isContainer }, typeof override === 'string' ? override : undefined) === 'boundary') {
      return 'scopes';
    }
  }
  if (role.containerLayer === 'logical') return 'scopes';
  return 'contains';
}

const UNDOCK_THRESHOLD = 60;

export interface DragReparentState {
  dropTargetId: string | null;
}

export function useDragReparent(
  graph: Graph,
  catalog: CatalogResolver | null,
  actorType: ActorType,
  onPatchesGenerated: ((patches: PatchOperation[]) => void) | undefined,
  onWarning: ((msg: string) => void) | undefined,
) {
  const reactFlow = useReactFlow();
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggedNodeRef = useRef<string | null>(null);
  const originalParentRef = useRef<string | undefined>(undefined);

  const findContainerAtPosition = useCallback((
    draggedNodeId: string,
    screenX: number,
    screenY: number,
  ): string | null => {
    const allNodes = reactFlow.getNodes();
    const containers = allNodes.filter(n =>
      (n.type === 'container' || n.type === 'logicalBoundary') &&
      n.id !== draggedNodeId &&
      !n.hidden
    );

    let bestMatch: { id: string; area: number } | null = null;

    for (const container of containers) {
      const el = document.querySelector(`[data-id="${container.id}"]`);
      if (!el) continue;
      const rect = el.getBoundingClientRect();

      if (
        screenX >= rect.left &&
        screenX <= rect.right &&
        screenY >= rect.top &&
        screenY <= rect.bottom
      ) {
        const area = rect.width * rect.height;
        if (!bestMatch || area < bestMatch.area) {
          bestMatch = { id: container.id, area };
        }
      }
    }

    return bestMatch?.id ?? null;
  }, [reactFlow]);

  const isOutsideParentBounds = useCallback((
    nodeId: string,
    screenX: number,
    screenY: number,
  ): boolean => {
    const node = reactFlow.getNode(nodeId);
    if (!node?.parentId) return false;

    const parentEl = document.querySelector(`[data-id="${node.parentId}"]`);
    if (!parentEl) return false;

    const rect = parentEl.getBoundingClientRect();
    return (
      screenX < rect.left - UNDOCK_THRESHOLD ||
      screenX > rect.right + UNDOCK_THRESHOLD ||
      screenY < rect.top - UNDOCK_THRESHOLD ||
      screenY > rect.bottom + UNDOCK_THRESHOLD
    );
  }, [reactFlow]);

  const handleNodeDragStart = useCallback((_event: React.MouseEvent, rfNode: { id: string }) => {
    const graphNode = graph.nodes[rfNode.id];
    draggedNodeRef.current = rfNode.id;
    originalParentRef.current = graphNode?.parentId;
  }, [graph.nodes]);

  const handleNodeDrag = useCallback((_event: React.MouseEvent, rfNode: { id: string }) => {
    const mouseEvent = _event as unknown as MouseEvent;
    const hoveredContainer = findContainerAtPosition(
      rfNode.id,
      mouseEvent.clientX,
      mouseEvent.clientY,
    );

    const graphNode = graph.nodes[rfNode.id];
    if (!graphNode) {
      setDropTargetId(null);
      return;
    }

    if (hoveredContainer && hoveredContainer !== graphNode.parentId) {
      const containerNode = graph.nodes[hoveredContainer];
      if (containerNode && canContainerHoldNode(containerNode.type, graphNode.type, undefined, graphNode.technology, containerNode.technology)) {
        setDropTargetId(hoveredContainer);
        return;
      }
    }

    setDropTargetId(null);
  }, [graph.nodes, findContainerAtPosition]);

  const handleNodeDragStop = useCallback((_event: React.MouseEvent, rfNode: { id: string }) => {
    const mouseEvent = _event as unknown as MouseEvent;
    const nodeId = rfNode.id;
    const graphNode = graph.nodes[nodeId];

    setDropTargetId(null);
    draggedNodeRef.current = null;

    if (!graphNode || !onPatchesGenerated) {
      originalParentRef.current = undefined;
      return;
    }

    if (isContainerType(graphNode.type, catalog)) {
      originalParentRef.current = undefined;
      return;
    }

    const hoveredContainer = findContainerAtPosition(
      nodeId,
      mouseEvent.clientX,
      mouseEvent.clientY,
    );

    if (hoveredContainer && hoveredContainer !== graphNode.parentId) {
      const containerNode = graph.nodes[hoveredContainer];
      if (!containerNode) {
        originalParentRef.current = undefined;
        return;
      }

      if (canContainerHoldNode(containerNode.type, graphNode.type, undefined, graphNode.technology, containerNode.technology)) {
        const placementKind = inferPlacementKindFromCatalog(catalog, containerNode.type, graphNode.type, graphNode.technology);
        const patch = createUpdateNodePatch(
          nodeId,
          { parentId: hoveredContainer, placementKind },
          {
            actorType,
            summary: `Move ${graphNode.label} into ${containerNode.label}`,
          }
        );
        onPatchesGenerated([patch]);
      } else {
        const containerDef = getContainerTypeById(containerNode.type);
        const friendlyName = containerDef?.label || containerNode.label;
        const nodeLabel = graphNode.label;
        onWarning?.(`${friendlyName} cannot contain ${nodeLabel}`);
      }

      originalParentRef.current = undefined;
      return;
    }

    if (
      graphNode.parentId &&
      isOutsideParentBounds(nodeId, mouseEvent.clientX, mouseEvent.clientY)
    ) {
      const parentNode = graph.nodes[graphNode.parentId];
      const patch = createUpdateNodePatch(
        nodeId,
        { parentId: undefined, placementKind: undefined },
        {
          actorType,
          summary: `Undock ${graphNode.label} from ${parentNode?.label || 'container'}`,
        }
      );
      onPatchesGenerated([patch]);
    }

    originalParentRef.current = undefined;
  }, [graph.nodes, catalog, actorType, onPatchesGenerated, onWarning, findContainerAtPosition, isOutsideParentBounds]);

  return {
    dropTargetId,
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
  };
}
