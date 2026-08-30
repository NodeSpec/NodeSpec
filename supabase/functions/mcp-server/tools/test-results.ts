// C4 step 3: report_test_results — the missing third of the evidence cluster. The
// test-plan lane half-existed and was DISCONNECTED: the live trigger
// on_test_case_status_change flips acceptance_criteria[i].met when the case keyed by
// criteria[i].testId passes/fails, but NOTHING server-side ever inserted test_cases
// rows — the user's AI had no lane to report results, so the trigger never fired from
// MCP work. This write tool is that lane: batch upsert keyed (requirement_id, test_id);
// the existing trigger performs the met-flip; the response returns which criteria
// flipped (the triage receipt).
//
// TRIGGER SEMANTICS (migration 20260325192007): AFTER UPDATE OF status ONLY — an
// INSERT never fires it. So NEW rows land in TWO steps: insert with status
// 'not_started', then UPDATE to the reported status. A plain update suffices for
// existing rows. Reporting a fresh result also clears stale/staleness_reason — a fresh
// run IS the re-verification the staleness triggers were asking for.
//
// C4 reconciliation additions (design review):
// · CRITERION BINDING — the trigger matches criteria by criterion.testId == the
//   test_cases ROW UUID, but nothing in this lane ever wrote testId, so on a fresh
//   project a report would flip zero criteria while looking successful. An optional
//   `criterion_text` per result exact-matches the requirement's criteria (the R5a
//   binding rule — exact text, never fuzzy) and sets criterion.testId to the row uuid
//   BEFORE the status-setting UPDATE, so the flip lands in the same call. No match →
//   reported as unbound (never guessed); a criterion already carrying a DIFFERENT
//   row's testId is never stolen — reported as a conflict.
// · MANUAL LANE (WS3, design ruling D-2) — a criterion with verification:'manual' is
//   proven by the R5 tick+approval lane (criterion box in the owning node's task doc
//   + user-approved change card), NEVER by test results. Binding is REFUSED
//   (criterionBinding 'manual-lane'), testId is never written, so the met-flip
//   trigger structurally cannot fire for it.
// · PROVENANCE — the trigger flips met but stamps nothing, leaving a test-flipped
//   criterion indistinguishable from an approved git tick. After the post-write
//   reread, every criterion whose met changed due to this call gets
//   { source: 'test', testCaseId, framework?, at } merged in with the same
//   preserve-every-other-key discipline as R5's applyTickDeltas (criterion-deltas.ts).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { AuthResult, MCPResponse } from "../shared.ts";
import { checkScope, resolveProjectByName } from "../shared.ts";
import { resolveSpecForProject, resolveRequirementRow } from "./requirements.ts";
import { findExistingTestArtifact } from "../../_shared/test-document-generator.ts";
// D4: the shared test-budget gauge — the same function get_project_status and
// the Work Board flag sprawl with.
import { assessTestBudget, formatTestBudgetNudge } from "../../_shared/derive-status.ts";
import { getPrimaryBranch } from "../../_shared/primary-branch.ts";

// Mirrors the test_cases CHECK constraints (20260119154603 + 20260326174948) so a bad
// value fails HERE with a usable message instead of as an opaque constraint violation.
const VALID_STATUSES = ['not_started', 'passed', 'failed', 'skipped', 'running'];
const VALID_TEST_TYPES = ['unit', 'integration', 'e2e', 'acceptance', 'performance', 'security'];
const VALID_FRAMEWORKS = [
  'vitest', 'jest', 'mocha', 'playwright', 'cypress', 'puppeteer', 'k6', 'artillery',
  'pytest', 'unittest', 'go_test', 'rspec', 'minitest', 'junit', 'testng', 'nunit',
  'xunit', 'swift_testing', 'xctest', 'dart_test', 'rust_test', 'elixir_exunit', 'other',
];

export interface ReportedTestResult {
  test_id: string;
  status: string;
  /** Exact text of the acceptance criterion this test verifies — binds
   *  criterion.testId to the test-case row so the met-flip trigger can act. */
  criterion_text?: string;
  name?: string;
  description?: string;
  test_type?: string;
  framework?: string;
  artifact_path?: string;
  source_artifact_ids?: string[];
  expected_result?: string;
  implementation?: string;
}

type CriterionBinding = 'bound' | 'already-bound' | 'unbound' | 'conflict' | 'manual-lane';

interface ResultOutcome {
  testId: string;
  caseId: string;
  action: 'created' | 'updated';
  status: string;
  criterionText?: string;
  criterionBinding?: CriterionBinding;
}

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>;

