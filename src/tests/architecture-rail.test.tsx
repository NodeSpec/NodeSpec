// @vitest-environment jsdom
//
// V3 4.4, to the design's Architecture board: the rail beside the canvas,
// mounted for real on the Shelfie web app node with its reads stubbed.
// What the board shows: Work here with the node's proof count (REQ-003's
// mapping the import marked needs-review at 60% confidence, and the
// privacy outcome, 0 of 6 proven), each row a door into Work; the import's
// open questions that sit ON THIS NODE (attributed by evidence file, never
// guessed) with what resolves them; nobody holding it; six connections
// with their contracts, the one without a schema marked.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import { renderCanvas } from './helpers/reactflow-dom.js';
import type { Graph } from '@nodespec/core/types.js';
import type { NodeItems } from '../ui/components/panels/useNodeItems.js';
import type { AgentHold } from '../ui/components/ideation/useAgentPresence.js';

const N = (n: string) => `bf000000-0000-4000-8000-00000000a0${n}`;
const C = (n: string) => `bf000000-0000-4000-8000-00000000c0${n}`;
const E = (n: string) => `bf000000-0000-4000-8000-00000000e0${n}`;
const D = (n: string) => `bf000000-0000-4000-8000-00000000d0${n}`;

const items: NodeItems = { requirements: [], candidates: [], job: null, loading: false, error: null };
// Q: the third argument is whether the plan carries repo import.
const nodeItemsCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock('../ui/components/panels/useNodeItems.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useNodeItems: (...a: unknown[]) => { nodeItemsCalls.push(a); return items; } }));
// The rail reads the account's plan (Q). Indie by default; a test may switch.
const gatePlan = vi.hoisted(() => ({ plan: 'indie' as 'community' | 'indie' }));
vi.mock('../ui/hooks/useFeatureGate.js', async () => {
  const { featureAllowed, FEATURE_RULES } = await import('../ui/config/feature-rules.js');
  return {
    useFeatureGate: () => ({
      plan: gatePlan.plan, subscription: null, loading: false,
      can: (f: Parameters<typeof featureAllowed>[1]) => featureAllowed(gatePlan.plan, f),
      check: (f: Parameters<typeof featureAllowed>[1]) => ({ allowed: featureAllowed(gatePlan.plan, f), rule: FEATURE_RULES[f] }),
      projectLimitReached: () => false, refresh: vi.fn(async () => {}), refreshUntilActive: vi.fn(),
    }),
  };
});
const presence = { holds: [] as AgentHold[], byRef: new Map(), collisions: [], pendingProposals: 0, loading: false, refresh: vi.fn(async () => {}) };
vi.mock('../ui/components/ideation/useAgentPresence.js', async (orig) => ({ ...(await orig<Record<string, unknown>>()), useAgentPresence: () => presence }));

const { ArchitectureRail, nodeConnections, questionsOnNode, requirementLine, deployLines, deploymentSentence, installSentence } = await import('../ui/components/panels/ArchitectureRail.js');

const node = (n: string, label: string, type = 'service') => ({ id: N(n), type, label });
const edge = (n: string, from: string, to: string, contract: string, label: string) => ({ id: E(n), source: N(from), target: N(to), contractId: C(contract), label });
const artifact = (n: string, nodeId: string, path: string) => ({ id: D(n), nodeId, kind: 'source', path, createdAt: '2026-09-15T11:12:00.000Z', updatedAt: '2026-09-15T11:12:00.000Z' });
const shelfie = (): Graph => ({
  id: 'g', schemaVersion: 1, version: 1, hash: 'h',
  nodes: {
    [N('01')]: node('01', 'Shelfie web app', 'frontend-app'), [N('04')]: node('04', 'Supabase Postgres', 'database'), [N('05')]: node('05', 'Supabase Auth'),
    [N('06')]: node('06', 'Supabase Storage'), [N('07')]: node('07', 'Supabase Realtime'), [N('08')]: node('08', 'import-goodreads'), [N('09')]: node('09', 'cover-proxy'), [N('10')]: node('10', 'Shared types'),
  },
  edges: {
    [E('01')]: edge('01', '01', '04', '01', 'supabase-js straight from the browser'),
    [E('02')]: edge('02', '01', '05', '02', 'Session issued to the browser; its sub is what every RLS policy reads'),
    [E('03')]: edge('03', '01', '06', '03', 'Signed and public object URLs'),
    [E('04')]: edge('04', '07', '01', '04', 'shelf_items changes pushed to the open shelf'),
    [E('05')]: edge('05', '01', '09', '05', 'GET /cover-proxy/:isbn'),
    [E('06')]: edge('06', '08', '04', '01', 'Bulk insert on import'),
    [E('07')]: edge('07', '09', '06', '03', 'Caches fetched covers into the covers bucket'),
    [E('08')]: edge('08', '01', '10', '07', 'Row types imported by the app'),
  },
  // Every contract but the browser-to-Postgres one carries a schema: that
  // one is the seed's open question oq-3.
  contracts: {
    [C('01')]: { id: C('01'), kind: 'rest', name: 'PostgREST over the anon key' }, [C('02')]: { id: C('02'), kind: 'rest', name: 'GoTrue session (JWT with sub = auth.uid())', schema: { type: 'object' } },
    [C('03')]: { id: C('03'), kind: 'rest', name: 'Storage object read and write', schema: { type: 'object' } }, [C('04')]: { id: C('04'), kind: 'websocket', name: 'Realtime channel', schema: { type: 'object' } },
    [C('05')]: { id: C('05'), kind: 'rest', name: 'Cover lookup', schema: { type: 'object' } }, [C('07')]: { id: C('07'), kind: 'library', name: 'Shared row types', schema: { type: 'object' } },
  } as never,
  // The seed's bound files: the evidence an open question cites resolves to
  // the node holding the file.
  artifacts: { [D('02')]: artifact('02', N('01'), 'src/lib/supabase.ts'), [D('04')]: artifact('04', N('01'), 'src/lib/sync.ts'), [D('03')]: artifact('03', N('09'), 'supabase/functions/cover-proxy/index.ts') } as never,
});

// The seed's import job, warts and all (scripts/seed-demo/shelfie-import.sql § 9).
const job = () => ({
  id: 'bf000000-0000-4000-8000-000000000501', created_at: '2026-09-15T11:12:00.000Z',
  metrics: { nodes: 9, edges: 8, contracts: 6 },
  open_questions: [
    { id: 'oq-1', kind: 'unresolved_edge', summary: 'An outbound HTTP client in src/lib/sync.ts calls a base URL read from an environment variable. No edge was drawn.', evidence: ['src/lib/sync.ts:14 — fetch(`${import.meta.env.VITE_SYNC_URL}/v1/push`)'], resolution: 'Ask the owner what VITE_SYNC_URL points at, then add_edges with that as the evidence.' },
    { id: 'oq-2', kind: 'ungrouped_node', summary: 'The whole app resolved to one node. 148 files, no module boundary found, so no seam to split on.', evidence: ['no package descriptor below the repository root'], resolution: 'run_repo_import with decisions once the owner says where the seams are.' },
    { id: 'oq-3', kind: 'missing_contract_schema', summary: 'The browser-to-Postgres contract has no schema. 41 call sites use the generated client with no shared type boundary.', evidence: ['src/lib/supabase.ts', '41 call sites across src/'], resolution: 'get_build_readiness reports this as a blocker and supplies draftInputs; submit the schema through propose_patches update_contract.' },
  ],
});

beforeEach(() => {
  items.requirements = [{ mappingId: 'm163', requirementRowId: 'r153', ref: 'REQ-003', name: 'Shelf Sync behaviour', confirmed: false, validationStatus: 'needs-review', confidence: 0.6, criteriaCount: 3, metCount: 0 }];
  items.candidates = [
    { id: 'o302', name: 'A shelf is private unless the reader shares it', kind: 'outcome', status: 'pending', criteriaCount: 3 },
    { id: 'c312', name: 'Shelfie web app data model', kind: 'data', status: 'pending', criteriaCount: 1 },
  ];
  items.job = job();
  presence.holds = [];
  gatePlan.plan = 'indie';
  nodeItemsCalls.length = 0;
});

describe('Architecture rail · the Shelfie web app node', () => {
  it('Work here: 0 of 6 proven; the mapping needing review with its confidence and count; the outcome; the imported candidate; six connections, one without a schema', () => {
    const { getByTestId, getAllByTestId, queryAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={shelfie()} />);
    const rail = getByTestId('architecture-rail');
    expect(rail.textContent).toContain('Work here0 of 6 proven');
    const rows = getAllByTestId('rail-item');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['requirement', 'outcome', 'candidate']);
    expect(within(rows[0]).getByText('Shelf Sync behaviour')).toBeTruthy();
    expect(within(rows[0]).getByTestId('rail-item-line').textContent).toBe('REQ-003unconfirmed, mapped here at 60% confidence, needs review · 0 of 3 provenneeds review');
    expect(within(rows[1]).getByTestId('rail-item-line').textContent).toBe('Outcome, not yet a requirement · 3 draft criteria');
    expect(within(rows[2]).getByTestId('rail-item-line').textContent).toBe('Imported candidate (data), undecided · proposal waiting');
    expect(rail.textContent).toContain('Held bynobody');
    expect(queryAllByTestId('rail-hold').length).toBe(0);
    const connections = getAllByTestId('rail-connection');
    expect(connections.length).toBe(6);
    expect(rail.textContent).toContain('Connects to6');
    expect(connections.map((el) => el.getAttribute('data-direction'))).toEqual(['out', 'out', 'out', 'out', 'out', 'in']);
    expect(connections.map((el) => within(el).getAllByText(/./)[1].textContent)).toEqual(['cover-proxy', 'Shared types', 'Supabase Auth', 'Supabase Postgres', 'Supabase Storage', 'Supabase Realtime']);
    expect(connections[2].textContent).toContain('GoTrue session (JWT with sub = auth.uid())');
    expect(queryAllByTestId('rail-no-schema').length).toBe(1);
    expect(connections[3].textContent).toContain('no schema');
  });

  it('each row is a door: a requirement or an outcome opens Work on it; an imported candidate opens Proposals', () => {
    const onOpenWork = vi.fn();
    const onOpenChanges = vi.fn();
    const { getAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={shelfie()} onOpenWork={onOpenWork} onOpenChanges={onOpenChanges} />);
    const rows = getAllByTestId('rail-item');
    fireEvent.click(rows[0]);
    expect(onOpenWork).toHaveBeenCalledWith({ kind: 'requirement', id: 'r153' });
    fireEvent.click(rows[1]);
    expect(onOpenWork).toHaveBeenCalledWith({ kind: 'outcome', id: 'o302' });
    fireEvent.click(rows[2]);
    expect(onOpenChanges).toHaveBeenCalledTimes(1);
    expect(onOpenWork).toHaveBeenCalledTimes(2);
  });

  it('the questions the import left ON THIS NODE, by their evidence files; the unattributable one is not pinned here', () => {
    const { getAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={shelfie()} />);
    const questions = getAllByTestId('rail-question');
    expect(questions.map((q) => q.getAttribute('data-kind'))).toEqual(['unresolved_edge', 'missing_contract_schema']);
    expect(questions[0].textContent).toContain('An outbound call with no edge');
    expect(questions[0].textContent).toContain('No edge was drawn.');
    // another node carries none of them
    expect(questionsOnNode(job(), shelfie(), N('04'))).toEqual([]);
    // the seam question names no file and no group: it stays under Proposals only
    expect(questionsOnNode(job(), shelfie(), N('01')).map((q) => q.proposalId)).toEqual(['bf000000-0000-4000-8000-000000000501:oq-1', 'bf000000-0000-4000-8000-000000000501:oq-3']);
  });

  it('a hold on the node shows who, at what level, and how long', () => {
    presence.holds = [{ checkoutId: 'l1', level: 'task', advisory: false, holder: 'hermes', credential: 'key · ci runner', credentialExpiresAt: null, refId: 't1', refLabel: 'T-004 wire the cover proxy', nodeId: N('01'), since: new Date(Date.now() - 5 * 60_000).toISOString(), stale: false, proposalId: null, meta: null }];
    const { getAllByTestId, getByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={shelfie()} />);
    expect(getByTestId('architecture-rail').textContent).toContain('Held by1');
    const hold = getAllByTestId('rail-hold')[0];
    expect(hold.textContent).toContain('hermes');
    expect(hold.textContent).toContain('task · T-004 wire the cover proxy');
    // AA.5: no files recorded reads as the whole node
    expect(getAllByTestId('rail-hold-reach')[0].textContent).toBe('Reaches the whole node');
  });

  it('AA.5: a node lease reads as holding the node; a work lease names the files it reaches', () => {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    presence.holds = [
      { checkoutId: 'l0', level: 'node', advisory: false, holder: 'codex · lead', credential: null, credentialExpiresAt: null, refId: null, refLabel: 'the node', nodeId: N('01'), since, stale: false, proposalId: null, meta: null },
      { checkoutId: 'l1', level: 'task', advisory: false, holder: 'hermes', credential: null, credentialExpiresAt: null, refId: 't1', refLabel: 'T-004', nodeId: N('01'), since, stale: false, proposalId: null, meta: { reach: ['src/proxy.ts', 'src/cache.ts', 'src/a.ts', 'src/b.ts'] } },
    ];
    const { getAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={shelfie()} />);
    const holds = getAllByTestId('rail-hold');
    expect(holds[0].getAttribute('data-level')).toBe('node');
    expect(holds[0].textContent).toContain('holds the node');
    expect(getAllByTestId('rail-hold-reach').map((r) => r.textContent)).toEqual(['Locks the node', 'Reaches src/proxy.ts, src/cache.ts, src/a.ts and 1 more']);
  });

  it('an empty node says so instead of drawing three empty lists', () => {
    items.requirements = []; items.candidates = []; items.job = null;
    const { getByTestId, queryAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('10')} graph={shelfie()} />);
    expect(getByTestId('rail-nothing').textContent).toContain('Nothing is mapped or filed here yet.');
    expect(getByTestId('architecture-rail').textContent).toContain('Work here0 of 0 proven');
    expect(queryAllByTestId('rail-connection').length).toBe(1);
    expect(queryAllByTestId('rail-question').length).toBe(0);
  });

  it('Q: on Community the import is neither read nor drawn: no imported candidate, no open question; requirements and outcomes stay', () => {
    gatePlan.plan = 'community';
    const { getAllByTestId, queryAllByTestId, getByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={shelfie()} />);
    expect(nodeItemsCalls.at(-1)).toEqual(['p1', N('01'), false]);
    const rows = getAllByTestId('rail-item');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('REQ-003');
    expect(rows[1].textContent).toContain('A shelf is private unless the reader shares it');
    expect(getByTestId('architecture-rail').textContent).not.toContain('Shelfie web app data model');
    expect(queryAllByTestId('rail-question').length).toBe(0);
    gatePlan.plan = 'indie';
    renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={shelfie()} />);
    expect(nodeItemsCalls.at(-1)).toEqual(['p1', N('01'), true]);
  });

  it('the pure halves: connections outgoing first with the contract and its schema state; the requirement line', () => {
    const list = nodeConnections(shelfie(), N('04'));
    expect(list.map((e) => [e.direction, e.otherLabel, e.contract, e.schemaMissing])).toEqual([['in', 'import-goodreads', 'PostgREST over the anon key', true], ['in', 'Shelfie web app', 'PostgREST over the anon key', true]]);
    expect(requirementLine({ mappingId: 'm', requirementRowId: 'r', ref: 'REQ-004', name: 'x', confirmed: true, validationStatus: 'valid', confidence: 1, criteriaCount: 3, metCount: 1 })).toBe('REQ-004 · confirmed · 1 of 3 proven');
    expect(requirementLine({ mappingId: 'm', requirementRowId: 'r', ref: 'REQ-003', name: 'x', confirmed: false, validationStatus: 'needs-review', confidence: null, criteriaCount: 3, metCount: 0 })).toBe('REQ-003 · unconfirmed, mapped here at low confidence, needs review · 0 of 3 proven');
  });
});

