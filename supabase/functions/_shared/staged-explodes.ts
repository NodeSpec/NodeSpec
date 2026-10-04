// V3 AE.6 (owner 2026-09-25): the Expand button on the canvas stages an
// explode request for the person's agent to pick up over MCP. MCP is not
// event driven, so the request waits where the agent already looks: the
// status read leads with it, the node's slice says it, and once the agent
// has proposed the explode the status says that instead, so it is never
// proposed twice. The request lives in projects.metadata.stagedExplodes
// (no table, no column); the app writes and withdraws it, this reads it.
// A request for a node that is gone, or already exploded, is not served.

export interface StagedExplode {
  nodeId: string;
  label: string;
  stagedAt: string | null;
  /** What the person said they want from the split, when they said anything. */
  note: string | null;
}

export interface LiveStagedExplode extends StagedExplode {
  /** The pending proposal that already carries this explode, when there is one. */
  proposalId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The requests the app staged, tolerating anything else in the key. */
export function readStagedExplodes(metadata: Record<string, unknown> | null | undefined): StagedExplode[] {
  const raw = metadata?.stagedExplodes;
  if (!Array.isArray(raw)) return [];
  const out: StagedExplode[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const nodeId = typeof r.nodeId === 'string' ? r.nodeId.trim() : '';
    if (!UUID_RE.test(nodeId) || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 500) : null;
    out.push({
      nodeId,
      label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : nodeId.slice(0, 8),
      stagedAt: typeof r.stagedAt === 'string' ? r.stagedAt : null,
      note,
    });
  }
  return out;
}

type GraphNodes = Record<string, { id?: string; label?: string; parentId?: string | null } | null | undefined> | null | undefined;
type PendingProposal = { id: string; metadata?: unknown; patches?: unknown };

/** The pending proposal (if any) whose intents explode this node. */
export function proposalExploding(nodeId: string, pending: readonly PendingProposal[]): string | null {
  for (const p of pending) {
    const meta = p.metadata && typeof p.metadata === 'object' ? p.metadata as Record<string, unknown> : null;
    const intents = Array.isArray(meta?.intents) ? meta!.intents as Array<Record<string, unknown>> : [];
    for (const it of intents) {
      const ids = it?.ids && typeof it.ids === 'object' ? it.ids as Record<string, unknown> : null;
      if (it?.kind === 'explode_node' && ids?.nodeId === nodeId) return p.id;
    }
  }
  return null;
}

/** The requests still worth serving: the node exists and is not exploded
 *  (no node names it as parent); each carries the node's current label and
 *  the pending proposal that already answers it, when one does. */
export function liveStagedExplodes(
  staged: readonly StagedExplode[],
  nodes: GraphNodes,
  pending: readonly PendingProposal[],
): LiveStagedExplode[] {
  if (!nodes) return [];
  const exploded = new Set<string>();
  for (const n of Object.values(nodes)) if (n?.parentId) exploded.add(n.parentId);
  const out: LiveStagedExplode[] = [];
  for (const s of staged) {
    const node = nodes[s.nodeId];
    if (!node || exploded.has(s.nodeId)) continue;
    out.push({ ...s, label: typeof node.label === 'string' && node.label.trim() ? node.label : s.label, proposalId: proposalExploding(s.nodeId, pending) });
  }
  return out;
}

/** The project's pending proposals, id and metadata, and the patches when
 *  asked (AL.21 reads them for the import intent's outcomes). A proposal belongs to
 *  a project through the branch it was filed on (ai_proposals carries
 *  source_branch_id, never a project id), so the project's branches are
 *  read first. The client is typed narrowly on purpose: the generic query
 *  builder's types are what push the checker over its instantiation depth
 *  in the status handler. */
type PendingReader = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => PromiseLike<{ data: unknown; error?: { message: string } | null }>;
      in: (col: string, v: string[]) => { eq: (col: string, v: string) => PromiseLike<{ data: unknown; error?: { message: string } | null }> };
    };
  };
};
export async function loadPendingProposals(client: unknown, projectId: string, opts: { patches?: boolean } = {}): Promise<PendingProposal[]> {
  const db = client as PendingReader;
  const { data: branches, error: branchErr } = await db.from('branches').select('id').eq('project_id', projectId);
  if (branchErr) throw new Error(`could not read the project's branches: ${branchErr.message}`);
  const ids = (Array.isArray(branches) ? branches as Array<{ id?: unknown }> : []).map((b) => b.id).filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return [];
  const { data, error } = await db.from('ai_proposals').select(opts.patches ? 'id, metadata, patches' : 'id, metadata').in('source_branch_id', ids).eq('status', 'pending');
  if (error) throw new Error(`could not read the pending proposals: ${error.message}`);
  return Array.isArray(data) ? data as PendingProposal[] : [];
}

const q = (s: string) => `"${s.replace(/"/g, '\'')}"`;

/** The status lead: one sentence per live request, the unproposed first. */
export function stagedExplodeLead(live: readonly LiveStagedExplode[]): string {
  const asked = live.filter((e) => !e.proposalId);
  const proposed = live.filter((e) => e.proposalId);
  let lead = '';
  for (const e of asked) {
    lead += `EXPANSION REQUESTED from the canvas: the user asked for ${q(e.label)} (node ${e.nodeId}) to be exploded into its parts` +
      `${e.note ? `, saying: ${q(e.note)}` : ''}. Read the node (get_project_context view slice), claim its lease (checkout_task level node), ` +
      'then propose_patches with ONE explode_node intent: each part\'s role one the node\'s role lists (lookup_catalog), every file to one part or left on the node, why per part. ';
  }
  for (const e of proposed) {
    lead += `The expansion of ${q(e.label)} the user asked for is proposed (proposal ${e.proposalId}) and waits for their review; do not propose it again. `;
  }
  return lead;
}
