// S1-3: the `requirements` tool bucket — create/update/delete/set_lock/list_requirements.
// Moved verbatim from index.ts (no logic change). A leaf bucket: depends only on shared
// helpers. The two internal helpers (resolveSpecForProject, resolveRequirementRow) travel
// with it — they were used exclusively by these handlers. Structural supabase param +
// type-only SupabaseClient so it's offline-testable. NOTE: get_test_plan is the sixth
// requirements-ish tool but is assembly-heavy — it stays in index.ts for the later heavy
// chunk.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName, UUID_RE } from "../shared.ts";
// R6: cross-bucket import (same precedent as git.ts → proposals.ts) — lineage
// recorded at creation rides the relations bucket's resolver.
import { createRelationsForNewRequirement } from "./relations.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";

// Owner bench 2026-07-29 (requirements pushed over MCP, UI showed only one): this
// used bare .maybeSingle(), which ERRORS when a project carries more than one
// project_specifications row — the error read as "no spec" and every subsequent
// create_requirement minted ANOTHER spec, scattering each requirement onto its own
// spec row (the initial duplicates came from parallel first-time creates racing the
// no-spec check). The canonical pick is NEWEST-first — the same row the client UI
// displays (getByProjectId orders created_at desc and uses [0]) and the same
// convention tasks.ts/agent.ts/git-drift already use. Repair for scattered data:
// scripts/repair-duplicate-specifications.sql.
// C4: exported — test-results.ts (report_test_results) validates requirement→project
// scoping through the same spec resolution these handlers use.
export async function resolveSpecForProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('project_specifications')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/** Discovered #8: the next free REQ-NNN for a spec. Numeric max over existing
 *  ids (never lexicographic), padded to 3 digits but unbounded beyond 999. */
export async function nextRequirementId(supabase: SupabaseClient, specId: string): Promise<string> {
  const { data: rows } = await supabase
    .from('specification_requirements')
    .select('requirement_id')
    .eq('specification_id', specId)
    .like('requirement_id', 'REQ-%');
  let maxNum = 0;
  for (const row of rows || []) {
    const num = parseInt(String(row.requirement_id).slice(4), 10);
    if (!Number.isNaN(num) && num > maxNum) maxNum = num;
  }
  return `REQ-${String(maxNum + 1).padStart(3, '0')}`;
}

// Accepts either the row uuid or the human-readable requirement_id ("REQ-001").
// C4: exported for test-results.ts (report_test_results).
export async function resolveRequirementRow(
  supabase: SupabaseClient,
  specificationId: string,
  requirementRef: string,
): Promise<{ id: string; requirement_id: string; name: string; locked: boolean; acceptance_criteria?: unknown } | null> {
  const column = UUID_RE.test(requirementRef) ? 'id' : 'requirement_id';
  const { data } = await supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, locked, acceptance_criteria')
    .eq('specification_id', specificationId)
    .eq(column, requirementRef)
    .maybeSingle();
  return data ?? null;
}

// WS3 split verification lanes (design ruling D-2: no test_type enum change, no
// migration): a criterion is either AUTOMATED (default — proven only by
// report_test_results evidence) or MANUAL (proven only by ticking the criterion box in
// the owning node's task doc and having the user approve the change card — the R5
// tick+approval lane; report_test_results refuses to bind it). 'automated' is stored as
// an ABSENT verification key: the default needs no marker, and every pre-WS3 row
// already means automated.
export type CriterionInput = string | { text: string; verification?: 'automated' | 'manual' };

// Validates + normalizes the wire shapes into { text, verification? } where
// verification survives ONLY as 'automated' | 'manual' | undefined — undefined means
// "caller said nothing", which create treats as automated and update treats as
// "carry the prior lane forward" (the same discipline met/testId already get).
function normalizeCriterionInputs(
  list: unknown[],
): { criteria: Array<{ text: string; verification?: 'automated' | 'manual' }> } | { error: string } {
  const criteria: Array<{ text: string; verification?: 'automated' | 'manual' }> = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (!entry) return { error: 'Acceptance criteria must be non-empty strings or { text, verification? } objects.' };
      criteria.push({ text: entry });
      continue;
    }
    const text = (entry as { text?: unknown } | null)?.text;
    if (!entry || typeof entry !== 'object' || typeof text !== 'string' || text.length === 0) {
      return { error: 'Acceptance criteria must be non-empty strings or { text, verification? } objects.' };
    }
    const verification = (entry as { verification?: unknown }).verification;
    if (verification !== undefined && verification !== 'automated' && verification !== 'manual') {
      return { error: `Invalid verification "${String(verification)}". Valid: automated (default), manual.` };
    }
    criteria.push(verification === undefined ? { text } : { text, verification });
  }
  return { criteria };
}

