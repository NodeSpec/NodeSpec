// W (owner 2026-09-23): the Workflows space held to the approved mockup
// (workflow-space.html, v9). The read side is pure (space-model.ts) and so is
// the scene's layout (space-scene.ts exports its geometry and its focus
// rule); both are pinned here without a canvas. The render and the writes
// are workflows-space.test.tsx.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildJourney, outcomeState, stageState, stripLabel, chainSegments, criteriaLine, unplacedOutcomes,
  stageRemovalNote, outcomeRemovalRefusal, activeLayers, scopeOf, layerCountLine, layerOf, evidenceCommit,
  initialsOf, shortDate, OUT_TONE, OUT_WORD, SPACE_COLOR, SPACE_COLOR_LIGHT, BANDS, LAYERS, hues, toneOf, layerColor, reqAlsoLine, artifactOf,
} from '../ui/components/work/workflows/space-model.js';
import { SPACE_CSS } from '../ui/components/work/workflows/space-css.js';
import { statusTones } from '../ui/components/ideation/status-tones.js';
import { columns, laneXs, colWidth, focusMatch } from '../ui/components/work/workflows/space-scene.js';
import { spaceFixture } from './helpers/space-fixture.js';
import type { TraceChain } from '../ui/components/ideation/useTraceData.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const journey = () => {
  const f = spaceFixture();
  return { f, j: buildJourney({ lane: f.lanes[0], lanes: f.lanes, outcomes: f.outcomes, requirements: f.band, chains: f.chains, graph: f.graph }) };
};

describe('W · the states, in the mockup\'s words', () => {
  it('an outcome: not built, being built, ready to close, done (settled AND proven)', () => {
    const proven = { proven: 2, total: 2 }, open = { proven: 1, total: 2 };
    expect(outcomeState({ settled: false, reqs: [] })).toBe('unimpl');
    expect(outcomeState({ settled: false, reqs: [proven, open] })).toBe('open');
    expect(outcomeState({ settled: false, reqs: [proven] })).toBe('ready');
    expect(outcomeState({ settled: true, reqs: [proven] })).toBe('done');
    // a settled outcome whose requirement is not proven yet is still being built
    expect(outcomeState({ settled: true, reqs: [open] })).toBe('open');
    // a requirement with no criteria proves nothing
    expect(outcomeState({ settled: false, reqs: [{ proven: 0, total: 0 }] })).toBe('open');
    expect(OUT_WORD).toEqual({ none: 'no outcome', unimpl: 'not built', open: 'being built', ready: 'ready to close', done: 'done' });
    expect(OUT_TONE.unimpl).toBe(SPACE_COLOR.bad);
  });

  it('a stage reads as the worst thing under it; no outcome is its own state', () => {
    expect(stageState([])).toBe('none');
    expect(stageState([{ state: 'done' }, { state: 'unimpl' }])).toBe('unimpl');
    expect(stageState([{ state: 'done' }, { state: 'open' }, { state: 'ready' }])).toBe('open');
    expect(stageState([{ state: 'done' }, { state: 'ready' }])).toBe('ready');
    expect(stageState([{ state: 'done' }])).toBe('done');
  });
});

