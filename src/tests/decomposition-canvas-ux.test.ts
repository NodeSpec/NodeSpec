import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Owner refinements 2026-08-22 (Decomposition canvas):
//  1. a type-to-filter above the bottom dock — refined same day: matching
//     COLLAPSES the columns to the match plus its linked nodes (a matched
//     requirement keeps its architecture and tests; a matched architecture
//     node keeps its requirements, not their other architecture; a matched
//     test keeps its requirement's group and that requirement's
//     architecture) — unrelated nodes leave the canvas and survivors re-pack;
//  2. the Deployment column is retired — deployment reads as a light dashed
//     wrapper (icon + label) drawn around the architecture nodes it hosts;
//  3. test cards no longer overlap their group header (the rendered NodeGroup
//     header is ~47px; the old 28px constant placed cards inside it).

const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');

describe('Decomposition canvas — type-to-filter collapses to the linked set', () => {
  const canvas = read('ui/components/layout/DecompositionCanvas.tsx');

  it('the filter feeds the LAYOUT (collapse + re-pack), not a dim pass', () => {
    expect(canvas).toContain("useState('')");
    expect(canvas).toContain('columnFilter');
    expect(canvas).toContain('Filter requirements, nodes, tests…');
    // The keep-sets gate the layout inputs — unrelated nodes never render.
    expect(canvas).toContain('keepReqIds');
    expect(canvas).toContain('keepArchIds');
    expect(canvas).toContain('renderableReqsAll.filter((r) => keepReqIds!.has(r.id))');
    expect(canvas).toContain('allArchLeafIds.filter((id) => keepArchIds!.has(id))');
    expect(canvas).toContain('allTestCases.filter((tc) => keepReqIds!.has(tc.requirementId))');
    // The layout memo re-runs on the needle; no post-layout dim pass remains.
    expect(canvas).toMatch(/visibleColumns, filterNeedle\]\);/);
    expect(canvas).not.toContain('dimmedIds');
    expect(canvas).toContain('edges={edges}');
  });

  it('linkage is one hop from the match: req↔arch via trace+mappings, test→its requirement', () => {
    // requirement → combined arch leaves (the same union the edges draw from).
    expect(canvas).toContain('reqArchIds');
    expect(canvas).toContain('req.architectureTrace');
    expect(canvas).toContain('archLeafIdSet.has(m.nodeId)');
    // Matching surfaces per column.
    expect(canvas).toContain('req.requirementId, req.name, req.description');
    expect(canvas).toContain('matchText(tc.testId, tc.name)');
    expect(canvas).toContain("getNodeTypeById(n.type)?.label");
    // A matched arch node pulls in its requirements; matched reqs/tests pull
    // in THEIR architecture — and nothing further (no transitive closure).
    expect(canvas).toContain('matchedArchIds.has(id))) keepReqIds.add(reqId)');
    expect(canvas).toContain('matchedReqIds, ...matchedTestReqIds');
  });

  it('the canvas empties honestly while filtering: sections and columns collapse, empty states say "No matches"', () => {
    expect(canvas).toContain('renderableReqs.some((r) => r.sectionId === section.id)');
    expect(canvas).toMatch(/filterNeedle \? 'No matches' : 'No requirements yet'/);
    expect(canvas).toMatch(/filterNeedle \? 'No matches' : 'No architecture yet'/);
    expect(canvas).toMatch(/filterNeedle \? 'No matches' : 'No tests yet'/);
  });
});

describe('Decomposition canvas — deployment wrappers replace the column', () => {
  const canvas = read('ui/components/layout/DecompositionCanvas.tsx');

  it('the deployment COLUMN is gone: no deployment-group, no dock toggle, no arch→deploy edges', () => {
    expect(canvas).not.toContain("'deployment-group'");
    expect(canvas).not.toContain("['deployment', 'Deployment']");
    expect(canvas).not.toContain('-to-deploy-');
    expect(canvas).not.toContain('deploymentColumnRendered');
  });

  it('deployed arch nodes nest inside light wrapper nodes; ids stay arch-<id> so edges are untouched', () => {
    expect(canvas).toContain("type: 'deploymentWrapper'");
    expect(canvas).toContain('deploy-wrap-');
    expect(canvas).toContain('archToDeployment');
    // Same ancestor walk the old column used — the wrapper is the same truth.
    expect(canvas).toContain("new Set(['infrastructure', 'orchestration', 'runtime'])");
    expect(canvas).toContain('const archNodeId = `arch-${nodeId}`;');
    // Wrappers are chrome: unselectable, and the click handler no longer
    // routes a deploy- prefix.
    expect(canvas).toContain('selectable: false');
    expect(canvas).not.toContain("node.id.startsWith('deploy-')");
  });

  it('the tests column anchors on positions tracked during layout, not a parentId scan (nesting broke it)', () => {
    expect(canvas).toContain('archColumnRelY');
    expect(canvas).toContain('archColumnRelY.get(archIds[0])');
    expect(canvas).not.toContain("node.parentId === 'architecture-group'");
  });

  it('the wrapper component exists and is registered as a node type', () => {
    expect(existsSync(resolve(SRC, 'ui/components/nodes/DeploymentWrapperNode.tsx'))).toBe(true);
    const wrapper = read('ui/components/nodes/DeploymentWrapperNode.tsx');
    // Light chrome: dashed border, icon header, no handles, clicks fall through.
    expect(wrapper).toContain('dashed');
    expect(wrapper).toContain("pointerEvents: 'none'");
    expect(wrapper).not.toContain('<Handle');
    const registry = read('ui/components/nodes/SpecializedNodes.tsx');
    expect(registry).toContain('deploymentWrapper: DeploymentWrapperNode');
  });
});

describe('Decomposition canvas — tests column overlap fix', () => {
  it('the group header constant clears the rendered NodeGroup header height', () => {
    const canvas = read('ui/components/layout/DecompositionCanvas.tsx');
    const match = canvas.match(/const testGroupHeaderH = (\d+);/);
    expect(match).toBeTruthy();
    // NodeGroup renders ~47px of header (12px padding ×2 + 21px badge + 2px
    // border); anything smaller puts the first card inside it.
    expect(Number(match![1])).toBeGreaterThanOrEqual(48);
  });
});