// Owner request 2026-08-22: the AI can file requirements into the SAME
// sections the app manages by hand (specification_sections — the grouping the
// Spec view and the Work Board render). Resolution is by NAME, trimmed and
// case-insensitive, against this spec's sections; a miss creates the section
// at the end of the order. Returns the stored row so responses echo the
// canonical name (the existing casing wins over the caller's).
async function resolveOrCreateSection(
  supabase: SupabaseClient,
  specId: string,
  name: string,
): Promise<{ id: string; name: string } | { error: string }> {
  const wanted = name.trim();
  if (!wanted) return { error: 'section must be a non-empty section name.' };
  if (wanted.length > 120) return { error: 'section name too long (max 120 chars).' };
  const { data: rows, error } = await supabase
    .from('specification_sections')
    .select('id, name, order_index')
    .eq('specification_id', specId);
  if (error) return { error: `Failed to read sections: ${error.message}` };
  const existing = (rows || []) as Array<{ id: string; name: string; order_index: number | null }>;
  const hit = existing.find((s) => s.name.trim().toLowerCase() === wanted.toLowerCase());
  if (hit) return { id: hit.id, name: hit.name };
  const maxOrder = existing.reduce((max, s) => Math.max(max, s.order_index ?? 0), -1);
  const { data: created, error: createError } = await supabase
    .from('specification_sections')
    .insert({ specification_id: specId, name: wanted, order_index: maxOrder + 1 })
    .select('id, name')
    .single();
  if (createError || !created) {
    return { error: `Failed to create section "${wanted}": ${createError?.message || 'unknown error'}` };
  }
  return { id: created.id as string, name: created.name as string };
}

export async function handleCreateRequirement(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: {
    project_id: string;
    name: string;
    description: string;
    category?: string;
    acceptance_criteria?: CriterionInput[];
    requirement_id?: string;
    /** Section NAME to file the requirement under (resolved case-insensitively,
     *  created when absent). */
    section?: string;
    /** R6: record lineage AT creation (source 'ai'); unresolvable targets are
     *  reported, never fatal. */
    relations?: Array<{ to: string; type: string; notes?: string }>;
  }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  if (!args.name || !args.description) {
    return { success: false, error: 'Both name and description are required.' };
  }

  const VALID_CATEGORIES = ['functional', 'non-functional', 'technical', 'business'];
  const category = args.category || 'functional';
  if (!VALID_CATEGORIES.includes(category)) {
    return { success: false, error: `Invalid category "${category}". Valid: ${VALID_CATEGORIES.join(', ')}` };
  }

  // Criterion shapes are validated with the other inputs — BEFORE the spec
  // auto-create below can write anything. Same for the section's SHAPE (its
  // resolution needs the spec id, so that happens after).
  const parsedCriteria = normalizeCriterionInputs(args.acceptance_criteria || []);
  if ('error' in parsedCriteria) {
    return { success: false, error: parsedCriteria.error };
  }
  if (args.section !== undefined && (typeof args.section !== 'string' || !args.section.trim())) {
    return { success: false, error: 'section must be a non-empty section name.' };
  }

  // Auto-create a minimal specification so MCP-created projects can hold
  // requirements without going through the app's spec-drafting flow first.
  const existingSpec = await resolveSpecForProject(supabase, projectId);
  let specId: string;
  if (existingSpec) {
    specId = existingSpec.id;
  } else {
    const { data: newSpec, error: specError } = await supabase
      .from('project_specifications')
      .insert({
        project_id: projectId,
        vision: '',
        raw_input: '',
        created_by: auth.userId,
        phase_status: 'drafting_requirements',
      })
      .select('id')
      .single();
    if (specError || !newSpec) {
      return { success: false, error: `Failed to create specification: ${specError?.message || 'unknown error'}` };
    }
    // Race convergence: two parallel FIRST creates can both pass the no-spec check
    // and both insert. Re-resolve newest so both racers attach their requirement to
    // the SAME (newest) spec — the one the UI displays.
    const converged = await resolveSpecForProject(supabase, projectId);
    specId = (converged?.id as string) ?? (newSpec.id as string);
  }

  const explicitId = (args.requirement_id || '').trim();
  if (explicitId) {
    const clash = await resolveRequirementRow(supabase, specId, explicitId);
    if (clash) {
      return { success: false, error: `Requirement ${explicitId} already exists.` };
    }
  }

  let section: { id: string; name: string } | null = null;
  if (args.section !== undefined) {
    const resolvedSection = await resolveOrCreateSection(supabase, specId, args.section);
    if ('error' in resolvedSection) {
      return { success: false, error: resolvedSection.error };
    }
    section = resolvedSection;
  }

  const acceptanceCriteria = parsedCriteria.criteria.map((c) =>
    c.verification === 'manual'
      ? { text: c.text, met: false, verification: 'manual' }
      : { text: c.text, met: false } // automated = the absent-key default
  );

  // Discovered #8: REQ-NNN numbering was client-side max+1 — two concurrent
  // creates could compute the same id and collide on
  // UNIQUE(specification_id, requirement_id). Auto-numbered inserts now
  // recompute-and-retry on the unique violation (bounded); explicit ids keep
  // the single honest "already exists" refusal.
  const MAX_NUMBERING_ATTEMPTS = 3;
  // deno-lint-ignore no-explicit-any
  let created: any = null;
  let insertError: { message?: string; code?: string } | null = null;
  for (let attempt = 0; attempt < MAX_NUMBERING_ATTEMPTS; attempt++) {
    const requirementId = explicitId || await nextRequirementId(supabase, specId);
    const { data, error } = await supabase
      .from('specification_requirements')
      .insert({
        specification_id: specId,
        requirement_id: requirementId,
        name: args.name,
        description: args.description,
        category,
        status: 'pending',
        acceptance_criteria: acceptanceCriteria,
        source: 'manual',
        locked: false,
        ...(section ? { section_id: section.id } : {}),
      })
      .select('id, requirement_id, name, category, status')
      .single();
    created = data;
    insertError = error;
    if (created) break;
    // Retry only the auto-numbered race; any other failure surfaces as-is.
    if (explicitId || error?.code !== '23505') break;
  }
  if (insertError || !created) {
    return { success: false, error: `Failed to create requirement: ${insertError?.message || 'unknown error'}` };
  }

  // R6: lineage recorded at creation — "this expands REQ-007" belongs with
  // the create, not a follow-up call the AI may forget.
  let relationsCreated: Array<{ to: string; type: string }> = [];
  let relationsFailed: Array<{ to: string; type: string; reason: string }> = [];
  if (Array.isArray(args.relations) && args.relations.length > 0) {
    const rel = await createRelationsForNewRequirement(supabase, specId, created.id, auth.userId, args.relations);
    relationsCreated = rel.created;
    relationsFailed = rel.failed;
  }

  return {
    success: true,
    data: {
      id: created.id,
      requirementId: created.requirement_id,
      name: created.name,
      category: created.category,
      status: created.status,
      acceptanceCriteriaCount: acceptanceCriteria.length,
      ...(section ? { section: section.name } : {}),
      ...(relationsCreated.length > 0 ? { relationsCreated } : {}),
      ...(relationsFailed.length > 0 ? { relationsFailed } : {}),
    },
  };
}