describe('W · one workflow as the space draws it', () => {
  it('a column per stage; outcomes are the kind-outcome candidates mapped to it, never an imported kind', () => {
    const { j } = journey();
    expect(j.stages.map((s) => [s.name, s.outcomes.map((o) => o.id), s.state])).toEqual([
      ['Detect', ['o1'], 'done'],
      ['Triage', ['o2'], 'open'],
      ['Contain', [], 'none'],
      ['Eradicate', ['o4'], 'unimpl'],
      ['Report', ['o5'], 'ready'],
    ]);
  });

  it('the requirements under an outcome, with their node, tests, tasks, and the file with its commit', () => {
    const { j } = journey();
    const [r1] = j.stages[0].outcomes[0].reqs;
    expect(r1).toMatchObject({ ref: 'REQ-014', name: 'Anomalous login detection', confirmed: true, proven: 2, total: 2, by: 'human' });
    expect(r1.node).toMatchObject({ id: 'n1', label: 'Detection Engine', tech: 'sigma-rules', taskTotal: 1 });
    expect(r1.node!.tasks).toEqual([{ id: 'task:n1:t1', displayId: 'T01', title: 'Write the sigma rule', done: true, commit: '9e41b07', planSet: null }]);
    expect(r1.tests).toEqual([{ testId: 'TC-004', name: 'five failures raise', status: 'passed', type: 'unit', framework: 'pytest', criterion: 'AC1' }]);
    // the covered source, not the test file; hash and language from the graph's artifact of the same path
    expect(r1.artifact).toEqual({ path: 'services/detection/rules_engine.py', dir: 'services/detection', file: 'rules_engine.py', sha: '9e41b07', hash: '9f2c1ab4e07d', language: 'python', kind: 'source', provenBy: ['TC-004'] });
    // a requirement with no node and no tests carries neither
    const triage = j.stages[1].outcomes[0];
    expect(triage.reqs.map((r) => [r.ref, !!r.node, r.artifact])).toEqual([['REQ-021', true, null], ['REQ-022', false, null]]);
    expect(triage.byAgent).toBe(true);
  });

  it('"also on": every other step the outcome sits on, in any workflow', () => {
    const { j } = journey();
    expect(j.stages[4].outcomes[0].also).toEqual([{ laneId: 'wf-po', laneName: 'Purchase order approval', laneColor: '#5fd3c8', stepId: 'p2', stepName: 'Reconcile', stepIndex: 2 }]);
    expect(j.stages[0].outcomes[0].also).toEqual([]);
  });

  it('the strip: the line under each name and the four chain segments', () => {
    const { j } = journey();
    expect(j.stages.map(stripLabel)).toEqual(['done', '1 of 3 proven', 'no outcome yet', 'nothing builds this', 'ready to close']);
    expect(chainSegments(j.stages[0])).toEqual([SPACE_COLOR.proven, SPACE_COLOR.requirement, SPACE_COLOR.node, SPACE_COLOR.artifact]);
    expect(chainSegments(j.stages[2])).toEqual([null, null, null, null]);
    expect(chainSegments(j.stages[3])).toEqual([SPACE_COLOR.bad, null, null, null]);
    expect(criteriaLine(j.stages[1].outcomes[0].reqs)).toBe('1 of 3 criteria proven');
  });

  it('an outcome on no stage of any workflow is listed for Requirements, never lost', () => {
    const f = spaceFixture();
    expect(unplacedOutcomes(f.outcomes, f.lanes).map((o) => o.id)).toEqual(['o9']);
  });
});

describe('AL.29 · the file that carries a requirement is the files its tests name, not the record\'s Code (R3)', () => {
  const sub = (id: string, tc: string, file: string, covers: string[]) => ({
    id: `tc:${id}`, kind: 'test', title: `${tc} \u00b7 a test`, right: 'passed', state: 'ok', live: null, provenance: null,
    detail: [['test code', file]], links: [`af:${file}`, ...covers.map((c) => `af:${c}`)],
  });
  const chainOf = (subs: ReturnType<typeof sub>[]) => ({ verify: { criteria: [], tests: [] }, cells: { plan: [{ down: subs }] } }) as unknown as TraceChain;
  const pick = (subs: ReturnType<typeof sub>[]) => artifactOf({ tasks: [] }, chainOf(subs), null);

  it('the first source a test covers, by path, with the tests that cover it; else the first test file; else none', () => {
    const a = pick([sub('1', 'TC-2', 'a/test_x.py', ['c/y.py']), sub('2', 'TC-1', 'a/test_z.py', ['b/x.py', 'c/y.py'])]);
    expect([a?.path, a?.provenBy]).toEqual(['b/x.py', ['TC-1']]);
    expect(pick([sub('1', 'TC-1', 'a/test_x.py', [])])?.path).toBe('a/test_x.py');
    expect(pick([])).toBeNull();
    expect(artifactOf({ tasks: [] }, null, null)).toBeNull();
  });
});

