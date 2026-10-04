// V3 3.1 (2026-09-19): intents inside propose_patches. An agent says what it
// wants in five structured shapes and the server compiles each to the patch
// batch it would otherwise have hand-assembled from 29 operation types with
// ordering rules. The compiled patches join the batch BEFORE validation, so
// catalog conformance and the reference check run unchanged; the proposal
// records the intents so a card can say what the agent wants without an
// explanation paragraph. patches[] stays for the long tail. No new tool.
//
// Pure: ids come from the caller, so tests can fix them.
//
// AA.3 (owner 2026-09-23): explode_node and collapse_node (explode.ts).
// split_node is retired into explode_node and kept as its alias: it compiles
// the same way, with `into` for `parts` and each part's `type` for its role.
//
// R.1 (owner 2026-09-23): reconciling a change made in git is one call. An
// add_node may name itself (`ref`) and a later intent in the same call points
// at it as "@ref", so a new service can be added, connected and given its
// files together. bind_file binds a file in the repository to a node (a new
// artifact, or an existing one moved with artifactId). Any intent may carry
// `evidence` ([{ path, line?, note? }]): it rides the intent's explanation
// into the proposal, so the person reviewing it sees where each claim comes
// from.

import { compileCollapse, compileExplode, type ExplodeContext, type RepoIndexMove } from './explode.ts';

export type IntentKind = 'add_node' | 'connect_nodes' | 'split_node' | 'explode_node' | 'collapse_node' | 'set_contract_schema' | 'place_on_step' | 'bind_file';
export const INTENT_KINDS: readonly IntentKind[] = ['add_node', 'connect_nodes', 'explode_node', 'collapse_node', 'split_node', 'set_contract_schema', 'place_on_step', 'bind_file'];

/** R.1: where an intent's claim comes from, cited in the proposal. */
export interface IntentEvidence { path: string; line?: number; note?: string }
/** AA.3: the intents that need the graph, the catalog and the repo index loaded (ExplodeContext). */
export const STRUCTURE_INTENT_KINDS: ReadonlySet<string> = new Set(['explode_node', 'collapse_node', 'split_node']);

export interface CompiledPatch { type: string; payload: Record<string, unknown> }

export interface CompiledIntent {
  kind: IntentKind;
  /** One clause, lower case, for a card: add a node "Cache" (database). */
  summary: string;
  /** The ids this intent minted, by role, so the agent can reference them next. */
  ids: Record<string, string | string[]>;
  patches: CompiledPatch[];
  explanations: string[];
  /** AA.3: repo index rows that follow their files to a part (or back) when the proposal is accepted. */
  repoIndexMoves?: RepoIndexMove[];
  /** AA.3: what the agent may want to do once this is accepted (a mapping to move). */
  suggestions?: string[];
  /** R.1: the files and lines the intent rests on. */
  evidence?: IntentEvidence[];
}

export interface CompileContext {
  /** The branch the proposal targets (place_on_step needs it in its payload). */
  branchId: string;
  newId: () => string;
  /** AA.3: the graph, the depth rule and the repo index for explode_node and collapse_node. */
  explode?: ExplodeContext;
  /** R.1: add_node refs named earlier in the same call, ref to minted node id. */
  refs?: Map<string, string>;
  /** R.1: the time a bound file's artifact is stamped with. */
  nowIso?: string;
}

/** R.1: the artifact kinds a file may be bound as. A task doc and a test plan
 *  are NodeSpec's own documents, never bound from git (as B1's declarations). */
export const BINDABLE_ARTIFACT_KINDS = ['source', 'schema', 'doc', 'config', 'build', 'design'] as const;
const REF_RE = /^[A-Za-z0-9_-]{1,40}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rec = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const uuid = (v: unknown): string | null => { const s = str(v); return s && UUID_RE.test(s) ? s : null; };
const q = (s: string) => `"${s}"`;

function fail(index: number, kind: string, what: string): { error: string } {
  return { error: `intent[${index}] (${kind}): ${what}` };
}

