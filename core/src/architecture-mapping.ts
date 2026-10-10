// AL.24: the keyword heuristic that maps the nodes an accepted proposal adds
// to the requirements their words overlap. It lived inside the app's
// ProposalService; it moved here so the server's Auto accept maps exactly as
// a person's accept does (the server runs a generated copy of core).

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been',
  'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'it',
  'that', 'this', 'can', 'will', 'should', 'must', 'may', 'all', 'each',
  'has', 'have', 'had', 'not', 'but', 'if', 'its', 'into', 'new', 'any',
]);

export function extractMatchTerms(...inputs: string[]): string[] {
  const terms = new Set<string>();
  for (const input of inputs) {
    if (!input) continue;
    const tokens = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t));
    for (const t of tokens) terms.add(t);
  }
  return Array.from(terms);
}

export function computeOverlapScore(nodeTerms: string[], reqTerms: string[]): number {
  const reqSet = new Set(reqTerms);
  let exact = 0;
  let partial = 0;
  for (const nt of nodeTerms) {
    if (reqSet.has(nt)) {
      exact++;
    } else {
      for (const rt of reqTerms) {
        if ((nt.length >= 4 && rt.includes(nt)) || (rt.length >= 4 && nt.includes(rt))) {
          partial++;
          break;
        }
      }
    }
  }
  return exact * 2 + partial;
}

export interface MappingNode {
  id: string;
  label: string;
  type: string;
  technology?: string;
}

export interface MappingRequirement {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  acceptanceCriteria?: ReadonlyArray<{ text: string }> | null;
}

export interface ProposedMapping {
  requirementId: string;
  nodeId: string;
  mappingType: 'implements';
  confidence: number;
  notes: string;
}

/** The mappings for the nodes a proposal adds, in the order it adds them.
 *  A container is never mapped, nor a node already mapped; each other node
 *  goes to the requirement its words overlap best, when the score is 2 or
 *  more. When a node is added twice, its last payload is the one read. Pure. */
export function proposeArchitectureMappings(
  nodes: readonly MappingNode[],
  requirements: readonly MappingRequirement[],
  alreadyMapped: ReadonlySet<string>,
  isContainer: (type: string) => boolean,
): ProposedMapping[] {
  const byId = new Map<string, MappingNode>();
  for (const n of nodes) if (n.id) byId.set(n.id, n);
  const implementationIds = nodes.filter((n) => n.id && !isContainer(n.type || '')).map((n) => n.id);
  const mappings: ProposedMapping[] = [];
  for (const nodeId of implementationIds) {
    if (alreadyMapped.has(nodeId)) continue;
    const node = byId.get(nodeId);
    if (!node) continue;
    const nodeTerms = extractMatchTerms(node.label || '', node.type || '', node.technology || '');
    if (nodeTerms.length === 0) continue;
    let best: { reqId: string; score: number } | null = null;
    for (const req of requirements) {
      const reqTerms = extractMatchTerms(
        req.name,
        req.description || '',
        req.category || '',
        ...(req.acceptanceCriteria || []).map((ac) => ac.text),
      );
      const score = computeOverlapScore(nodeTerms, reqTerms);
      if (score > 0 && (!best || score > best.score)) best = { reqId: req.id, score };
    }
    if (best && best.score >= 2) {
      const confidence = Math.min(0.9, 0.5 + best.score * 0.1);
      mappings.push({
        requirementId: best.reqId,
        nodeId,
        mappingType: 'implements',
        confidence: Math.round(confidence * 100) / 100,
        notes: `Auto-mapped by keyword heuristic (score: ${best.score})`,
      });
    }
  }
  return mappings;
}