describe('AL.13 · a requirement behind two outcomes', () => {
  const derive = (f: ReturnType<typeof spaceFixture>, outcomeId: string, by: 'human' | 'agent') => {
    f.outcomes.find((o) => o.id === outcomeId)!.derivations.push({ id: `d-${outcomeId}-r1`, requirementRowId: 'r1', reqRef: 'REQ-014', criteriaIds: [], proposedByKind: by, createdAt: '2026-09-13T10:00:00Z' });
  };
  const build = (f: ReturnType<typeof spaceFixture>) => buildJourney({ lane: f.lanes[0], lanes: f.lanes, outcomes: f.outcomes, requirements: f.band, chains: f.chains, graph: f.graph });

  it('sits under both, each card saying where else it is: the other outcome, its workflow and first stage', () => {
    const f = spaceFixture();
    derive(f, 'o5', 'agent');
    const j = build(f);
    const underO1 = j.stages[0].outcomes[0].reqs[0];
    const underO5 = j.stages[4].outcomes[0].reqs.find((r) => r.ref === 'REQ-014')!;
    expect(underO1.also).toEqual([{ outcomeId: 'o5', outcomeName: 'A timeline lands in the incident record automatically', laneId: 'wf-ir', laneName: 'Incident response', laneColor: '#8B8FE6', stepId: 's4', stepName: 'Report', stepIndex: 4 }]);
    expect(underO5.also.map((a) => [a.outcomeId, a.stepName])).toEqual([['o1', 'Detect']]);
    expect(reqAlsoLine(underO1)).toBe('also under "A timeline lands in the inc…"');
    expect(reqAlsoLine({ also: [underO1.also[0], { ...underO1.also[0], outcomeId: 'o2' }] })).toBe('also under 2 other outcomes');
    expect(reqAlsoLine(j.stages[1].outcomes[0].reqs[0])).toBeNull();
    expect(j.stages[1].outcomes[0].reqs.map((r) => r.also)).toEqual([[], []]);
  });

  it('an outcome on no stage counts in its home workflow, unplaced; a dismissed one and an imported kind do not', () => {
    const f = spaceFixture();
    derive(f, 'o5', 'agent');
    derive(f, 'o9', 'human');
    derive(f, 'imp', 'human');
    expect(build(f).stages[0].outcomes[0].reqs[0].also.map((a) => [a.outcomeId, a.laneName, a.stepId, a.stepName, a.stepIndex])).toEqual([['o5', 'Incident response', 's4', 'Report', 4], ['o9', 'Incident response', null, null, null]]);
    f.outcomes.find((o) => o.id === 'o9')!.status = 'dismissed';
    expect(build(f).stages[0].outcomes[0].reqs[0].also.map((a) => a.outcomeId)).toEqual(['o5']);
  });
});

describe('W · what refuses before the database has to', () => {
  it('a stage that holds outcomes keeps them until they move (a settled outcome\'s map may not change)', () => {
    const { j } = journey();
    expect(stageRemovalNote(j.stages[2])).toBeNull();
    // AE.7: the stage goes on the second press; its outcome is left for the person to place again
    expect(stageRemovalNote(j.stages[0])).toBe('"Detect" still holds an outcome. Removing it leaves it without a stage, for you to place again. Press Remove again to go ahead.');
  });

  it('an outcome that derived a requirement is not removed; its requirements go first', () => {
    const { j } = journey();
    expect(outcomeRemovalRefusal(j.stages[3].outcomes[0])).toBeNull();
    expect(outcomeRemovalRefusal(j.stages[1].outcomes[0])).toBe('Remove its requirements first: REQ-021, REQ-022.');
  });
});

describe('W · the Constraints lens', () => {
  it('a column per layer that holds something, in the canonical order; unknown types fold into Other', () => {
    const f = spaceFixture();
    const rows = [...f.constraints, { id: 'k9', ctype: 'weird', title: 'x', description: 'x', rationale: null, author: null, workflow_id: null }];
    expect(activeLayers(rows).map((l) => [l.layer.label, l.rows.length])).toEqual([['Technology', 2], ['Security', 1], ['Other', 1]]);
    expect(layerOf('nope').ctype).toBe('other');
    expect(LAYERS.map((l) => l.ctype)).toEqual(['technology', 'architecture', 'deployment', 'performance', 'security', 'compliance', 'cost', 'other']);
  });

  it('global or one workflow, named; the strip counts both', () => {
    const f = spaceFixture();
    expect(scopeOf(f.constraints[0], f.lanes)).toEqual({ global: false, word: 'Incident response', tone: '#8B8FE6' });
    expect(scopeOf(f.constraints[1], f.lanes)).toEqual({ global: true, word: 'Global', tone: '#8a8f9e' });
    expect(layerCountLine(f.constraints)).toBe('2 global · 1 for a workflow');
  });
});

describe('W · small helpers', () => {
  it('the evidence commit is the latest stamped one, short; initials and dates read as the mockup does', () => {
    const f = spaceFixture();
    expect(evidenceCommit(f.chains.get('r1')!)).toBe('9e41b07');
    expect(evidenceCommit(f.chains.get('r3')!)).toBeNull();
    expect(evidenceCommit(null)).toBeNull();
    expect(initialsOf('Ana Kohl')).toBe('AK');
    expect(initialsOf('  ')).toBe('');
    expect(shortDate('2026-09-12T10:00:00Z')).toBe('12 Sep');
    expect(shortDate(null)).toBe('');
  });
});

