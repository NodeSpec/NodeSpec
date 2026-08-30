// R6: scale-surface helpers for the spec plane — pure, no I/O, pinned by
// src/tests/spec-scale-surfaces.test.ts. The panel stays usable at 100+
// requirements by collapsing sections by default past a threshold (collapsed
// sections unmount their cards — the render valve), summarizing each section
// header, and filtering by recency / expansion lineage.
import type { Requirement } from '../../../persistence/supabase/requirements-repository.js';
import type { RequirementRelation } from '../../../persistence/supabase/requirement-relations-repository.js';
import { computeArchivedRowIds } from '../../../../supabase/functions/_shared/derive-status.js';

/** Above this many requirements the panel starts with every section collapsed. */
export const DEFAULT_COLLAPSE_THRESHOLD = 25;

/** Sentinel section key for requirements without a section — collapsible like a real one. */
export const UNSECTIONED_KEY = '__unsectioned__';

export function shouldDefaultCollapse(reqCount: number): boolean {
  return reqCount > DEFAULT_COLLAPSE_THRESHOLD;
}

export interface SectionMetSummary {
  reqCount: number;
  criteriaMet: number;
  criteriaTotal: number;
}

export function computeSectionMetSummary(
  reqs: Array<Pick<Requirement, 'acceptanceCriteria'>>,
): SectionMetSummary {
  let criteriaMet = 0;
  let criteriaTotal = 0;
  for (const req of reqs) {
    for (const ac of req.acceptanceCriteria || []) {
      criteriaTotal += 1;
      if (ac.met) criteriaMet += 1;
    }
  }
  return { reqCount: reqs.length, criteriaMet, criteriaTotal };
}

/** "5 reqs · 3/12 criteria met" — criteria clause omitted when there are none. */
export function formatSectionSummary(summary: SectionMetSummary): string {
  const reqs = `${summary.reqCount} req${summary.reqCount !== 1 ? 's' : ''}`;
  if (summary.criteriaTotal === 0) return reqs;
  return `${reqs} · ${summary.criteriaMet}/${summary.criteriaTotal} criteria met`;
}

export const RECENTLY_ADDED_WINDOW_DAYS = 7;

export function isRecentlyAdded(
  req: Pick<Requirement, 'createdAt'>,
  nowMs: number,
  windowDays: number = RECENTLY_ADDED_WINDOW_DAYS,
): boolean {
  const created = Date.parse(req.createdAt);
  if (Number.isNaN(created)) return false;
  return nowMs - created <= windowDays * 24 * 60 * 60 * 1000 && created <= nowMs;
}

/** Row ids of requirements that carry an 'expands' relation onto a COMPLETED
 *  requirement — the "expansions of completed work" filter's membership set. */
export function computeExpansionOfCompletedIds(
  relations: RequirementRelation[],
  isCompletedByRowId: (rowId: string) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (const rel of relations) {
    if (rel.relationType !== 'expands') continue;
    if (isCompletedByRowId(rel.toRequirementId)) out.add(rel.fromRequirementId);
  }
  return out;
}

// ── Decomposition canvas: archived lineage (Section G 7b) ────────────────────
// "Edges are for structure. Time is for panels." Supersession is a TEMPORAL
// relation; the canvas axis is structural, so req→req edges are never drawn
// (supersedes the R6 commit-8 relation edges). Instead: a completed requirement
// that a newer one 'expands' is ARCHIVED — it leaves the canvas — and the
// superseding card carries a lineage chip opening the version chain.

export interface LineageChainEntry {
  rowId: string;
  requirementId: string;
  name: string;
  status: string;
  updatedAt: string;
}

export interface ArchivedLineage {
  /** Row ids that leave the canvas (completed + superseded by an 'expands'). */
  archivedRowIds: Set<string>;
  /** Superseding row id → its version chain, direct predecessor first. */
  chainByRowId: Map<string, LineageChainEntry[]>;
}

export function computeArchivedLineage(
  requirements: Array<Pick<Requirement, 'id' | 'requirementId' | 'name' | 'status' | 'acceptanceCriteria' | 'updatedAt'>>,
  relations: RequirementRelation[],
): ArchivedLineage {
  const byId = new Map(requirements.map(r => [r.id, r]));

  // expands edges: from (newer) → to (older)
  const expandsTargets = new Map<string, string[]>();
  for (const rel of relations) {
    if (rel.relationType !== 'expands') continue;
    if (!byId.has(rel.fromRequirementId) || !byId.has(rel.toRequirementId)) continue;
    const list = expandsTargets.get(rel.fromRequirementId) ?? [];
    list.push(rel.toRequirementId);
    expandsTargets.set(rel.fromRequirementId, list);
  }

  // D2: the archived-set rule is SHARED with the server-side BOARD.md
  // generator (one completed-rule, both projections) — see _shared.
  const archivedRowIds = computeArchivedRowIds(requirements, relations);

  // Version chain for each ACTIVE superseding requirement: walk expands links
  // through archived predecessors, direct predecessor first (cycle-guarded).
  const chainByRowId = new Map<string, LineageChainEntry[]>();
  for (const [fromId, targets] of expandsTargets) {
    if (archivedRowIds.has(fromId)) continue; // only active cards carry the chip
    const chain: LineageChainEntry[] = [];
    const seen = new Set<string>([fromId]);
    let frontier = targets.filter(t => archivedRowIds.has(t));
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        if (seen.has(id)) continue;
        seen.add(id);
        const r = byId.get(id)!;
        chain.push({ rowId: r.id, requirementId: r.requirementId, name: r.name, status: r.status, updatedAt: r.updatedAt });
        for (const t of expandsTargets.get(id) ?? []) {
          if (archivedRowIds.has(t)) next.push(t);
        }
      }
      frontier = next;
    }
    if (chain.length > 0) chainByRowId.set(fromId, chain);
  }

  return { archivedRowIds, chainByRowId };
}

// ── Test-plan presence (plan↔evidence alignment) ──────────────────────────────
//
// CLIENT MIRROR of the server's findExistingTestArtifact
// (supabase/functions/_shared/test-document-generator.ts) — the match rules must
// stay value-identical or the canvas and the MCP lane disagree about whether a
// requirement's plan exists. Match order:
//   1. metadata.requirementId — rename-proof, stamped on every plan since C4;
//   2. the id-only path (.nodespec/tests/<req-id-slug>.tests.md);
//   3. the legacy id+name path — pre-C4 plans, findable while the name is unchanged.
// Evidence (test_cases rows) without a matching plan artifact is an ORPHAN the
// repo cannot explain; the tests column surfaces that state instead of hiding it.

export interface TestPlanArtifactLike {
  kind: string;
  path?: string;
  metadata?: Record<string, unknown> | null;
}

function testDocumentSlugPath(base: string): string {
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `.nodespec/tests/${slug}.tests.md`;
}

export function findTestPlanArtifact<T extends TestPlanArtifactLike>(
  artifacts: Record<string, T>,
  requirementId: string,
  requirementName: string,
): T | null {
  const plans = Object.values(artifacts).filter((a) => a?.kind === 'test-plan');
  for (const artifact of plans) {
    if (artifact.metadata?.requirementId === requirementId) return artifact;
  }
  const newPath = testDocumentSlugPath(requirementId);
  for (const artifact of plans) {
    if (artifact.path === newPath) return artifact;
  }
  const legacyPath = testDocumentSlugPath(`${requirementId}-${requirementName}`);
  for (const artifact of plans) {
    if (artifact.path === legacyPath) return artifact;
  }
  return null;
}