export async function handleReportTestResults(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: { project_id: string; requirement_id: string; results: ReportedTestResult[]; external_agent?: string },
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }
  if (!args.project_id || !args.requirement_id) {
    return { success: false, error: 'project_id and requirement_id are required' };
  }
  if (!Array.isArray(args.results) || args.results.length === 0) {
    return { success: false, error: 'results (a non-empty array of {test_id, status, ...}) is required' };
  }

  // Validate the whole batch BEFORE any write — a half-applied batch would leave the
  // evidence state ambiguous.
  const seen = new Set<string>();
  for (const r of args.results) {
    const testId = (r.test_id || '').trim();
    if (!testId) return { success: false, error: 'Every result needs a non-empty test_id (the stable key within the requirement).' };
    if (seen.has(testId)) return { success: false, error: `Duplicate test_id "${testId}" in the batch — one result per test case.` };
    seen.add(testId);
    if (!VALID_STATUSES.includes(r.status)) {
      return { success: false, error: `Invalid status "${r.status}" for ${testId}. Valid: ${VALID_STATUSES.join(', ')}` };
    }
    if (r.test_type !== undefined && !VALID_TEST_TYPES.includes(r.test_type)) {
      return { success: false, error: `Invalid test_type "${r.test_type}" for ${testId}. Valid: ${VALID_TEST_TYPES.join(', ')}` };
    }
    if (r.framework !== undefined && !VALID_FRAMEWORKS.includes(r.framework)) {
      return { success: false, error: `Invalid framework "${r.framework}" for ${testId}. Valid: ${VALID_FRAMEWORKS.join(', ')}` };
    }
    if (r.criterion_text !== undefined && (typeof r.criterion_text !== 'string' || r.criterion_text.length === 0)) {
      return { success: false, error: `criterion_text for ${testId} must be a non-empty string (the criterion's exact text).` };
    }
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;

  // Project scoping: the service client bypasses RLS, so ownership is enforced the
  // same way the sibling requirement write tools do — the requirement must belong to
  // THIS project's (newest) specification. Accepts the row UUID or REQ-xxx.
  const spec = await resolveSpecForProject(supabase, projectId);
  if (!spec) {
    return { success: false, error: 'No specification found for this project.' };
  }
  const requirement = await resolveRequirementRow(supabase, spec.id, args.requirement_id);
  if (!requirement) {
    return { success: false, error: `Requirement not found in this project: ${args.requirement_id}` };
  }

  // Pre-write criteria snapshot: the binding target AND the baseline for "did met
  // change" (provenance is stamped only on actual flips).
  const preCriteria: AnyRecord[] = (Array.isArray(requirement.acceptance_criteria)
    ? (requirement.acceptance_criteria as unknown[])
    : []).map((c) => (typeof c === 'string' ? { text: c } : { ...(c as AnyRecord) }));

  // One read for the whole batch: which reported test_ids already have rows.
  const { data: existingRows } = await supabase
    .from('test_cases')
    .select('id, test_id, status')
    .eq('requirement_id', requirement.id)
    .in('test_id', [...seen]);
  const existingByTestId = new Map(
    ((existingRows ?? []) as Array<{ id: string; test_id: string; status: string }>).map((row) => [row.test_id, row]),
  );

  const now = new Date().toISOString();
  const outcomes: ResultOutcome[] = [];

  // ── Phase A: ensure every reported case has a ROW (new rows insert at the
  // 'not_started' default — the trigger is AFTER UPDATE OF status, so the reported
  // status must arrive as an UPDATE in phase C, after bindings exist).
  for (const r of args.results) {
    const testId = r.test_id.trim();
    const existing = existingByTestId.get(testId);
    if (existing) {
      outcomes.push({ testId, caseId: existing.id, action: 'updated', status: r.status });
      continue;
    }
    const insertPayload: AnyRecord = {
      requirement_id: requirement.id,
      test_id: testId,
      name: r.name ?? testId,
      status: 'not_started',
    };
    if (r.description !== undefined) insertPayload.description = r.description;
    if (r.test_type !== undefined) insertPayload.test_type = r.test_type;
    if (r.framework !== undefined) insertPayload.framework = r.framework;
    if (r.artifact_path !== undefined) insertPayload.artifact_path = r.artifact_path;
    if (r.source_artifact_ids !== undefined) insertPayload.source_artifact_ids = r.source_artifact_ids;
    if (r.expected_result !== undefined) insertPayload.expected_result = r.expected_result;
    if (r.implementation !== undefined) insertPayload.implementation = r.implementation;
    const { data: inserted, error: insertError } = await supabase
      .from('test_cases')
      .insert(insertPayload)
      .select('id')
      .single();
    if (insertError || !inserted) {
      return { success: false, error: `Failed to create test case ${testId}: ${insertError?.message || 'unknown error'}` };
    }
    outcomes.push({ testId, caseId: inserted.id as string, action: 'created', status: r.status });
  }
  const caseIdByTestId = new Map(outcomes.map((o) => [o.testId, o.caseId]));

  // ── Phase B: criterion binding. The trigger matches criteria by testId == the ROW
  // uuid; nothing else in this lane writes it, so `criterion_text` is how a report
  // connects evidence to the criterion it proves. Exact text match only (R5a rule):
  // no match → unbound, reported; a foreign testId → conflict, never stolen. All
  // bindings land in ONE update, BEFORE the status writes fire the trigger.
  const workingCriteria = preCriteria.map((c) => ({ ...c }));
  let bindingsApplied = 0;
  for (const r of args.results) {
    if (r.criterion_text === undefined) continue;
    const testId = r.test_id.trim();
    const outcome = outcomes.find((o) => o.testId === testId)!;
    outcome.criterionText = r.criterion_text;
    const caseId = caseIdByTestId.get(testId)!;
    const criterion = workingCriteria.find((c) => c.text === r.criterion_text);
    if (!criterion) {
      outcome.criterionBinding = 'unbound';
      continue;
    }
    // WS3 manual lane: refused before any bound-state reasoning — a manual criterion
    // never carries a testId, so the trigger can never flip it from this tool.
    if (criterion.verification === 'manual') {
      outcome.criterionBinding = 'manual-lane';
      continue;
    }
    const boundTo = typeof criterion.testId === 'string' && criterion.testId.length > 0 ? criterion.testId : null;
    if (boundTo && boundTo !== caseId) {
      outcome.criterionBinding = 'conflict';
      continue;
    }
    if (boundTo === caseId) {
      outcome.criterionBinding = 'already-bound';
      continue;
    }
    criterion.testId = caseId;
    outcome.criterionBinding = 'bound';
    bindingsApplied++;
  }
  if (bindingsApplied > 0) {
    const { error: bindError } = await supabase
      .from('specification_requirements')
      .update({ acceptance_criteria: workingCriteria, updated_at: now })
      .eq('id', requirement.id);
    if (bindError) {
      return { success: false, error: `Failed to bind criteria to test cases: ${bindError.message}` };
    }
  }

  // ── Phase C: the status writes — the step that fires the met-flip trigger.
  // Existing rows also refresh their detail fields; every reported row clears
  // staleness (a fresh result IS the re-verification).
  for (const r of args.results) {
    const testId = r.test_id.trim();
    const outcome = outcomes.find((o) => o.testId === testId)!;
    if (outcome.action === 'updated') {
      // Revival: a retired case that RAN again is live again by definition —
      // a fresh report clears retirement the same way it clears staleness.
      const updatePayload: AnyRecord = {
        status: r.status, stale: false, staleness_reason: null,
        retired_at: null, retired_reason: null, updated_at: now,
      };
      if (r.name !== undefined) updatePayload.name = r.name;
      if (r.description !== undefined) updatePayload.description = r.description;
      if (r.test_type !== undefined) updatePayload.test_type = r.test_type;
      if (r.framework !== undefined) updatePayload.framework = r.framework;
      if (r.artifact_path !== undefined) updatePayload.artifact_path = r.artifact_path;
      if (r.source_artifact_ids !== undefined) updatePayload.source_artifact_ids = r.source_artifact_ids;
      if (r.expected_result !== undefined) updatePayload.expected_result = r.expected_result;
      if (r.implementation !== undefined) updatePayload.implementation = r.implementation;
      const { error: updateError } = await supabase
        .from('test_cases')
        .update(updatePayload)
        .eq('id', outcome.caseId);
      if (updateError) {
        return { success: false, error: `Failed to update test case ${testId}: ${updateError.message}` };
      }
    } else if (r.status !== 'not_started') {
      // New row, two-step by design: the insert carried 'not_started'; THIS update
      // carries the real status so the AFTER UPDATE OF status trigger fires.
      const { error: statusError } = await supabase
        .from('test_cases')
        .update({ status: r.status, stale: false, staleness_reason: null, updated_at: now })
        .eq('id', outcome.caseId);
      if (statusError) {
        return { success: false, error: `Failed to set status for test case ${testId}: ${statusError.message}` };
      }
    }
  }

  // ── Phase D: the triage receipt. REREAD the criteria after the writes — the
  // trigger has run by now, so `met` is post-flip truth, not a client simulation.
  const { data: reread } = await supabase
    .from('specification_requirements')
    .select('acceptance_criteria')
    .eq('id', requirement.id)
    .maybeSingle();
  const postCriteria: AnyRecord[] = (Array.isArray(reread?.acceptance_criteria)
    ? (reread!.acceptance_criteria as unknown[])
    : []).map((c) => (typeof c === 'string' ? { text: c } : { ...(c as AnyRecord) }));

  const affected = new Set(outcomes.map((o) => o.caseId));
  const frameworkByCaseId = new Map<string, string>();
  for (const r of args.results) {
    if (r.framework !== undefined) frameworkByCaseId.set(caseIdByTestId.get(r.test_id.trim())!, r.framework);
  }

  // Provenance parity with R5's git ticks (criterion-deltas.ts applyTickDeltas): the
  // trigger flips met but stamps NOTHING, so without this a test-flipped criterion is
  // unauditable. Stamp { source: 'test', testCaseId, framework?, at } on every
  // criterion whose met CHANGED due to this call, preserving every other key, in one
  // follow-up update.
  const preMetByText = new Map(preCriteria.filter((c) => typeof c.text === 'string').map((c) => [c.text as string, c.met]));
  // E1: a criterion carrying an evidenceStale mark (git-lane source change, or an
  // update_test_case release) whose bound case was RUN this call is re-verified by
  // that run — passed or failed, the fresh outcome IS the current truth, so the
  // mark clears alongside the flip. Statuses that are not runs (skipped, running,
  // not_started) clear nothing.
  const ranCaseIds = new Set(
    outcomes.filter((o) => o.status === 'passed' || o.status === 'failed').map((o) => o.caseId),
  );
  let stamped = 0;
  let staleCleared = 0;
  const stampedCriteria = postCriteria.map((c) => {
    if (typeof c.testId !== 'string' || !affected.has(c.testId)) return c;
    let next = c;
    if (next.evidenceStale && ranCaseIds.has(c.testId)) {
      const { evidenceStale: _cleared, ...rest } = next;
      next = rest;
      staleCleared++;
    }
    const metChanged = preMetByText.get(c.text as string) !== c.met;
    if (!metChanged) return next;
    stamped++;
    const framework = frameworkByCaseId.get(c.testId);
    return {
      ...next,
      provenance: { source: 'test', testCaseId: c.testId, ...(framework ? { framework } : {}), at: now },
    };
  });
  if (stamped + staleCleared > 0) {
    const { error: stampError } = await supabase
      .from('specification_requirements')
      .update({ acceptance_criteria: stampedCriteria, updated_at: now })
      .eq('id', requirement.id);
    if (stampError) {
      return { success: false, error: `Failed to stamp criterion provenance: ${stampError.message}` };
    }
  }

  const flippedCriteria = stampedCriteria
    .filter((c) => typeof c.testId === 'string' && affected.has(c.testId))
    .map((c) => ({ text: String(c.text ?? ''), met: c.met === true, testId: c.testId as string }));

  const created = outcomes.filter((o) => o.action === 'created').length;
  const passed = outcomes.filter((o) => o.status === 'passed').length;
  const failed = outcomes.filter((o) => o.status === 'failed').length;
  const unbound = outcomes.filter((o) => o.criterionBinding === 'unbound');
  const conflicts = outcomes.filter((o) => o.criterionBinding === 'conflict');
  const manualLane = outcomes.filter((o) => o.criterionBinding === 'manual-lane');

  // ── Plan-lane alignment: evidence rows without a stored test-plan artifact are
  // ORPHANS the repo cannot explain — the canvas shows test cards while
  // .nodespec/tests/ carries nothing documenting them. The lookup is best-effort
  // (a read failure must never fail an already-recorded report) and reads the
  // same main-branch snapshot get_project_status does. The response WARNS and
  // points at get_test_plan; it never blocks — reporting first is a legitimate
  // manual-lane order of operations.
  let testPlan: { exists: boolean; path?: string } | undefined;
  try {
    const mainBranch = await getPrimaryBranch(supabase, projectId, 'id, name, is_primary');
    if (mainBranch) {
      const { data: snapshot } = await supabase
        .from('graph_snapshots')
        .select('graph_data')
        .eq('branch_id', mainBranch.id)
        .order('patch_sequence', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const artifacts = ((snapshot?.graph_data as AnyRecord | undefined)?.artifacts ?? {}) as Record<
        string,
        { kind: string; path?: string; metadata?: Record<string, unknown> | null }
      >;
      const stored = findExistingTestArtifact(artifacts, String(requirement.requirement_id), String(requirement.name ?? ''));
      testPlan = stored
        ? { exists: true, ...(stored.path ? { path: String(stored.path) } : {}) }
        : { exists: false };
    }
  } catch (_err) {
    // Unknown ≠ absent: on a failed read, omit testPlan rather than claim false.
  }

  const warnings: string[] = [];
  if (manualLane.length > 0) {
    warnings.push(`${manualLane.length} criterion(s) are verification: 'manual' — binding REFUSED (${manualLane.map((o) => `"${o.criterionText}"`).join(', ')}). Manual criteria are proven through the task-doc lane: tick the criterion box in the owning node's task document and have the user approve the resulting change card. report_test_results never flips them.`);
  }
  if (unbound.length > 0) {
    warnings.push(`${unbound.length} criterion_text value(s) matched NO criterion exactly (${unbound.map((o) => `"${o.criterionText}"`).join(', ')}) — nothing was bound for them; check list_requirements for the exact text.`);
  }
  if (conflicts.length > 0) {
    warnings.push(`${conflicts.length} criterion(s) already bound to a DIFFERENT test case were left untouched (${conflicts.map((o) => `"${o.criterionText}"`).join(', ')}) — rebind via the app if the old case is obsolete.`);
  }
  // Appended LAST: binding warnings stay first (their wording is pinned by tests
  // and is what triage acts on before anything else).
  if (testPlan && !testPlan.exists) {
    warnings.push(`No test plan is stored for ${requirement.requirement_id} — the results are recorded, but the repo has nothing upstream documenting them. Call get_test_plan for this requirement: it generates a plan and parks it as a pending proposal; once accepted in NodeSpec, the next push writes the .nodespec/tests/ plan alongside the task documents.`);
  }

  // D4: the budget receipt — after this write, does the requirement carry
  // more cases than its criteria budget (one binding test per criterion,
  // sprawl threshold shared with get_project_status and the board)? Only an
  // over-budget state is surfaced; a count the fake/failed query cannot
  // provide skips the check rather than guessing.
  const { count: totalCasesForRequirement } = await supabase
    .from('test_cases')
    .select('id', { count: 'exact', head: true })
    .eq('requirement_id', requirement.id)
    .is('retired_at', null);
  const budget = typeof totalCasesForRequirement === 'number'
    ? assessTestBudget({ criteriaTotal: workingCriteria.length, testsTotal: totalCasesForRequirement })
    : null;

  return {
    success: true,
    data: {
      requirementId: requirement.requirement_id,
      reported: outcomes.length,
      created,
      updated: outcomes.length - created,
      results: outcomes,
      flippedCriteria,
      criteriaStamped: stamped,
      ...(testPlan ? { testPlan } : {}),
      ...(budget?.overBudget
        ? {
          testBudget: {
            criteria: budget.criteriaTotal,
            testCases: budget.testsTotal,
            testsPerCriterion: budget.testsPerCriterion,
            nudge: formatTestBudgetNudge(budget),
          },
        }
        : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      message: `Recorded ${outcomes.length} test result(s) for ${requirement.requirement_id} (${passed} passed, ${failed} failed). ` +
        (flippedCriteria.length > 0
          ? `${flippedCriteria.length} linked acceptance criterion(s) now carry the post-result met state (see flippedCriteria).`
          : 'No acceptance criterion is linked to these cases — pass criterion_text (the exact criterion wording) with each result to bind it, or set testId via the app.'),
      nextAction: failed > 0
        ? 'Failing results leave their criteria unmet. Fix the implementation, re-run exactly the failing tests, and report again — a fresh passing result flips the criterion met.'
        : 'Call get_build_readiness to confirm no tests advisories remain, or get_project_status for the project-wide coverage picture.',
    },
  };
}

// ── E1: update_test_case — the CRUD lane report_test_results deliberately lacks.
//
// report_test_results is append-flavored by design (results only ever upsert), which
// left the user's AI with no honest way to fix a mistyped test_id, move a case to the
// requirement it actually verifies, or supersede an obsolete case. The gaps were being
// worked around dishonestly: orphan cases inflating the D4 budget, or hand-edits in
// the app. This tool closes them with four lanes, each preserving evidence doctrine:
//
// · RENAME (new_test_id / name / description) — metadata only; refuses a test_id
//   collision against the FINAL owning requirement (rename+reassign check the target).
// · REASSIGN (reassign_to) — moves the case to another requirement in the same spec
//   and DELIBERATELY marks it stale ("Reassigned from REQ-xxx"): a moved test has
//   proven nothing about its new home until it runs there. Criteria on the OLD
//   requirement bound to this case are released (testId stripped, evidenceStale set,
//   met PRESERVED) — the board reads evidence-due, which is the honest state.
// · RETIRE (retire: true + retire_reason) — soft-retirement, NEVER a hard delete: the
//   row and its history survive; every count surface filters retired_at IS NULL so it
//   stops counting. Bound criteria are released the same way as reassign — a criterion
//   must never read proven-by a case the surfaces no longer show. retire: false
//   un-retires; reporting a fresh result via report_test_results also revives.
// · REBIND (criterion_text) — the criterion-reword lane: after a reword breaks the
//   testId link, re-bind by EXACT text on the final owning requirement. Same R5a rules
//   as report_test_results: no fuzzy match, manual-lane refused, a criterion bound to
//   a DIFFERENT case is never stolen. Binding alone NEVER flips met — only a fresh
//   reported run does.

export interface UpdateTestCaseArgs {
  project_id: string;
  requirement_id: string;
  test_id: string;
  new_test_id?: string;
  name?: string;
  description?: string;
  retire?: boolean;
  retire_reason?: string;
  reassign_to?: string;
  criterion_text?: string;
}

/** Strip this case's bindings from a criteria list: testId removed, evidenceStale set,
 *  met preserved — the deliberate evidence-due state, never a silent unproof.
 *  The mark is the same OBJECT shape R5e's git lane writes ({at, reason} — the Spec
 *  card renders evidenceStale.at); a fresh report_test_results run clears it. */
function releaseCriteriaBoundTo(criteria: AnyRecord[], caseId: string, at: string, reason: string): {
  changed: boolean; criteria: AnyRecord[]; releasedTexts: string[];
} {
  const releasedTexts: string[] = [];
  const next = criteria.map((c) => {
    if (c.testId !== caseId) return c;
    releasedTexts.push(String(c.text ?? ''));
    const { testId: _dropped, ...rest } = c;
    return { ...rest, evidenceStale: { at, reason } };
  });
  return { changed: releasedTexts.length > 0, criteria: next, releasedTexts };
}

const asCriteria = (raw: unknown): AnyRecord[] =>
  (Array.isArray(raw) ? (raw as unknown[]) : [])
    .map((c) => (typeof c === 'string' ? { text: c } : { ...(c as AnyRecord) }));

export async function handleUpdateTestCase(
  supabase: SupabaseClient,
  auth: AuthResult,
  args: UpdateTestCaseArgs,
): Promise<MCPResponse> {
  if (!checkScope(auth, 'write')) {
    return { success: false, error: 'Insufficient permissions: write scope required' };
  }
  if (!args.project_id || !args.requirement_id || !args.test_id?.trim()) {
    return { success: false, error: 'project_id, requirement_id, and test_id are required' };
  }
  const hasAction = args.new_test_id !== undefined || args.name !== undefined ||
    args.description !== undefined || args.retire !== undefined ||
    args.reassign_to !== undefined || args.criterion_text !== undefined;
  if (!hasAction) {
    return { success: false, error: 'Nothing to do — pass at least one of new_test_id, name, description, retire, reassign_to, criterion_text.' };
  }
  if (args.retire === true && !(args.retire_reason ?? '').trim()) {
    return { success: false, error: 'retire: true requires retire_reason — a retirement must be explainable later (e.g. "superseded by TC-004").' };
  }
  if (args.new_test_id !== undefined && !args.new_test_id.trim()) {
    return { success: false, error: 'new_test_id must be a non-empty string.' };
  }
  if (args.criterion_text !== undefined && !(args.criterion_text ?? '').trim()) {
    return { success: false, error: 'criterion_text must be the criterion\'s exact non-empty text.' };
  }
  if (args.criterion_text !== undefined && args.retire === true) {
    return { success: false, error: 'criterion_text cannot be combined with retire: true — a retired case must not hold criterion bindings. Retire it, then bind the replacement case.' };
  }

  const resolved = await resolveProjectByName(supabase, auth.userId, args.project_id);
  if ('error' in resolved) return resolved.error;
  const projectId = resolved.project.id;
  const spec = await resolveSpecForProject(supabase, projectId);
  if (!spec) return { success: false, error: 'No specification found for this project.' };
  const requirement = await resolveRequirementRow(supabase, spec.id, args.requirement_id);
  if (!requirement) {
    return { success: false, error: `Requirement not found in this project: ${args.requirement_id}` };
  }

  // The lookup deliberately does NOT filter retired rows — retired cases must stay
  // reachable (to un-retire, rename for the record, or rebind after revival).
  const testId = args.test_id.trim();
  const { data: testCase } = await supabase
    .from('test_cases')
    .select('id, test_id, name, status, retired_at, retired_reason')
    .eq('requirement_id', requirement.id)
    .eq('test_id', testId)
    .maybeSingle();
  if (!testCase) {
    return { success: false, error: `No test case "${testId}" on ${requirement.requirement_id}. Cases are keyed (requirement_id, test_id) — check get_test_plan's per-case summary for the exact ids.` };
  }
  const caseId = testCase.id as string;

  // Resolve the reassign target FIRST — rename collisions are checked against the
  // FINAL owner, whichever requirement that ends up being.
  let target: AnyRecord | null = null;
  if (args.reassign_to !== undefined) {
    target = await resolveRequirementRow(supabase, spec.id, args.reassign_to);
    if (!target) {
      return { success: false, error: `Reassign target not found in this project: ${args.reassign_to}` };
    }
    if (target.id === requirement.id) {
      return { success: false, error: `${requirement.requirement_id} already owns "${testId}" — reassign_to must name a different requirement.` };
    }
  }
  const finalOwner = target ?? requirement;
  const finalTestId = args.new_test_id !== undefined ? args.new_test_id.trim() : testId;

  // Collision check when the (requirement, test_id) key changes: the UNIQUE
  // constraint would reject it anyway, but this refusal NAMES the holder.
  if (finalTestId !== testId || target) {
    const { data: holder } = await supabase
      .from('test_cases')
      .select('id, test_id, name')
      .eq('requirement_id', finalOwner.id)
      .eq('test_id', finalTestId)
      .neq('id', caseId)
      .maybeSingle();
    if (holder) {
      return {
        success: false,
        error: `${finalOwner.requirement_id} already has a test case "${finalTestId}" (${holder.name ?? 'unnamed'}). ` +
          (target ? 'Rename one of them first (pass new_test_id with the reassign), or retire the obsolete one.' : 'Pick a different new_test_id, or retire the obsolete case.'),
      };
    }
  }

  const now = new Date().toISOString();
  const changes: string[] = [];
  const notes: string[] = [];
  const updatePayload: AnyRecord = { updated_at: now };

  if (args.new_test_id !== undefined && finalTestId !== testId) {
    updatePayload.test_id = finalTestId;
    changes.push(`renamed test_id "${testId}" → "${finalTestId}"`);
  }
  if (args.name !== undefined) {
    updatePayload.name = args.name;
    changes.push('updated name');
  }
  if (args.description !== undefined) {
    updatePayload.description = args.description;
    changes.push('updated description');
  }
  if (target) {
    updatePayload.requirement_id = target.id;
    // Deliberate staleness: the move is a design act, not evidence — whatever this
    // case last proved, it proved on the OLD requirement.
    updatePayload.stale = true;
    updatePayload.staleness_reason = `Reassigned from ${requirement.requirement_id}`;
    changes.push(`reassigned ${requirement.requirement_id} → ${target.requirement_id} (marked stale — re-run and report against ${target.requirement_id})`);
  }
  if (args.retire === true) {
    updatePayload.retired_at = now;
    updatePayload.retired_reason = args.retire_reason!.trim();
    changes.push(`retired: ${updatePayload.retired_reason}`);
    notes.push('Retired cases are excluded from every count surface but never deleted. Reporting a fresh result via report_test_results revives the case.');
  } else if (args.retire === false) {
    if (testCase.retired_at == null) {
      notes.push('retire: false was a no-op — the case was not retired.');
    } else {
      updatePayload.retired_at = null;
      updatePayload.retired_reason = null;
      changes.push('un-retired');
    }
  }

  const { error: updateError } = await supabase
    .from('test_cases')
    .update(updatePayload)
    .eq('id', caseId);
  if (updateError) {
    return { success: false, error: `Failed to update test case ${testId}: ${updateError.message}` };
  }

  // Criteria release: on REASSIGN the old requirement's bindings to this case are no
  // longer backed by a case it owns; on RETIRE a criterion must never keep reading
  // proven-by a case the surfaces no longer show. Same release either way — testId
  // stripped, evidenceStale set, met preserved (evidence-due, the honest state).
  let releasedCriteria: string[] = [];
  const mustRelease = target !== null || args.retire === true;
  if (mustRelease) {
    const releaseOwner = target ? requirement : finalOwner; // reassign releases the OLD owner
    const release = releaseCriteriaBoundTo(
      asCriteria(releaseOwner.acceptance_criteria), caseId, now,
      target ? 'case-reassigned' : 'case-retired',
    );
    if (release.changed) {
      const { error: releaseError } = await supabase
        .from('specification_requirements')
        .update({ acceptance_criteria: release.criteria, updated_at: now })
        .eq('id', releaseOwner.id);
      if (releaseError) {
        return { success: false, error: `Test case updated, but releasing its criterion bindings on ${releaseOwner.requirement_id} failed: ${releaseError.message}` };
      }
      releasedCriteria = release.releasedTexts;
      changes.push(`released ${release.releasedTexts.length} criterion binding(s) on ${releaseOwner.requirement_id} (met preserved, evidence marked stale)`);
    }
  }

  // REBIND lane (criterion-reword recovery): exact text on the FINAL owner, same R5a
  // rules as report_test_results. Binding alone NEVER flips met.
  let binding: CriterionBinding | undefined;
  if (args.criterion_text !== undefined) {
    // retire+bind was refused up front, so the bind owner's criteria row is
    // untouched by the release above (which only wrote the OLD owner on reassign).
    const bindOwner = finalOwner;
    const criteria = asCriteria(bindOwner.acceptance_criteria);
    const criterion = criteria.find((c) => c.text === args.criterion_text);
    if (!criterion) {
      binding = 'unbound';
      notes.push(`criterion_text matched NO criterion on ${bindOwner.requirement_id} exactly — nothing was bound; check list_requirements for the exact text.`);
    } else if (criterion.verification === 'manual') {
      binding = 'manual-lane';
      notes.push(`"${args.criterion_text}" is verification: 'manual' — binding REFUSED. Manual criteria are proven through the task-doc tick + user approval, never test cases.`);
    } else {
      const boundTo = typeof criterion.testId === 'string' && criterion.testId.length > 0 ? criterion.testId : null;
      if (boundTo && boundTo !== caseId) {
        binding = 'conflict';
        notes.push(`"${args.criterion_text}" is already bound to a DIFFERENT test case — never stolen. Retire or reassign the other case first if it is obsolete.`);
      } else if (boundTo === caseId) {
        binding = 'already-bound';
      } else {
        criterion.testId = caseId;
        const { error: bindError } = await supabase
          .from('specification_requirements')
          .update({ acceptance_criteria: criteria, updated_at: now })
          .eq('id', bindOwner.id);
        if (bindError) {
          return { success: false, error: `Test case updated, but binding the criterion failed: ${bindError.message}` };
        }
        binding = 'bound';
        changes.push(`bound criterion "${args.criterion_text}" on ${bindOwner.requirement_id}`);
        notes.push('Binding alone never flips met — run the test and report the outcome via report_test_results to prove the criterion.');
      }
    }
  }

  return {
    success: true,
    data: {
      caseId,
      testId: finalTestId,
      requirementId: String(finalOwner.requirement_id),
      changes,
      ...(releasedCriteria.length > 0 ? { releasedCriteria } : {}),
      ...(binding ? { criterionBinding: binding } : {}),
      ...(notes.length > 0 ? { notes } : {}),
      message: changes.length > 0
        ? `Updated test case "${finalTestId}" on ${finalOwner.requirement_id}: ${changes.join('; ')}.`
        : `No changes applied to "${finalTestId}" on ${finalOwner.requirement_id}.`,
      nextAction: target
        ? `The case is deliberately stale on ${finalOwner.requirement_id} — re-run it there and report via report_test_results (pass criterion_text to bind it to the criterion it proves).`
        : args.retire === true
          ? 'If a replacement case supersedes this one, report it via report_test_results with criterion_text so the released criteria regain live evidence.'
          : 'Call get_test_plan for the per-case summary, or report a fresh run via report_test_results.',
    },
  };
}