export async function handleUpdateRequirement(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: {
    project_id: string;
    requirement_id: string;
    name?: string;
    description?: string;
    category?: string;
    status?: string;
    acceptance_criteria?: CriterionInput[];
    /** Section NAME to move the requirement to (resolved case-insensitively,
     *  created when absent); null clears the section. */
    section?: string | null;
  }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;

  const spec = await resolveSpecForProject(supabase, resolved.project.id);
  if (!spec) {
    return { success: false, error: 'No specification found for this project.' };
  }

  const requirement = await resolveRequirementRow(supabase, spec.id, args.requirement_id);
  if (!requirement) {
    return { success: false, error: `Requirement not found: ${args.requirement_id}` };
  }
  if (requirement.locked) {
    return { success: false, error: `Requirement ${requirement.requirement_id} is locked. Unlock it first with set_requirement_lock.` };
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.name !== undefined) updates.name = args.name;
  if (args.description !== undefined) updates.description = args.description;
  if (args.category !== undefined) {
    const VALID_CATEGORIES = ['functional', 'non-functional', 'technical', 'business'];
    if (!VALID_CATEGORIES.includes(args.category)) {
      return { success: false, error: `Invalid category "${args.category}". Valid: ${VALID_CATEGORIES.join(', ')}` };
    }
    updates.category = args.category;
  }
  if (args.status !== undefined) {
    const VALID_STATUSES = ['pending', 'in-progress', 'implemented', 'validated', 'blocked'];
    if (!VALID_STATUSES.includes(args.status)) {
      return { success: false, error: `Invalid status "${args.status}". Valid: ${VALID_STATUSES.join(', ')}` };
    }
    updates.status = args.status;
  }
  let movedToSection: string | null = null;
  if (args.section !== undefined) {
    if (args.section === null) {
      updates.section_id = null;
    } else {
      const resolvedSection = await resolveOrCreateSection(supabase, spec.id, args.section);
      if ('error' in resolvedSection) {
        return { success: false, error: resolvedSection.error };
      }
      updates.section_id = resolvedSection.id;
      movedToSection = resolvedSection.name;
    }
  }
  if (args.acceptance_criteria !== undefined) {
    // Replacing the criteria list must not erase completion truth: `met`/`testId`/
    // `provenance`/`verification` are evidence + lane state (flipped by test results,
    // accepted git ticks, and the WS3 lane choice), so an exact-text match carries the
    // prior entry forward; only new text starts unmet. verification follows the same
    // discipline: unspecified (string form) keeps the prior lane; an explicit
    // 'manual'/'automated' sets it ('automated' by DELETING the key — absent is the
    // stored form of the default).
    const parsedCriteria = normalizeCriterionInputs(args.acceptance_criteria);
    if ('error' in parsedCriteria) {
      return { success: false, error: parsedCriteria.error };
    }
    const existing = Array.isArray(requirement.acceptance_criteria)
      ? (requirement.acceptance_criteria as Array<Record<string, unknown>>)
      : [];
    const byText = new Map<string, Record<string, unknown>>();
    for (const c of existing) {
      if (c && typeof c.text === 'string' && !byText.has(c.text)) byText.set(c.text, c);
    }
    updates.acceptance_criteria = parsedCriteria.criteria.map((c) => {
      const prior = byText.get(c.text);
      const base = prior ? { ...prior, text: c.text } : { text: c.text, met: false };
      if (c.verification === 'manual') return { ...base, verification: 'manual' };
      if (c.verification === 'automated') {
        const { verification: _cleared, ...rest } = base;
        return rest;
      }
      return base;
    });
  }

  if (Object.keys(updates).length === 1) {
    return { success: false, error: 'No fields to update. Provide at least one of: name, description, category, status, acceptance_criteria, section.' };
  }

  const { error: updateError } = await supabase
    .from('specification_requirements')
    .update(updates)
    .eq('id', requirement.id);
  if (updateError) {
    return { success: false, error: `Failed to update requirement: ${updateError.message}` };
  }

  return {
    success: true,
    data: {
      requirementId: requirement.requirement_id,
      updatedFields: Object.keys(updates).filter((k) => k !== 'updated_at'),
      ...(movedToSection ? { section: movedToSection } : {}),
    },
  };
}

