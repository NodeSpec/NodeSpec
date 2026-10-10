// AL.29: the one reader of a requirement's test plan (.nodespec/tests/*.tests.md),
// shared by the server (get_test_plan, the push gate, the carry that keeps the
// agent's statements) and the app (the Requirements record, the Plan board). No
// imports: the app bundles it as it bundles task-deltas.
//
// A plan's test cases are its "#### AC-..." headings under Automated Test
// Scenarios and its items under Manual Verification. Each case's criterion is
// read through the plan's own Acceptance Criteria list, so a case follows its
// criterion by TEXT whatever renumbers the positional AC ids. The statements are
// the agent's: checkbox lines under an automated case's heading, indented
// checkbox lines under a manual item (the check a person performs). Statements
// whose criterion was reworded or removed sit under "Statements to review".

export const AC_ROW = /^- \*\*(AC-[^*\s]+)\*\* \[(?:manual|automated)\] \[(?:VERIFIED|PENDING)\] (.*)$/;
export const SCENARIO_HEADING = /^#### (AC-[^:\s]+):/;
export const MANUAL_ITEM = /^- \[[ xX]\] (AC-\S+)/;
export const STATEMENT = /^- \[[ xX]\] /;
export const INDENTED_STATEMENT = /^\s+- \[[ xX]\] /;
export const SCENARIOS_HEADING = "## Automated Test Scenarios";
export const MANUAL_HEADING = "## Manual Verification";
export const STATEMENTS_TO_REVIEW_HEADING = "#### Statements to review";
export const REVIEW_NOTE = "Kept from a criterion that was reworded or removed. Move each under its test case, or delete it.";
const REVIEW_ENTRY = /^Written for: "/;
const SUGGESTED_TEST_ID = /test_id "([^"]+)"/;