// AA.4 (owner 2026-09-23): what the import read about how a node runs and
// ships. The Postgres node is managed by Supabase when deployed and runs as
// a self-hosted image in local development; a root script and a CI job
// deploy it. Each line cites its file; nothing shows below Indie.
describe('Architecture rail · Deploys via (AA.4)', () => {
  const withDeploys = (): Graph => {
    const g = shelfie();
    g.nodes[N('04')] = {
      ...g.nodes[N('04')],
      metadata: {
        deployment: {
          mode: 'managed', provider: 'supabase', environment: 'deployed', technology: 'supabase-db',
          evidence: [{ path: 'supabase/config.toml', detail: 'supabase db' }],
          otherEnvironments: [{ mode: 'self-hosted', provider: null, environment: 'development', technology: 'postgresql', evidence: [{ path: 'docker-compose.dev.yml', line: 4, detail: 'db runs postgres:15' }] }],
        },
        deploysVia: [
          { path: '.github/workflows/deploy.yml', line: 22, tool: 'supabase', text: 'supabase db push', target: 'migrate' },
          { path: 'deploy.sh', line: 3, tool: 'supabase', text: 'supabase functions deploy cover-proxy' },
        ],
      },
    } as never;
    return g;
  };

  it('says the managed and the self-hosted environment, then each deploy call, every line citing its file', () => {
    const { getByTestId, getAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('04')} graph={withDeploys()} />);
    expect(getByTestId('architecture-rail').textContent).toContain('Deploys via4');
    const rows = getAllByTestId('rail-deploy');
    expect(rows.map((r) => r.getAttribute('data-kind'))).toEqual(['runs', 'runs', 'call', 'call']);
    expect(rows.map((r) => r.textContent)).toEqual([
      'supabase-db, managed by Supabase and deployedsupabase/config.toml',
      'postgresql, self-hosted in local developmentdocker-compose.dev.yml:4',
      'supabase db push.github/workflows/deploy.yml:22',
      'supabase functions deploy cover-proxydeploy.sh:3',
    ]);
    expect(rows[1].getAttribute('title')).toBe('docker-compose.dev.yml:4 db runs postgres:15');
    expect(rows[2].getAttribute('title')).toBe('.github/workflows/deploy.yml:22, in migrate');
  });

  it('is not drawn below Indie, nor on a node the import read nothing about', () => {
    gatePlan.plan = 'community';
    const below = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('04')} graph={withDeploys()} />);
    expect(below.queryAllByTestId('rail-deploy').length).toBe(0);
    expect(below.getByTestId('architecture-rail').textContent).not.toContain('Deploys via');
    below.unmount();
    gatePlan.plan = 'indie';
    const plain = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={withDeploys()} />);
    expect(plain.getByTestId('architecture-rail').textContent).not.toContain('Deploys via');
  });

  it('names the technology from the catalog when it has loaded, and reads defensively', () => {
    expect(deploymentSentence({ mode: 'managed', provider: 'aws', environment: 'deployed', technology: 'aws-rds' }, (id) => (id === 'aws-rds' ? 'Amazon RDS' : null))).toBe('Amazon RDS, managed by AWS and deployed');
    expect(deploymentSentence({ mode: 'self-hosted', environment: null, technology: 'redis' })).toBe('redis, self-hosted');
    expect(deployLines(undefined)).toEqual([]);
    expect(deployLines({ deploysVia: 'nonsense', deployment: 7 } as never)).toEqual([]);
  });
});