/** A node id: a uuid, or "@ref" naming an add_node earlier in the call. */
function nodeRef(v: unknown, ctx: CompileContext): { id: string } | { error: string } | null {
  const s = str(v);
  if (!s) return null;
  if (s.startsWith('@')) {
    const id = ctx.refs?.get(s.slice(1));
    return id ? { id } : { error: `${s} names no add_node earlier in this call (give that add_node ref: "${s.slice(1)}")` };
  }
  return UUID_RE.test(s) ? { id: s } : null;
}

/** R.1: the intent's evidence, normalised; a malformed entry is refused. */
function evidenceOf(v: unknown): IntentEvidence[] | { error: string } {
  if (v === undefined) return [];
  const list = Array.isArray(v) ? v : [v];
  const out: IntentEvidence[] = [];
  for (const e of list) {
    const r = rec(e);
    const path = r ? str(r.path) : null;
    if (!r || !path) return { error: 'evidence entries are { path, line?, note? }' };
    const line = typeof r.line === 'number' && Number.isInteger(r.line) && r.line > 0 ? r.line : undefined;
    if (r.line !== undefined && line === undefined) return { error: `evidence line for ${path} must be a positive integer` };
    const note = str(r.note);
    out.push({ path, ...(line ? { line } : {}), ...(note ? { note: note.slice(0, 200) } : {}) });
  }
  return out;
}

/** "src/cache.ts:12, package.json" for an explanation. */
export function evidenceText(evidence: IntentEvidence[]): string {
  return evidence.map((e) => `${e.path}${e.line ? `:${e.line}` : ''}${e.note ? ` (${e.note})` : ''}`).join(', ');
}

export function compileIntent(raw: unknown, index: number, ctx: CompileContext): CompiledIntent | { error: string } {
  const compiled = compileIntentBody(raw, index, ctx);
  if ('error' in compiled) return compiled;
  const it = rec(raw) as Record<string, unknown>;
  const evidence = evidenceOf(it.evidence);
  if ('error' in evidence) return fail(index, compiled.kind, evidence.error);
  if (evidence.length === 0) return compiled;
  const cite = ` (evidence: ${evidenceText(evidence)})`;
  return { ...compiled, evidence, explanations: compiled.explanations.map((e) => `${e}${cite}`) };
}