/** The plan's Acceptance Criteria list: AC id -> the criterion's text. */
export function criterionTextById(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let inCriteria = false;
  for (const line of lines) {
    if (/^## (?!#)/.test(line)) { inCriteria = line.trim() === "## Acceptance Criteria"; continue; }
    if (!inCriteria) continue;
    const m = AC_ROW.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

export interface PlanCase {
  /** The plan's positional id: "AC-REQ-003-2". */
  id: string;
  /** The criterion's text from the plan's own list; null when the list does not name the id. */
  criterion: string | null;
  lane: "automated" | "manual";
  /** The test_id the plan suggests for an automated case. */
  testId: string | null;
  /** The agent's statements as the plan carries them (a manual item's unindented). */
  statements: string[];
  /** A case on a contract with no schema yet: it waits for the schema. */
  blocked: boolean;
}

/** Every test case in a plan, in the plan's order, and the lines under
 *  "Statements to review" as written. */
export function planCases(content: string): { cases: PlanCase[]; review: string[] } {
  const lines = String(content ?? "").split("\n");
  const textOf = criterionTextById(lines);
  const cases: PlanCase[] = [];
  const review: string[] = [];
  const open = (id: string, lane: PlanCase["lane"]): PlanCase => {
    const c: PlanCase = { id, criterion: textOf.get(id) ?? null, lane, testId: null, statements: [], blocked: false };
    cases.push(c);
    return c;
  };
  let section = "";
  let current: PlanCase | null = null;
  let inReview = false;
  for (const line of lines) {
    if (/^## (?!#)/.test(line)) { section = line.trim(); current = null; inReview = false; continue; }
    if (section === SCENARIOS_HEADING) {
      if (line.startsWith("#### ")) {
        inReview = line.trim() === STATEMENTS_TO_REVIEW_HEADING;
        const m = SCENARIO_HEADING.exec(line);
        current = m ? open(m[1], "automated") : null;
        continue;
      }
      if (inReview) {
        if (REVIEW_ENTRY.test(line) || STATEMENT.test(line)) review.push(line);
        continue;
      }
      if (!current) continue;
      if (STATEMENT.test(line)) current.statements.push(line);
      else if (line.startsWith("[blocked by schema")) current.blocked = true;
      else current.testId ??= SUGGESTED_TEST_ID.exec(line)?.[1] ?? null;
    } else if (section === MANUAL_HEADING) {
      const m = MANUAL_ITEM.exec(line);
      if (m) { current = open(m[1], "manual"); continue; }
      if (current && INDENTED_STATEMENT.test(line)) { current.statements.push(line.trimStart()); continue; }
      if (!/^\s/.test(line)) current = null;
    }
  }
  return { cases, review };
}

/** The agent's statements in a plan, by criterion text (canonical, unindented),
 *  plus the lines already under "Statements to review", verbatim. */
export function planStatements(content: string): { byText: Map<string, string[]>; review: string[] } {
  const { cases, review } = planCases(content);
  const byText = new Map<string, string[]>();
  for (const c of cases) {
    if (c.criterion === null || c.statements.length === 0) continue;
    byText.set(c.criterion, [...(byText.get(c.criterion) ?? []), ...c.statements]);
  }
  return { byText, review };
}

/** What a plan still asks of an agent: the test cases with no statement under
 *  them (a case blocked by a schema waits for it, so it is not listed), in the
 *  plan's order, and how many statements wait under "Statements to review". */
export function statementGaps(content: string): {
  withoutStatements: Array<{ id: string; criterion: string; lane: "automated" | "manual" }>;
  toReview: number;
} {
  const { cases, review } = planCases(content);
  return {
    withoutStatements: cases.filter((c) => c.statements.length === 0 && !c.blocked).map((c) => ({ id: c.id, criterion: c.criterion ?? "", lane: c.lane })),
    toReview: review.filter((l) => STATEMENT.test(l)).length,
  };
}

// C4 step 5 (Discovered #4): the slug is the requirement ID ONLY: renaming a requirement
// must not move its test plan. The 2-arg signature is kept so no call site churns; the
// name is deliberately unused. Like the task-doc path (P0-4), this is a SEED for first
// creation; lookups go through findExistingTestArtifact, never a recomputed path.
export function getTestDocumentPath(requirementId: string, _requirementName: string): string {
  const slug = requirementId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `.nodespec/tests/${slug}.tests.md`;
}

// The pre-C4 path formula: `{id}-{name}` slugged together. Kept ONLY so plans stored
// before the id-only formula (and before metadata.requirementId stamping) keep being
// found; never used to create new paths.
function legacyTestDocumentPath(requirementId: string, requirementName: string): string {
  const slug = `${requirementId}-${requirementName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `.nodespec/tests/${slug}.tests.md`;
}

// C4 step 5: the ONE way to find a requirement's existing test plan (the analogue of
// findExistingTaskArtifact). Match order:
//   1. metadata.requirementId: rename-proof, stamped on every plan written since C4;
//   2. the id-only path: plans created with the new formula but missing metadata;
//   3. the legacy id+name path: pre-C4 plans (only findable while the name is
//      unchanged, which is exactly the pre-C4 status quo; once refreshed they gain
//      metadata.requirementId and become rename-proof).
//
// AL.28 (owner 2026-10-08): an agent's hand-filed plans named the requirement's
// row id in metadata.requirementId and spelled the path REQ-015.tests.md. Every
// lane missed them, get_test_plan made a second plan beside each, and on macOS or
// Windows git sees REQ-015 and req-015 as one file. With `requirementRowId` the
// row id matches after the human id, and the id-only path matches in any case.
export function findExistingTestArtifact<
  T extends { kind?: string | null; path?: string | null; metadata?: Record<string, unknown> | null },
>(
  artifacts: Record<string, T>,
  requirementId: string,
  requirementName: string,
  requirementRowId?: string,
): T | null {
  const plans = Object.values(artifacts).filter((a) => a?.kind === "test-plan");
  for (const artifact of plans) {
    if (artifact.metadata?.requirementId === requirementId) return artifact;
  }
  if (requirementRowId) {
    for (const artifact of plans) {
      if (artifact.metadata?.requirementId === requirementRowId) return artifact;
    }
  }
  const newPath = getTestDocumentPath(requirementId, requirementName);
  for (const artifact of plans) {
    if (artifact.path === newPath) return artifact;
  }
  for (const artifact of plans) {
    if (typeof artifact.path === "string" && artifact.path.toLowerCase() === newPath) return artifact;
  }
  const legacyPath = legacyTestDocumentPath(requirementId, requirementName);
  for (const artifact of plans) {
    if (artifact.path === legacyPath) return artifact;
  }
  return null;
}
