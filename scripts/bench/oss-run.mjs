#!/usr/bin/env node
// NodeSpec community test bench.
//
//   npm run bench:oss                 run every scenario
//   npm run bench:oss -- --only=unchanged-push
//   npm run bench:oss -- --list       print scenarios by functional area (offline)
//   npm run bench:oss -- --dry-run    validate config/env parsing only (offline)
//
// Live end-to-end regression against YOUR running NodeSpec stack (the local
// dev stack or the deploy/community compose stack) and a dedicated throwaway
// GitHub sandbox repo, which is FORCE-RESET BEFORE EVERY SCENARIO. Setup:
// scripts/bench/README.md. The harness refuses non-local URLs by design.
import { loadEnv, assertServiceKey, signIn, github, Scenario } from './lib.mjs';
import { cleanupPreviousRuns } from './fixtures.mjs';
import gitopsCore from './scenarios/gitops-core.mjs';
import mergeBranches from './scenarios/merge-branches.mjs';
import specCriteria from './scenarios/spec-criteria.mjs';
import webhookMcp from './scenarios/webhook-mcp.mjs';
import c4TestPlan from './scenarios/c4-test-plan.mjs';
import r6SpecPlane from './scenarios/r6-spec-plane.mjs';
import statusLeads from './scenarios/status-leads.mjs';
import workLoopTicks from './scenarios/work-loop-ticks.mjs';
import directCommitSync from './scenarios/direct-commit-sync.mjs';
import bindingsEdgeCases from './scenarios/bindings-edge-cases.mjs';
import proposalSessions from './scenarios/proposal-sessions.mjs';
import prCommitMode from './scenarios/pr-commit-mode.mjs';
import boardLoop from './scenarios/board-loop.mjs';
import evidenceUpstream from './scenarios/evidence-upstream.mjs';
import testCrud from './scenarios/test-crud.mjs';
import dogfoodFixes from './scenarios/dogfood-fixes.mjs';

const ALL = [...gitopsCore, ...mergeBranches, ...specCriteria, ...webhookMcp, ...c4TestPlan, ...r6SpecPlane, ...statusLeads, ...workLoopTicks, ...directCommitSync, ...bindingsEdgeCases, ...proposalSessions, ...prCommitMode, ...boardLoop, ...evidenceUpstream, ...testCrud, ...dogfoodFixes];

// Scenarios grouped by the FUNCTIONALITY they prove — the community view of
// the suite. Every imported scenario must appear in exactly one category
// (validated below, so an uncategorized addition fails loudly).
const CATEGORIES = [
  {
    title: 'Repository sync & drift detection',
    scenarios: ['connect-baseline', 'push-format', 'legacy-anchor-compat', 'out-of-band-detect', 'spec-drift', 'webhook-lane', 'unchanged-push'],
  },
  {
    title: 'Branches & pull requests',
    scenarios: ['merge-swallow-rebase', 'merge-swallow-squash', 'branch-safety', 'pr-commit-mode'],
  },
  {
    title: 'Architecture proposals over MCP',
    scenarios: ['proposal-sessions', 'patch-key-refusal'],
  },
  {
    title: 'Requirements & the specification plane',
    scenarios: ['req-sections', 'spec-import-lead', 'r6-vision-lane', 'r6-relations-coupling', 'r6-canvas-data'],
  },
  {
    title: 'Acceptance evidence & the work loop',
    scenarios: ['criteria-loop', 'mcp-tools', 'evidence-upstream', 'work-loop-ticks', 'board-loop'],
  },
  {
    title: 'Test plans & verification',
    scenarios: ['test-plan-loop', 'test-crud', 'testplan-read-refresh'],
  },
  {
    title: 'File bindings & task packets',
    scenarios: ['direct-commit-sync', 'bindings-edge-cases', 'suppress-guidance'],
  },
];

