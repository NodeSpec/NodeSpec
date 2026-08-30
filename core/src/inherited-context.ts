// N8.4r — CLIENT MIRROR of supabase/functions/_shared/inherited-context.ts. Keep the two
// implementations behaviourally identical (the enums.ts pattern: two runtimes, one rule).
//
// Owner 2026-07-27: "For Azure and GCP, just like the primary AWS project container node,
// ensure there's configuration the user can specify that will further SCOPE its contained
// nodes." The scoping was the missing half — platform containers have carried a
// configurable account/subscription/project context since 4a-4c, but every AI-facing
// surface printed only the parent's label and type, so the configured region, environment,
// IAM baseline and tagging policy reached nothing that builds.

export interface InheritedScope {
  containerId: string;
  containerLabel: string;
  containerType: string;
  values: Record<string, unknown>;
}

interface GraphLike {
  nodes: Record<string, {
    id: string;
    label: string;
    type: string;
    parentId?: string;
    metadata?: Record<string, unknown>;
  }>;
}

const MAX_DEPTH = 12;

/** Ancestor configuration, OUTERMOST FIRST. Nearest ancestor wins a key collision. */
export function collectInheritedScopes(graph: GraphLike, nodeId: string): InheritedScope[] {
  const chain: InheritedScope[] = [];
  const seen = new Set<string>([nodeId]);
  let current = graph.nodes[nodeId]?.parentId;
  let depth = 0;

  while (current && depth < MAX_DEPTH) {
    if (seen.has(current)) break; // cycle guard
    seen.add(current);
    const ancestor = graph.nodes[current];
    if (!ancestor) break;

    const config = ancestor.metadata?.config as Record<string, unknown> | undefined;
    if (config) {
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config)) {
        // Blank means "not answered" — the inspector writes '' on focus-then-blur.
        if (v === null || v === undefined || v === '') continue;
        values[k] = v;
      }
      if (Object.keys(values).length > 0) {
        chain.push({
          containerId: ancestor.id,
          containerLabel: ancestor.label,
          containerType: ancestor.type,
          values,
        });
      }
    }

    current = ancestor.parentId;
    depth++;
  }

  return chain.reverse();
}

/** Flattened view: nearest ancestor wins a key collision. */
export function effectiveInheritedValues(scopes: InheritedScope[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const scope of scopes) Object.assign(out, scope.values);
  return out;
}