function compileIntentBody(raw: unknown, index: number, ctx: CompileContext): CompiledIntent | { error: string } {
  const it = rec(raw);
  if (!it) return { error: `intent[${index}]: must be an object with a kind` };
  const kind = str(it.kind);
  if (!kind || !(INTENT_KINDS as readonly string[]).includes(kind)) {
    return { error: `intent[${index}]: unknown kind ${JSON.stringify(it.kind ?? null)}. Expected one of ${INTENT_KINDS.join(' | ')}.` };
  }

  switch (kind as IntentKind) {
    case 'add_node': {
      const label = str(it.label); const type = str(it.type);
      if (!label) return fail(index, kind, 'label is required');
      if (!type) return fail(index, kind, 'type is required (a NodeSpec role id such as backend-service, database, cache)');
      const parent = it.parentId !== undefined ? nodeRef(it.parentId, ctx) : null;
      if (parent && 'error' in parent) return fail(index, kind, parent.error);
      if (it.parentId !== undefined && !parent) return fail(index, kind, 'parentId must be a node uuid or "@ref"');
      const parentId = parent ? parent.id : null;
      const technology = str(it.technology); const description = str(it.description);
      const ref = it.ref !== undefined ? str(it.ref) : null;
      if (it.ref !== undefined && (!ref || !REF_RE.test(ref))) return fail(index, kind, 'ref must be 1 to 40 letters, digits, _ or -');
      if (ref && ctx.refs?.has(ref)) return fail(index, kind, `ref "${ref}" is already used in this call`);
      const id = ctx.newId();
      if (ref) ctx.refs?.set(ref, id);
      const payload: Record<string, unknown> = { id, type, label };
      if (technology) payload.technology = technology;
      if (parentId) payload.parentId = parentId;
      if (description) payload.metadata = { description };
      return {
        kind: 'add_node',
        summary: `add a node ${q(label)} (${type}${technology ? `, ${technology}` : ''})`,
        ids: { nodeId: id, ...(ref ? { ref } : {}) },
        patches: [{ type: 'add_node', payload }],
        explanations: [`Add node ${q(label)}${description ? `: ${description}` : ''}`],
      };
    }
    case 'connect_nodes': {
      const src = nodeRef(it.source, ctx); const tgt = nodeRef(it.target, ctx);
      if (src && 'error' in src) return fail(index, kind, src.error);
      if (tgt && 'error' in tgt) return fail(index, kind, tgt.error);
      if (!src) return fail(index, kind, 'source must be a node uuid or "@ref"');
      if (!tgt) return fail(index, kind, 'target must be a node uuid or "@ref"');
      const source = src.id; const target = tgt.id;
      if (source === target) return fail(index, kind, 'source and target must differ');
      const sourceLabel = str(it.sourceLabel) ?? source; const targetLabel = str(it.targetLabel) ?? target;
      const contract = rec(it.contract);
      if (!contract) return fail(index, kind, 'contract is required: { id } of an existing contract, or { kind, name, schema? } for a new one');
      const edgeId = ctx.newId();
      const label = str(it.label);
      const existing = uuid(contract.id);
      if (existing) {
        const edge: Record<string, unknown> = { id: edgeId, source, target, contractId: existing };
        if (label) edge.label = label;
        return {
          kind: 'connect_nodes',
          summary: `connect ${q(sourceLabel)} to ${q(targetLabel)} over an existing contract`,
          ids: { edgeId, contractId: existing },
          patches: [{ type: 'add_edge', payload: edge }],
          explanations: [`Connect ${q(sourceLabel)} to ${q(targetLabel)}`],
        };
      }
      const ckind = str(contract.kind); const cname = str(contract.name);
      if (!ckind) return fail(index, kind, 'contract.kind is required (rest, graphql, grpc, websocket, sse, kafka, amqp, sql, nosql, ipc, dependency, custom) or pass contract.id');
      if (!cname) return fail(index, kind, 'contract.name is required');
      const schema = rec(contract.schema);
      const contractId = ctx.newId();
      const contractPayload: Record<string, unknown> = { id: contractId, kind: ckind, name: cname };
      if (schema) contractPayload.schema = schema;
      const edge: Record<string, unknown> = { id: edgeId, source, target, contractId };
      if (label) edge.label = label;
      return {
        kind: 'connect_nodes',
        summary: `connect ${q(sourceLabel)} to ${q(targetLabel)} over a ${ckind} contract ${q(cname)}`,
        ids: { edgeId, contractId },
        patches: [
          { type: 'add_contract', payload: contractPayload },
          { type: 'add_edge', payload: edge },
        ],
        explanations: [`Define the ${ckind} contract ${q(cname)}`, `Connect ${q(sourceLabel)} to ${q(targetLabel)} over it`],
      };
    }
    case 'split_node':
    case 'explode_node': {
      const c = compileExplode(it, ctx.explode, ctx.newId, kind === 'split_node' ? 'split_node' : undefined);
      if ('error' in c) return fail(index, kind, c.error);
      return { kind: 'explode_node', ...c };
    }
    case 'collapse_node': {
      const c = compileCollapse(it, ctx.explode);
      if ('error' in c) return fail(index, kind, c.error);
      return { kind: 'collapse_node', ...c };
    }
    case 'set_contract_schema': {
      const contractId = uuid(it.contractId);
      if (!contractId) return fail(index, kind, 'contractId must be a contract uuid');
      const schema = rec(it.schema);
      if (!schema || Object.keys(schema).length === 0) return fail(index, kind, 'schema must be a non-empty JSON object (the inline schema, not a string)');
      const name = str(it.contractName) ?? contractId;
      const changes: Record<string, unknown> = { schema };
      const specFormat = str(it.specFormat); if (specFormat) changes.specFormat = specFormat;
      return {
        kind: 'set_contract_schema',
        summary: `set the schema of contract ${q(name)}`,
        ids: { contractId },
        patches: [{ type: 'update_contract', payload: { id: contractId, changes } }],
        explanations: [`Set the schema of ${q(name)}`],
      };
    }
    case 'place_on_step': {
      const candidateId = uuid(it.candidateId);
      if (!candidateId) return fail(index, kind, 'candidateId must be an outcome (candidate) uuid');
      const stepIds = Array.isArray(it.stepIds) ? it.stepIds.map(uuid) : null;
      if (!stepIds || stepIds.length === 0 || stepIds.some((s) => s === null)) return fail(index, kind, 'stepIds must be a non-empty array of workflow step uuids');
      const name = str(it.candidateName) ?? candidateId;
      return {
        kind: 'place_on_step',
        summary: `place outcome ${q(name)} on ${stepIds.length} step${stepIds.length === 1 ? '' : 's'}`,
        ids: { candidateId },
        patches: [{ type: 'set_outcome_step_maps', payload: { candidateId, branchId: ctx.branchId, stepIds: stepIds as string[] } }],
        explanations: [`Place ${q(name)} on its step${stepIds.length === 1 ? '' : 's'}`],
      };
    }
    case 'bind_file': {
      const path = str(it.path)?.replace(/^\/+/, '') ?? null;
      if (!path) return fail(index, kind, 'path is required (the file\'s path in the repository)');
      if (path.startsWith('.nodespec/')) return fail(index, kind, `${path} is NodeSpec's own file; it is never bound to a node`);
      const node = nodeRef(it.nodeId, ctx);
      if (node && 'error' in node) return fail(index, kind, node.error);
      if (!node) return fail(index, kind, 'nodeId must be a node uuid or "@ref"');
      const nodeLabel = str(it.nodeLabel) ?? node.id;
      const artifactKind = str(it.artifactKind) ?? 'source';
      if (!(BINDABLE_ARTIFACT_KINDS as readonly string[]).includes(artifactKind)) {
        return fail(index, kind, `artifactKind must be one of ${BINDABLE_ARTIFACT_KINDS.join(' | ')} (a task doc or test plan is NodeSpec's own, never bound)`);
      }
      const existing = it.artifactId !== undefined ? uuid(it.artifactId) : null;
      if (it.artifactId !== undefined && !existing) return fail(index, kind, 'artifactId must be the uuid of the file\'s artifact');
      if (existing) {
        return {
          kind: 'bind_file',
          summary: `bind ${path} to ${q(nodeLabel)}`,
          ids: { artifactId: existing },
          patches: [{ type: 'update_artifact', payload: { id: existing, changes: { nodeId: node.id } } }],
          explanations: [`Move ${path} to ${q(nodeLabel)}`],
        };
      }
      const at = ctx.nowIso ?? new Date().toISOString();
      const artifactId = ctx.newId();
      return {
        kind: 'bind_file',
        summary: `bind ${path} to ${q(nodeLabel)}`,
        ids: { artifactId },
        patches: [{ type: 'add_artifact', payload: { id: artifactId, nodeId: node.id, kind: artifactKind, path, createdAt: at, updatedAt: at } }],
        explanations: [`Bind ${path} to ${q(nodeLabel)}`],
      };
    }
  }
}