export async function handleDeleteRequirement(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; requirement_id: string; force?: boolean }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;

  const spec = await resolveSpecForProject(supabase, resolved.project.id);
  if (!spec) {
    return { success: false, error: 'No specification found for this project.' };
  }

  const requirement = await resolveRequirementRow(supabase, spec.id, args.requirement_id);
  if (!requirement) {
    return { success: false, error: `Requirement not found: ${args.requirement_id}` };
  }
  if (requirement.locked) {
    return { success: false, error: `Requirement ${requirement.requirement_id} is locked. Unlock it first with set_requirement_lock.` };
  }

  // Mirror the app's delete semantics: refuse when architecture mappings
  // reference this requirement unless force is set (then cascade mappings).
  const { count: mappingCount } = await supabase
    .from('specification_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('requirement_id', requirement.id);

  // E2: deletion CASCADES test_cases (the FK) — recorded evidence would be
  // destroyed, not archived. A requirement with evidence is better SUPERSEDED:
  // create the successor with relations [{to, type:'expands'}] (a completed,
  // expanded requirement archives off the working set) and retire obsolete
  // cases via update_test_case. force remains the escape hatch for genuinely
  // disposable drafts. Retired rows count here too — retired evidence is
  // still evidence.
  const { count: evidenceCount } = await supabase
    .from('test_cases')
    .select('id', { count: 'exact', head: true })
    .eq('requirement_id', requirement.id);
  if ((evidenceCount ?? 0) > 0 && !args.force) {
    return {
      success: false,
      error: `Requirement ${requirement.requirement_id} carries ${evidenceCount} test case(s) — deleting would CASCADE that evidence away. Prefer supersession: create_requirement with relations [{to: '${requirement.requirement_id}', type: 'expands'}] archives the completed original off the working set, and update_test_case (retire: true) parks obsolete cases with their history intact. Pass force: true only if this evidence is genuinely disposable.`,
    };
  }

  // The mapping refusal ranks BELOW the evidence guard (owner bench catch
  // 2026-08-23: a mapped requirement WITH evidence used to get this plain
  // message and the supersession steering never surfaced).
  if ((mappingCount ?? 0) > 0 && !args.force) {
    return {
      success: false,
      error: `Requirement ${requirement.requirement_id} is mapped to ${mappingCount} architecture element(s). Pass force: true to delete it along with its mappings.`,
    };
  }


  if ((mappingCount ?? 0) > 0) {
    const { error: mappingError } = await supabase
      .from('specification_mappings')
      .delete()
      .eq('requirement_id', requirement.id);
    if (mappingError) {
      return { success: false, error: `Failed to delete mappings: ${mappingError.message}` };
    }
  }

  const { error: deleteError } = await supabase
    .from('specification_requirements')
    .delete()
    .eq('id', requirement.id);
  if (deleteError) {
    return { success: false, error: `Failed to delete requirement: ${deleteError.message}` };
  }

  return {
    success: true,
    data: {
      requirementId: requirement.requirement_id,
      name: requirement.name,
      deletedMappings: mappingCount ?? 0,
      deletedTestCases: evidenceCount ?? 0,
    },
  };
}

export async function handleSetRequirementLock(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; requirement_id: string; locked: boolean }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;

  const spec = await resolveSpecForProject(supabase, resolved.project.id);
  if (!spec) {
    return { success: false, error: 'No specification found for this project.' };
  }

  const requirement = await resolveRequirementRow(supabase, spec.id, args.requirement_id);
  if (!requirement) {
    return { success: false, error: `Requirement not found: ${args.requirement_id}` };
  }

  if (typeof args.locked !== 'boolean') {
    return { success: false, error: 'locked must be a boolean.' };
  }

  const { error: updateError } = await supabase
    .from('specification_requirements')
    .update({ locked: args.locked, updated_at: new Date().toISOString() })
    .eq('id', requirement.id);
  if (updateError) {
    return { success: false, error: `Failed to ${args.locked ? 'lock' : 'unlock'} requirement: ${updateError.message}` };
  }

  return {
    success: true,
    data: {
      requirementId: requirement.requirement_id,
      locked: args.locked,
      message: args.locked
        ? `Requirement ${requirement.requirement_id} is now locked; update_requirement and delete_requirement will refuse it until unlocked.`
        : `Requirement ${requirement.requirement_id} is now unlocked and can be modified.`,
    },
  };
}

// R6 (Discovered #6): derived coupling — which requirements does a change touch?
// Computed at READ time from mappings + the live graph, NEVER stored (the authored
// relations table records intent; this records architectural fact). Keys are echoed
// back verbatim, so callers pick the id vocabulary. One entry per (req, other) pair:
// shared_node (both map the same node; via = its label) beats adjacent (mapped nodes
// bridged by an edge; via = "Source → Target"). O(mappings + edges) plus the
// per-node pair fan-out that co-mapping inherently implies.
export interface CouplingEntry {
  requirementId: string;
  kind: 'shared_node' | 'adjacent';
  via: string;
}