// ── category map integrity (offline, before anything network) ────────────────
const categorized = CATEGORIES.flatMap((c) => c.scenarios);
const known = new Set(ALL.map((s) => s.name));
const missing = [...known].filter((n) => !categorized.includes(n));
const phantom = categorized.filter((n) => !known.has(n));
const dupes = categorized.filter((n, i) => categorized.indexOf(n) !== i);
if (missing.length || phantom.length || dupes.length) {
  console.error('Category map out of sync with the imported scenarios:');
  if (missing.length) console.error(`  uncategorized: ${missing.join(', ')}`);
  if (phantom.length) console.error(`  unknown names: ${phantom.join(', ')}`);
  if (dupes.length) console.error(`  duplicated:    ${dupes.join(', ')}`);
  process.exit(2);
}
const byName = new Map(ALL.map((s) => [s.name, s]));
const categoryOf = new Map(CATEGORIES.flatMap((c) => c.scenarios.map((n) => [n, c.title])));

const args = new Map(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));

if (args.has('list')) {
  console.log('NodeSpec community bench — live scenarios by functional area:\n');
  for (const cat of CATEGORIES) {
    console.log(`  ${cat.title}`);
    for (const n of cat.scenarios) console.log(`    ${n}`);
    console.log('');
  }
  console.log(`${ALL.length} scenarios. Run all: npm run bench:oss — one: -- --only=<name>`);
  process.exit(0);
}

if (args.has('dry-run')) {
  const env = loadEnv({ dryRun: true });
  console.log('Config parses. Effective (secrets elided):');
  console.log(`  SUPABASE_URL = ${env.SUPABASE_URL}`);
  console.log(`  BENCH_REPO   = ${env.BENCH_REPO}`);
  console.log(`  BENCH_USER   = ${env.BENCH_USER}`);
  console.log('Dry run only — nothing was called.');
  process.exit(0);
}

const only = args.get('only');
const toRun = only ? ALL.filter((s) => s.name === only) : CATEGORIES.flatMap((c) => c.scenarios.map((n) => byName.get(n)));
if (toRun.length === 0) {
  console.error(`No scenario named "${only}". Use --list.`);
  process.exit(2);
}

const env = loadEnv();
await assertServiceKey(env);
const session = await signIn(env);
console.log(`Signed in as ${env.BENCH_USER} against ${env.SUPABASE_URL}`);
console.log(`Sandbox repo: ${env.BENCH_REPO} (force-reset before every scenario)\n`);

await cleanupPreviousRuns(env);
const gh = github(env);

const results = [];
let currentCategory = null;
for (const sc of toRun) {
  const cat = categoryOf.get(sc.name);
  if (cat !== currentCategory) {
    currentCategory = cat;
    console.log(`\n══ ${cat}`);
  }
  console.log(`━━ ${sc.name}`);
  let scenario;
  try {
    await gh.resetSandbox('main');
    const out = await sc.run(env, session);
    scenario = out.s;
  } catch (err) {
    scenario = new Scenario(sc.name, sc.boxes);
    scenario.check('scenario ran to completion', false, err?.stack ?? String(err));
  }
  results.push({ name: sc.name, category: cat, scenario });
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let failedScenarios = 0;
let lastCategory = null;
for (const r of results) {
  if (r.category !== lastCategory) {
    lastCategory = r.category;
    console.log(`  ${r.category}`);
  }
  const failed = r.scenario.failed.length;
  const total = r.scenario.checks.length;
  const mark = failed === 0 ? 'PASS' : 'FAIL';
  if (failed > 0) failedScenarios++;
  console.log(`    [${mark}] ${r.name.padEnd(24)} ${total - failed}/${total} checks`);
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (failedScenarios > 0) {
  console.log(`\n${failedScenarios} scenario(s) failed — each failure above is a live bug report. ` +
    'Re-run one with -- --only=<name>.');
  process.exit(1);
}
console.log('\nAll scenarios passed.');
