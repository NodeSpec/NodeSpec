import type { Node, Graph } from './types.js';
import { canContainerHoldNode, getCanContainRoleIds, getContainerTypeById, resolveContainerRoleId } from './container-types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateContainerHierarchy(graph: Graph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const node of Object.values(graph.nodes)) {
    if (node.parentId) {
      const parent = graph.nodes[node.parentId];

      if (!parent) {
        errors.push(`Node "${node.label}" has invalid parent ID: ${node.parentId}`);
        continue;
      }

      if (!canContainerHoldNode(parent.type, node.type, undefined, node.technology, parent.technology)) {
        errors.push(
          `Container "${parent.label}" (${parent.type}) cannot contain node "${node.label}" (${node.type}). ` +
          `Check container type definitions for allowed children.`
        );
      }

      const parentDef = getContainerTypeById(parent.type);
      if (parentDef && parentDef.layer === 'runtime' && node.parentId) {
        warnings.push(
          `Runtime containers like "${parent.label}" typically don't contain other nodes. ` +
          `Consider using orchestration or logical boundaries instead.`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateNodePlacement(nodeType: string, parentId: string | undefined, graph: Graph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!parentId) {
    return { valid: true, errors: [], warnings: [] };
  }

  const parent = graph.nodes[parentId];
  if (!parent) {
    errors.push(`Parent node not found: ${parentId}`);
    return { valid: false, errors, warnings };
  }

  if (!canContainerHoldNode(parent.type, nodeType)) {
    const parentDef = getContainerTypeById(parent.type);
    errors.push(
      `Cannot place ${nodeType} inside ${parent.type}. ` +
      (parentDef ? `Allowed types: ${getCanContainRoleIds(parentDef).join(', ') || 'provider-based matching'}` : '')
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function suggestParentContainers(nodeType: string, graph: Graph): Node[] {
  const suggestions: Node[] = [];

  for (const node of Object.values(graph.nodes)) {
    if (canContainerHoldNode(node.type, nodeType)) {
      const containerDef = getContainerTypeById(node.type);
      if (containerDef) {
        suggestions.push(node);
      }
    }
  }

  suggestions.sort((a, b) => {
    const aDef = getContainerTypeById(a.type);
    const bDef = getContainerTypeById(b.type);

    const layerOrder = {
      infrastructure: 1,
      orchestration: 2,
      runtime: 3,
      logical: 4,
    };

    const aOrder = aDef ? layerOrder[aDef.layer] : 5;
    const bOrder = bDef ? layerOrder[bDef.layer] : 5;

    return aOrder - bOrder;
  });

  return suggestions;
}

export function deriveContainerMetadata(container: Node, graph: Graph): Record<string, unknown> {
  const children = Object.values(graph.nodes).filter(n => n.parentId === container.id);

  const derivedData: Record<string, unknown> = {
    childCount: children.length,
  };

  const roleId = resolveContainerRoleId(container.type);

  if (roleId === 'docker-container') {
    const allDependencies = new Set<string>();

    for (const child of children) {
      const metadata = child.metadata?.domainMetadata as any;
      if (metadata?.data?.dependencies) {
        const deps = Array.isArray(metadata.data.dependencies)
          ? metadata.data.dependencies
          : [];
        deps.forEach((dep: string) => allDependencies.add(dep));
      }
    }

    if (allDependencies.size > 0) {
      derivedData.derivedDependencies = Array.from(allDependencies);
    }
  }

  if (roleId === 'k8s-cluster') {
    const serviceCount = children.filter(c =>
      c.type.includes('service') || c.type.includes('deployment')
    ).length;

    derivedData.recommendedNodeCount = Math.max(3, Math.ceil(serviceCount / 10) * 3);
  }

  if (roleId === 'vpc') {
    const needsPublicAccess = children.some(c =>
      c.type.includes('frontend') || c.type.includes('load-balancer')
    );

    if (needsPublicAccess) {
      derivedData.suggestInternetGateway = true;
    }
  }

  return derivedData;
}
