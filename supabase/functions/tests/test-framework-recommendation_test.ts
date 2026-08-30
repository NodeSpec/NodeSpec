// The Test Plan's **Framework** line reaches the user's paired AI through MCP context,
// get_test_plan, and the agent loop. It used to be inferred with four
// `technology.name.toLowerCase().includes(...)` tests, and `includes("go")` matched 48 of
// the 297 catalog rows — every Google Cloud service, plus Algolia, ArgoCD, MongoDB and
// Godot. Exactly one of the 48 was Go.
//
// A user building a Godot game was told to use `go test`. These pin the fix: the lookup is
// keyed on technology ID, and an unknown technology yields NO recommendation rather than a
// wrong one.
import { generateTestDocument } from '../_shared/test-document-generator.ts';
import { assert, assertEquals } from './helpers.ts';

// deno-lint-ignore no-explicit-any
function tech(id: string, name: string): any {
  return { id, name, role_affinities: [], ai_context: {} };
}

// deno-lint-ignore no-explicit-any
function input(techId: string, techName: string): any {
  return {
    requirement: {
      requirementId: 'REQ-1',
      name: 'Player can move',
      category: 'functional',
      description: 'The avatar responds to input.',
      acceptanceCriteria: [],
    },
    graph: { nodes: {}, edges: {}, contracts: {}, artifacts: {}, nodeGroups: {} },
    catalogs: { nodeRoles: {}, technologies: { [techId]: tech(techId, techName) }, deploymentTargets: {}, cloudProviderPatterns: [], scopeArchetypes: {} },
    mappedNodes: [{ nodeId: 'n1', label: 'Game Client', role: 'game-client', technology: techId }],
    sourceArtifacts: [],
  };
}

function frameworkLine(doc: string): string | null {
  const m = doc.split('\n').find((l) => l.startsWith('**Framework:**'));
  return m ? m.replace('**Framework:**', '').trim() : null;
}

Deno.test('THE BUG: Godot no longer recommends go test', () => {
  const doc = generateTestDocument(input('godot', 'Godot'));
  const fw = frameworkLine(doc);
  assert(fw !== 'go test', 'Godot must never be recommended Go tooling');
  assertEquals(fw, 'GdUnit4');
});

Deno.test('Google Cloud technologies no longer recommend go test', () => {
  // 45 of the 48 false positives were Google Cloud rows — the largest silent blast radius.
  for (const [id, name] of [
    ['gcp-cloud-run', 'Google Cloud Run'],
    ['gcp-cloud-sql', 'Google Cloud SQL'],
    ['gcp-cloud-storage', 'Google Cloud Storage'],
  ]) {
    const fw = frameworkLine(generateTestDocument(input(id, name)));
    assert(fw !== 'go test', `${name} must not be recommended Go tooling`);
  }
});

Deno.test('the other name-collision victims are clean too', () => {
  for (const [id, name] of [['mongodb', 'MongoDB'], ['argocd', 'ArgoCD'], ['algolia', 'Algolia']]) {
    const fw = frameworkLine(generateTestDocument(input(id, name)));
    assert(fw !== 'go test', `${name} must not be recommended Go tooling`);
  }
});

Deno.test('real Go still gets go test', () => {
  assertEquals(frameworkLine(generateTestDocument(input('go-backend', 'Go'))), 'go test');
});

Deno.test('an unknown technology yields NO framework line, not a guess', () => {
  // Silence is the correct output. A wrong framework does not degrade gracefully — the AI
  // acts on it and writes tests in the wrong language.
  assertEquals(frameworkLine(generateTestDocument(input('some-new-thing', 'Some New Thing'))), null);
});

Deno.test('ai_context.testingPatterns still wins over the id map', () => {
  const inp = input('godot', 'Godot');
  inp.catalogs.technologies['godot'].ai_context = { testingPatterns: { framework: 'GUT (project standard)' } };
  assertEquals(frameworkLine(generateTestDocument(inp)), 'GUT (project standard)');
});