export function computeRequirementCoupling(
  mappingsByReq: Record<string, string[]>,
  graph: {
    nodes?: Record<string, unknown>;
    edges?: Record<string, { source?: string; target?: string }> | Array<{ source?: string; target?: string }>;
  },
): Record<string, CouplingEntry[]> {
  const nodeToReqs = new Map<string, string[]>();
  for (const [req, nodeIds] of Object.entries(mappingsByReq)) {
    for (const nodeId of new Set(nodeIds || [])) {
      const list = nodeToReqs.get(nodeId);
      if (list) list.push(req);
      else nodeToReqs.set(nodeId, [req]);
    }
  }

  const nodes = graph.nodes || {};
  const nodeLabel = (id: string): string => {
    const node = nodes[id] as { label?: unknown } | undefined;
    return typeof node?.label === 'string' && node.label ? node.label : id;
  };

  const out: Record<string, CouplingEntry[]> = {};
  const seen = new Set<string>(); // directed pair guard — shared_node runs first and wins
  const addPair = (a: string, b: string, kind: CouplingEntry['kind'], via: string) => {
    if (a === b) return;
    const key = `${a} ${b}`;
    if (seen.has(key)) return;
    seen.add(key);
    (out[a] ??= []).push({ requirementId: b, kind, via });
  };

  for (const [nodeId, reqs] of nodeToReqs) {
    if (reqs.length < 2) continue;
    const via = nodeLabel(nodeId);
    for (const a of reqs) {
      for (const b of reqs) addPair(a, b, 'shared_node', via);
    }
  }

  const edges = Array.isArray(graph.edges) ? graph.edges : Object.values(graph.edges || {});
  for (const edge of edges) {
    const source = edge?.source;
    const target = edge?.target;
    if (!source || !target || source === target) continue;
    const sourceReqs = nodeToReqs.get(source);
    const targetReqs = nodeToReqs.get(target);
    if (!sourceReqs?.length || !targetReqs?.length) continue;
    const via = `${nodeLabel(source)} → ${nodeLabel(target)}`;
    for (const a of sourceReqs) {
      for (const b of targetReqs) {
        addPair(a, b, 'adjacent', via);
        addPair(b, a, 'adjacent', via);
      }
    }
  }

  return out;
}