// AB.4 (owner 2026-09-23): software that installs on a device or an
// operating system says where, first under Deploys via, citing the file.
describe('Architecture rail · where installed software goes (AB.4)', () => {
  const ev = (kind: string, target: string, path: string, detail?: string, platforms?: string[]) => ({ kind, target, path, via: 'signal', ...(detail ? { detail } : {}), ...(platforms ? { platforms } : {}) });

  it('says the devices, the operating systems, the service manager or the board, from the evidence for the node\'s target', () => {
    expect(installSentence('mobile-device', [
      ev('ios-app', 'mobile-device', 'ios/App.xcodeproj/project.pbxproj', 'com.shelfie', ['ios']),
      ev('android-app', 'mobile-device', 'android/app/build.gradle.kts', undefined, ['android']),
      ev('store-release', 'mobile-device', 'fastlane/Fastfile', 'fastlane: upload_to_testflight, supply', ['android', 'ios']),
    ])).toBe('Installed on iOS and Android devices, released with fastlane');
    expect(installSentence('desktop-native', [
      ev('installer-wix', 'desktop-native', 'installer/Product.wxs', undefined, ['windows']),
      ev('desktop-package', 'desktop-native', 'Formula/shelfie.rb', 'homebrew Shelfie', ['macos']),
      ev('dockerfile', 'container', 'Dockerfile'),
    ])).toBe('Installed on Windows and macOS (WiX, homebrew)');
    expect(installSentence('os-service', [
      ev('os-service', 'os-service', 'deploy/sync.service', 'systemd sync.service', ['linux']),
      ev('os-service', 'os-service', 'installer/Sync.wxs', 'windows-service ShelfieSync (WiX)', ['windows']),
      ev('os-service', 'os-service', 'ops/crontab', 'cron', ['linux']),
    ])).toBe('Runs under systemd on Linux, as a Windows service and on a cron schedule on Linux');
    expect(installSentence('embedded', [ev('firmware', 'embedded', 'fw/platformio.ini', 'PlatformIO, board esp32dev, arduino')])).toBe('Firmware flashed to a device: PlatformIO, board esp32dev, arduino');
    expect(installSentence('mobile-device', [])).toBe('Installed on mobile devices');
    // AJ.4: a cross-platform app's framework is the evidence; a phone app that also ships to desktops says so.
    expect(installSentence('mobile-device', [
      ev('mobile-app-framework', 'mobile-device', 'pubspec.yaml', 'Flutter', ['android', 'ios', 'macos', 'windows']),
      ev('ios-app', 'mobile-device', 'ios/Runner.xcodeproj/project.pbxproj', 'org.shelfie.app', ['ios']),
    ])).toBe('Installed on Android and iOS devices and on macOS and Windows');
    expect(installSentence('desktop-native', [
      ev('desktop-app-framework', 'desktop-native', 'wails.json', 'Wails'),
    ])).toBe('Installed on a desktop (Wails)');
    expect(installSentence('desktop-native', [
      ev('desktop-electron', 'desktop-native', 'package.json', 'org.shelfie.desktop', ['macos', 'windows']),
      ev('desktop-app-framework', 'desktop-native', 'package.json', 'Electron', ['macos', 'windows']),
    ])).toBe('Installed on macOS and Windows (Electron)');
    expect(installSentence('container', [ev('dockerfile', 'container', 'Dockerfile')])).toBeNull();
    expect(installSentence(undefined, 'nonsense')).toBeNull();
  });

  it('is the first line under Deploys via, citing the file and listing every piece of evidence on hover', () => {
    const g = shelfie();
    g.nodes[N('01')] = {
      ...g.nodes[N('01')],
      deploymentTarget: 'mobile-device',
      metadata: {
        deploymentEvidence: [
          ev('ios-app', 'mobile-device', 'ios/Shelfie.xcodeproj/project.pbxproj', 'com.shelfie.app', ['ios']),
          ev('store-release', 'mobile-device', 'ios/fastlane/Fastfile', 'fastlane: upload_to_testflight', ['ios']),
        ],
        deploysVia: [{ path: '.github/workflows/release.yml', line: 9, tool: 'fastlane', text: 'bundle exec fastlane ios beta' }],
      },
    } as never;
    const { getAllByTestId } = renderCanvas(<ArchitectureRail projectId="p1" nodeId={N('01')} graph={g} />);
    const rows = getAllByTestId('rail-deploy');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Installed on iOS devices, released with fastlaneios/Shelfie.xcodeproj/project.pbxproj',
      'bundle exec fastlane ios beta.github/workflows/release.yml:9',
    ]);
    expect(rows[0].getAttribute('data-kind')).toBe('runs');
    expect(rows[0].getAttribute('title')).toBe('ios/Shelfie.xcodeproj/project.pbxproj com.shelfie.app\nios/fastlane/Fastfile fastlane: upload_to_testflight');
    expect(deployLines(g.nodes[N('01')].metadata as never, undefined, null).map((l) => l.key)).toEqual([expect.stringMatching(/^call-/)]);
  });
});
