// Criterion→work-order attribution (owner live find 2026-09-01, "Camera System").
// The old keyword matcher treated ANY contract-name token in a criterion as
// evidence the contract serves it. Contract names embed the OWNING node's own
// domain noun ("Camera Hint Interface" on Camera System), so every camera
// criterion matched, all five rode the Coral Cove contract task, zero
// Implement work orders were synthesized — and because the requirement was
// not mapped to Coral Cove, every line also warned "(unverified match) …
// verify or reassign", telling agents to fix a mapping that was correct.
//
// Doctrine now: a criterion attaches to a contract work order ONLY on
// verified evidence (requirement mapped to the connected node too). A
// keyword-only hit is a soft "possible coordination point" note and the
// criterion keeps its own Implement work order on this node.
import { generateTaskDocument } from '../_shared/task-document-generator.ts';
import { assert } from './helpers.ts';

const N_CAM = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa';
const N_COVE = 'bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb';

// deno-lint-ignore no-explicit-any
const CATALOGS: any = {
  nodeRoles: {
    'backend-service': {
      id: 'backend-service', label: 'Backend Service', description: 'App service',
      nature: 'build', palette_category: 'services', is_container: false,
      container_layer: null, capability_tags: [],
      default_ports: [{ name: 'input', direction: 'in' }, { name: 'output', direction: 'out' }],
    },
  },
  technologies: {}, deploymentTargets: {}, legacyMappings: {}, cloudPatterns: {}, scopeArchetypes: {},
};

// Camera System exposes the hint interface Coral Cove consumes (incoming
// dependency edge), mirroring the reported repro exactly.
// deno-lint-ignore no-explicit-any
function cameraGraph(): any {
  return {
    nodes: {
      [N_CAM]: { id: N_CAM, type: 'backend-service', label: 'Camera System', ports: [] },
      [N_COVE]: { id: N_COVE, type: 'backend-service', label: 'World: Coral Cove', ports: [] },
    },
    edges: {
      e1: { id: 'e1', source: N_COVE, target: N_CAM, contractId: 'c1' },
    },
    contracts: {
      c1: { id: 'c1', name: 'Camera Hint Interface', kind: 'dependency', interactionKind: 'dependency' },
    },
    artifacts: {},
  };
}

const REQ = {
  requirementId: 'REQ-005',
  name: 'Camera follows the player',
  description: 'The camera system.',
  category: 'functional',
  status: 'approved',
  acceptanceCriteria: [
    { text: 'Camera follows the axolotl in both water and land grammars' },
    { text: 'Camera performs collision avoidance against level geometry' },
    { text: 'Worlds can place camera hint volumes near ledges' },
    { text: 'Camera behavior is fully driven by exported configuration values rather than hardcoded constants' },
    { text: 'Camera never induces disorientation during grammar transitions' },
  ],
};

Deno.test('unverified keyword hits never steer ownership: every criterion gets its own Implement work order', () => {
  const doc = generateTaskDocument({
    node: cameraGraph().nodes[N_CAM],
    graph: cameraGraph(),
    catalogs: CATALOGS as never,
    requirements: [REQ],
    requirementNodeMap: { 'REQ-005': [N_CAM] }, // mapped to THIS node only
  });
  // The repro's failure mode: zero Implement work orders, five warnings.
  for (const ac of REQ.acceptanceCriteria) {
    assert(doc.includes(`Implement: "${ac.text}"`), `own work order for: ${ac.text}`);
  }
  assert(!doc.includes('(unverified match)'), 'the self-distrusting serves variant is gone');
  assert(!doc.includes('verify or reassign'), 'no advice to fix a mapping that is correct');
  // The contract task still exists — it just does not own these criteria.
  assert(doc.includes('Expose the interface World: Coral Cove consumes'), 'contract work order intact');
});

Deno.test('self-reference subtraction: the node\'s own noun and generic vocabulary are not evidence', () => {
  const doc = generateTaskDocument({
    node: cameraGraph().nodes[N_CAM],
    graph: cameraGraph(),
    catalogs: CATALOGS as never,
    requirements: [REQ],
    requirementNodeMap: { 'REQ-005': [N_CAM] },
  });
  // "camera" (own label) and "interface" (generic) filtered: the pure-internal
  // criterion carries NO coordination note at all.
  const configLine = doc.split('\n').find((l) => l.includes('serves: REQ-005 "Camera behavior is fully driven'));
  assert(configLine !== undefined, 'config criterion has a serves line');
  assert(!configLine!.includes('coordination'), 'no contract note on a criterion with zero cross-node vocabulary');
  // "hint" IS distinctive contract vocabulary — that criterion keeps the soft
  // note, but still as this node's own work order.
  const hintLine = doc.split('\n').find((l) => l.includes('serves: REQ-005 "Worlds can place camera hint volumes'));
  assert(hintLine !== undefined, 'hint criterion has a serves line');
  assert(hintLine!.includes('possible coordination point: Contract "Camera Hint Interface"'), 'soft note names the contract');
  assert(hintLine!.includes('keyword signal only'), 'note is labeled as signal, not ownership');
});

Deno.test('verified cross-node evidence still attaches to the contract work order, warning-free', () => {
  const req6 = {
    requirementId: 'REQ-006',
    name: 'Hint volume authoring',
    description: 'Worlds author hints.',
    category: 'functional',
    status: 'approved',
    acceptanceCriteria: [{ text: 'Coral Cove hint volumes adjust framing on entry' }],
  };
  const doc = generateTaskDocument({
    node: cameraGraph().nodes[N_CAM],
    graph: cameraGraph(),
    catalogs: CATALOGS as never,
    requirements: [req6],
    requirementNodeMap: { 'REQ-006': [N_CAM, N_COVE] }, // mapped to BOTH nodes
  });
  const lines = doc.split('\n');
  const taskIdx = lines.findIndex((l) => l.includes('Expose the interface World: Coral Cove consumes'));
  const servesIdx = lines.findIndex((l) => l.includes('serves: REQ-006 "Coral Cove hint volumes'));
  assert(taskIdx > -1 && servesIdx > taskIdx, 'criterion rides the contract task');
  assert(lines[servesIdx].includes('coordinate with World: Coral Cove'), 'verified cross-node coordination named');
  assert(!lines[servesIdx].includes('unverified'), 'no warning on verified evidence');
  assert(!doc.includes(`Implement: "${req6.acceptanceCriteria[0].text}"`), 'no duplicate internal work order');
});
