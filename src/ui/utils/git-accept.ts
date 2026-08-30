// R3-4b: accepted external content carries provenance. WHERE the content came from
// lives on the artifact — `sourceProvenance` names the origin lane and
// `metadata.provenance` carries the details (commit sha) — and in the patch ledger
// (the sha rides the summary). A `suggested` artifact accepting real git content is
// promoted to draft: accepted content must be REAL (visible to push and the AI),
// not parked behind the suggested filter (the pre-R3-4b silent black hole).
import type { Artifact, ArtifactKind, Node, PatchOperation } from '@nodespec/core/types.js';
import { createUpdateArtifactPatch, createAddArtifactPatch } from '@nodespec/core/patch-factory.js';
import { computeContentHash, generateUUID, now } from '@nodespec/core/utils.js';
import { buildUpdateNodePatch } from '../builders/patchBuilders.js';

export function buildGitAcceptPatch(
  current: Artifact | undefined,
  artifactId: string,
  newContent: string,
  path: string,
  sourceCommit?: string,
): ReturnType<typeof createUpdateArtifactPatch> {
  const updates: Partial<Omit<Artifact, 'id'>> = {
    content: newContent,
    sourceProvenance: 'git-accept',
    metadata: {
      ...(current?.metadata ?? {}),
      provenance: {
        origin: 'git-accept',
        ...(sourceCommit ? { commitSha: sourceCommit } : {}),
        at: new Date().toISOString(),
      },
    },
    ...(current?.status === 'suggested' ? { status: 'draft' as const } : {}),
  };
  return createUpdateArtifactPatch(artifactId, updates, {
    actorType: 'human',
    summary: `Accepted external change for ${path}${sourceCommit ? ` (commit ${sourceCommit.slice(0, 8)})` : ''}`,
  });
}

// R3-4c: a coarse extension→kind default for residue binds — the user can change
// the kind later in the workbench; 'source' is the honest fallback.
export function inferArtifactKindFromPath(path: string): ArtifactKind {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  if (base === 'dockerfile' || base === 'makefile' || ext === 'gradle') return 'build';
  if (ext === 'md' || ext === 'rst' || ext === 'txt' || ext === 'adoc') return 'doc';
  if (ext === 'sql' || ext === 'prisma' || ext === 'proto' || ext === 'graphql') return 'schema';
  if (ext === 'json' || ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'ini' || ext === 'env') return 'config';
  return 'source';
}

/**
 * R3-4c: bind an unattributed repo file (residue) to a node — the manual
 * attribution lane. Creates the artifact BINDING (with content when the caller
 * fetched it) plus the node-array link, exactly the pair the workbench create flow
 * emits, stamped with the shared provenance convention. The next sweep matches the
 * path, so the file stops reading as residue.
 *
 * APPLY SEQUENTIALLY, IN ORDER (one proposePatches call per patch, the workbench
 * pattern): the engine's sortPatchesByDependencyOrder puts update_node BEFORE
 * add_artifact within one batch, so the link's artifact-reference check would fail
 * against the pre-batch graph.
 *
 * Owner bench 2026-07-29 (bind silently failed): applyPatches runs a WHOLE-GRAPH
 * validation after every patch — a stale dangling artifact id already sitting on
 * the node fails even the unrelated add_artifact patch ("node references
 * non-existent artifact"). When `liveArtifactIds` reveals stale ids, the sequence
 * therefore LEADS with a heal patch that prunes them (N5.13's read-time-pruning
 * stance), making the graph valid before the add/link pair runs.
 */
export function buildResidueBindPatches(
  node: Node,
  path: string,
  content: string,
  sourceCommit?: string,
  /** Live artifact ids in the graph — the node's existing array is PRUNED against
   *  this (owner bench 2026-07-29: a stale dangling id on the node failed the link
   *  patch's MISSING_ARTIFACT check, invisibly killing the bind; same read-time
   *  pruning stance as N5.13's phantom-mapping hygiene). */
  liveArtifactIds?: ReadonlySet<string>,
): PatchOperation[] {
  const artifactId = generateUUID();
  const timestamp = now();
  const existingIds = node.artifacts ?? [];
  const prunedIds = liveArtifactIds
    ? existingIds.filter(id => liveArtifactIds.has(id))
    : existingIds;
  const healPatches: PatchOperation[] = prunedIds.length !== existingIds.length
    ? [buildUpdateNodePatch({
        nodeId: node.id,
        updates: { artifacts: prunedIds },
        actor: 'human',
        summary: `Prune ${existingIds.length - prunedIds.length} stale artifact reference(s) from ${node.label}`,
      })]
    : [];
  const artifact: Artifact = {
    id: artifactId,
    nodeId: node.id,
    kind: inferArtifactKindFromPath(path),
    path,
    content,
    contentHash: computeContentHash(content),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'draft',
    sourceProvenance: 'git-residue-bind',
    metadata: {
      provenance: {
        origin: 'git-residue-bind',
        ...(sourceCommit ? { commitSha: sourceCommit } : {}),
        at: new Date().toISOString(),
      },
    },
  };
  return [
    ...healPatches,
    createAddArtifactPatch(artifact, {
      actorType: 'human',
      summary: `Bind repo file ${path} to ${node.label}`,
    }),
    buildUpdateNodePatch({
      nodeId: node.id,
      updates: { artifacts: [...prunedIds, artifactId] },
      actor: 'human',
      summary: `Link artifact ${path} to node ${node.label}`,
    }),
  ];
}