export async function handleListRequirements(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; category?: string; status?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'read')) {
    return { success: false, error: 'Insufficient permissions: read scope required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const { data: spec } = await supabase
    .from('project_specifications')
    .select('id, phase_status, vision')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!spec) {
    return {
      success: true,
      data: {
        projectName: resolved.project.name,
        phaseStatus: 'drafting_requirements',
        hasSpecification: false,
        requirements: [],
      },
    };
  }

  let reqQuery = supabase
    .from('specification_requirements')
    .select('id, requirement_id, name, description, category, status, acceptance_criteria, locked, section_id, architecture_trace, confirmed, created_at, updated_at')
    .eq('specification_id', spec.id)
    .order('requirement_id'); // stable pre-sort; the natural sort below is authoritative

  if (args.category) {
    reqQuery = reqQuery.eq('category', args.category);
  }
  if (args.status) {
    reqQuery = reqQuery.eq('status', args.status);
  }

  const { data: requirements, error: reqError } = await reqQuery;

  if (reqError) {
    return { success: false, error: reqError.message };
  }

  // Discovered #8 (ordering half): lexicographic requirement_id ordering
  // breaks at REQ-1000 (sorts before REQ-999). Natural sort, no schema change.
  (requirements || []).sort((a: { requirement_id: string }, b: { requirement_id: string }) =>
    String(a.requirement_id).localeCompare(String(b.requirement_id), undefined, { numeric: true }));

  const categories = [...new Set((requirements || []).map((r: { category: string }) => r.category))];

  // R6 (Discovered #6): spec-plane enrichment. Sections/mappings/relations load
  // spec-wide; the main-branch snapshot (the graph the Decomposition view reads —
  // same read map_requirement validates against) names coupling `via`s. With a
  // category/status filter active, relations and coupling cover only the RETURNED
  // rows — a counterpart outside the filter is omitted, not half-resolved.
  const reqRows = (requirements || []) as Array<{ id: string; requirement_id: string }>;
  const rowIdToReqId = new Map(reqRows.map((r) => [r.id, r.requirement_id]));

  const { data: sections } = await supabase
    .from('specification_sections')
    .select('id, name')
    .eq('specification_id', spec.id);
  const sectionNameById = new Map((sections || []).map((s: { id: string; name: string }) => [s.id, s.name]));

  const { data: mappingRows } = await supabase
    .from('specification_mappings')
    .select('requirement_id, node_id')
    .eq('specification_id', spec.id);
  const mappedNodesByRowId = new Map<string, string[]>();
  for (const m of (mappingRows || []) as Array<{ requirement_id: string; node_id: string }>) {
    const list = mappedNodesByRowId.get(m.requirement_id);
    if (list) list.push(m.node_id);
    else mappedNodesByRowId.set(m.requirement_id, [m.node_id]);
  }

  const { data: relationRows } = await supabase
    .from('specification_requirement_relations')
    .select('from_requirement_id, to_requirement_id, relation_type, source, notes')
    .eq('specification_id', spec.id);
  type RelationOut = { to: string; type: string; source: string; notes?: string };
  type RelationIn = { from: string; type: string; source: string; notes?: string };
  const relationsFromByRowId = new Map<string, RelationOut[]>();
  const relationsToByRowId = new Map<string, RelationIn[]>();
  for (const rel of (relationRows || []) as Array<{ from_requirement_id: string; to_requirement_id: string; relation_type: string; source: string; notes: string | null }>) {
    const fromReqId = rowIdToReqId.get(rel.from_requirement_id);
    const toReqId = rowIdToReqId.get(rel.to_requirement_id);
    if (!fromReqId || !toReqId) continue;
    const outList = relationsFromByRowId.get(rel.from_requirement_id) ?? [];
    outList.push({ to: toReqId, type: rel.relation_type, source: rel.source, ...(rel.notes ? { notes: rel.notes } : {}) });
    relationsFromByRowId.set(rel.from_requirement_id, outList);
    const inList = relationsToByRowId.get(rel.to_requirement_id) ?? [];
    inList.push({ from: fromReqId, type: rel.relation_type, source: rel.source, ...(rel.notes ? { notes: rel.notes } : {}) });
    relationsToByRowId.set(rel.to_requirement_id, inList);
  }

  const mainBranch = await getPrimaryBranch(supabase, projectId, 'id, name, is_primary');
  let graph: { nodes?: Record<string, unknown>; edges?: Record<string, { source?: string; target?: string }> } = {};
  if (mainBranch) {
    const { data: snapshot } = await supabase
      .from('graph_snapshots')
      .select('graph_data')
      .eq('branch_id', mainBranch.id)
      .order('patch_sequence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    graph = (snapshot?.graph_data as typeof graph) || {};
  }

  const mappingsByReqId: Record<string, string[]> = {};
  for (const r of reqRows) {
    const nodeIds = mappedNodesByRowId.get(r.id);
    if (nodeIds?.length) mappingsByReqId[r.requirement_id] = nodeIds;
  }
  const coupling = computeRequirementCoupling(mappingsByReqId, graph);

  return {
    success: true,
    data: {
      projectName: resolved.project.name,
      phaseStatus: spec.phase_status,
      vision: spec.vision,
      hasSpecification: true,
      categories,
      requirements: (requirements || []).map((r: {
        id: string;
        requirement_id: string;
        name: string;
        description: string | null;
        category: string;
        status: string;
        acceptance_criteria: string[] | null;
        locked: boolean | null;
        section_id: string | null;
        architecture_trace: unknown;
        confirmed: boolean | null;
        created_at: string;
        updated_at: string;
      }) => ({
        id: r.id,
        requirementId: r.requirement_id,
        name: r.name,
        description: r.description,
        category: r.category,
        status: r.status,
        acceptanceCriteria: r.acceptance_criteria || [],
        locked: r.locked ?? false,
        sectionId: r.section_id ?? null,
        sectionName: r.section_id ? (sectionNameById.get(r.section_id) ?? null) : null,
        confirmed: r.confirmed ?? false,
        architectureTrace: r.architecture_trace ?? [],
        mappedNodeIds: mappedNodesByRowId.get(r.id) || [],
        relations: {
          from: relationsFromByRowId.get(r.id) || [],
          to: relationsToByRowId.get(r.id) || [],
        },
        coupling: coupling[r.requirement_id] || [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    },
  };
}

// P1-2 (traceability): the external AI can propose nodes/edges/contracts but had no way to make
// its architecture *traceable* — the requirement↔node link lives in two app stores it couldn't
// write (specification_mappings rows + specification_requirements.architecture_trace), so
// AI-built graphs never appeared on the Decomposition/trace canvas. This op writes both,
// server-side, mirroring the app inspector's P0-13 dual-write.
// N5.13 (owner direction: "fix the purely additive map requirement into a more general CRUD
// capability" — bench AI was stuck unable to prune dangling links the tooling itself flagged):
//   mode 'add' (default)  — union the given nodes in; live-graph validated (no ghost writes).
//   mode 'remove'         — delete the given node links + prune them from the trace. SKIPS
//                           live validation on purpose: the ids being removed may reference
//                           nodes already deleted from the branch (that is the cleanup case).
//   mode 'replace'        — the given list becomes the exact mapping set (validated live);
//                           anything else — including dangling ids — is removed implicitly.
export async function handleMapRequirement(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; requirement_id: string; node_ids: string[]; branch_id?: string; mapping_type?: string; mode?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }

  if (!args.project_id || !args.requirement_id) {
    return { success: false, error: 'project_id and requirement_id are required' };
  }
  const mode = args.mode || 'add';
  if (!['add', 'remove', 'replace'].includes(mode)) {
    return { success: false, error: `Invalid mode "${mode}". Valid: add, remove, replace` };
  }
  if (!Array.isArray(args.node_ids) || (args.node_ids.length === 0 && mode !== 'replace')) {
    return { success: false, error: 'node_ids (a non-empty array of node UUIDs) is required (empty is allowed only with mode "replace" to clear all mappings)' };
  }

  const VALID_MAPPING_TYPES = ['implements', 'depends_on', 'validates', 'supports'];
  const mappingType = args.mapping_type || 'implements';
  if (!VALID_MAPPING_TYPES.includes(mappingType)) {
    return { success: false, error: `Invalid mapping_type "${mappingType}". Valid: ${VALID_MAPPING_TYPES.join(', ')}` };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const spec = await resolveSpecForProject(supabase, projectId);
  if (!spec) {
    return { success: false, error: 'No specification found for this project.' };
  }

  const requirement = await resolveRequirementRow(supabase, spec.id, args.requirement_id);
  if (!requirement) {
    return { success: false, error: `Requirement not found: ${args.requirement_id}` };
  }

  // Resolve the target branch (default: main) and load its latest graph snapshot, so node_ids
  // can be validated against real nodes. The Decomposition canvas reads the main branch, so a
  // mapping to a node absent there would be invisible — hence the validation + clear error.
  let branchId = args.branch_id;
  let branchName = 'main';
  if (branchId) {
    const { data: branch } = await supabase
      .from('branches')
      .select('id, name')
      .eq('id', branchId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!branch) {
      return { success: false, error: 'Branch not found' };
    }
    branchName = branch.name;
  } else {
    const mainBranch = await getPrimaryBranch(supabase, projectId, 'id, name, is_primary');
    if (!mainBranch) {
      return { success: false, error: 'No primary branch found for this project' };
    }
    branchId = mainBranch.id;
    branchName = mainBranch.name;
  }

  const { data: snapshot } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('branch_id', branchId)
    .order('patch_sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const graphNodes = (snapshot?.graph_data?.nodes || {}) as Record<string, unknown>;
  const requestedIds = [...new Set(args.node_ids)];
  // 'remove' deliberately skips liveness validation: the ids being removed may reference
  // nodes already deleted from the branch — pruning those is exactly what it is for.
  if (mode !== 'remove') {
    const unknownIds = requestedIds.filter((id) => !(id in graphNodes));
    if (unknownIds.length > 0) {
      return {
        success: false,
        error: `These node_ids are not in the '${branchName}' branch graph: ${unknownIds.join(', ')}. Use get_architecture_overview to list valid node ids, or pass branch_id for a different branch.`,
      };
    }
  }

  const { data: existingRows } = await supabase
    .from('specification_mappings')
    .select('node_id')
    .eq('specification_id', spec.id)
    .eq('requirement_id', requirement.id);
  const existingNodeIds = new Set((existingRows || []).map((m: { node_id: string }) => m.node_id));

  let toCreate: string[] = [];
  let toDelete: string[] = [];
  if (mode === 'add') {
    toCreate = requestedIds.filter((id) => !existingNodeIds.has(id));
  } else if (mode === 'remove') {
    toDelete = requestedIds.filter((id) => existingNodeIds.has(id));
  } else {
    toCreate = requestedIds.filter((id) => !existingNodeIds.has(id));
    toDelete = [...existingNodeIds].filter((id) => !requestedIds.includes(id));
  }

  if (toDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('specification_mappings')
      .delete()
      .eq('specification_id', spec.id)
      .eq('requirement_id', requirement.id)
      .in('node_id', toDelete);
    if (deleteError) {
      return { success: false, error: `Failed to delete mappings: ${deleteError.message}` };
    }
  }
  if (toCreate.length > 0) {
    const { error: insertError } = await supabase
      .from('specification_mappings')
      .insert(toCreate.map((nodeId) => ({
        specification_id: spec.id,
        requirement_id: requirement.id,
        node_id: nodeId,
        mapping_type: mappingType,
        confidence: 1.0,
      })));
    if (insertError) {
      return { success: false, error: `Failed to create mappings: ${insertError.message}` };
    }
  }

  // Mirror the dual-write on architecture_trace (the JSON list the canvas also reads),
  // per mode: add unions, remove prunes, replace sets the exact list.
  const { data: traceRow } = await supabase
    .from('specification_requirements')
    .select('architecture_trace')
    .eq('id', requirement.id)
    .maybeSingle();
  const currentTrace = Array.isArray(traceRow?.architecture_trace)
    ? (traceRow!.architecture_trace as string[])
    : [];
  const newTrace = mode === 'add'
    ? [...new Set([...currentTrace, ...requestedIds])]
    : mode === 'remove'
      ? currentTrace.filter((id) => !requestedIds.includes(id))
      : [...new Set(requestedIds)];
  const traceChanged = newTrace.length !== currentTrace.length || newTrace.some((id, i) => currentTrace[i] !== id);
  if (traceChanged) {
    const { error: traceError } = await supabase
      .from('specification_requirements')
      .update({ architecture_trace: newTrace })
      .eq('id', requirement.id);
    if (traceError) {
      return { success: false, error: `Failed to update architecture trace: ${traceError.message}` };
    }
  }

  return {
    success: true,
    data: {
      requirementId: requirement.requirement_id,
      branch: branchName,
      mode,
      mappedNodes: mode === 'remove' ? [...existingNodeIds].filter((id) => !toDelete.includes(id)) : requestedIds,
      created: toCreate.length,
      removed: toDelete.length,
      alreadyMapped: mode === 'add' ? requestedIds.length - toCreate.length : undefined,
      architectureTraceCount: newTrace.length,
      mappingType,
    },
  };
}

// ── R5d: mark_entity_complete — whole-node completion, honestly scoped ─────────
// The completion claim has TWO different truths and this tool writes only one:
//   · per-criterion `met` = "this criterion is PROVEN" — flipped only by evidence
//     (a passing test via the test_cases trigger, or an approved git tick, R5c);
//   · `specification_mappings.validation_status` = "the implementer says this
//     node's side of the requirement is DONE" — a declaration, not a proof.
// Whole-node completion therefore NEVER flips criteria (owner decision
// 2026-07-21); the Spec view shows the badge BESIDE criteria state, never instead
// of it. First writer of validation_status; provenance rides along (R3-4b
// convention: the status says what, the provenance says who declared it).
export async function handleMarkEntityComplete(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; node_id: string; branch_id?: string; complete?: boolean; note?: string; external_agent?: string }
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }
  if (!args.project_id || !args.node_id) {
    return { success: false, error: 'project_id and node_id are required' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  const spec = await resolveSpecForProject(supabase, projectId);
  if (!spec) {
    return { success: false, error: 'No specification found for this project — there are no requirement mappings to mark.' };
  }

  // Resolve the entity: a node UUID, a node LABEL, or a task-artifact id whose
  // owning node is the entity ("on a node or its task artifact"). Resolution reads
  // the branch graph so labels and artifacts resolve exactly like map_requirement.
  let branchId = args.branch_id;
  if (!branchId) {
    const mainBranch = await getPrimaryBranch(supabase, projectId, 'id, name, is_primary');
    if (!mainBranch) return { success: false, error: 'No primary branch found for this project' };
    branchId = mainBranch.id;
  }
  const { data: snapshot } = await supabase
    .from('graph_snapshots')
    .select('graph_data')
    .eq('branch_id', branchId)
    .order('patch_sequence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const graph = (snapshot?.graph_data ?? {}) as Record<string, any>;
  const nodes = graph.nodes ?? {};
  const artifacts = graph.artifacts ?? {};

  let nodeId: string | null = null;
  let nodeLabel = '';
  if (nodes[args.node_id]) {
    nodeId = args.node_id;
    nodeLabel = nodes[args.node_id]?.label ?? args.node_id;
  } else if (artifacts[args.node_id]?.nodeId && nodes[artifacts[args.node_id].nodeId]) {
    nodeId = artifacts[args.node_id].nodeId;
    nodeLabel = nodes[nodeId!]?.label ?? nodeId!;
  } else {
    // deno-lint-ignore no-explicit-any
    const byLabel = (Object.values(nodes) as any[]).filter((n) => n.label === args.node_id);
    if (byLabel.length === 1) {
      nodeId = byLabel[0].id;
      nodeLabel = byLabel[0].label;
    } else if (byLabel.length > 1) {
      return { success: false, error: `Node label "${args.node_id}" is ambiguous (${byLabel.length} matches) — pass the node UUID.` };
    }
  }
  if (!nodeId) {
    return { success: false, error: `No node or task artifact "${args.node_id}" found in the branch graph. Pass a node UUID, an exact node label, or a task-artifact id.` };
  }

  const { data: mappingRows } = await supabase
    .from('specification_mappings')
    .select('id, requirement_id')
    .eq('specification_id', spec.id)
    .eq('node_id', nodeId);
  const rows = (mappingRows ?? []) as Array<{ id: string; requirement_id: string | null }>;
  if (rows.length === 0) {
    return {
      success: false,
      error: `Node "${nodeLabel}" has no requirement mappings — there is nothing to mark complete. Map it first with map_requirement.`,
    };
  }

  const complete = args.complete !== false;
  const provenance = complete
    ? {
      source: 'mcp',
      ...(args.external_agent ? { actor: args.external_agent } : {}),
      at: new Date().toISOString(),
      ...(args.note ? { note: args.note } : {}),
    }
    : null; // reverting to 'pending' clears the declaration — NULL means "never declared"

  const { error: updateError } = await supabase
    .from('specification_mappings')
    .update({ validation_status: complete ? 'valid' : 'pending', validation_provenance: provenance })
    .eq('specification_id', spec.id)
    .eq('node_id', nodeId);
  if (updateError) {
    return { success: false, error: `Mapping update failed: ${updateError.message}` };
  }

  // Report the criteria state HONESTLY so the caller cannot mistake the
  // declaration for proof: unmet criteria stay unmet, and this tool did not
  // touch them.
  const reqRowIds = [...new Set(rows.map((r) => r.requirement_id).filter((id): id is string => !!id))];
  const { data: reqRows } = await supabase
    .from('specification_requirements')
    .select('requirement_id, acceptance_criteria')
    .in('id', reqRowIds.length > 0 ? reqRowIds : ['00000000-0000-0000-0000-000000000000']);
  let unmetCount = 0;
  const requirementIds: string[] = [];
  // deno-lint-ignore no-explicit-any
  for (const r of ((reqRows ?? []) as any[])) {
    requirementIds.push(r.requirement_id);
    const criteria = Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria : [];
    // deno-lint-ignore no-explicit-any
    unmetCount += criteria.filter((c: any) => typeof c === 'object' ? c?.met !== true : true).length;
  }

  return {
    success: true,
    data: {
      nodeId,
      nodeLabel,
      validationStatus: complete ? 'valid' : 'pending',
      mappingsUpdated: rows.length,
      requirements: requirementIds,
      criteriaUntouched: true,
      unmetCriteria: unmetCount,
      note: complete
        ? (unmetCount > 0
          ? `Completion recorded on ${rows.length} mapping(s). ${unmetCount} acceptance criterion(s) remain UNMET — this tool never flips criteria. They flip only via evidence: report test results, or tick the criterion box in the node's task doc and approve the resulting change card.`
          : `Completion recorded on ${rows.length} mapping(s); every mapped acceptance criterion is already met.`)
        : `Completion declaration reverted to 'pending' on ${rows.length} mapping(s). Criteria were not touched.`,
    },
  };
}
