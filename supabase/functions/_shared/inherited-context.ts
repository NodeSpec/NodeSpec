// N8.4r (owner 2026-07-27: "For Azure and GCP, just like the primary AWS project
// container node, ensure there's configuration the user can specify that will further
// SCOPE its contained nodes").
//
// The scoping was the missing half. Platform containers have carried a configurable
// account/subscription/project context since 4a-4c, but every AI-facing surface printed
// only the parent's LABEL and TYPE — the configured region, environment, IAM baseline
// and tagging policy reached nothing. The user filled in a form that changed no output.
//
// This module walks the ancestor chain once and is shared by the task packet and the
// MCP node context, so the two cannot drift (the 4a-3b/3c lesson: the same traceability
// gap had to be fixed twice because two surfaces each did their own thing).

export interface InheritedScope {
  containerId: string;
  containerLabel: string;
  containerType: string;
  /** Configured values on that ancestor — never empty (callers skip empty ancestors). */
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

/** Guard against a malformed graph looping forever; also the practical nesting ceiling
 *  (platform → vpc → subnet → k8s-cluster → namespace is already deep). */
const MAX_DEPTH = 12;

/**
 * Ancestor configuration, OUTERMOST FIRST — the account/subscription/project scope reads
 * before the narrower ones, which is the order a reader needs to understand narrowing.
 * A nearer ancestor's value for the same key wins; `effectiveInheritedValues` applies it.
 */
export function collectInheritedScopes(graph: GraphLike, nodeId: string): InheritedScope[] {
  const chain: InheritedScope[] = [];
  const seen = new Set<string>([nodeId]);
  let current = graph.nodes[nodeId]?.parentId;
  let depth = 0;

  while (current && depth < MAX_DEPTH) {
    if (seen.has(current)) break; // cycle
    seen.add(current);
    const ancestor = graph.nodes[current];
    if (!ancestor) break;

    const config = ancestor.metadata?.config as Record<string, unknown> | undefined;
    if (config) {
      // Blank strings are "not answered", not "answered with empty" — the inspector
      // writes them when a user focuses a field and leaves it.
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(config)) {
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

/** Flattened view: nearest ancestor wins a key collision (the narrower scope overrides). */
export function effectiveInheritedValues(scopes: InheritedScope[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const scope of scopes) Object.assign(out, scope.values);
  return out;
}

/**
 * Markdown block for the task packet. Empty string when there is nothing inherited, so
 * callers can append unconditionally without emitting a hollow heading.
 */
export function renderInheritedContext(scopes: InheritedScope[]): string {
  if (scopes.length === 0) return '';
  const lines: string[] = ['**Inherited Context (set on the containers this node lives in — honor these):**'];
  for (const scope of scopes) {
    const pairs = Object.entries(scope.values)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' · ');
    lines.push(`- From **${scope.containerLabel}** (${scope.containerType}): ${pairs}`);
  }
  if (scopes.length > 1) {
    lines.push('');
    lines.push('_Listed outermost first; where the same setting appears twice, the innermost container wins._');
  }
  return lines.join('\n');
}