describe('W · the scene\'s layout and focus, without a canvas', () => {
  it('columns are as wide as what they hold, so fanned requirements never overlap the next stage', () => {
    const { j } = journey();
    const cols = columns(j);
    expect(cols.length).toBe(5);
    // Triage holds one outcome with two requirements: wider than the minimum
    expect(colWidth(j.stages[1])).toBeGreaterThan(colWidth(j.stages[0]));
    // each column starts where the last one ends; the plane is centred on 0
    for (let i = 1; i < cols.length; i++) expect(cols[i].x - cols[i].w / 2).toBeCloseTo(cols[i - 1].x + cols[i - 1].w / 2);
    expect(cols[0].x - cols[0].w / 2).toBeCloseTo(-(cols[4].x + cols[4].w / 2));
  });

  it('several outcomes on one stage sit side by side, not stacked in depth', () => {
    const stage = { outcomes: [{ reqs: [] }, { reqs: [{}, {}] }] } as never;
    const xs = laneXs(stage, 0);
    expect(xs.length).toBe(2);
    expect(xs[0]).toBeLessThan(xs[1]);
    // the second lane fans two requirements (2 x 4.5 + 0.6 wide), the first
    // holds one card (5.2); with the 0.9 gap between them nothing overlaps
    expect(xs[1] - xs[0]).toBeCloseTo((5.2 + 9.6) / 2 + 0.9);
    // and the pair is centred under its head
    expect((xs[0] - 5.2 / 2 + xs[1] + 9.6 / 2) / 2).toBeCloseTo(0);
  });

  it('selecting keeps its own line: a stage lights its column, an outcome its limb, a requirement its chain', () => {
    const k = (stepId: string, outcomeId?: string, reqId?: string) => ({ stepId, outcomeId, reqId });
    const onStep = { kind: 'step', stepId: 's1' } as const;
    expect(focusMatch(k('s1', 'o2', 'r2'), onStep)).toBe(true);
    expect(focusMatch(k('s0'), onStep)).toBe(false);
    const onOutcome = { kind: 'outcome', stepId: 's1', outcomeId: 'o2' } as const;
    expect(focusMatch(k('s1'), onOutcome)).toBe(true);
    expect(focusMatch(k('s1', 'o3'), onOutcome)).toBe(false);
    const onReq = { kind: 'req', stepId: 's1', outcomeId: 'o2', reqId: 'r2' } as const;
    expect(focusMatch(k('s1', 'o2'), onReq)).toBe(true);
    expect(focusMatch(k('s1', 'o2', 'r3'), onReq)).toBe(false);
    expect(focusMatch({ ctype: 'security', id: 'k1' }, { kind: 'layer', ctype: 'security' })).toBe(true);
    expect(focusMatch({ ctype: 'security' }, { kind: 'constraint', id: 'k1', ctype: 'security' })).toBe(true);
    expect(focusMatch({ ctype: 'security', id: 'k2' }, { kind: 'constraint', id: 'k1', ctype: 'security' })).toBe(false);
    expect(focusMatch(k('s0'), null)).toBe(true);
  });

  it('the heads sit above the outcome row; connectors draw before every card, as tubes that write no depth', () => {
    const scene = read('src/ui/components/work/workflows/space-scene.ts');
    const yHead = Number(/Y_HEAD = ([\d.]+)/.exec(scene)![1]);
    expect(yHead).toBeGreaterThan(BANDS[0].y + 2);
    const ro = /const RO = \{ line: (\d+), card: (\d+) \}/.exec(scene)!;
    expect(Number(ro[1])).toBeLessThan(Number(ro[2]));
    expect(scene).toContain('m.renderOrder = RO.line;');
    expect(scene).toContain('new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: base, depthWrite: false })');
    expect(scene).toContain('new THREE.TubeGeometry(part, seg, LINK_R, rad, false)');
    // a GL line is one device pixel: none is drawn
    expect(scene).not.toMatch(/new THREE\.Line\(|LineBasicMaterial|LineDashedMaterial/);
    // the empty stage offers its outcome where the outcome will land
    expect(scene).toContain("adds ? { kind: 'addout', stepId: s.id } : { kind: 'step', stepId: s.id }");
    expect(scene).toContain("title: adds ? 'Add an outcome' : 'No outcome yet'");
    // AJ.6: the example below Indie hands the scene editable: false (workflows-space.test.tsx)
    expect(scene).toContain('const adds = model!.editable !== false;');
  });

  it('three is imported only by the scene, and the scene only by the lazily loaded tab', () => {
    expect(read('src/ui/components/work/WorkSurface.tsx')).toContain("const WorkflowsSpace = lazy(() => import('./workflows/WorkflowsSpace.js'));");
    expect(read('src/ui/components/work/WorkSurface.tsx')).not.toContain("from 'three'");
    expect(read('src/ui/components/work/workflows/space-model.ts')).not.toContain("from 'three'");
    expect(read('src/ui/components/work/workflows/WorkflowsSpace.tsx')).not.toContain("from 'three'");
  });
});

describe('X · the space follows the app\'s light or dark setting (owner 2026-09-23)', () => {
  it('dark is the mockup\'s hues; light has its own, and its three state inks are the app\'s light status tones', () => {
    expect(hues('dark')).toBe(SPACE_COLOR);
    expect(hues()).toBe(SPACE_COLOR);
    expect(hues('light')).toBe(SPACE_COLOR_LIGHT);
    expect(Object.keys(SPACE_COLOR_LIGHT).sort()).toEqual(Object.keys(SPACE_COLOR).sort());
    const light = statusTones('light');
    expect([toneOf('done', 'light'), toneOf('open', 'light'), toneOf('unimpl', 'light')]).toEqual([light.ok, light.warn, light.bad]);
    // the dark tones are the constant the mockup named
    for (const s of ['none', 'unimpl', 'open', 'ready', 'done'] as const) expect(toneOf(s)).toBe(OUT_TONE[s]);
  });

  it('the strip, the layers and a constraint\'s scope take the mode', () => {
    const { j } = journey();
    expect(chainSegments(j.stages[0], 'light')).toEqual([SPACE_COLOR_LIGHT.proven, SPACE_COLOR_LIGHT.requirement, SPACE_COLOR_LIGHT.node, SPACE_COLOR_LIGHT.artifact]);
    for (const L of LAYERS) {
      expect(layerColor(L)).toBe(L.color);
      expect(layerColor(L, 'light')).toBe(L.light);
      expect(L.light).not.toBe(L.color);
    }
    const f = spaceFixture();
    expect(scopeOf(f.constraints[1], f.lanes, 'light').tone).not.toBe(scopeOf(f.constraints[1], f.lanes, 'dark').tone);
  });

  it('the stylesheet: every colour is a variable, and both modes set every variable it uses', () => {
    const block = (mode: string) => {
      const m = new RegExp(`\\.ns-ws\\[data-mode="${mode}"\\]\\{([^}]*)\\}`).exec(SPACE_CSS);
      expect(m, mode).toBeTruthy();
      return new Set([...m![1].matchAll(/(--ws-[a-z0-9-]+):/g)].map((x) => x[1]));
    };
    const dark = block('dark'), light = block('light');
    expect([...light].sort()).toEqual([...dark].sort());
    const rules = SPACE_CSS.slice(SPACE_CSS.indexOf('.ns-ws{'));
    const used = new Set([...rules.matchAll(/var\((--ws-[a-z0-9-]+)\)/g)].map((x) => x[1]));
    for (const v of used) expect(dark.has(v), v).toBe(true);
    // no rule paints a colour of its own (the light shadow is the one tint written in place)
    const painted = rules.replace(/\.ns-ws\[data-mode="light"\] \.glass\{[^}]*\}/, '');
    expect(painted).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('the scene paints from a palette per mode and switches it with the model', () => {
    const scene = read('src/ui/components/work/workflows/space-scene.ts');
    expect(scene).toContain('const SCENE_PALETTE: Record<SpaceMode, ScenePalette> = {');
    expect(scene).toContain('P = SCENE_PALETTE[model.mode];');
    expect(scene).toContain('C = hues(model.mode);');
    expect(scene).toContain('fog.color.set(P.fog);');
    expect(scene).not.toContain('SPACE_COLOR');
    // outside the palette table, nothing in the scene names a colour of its own
    const draw = scene.slice(scene.indexOf('function withAlpha'));
    expect(draw).not.toMatch(/'#[0-9a-fA-F]{3,8}'|'rgba\(/);
  });

  it('Work hands the space the app\'s mode', () => {
    expect(read('src/ui/components/work/WorkSurface.tsx')).toContain('mode={theme.mode}');
  });
});