export interface CompiledBatch {
  intents: CompiledIntent[];
  patches: CompiledPatch[];
  explanations: string[];
  /** Which intent each compiled patch came from, by patch index. */
  originOf: number[];
}

export function compileIntents(raw: unknown, ctx: CompileContext): CompiledBatch | { error: string } {
  if (!Array.isArray(raw)) return { error: 'intents must be an array' };
  // R.1: refs are per call, shared by every intent in it.
  ctx = { ...ctx, refs: ctx.refs ?? new Map<string, string>() };
  const intents: CompiledIntent[] = []; const patches: CompiledPatch[] = []; const explanations: string[] = []; const originOf: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = compileIntent(raw[i], i, ctx);
    if ('error' in c) return c;
    intents.push(c);
    for (let k = 0; k < c.patches.length; k++) { patches.push(c.patches[k]); explanations.push(c.explanations[k] ?? c.summary); originOf.push(i); }
  }
  return { intents, patches, explanations, originOf };
}

/** "Wants to add a node "Cache", and connect ..." for a card. */
export function intentsTitle(intents: Array<{ summary?: unknown }>): string | null {
  const parts = intents.map((i) => (typeof i.summary === 'string' ? i.summary : null)).filter((x): x is string => !!x);
  if (parts.length === 0) return null;
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
  return `Wants to ${joined}`;
}
