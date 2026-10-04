// 9.13 (owner ask): "review and refine these between the content that is
// automatically exported to Claude.md vs Agents.md vs Cursor rules vs
// Specification.md ... ensure the automated export is pushing the correct and
// appropriate data types into these files."
//
// The review found one real defect and several drifts of the same kind. The
// three AGENT files carried different DATA when the only thing that should
// differ is the MECHANISM each tool reads them by:
//
//   · CLAUDE.md alone listed open work — and printed only the FIRST unmet
//     criterion of each requirement, which reads as the whole job.
//   · AGENTS.md reduced every criterion to a count: "[3 unmet]" says work
//     remains and nothing about what it is.
//   · Cursor's rules carried no open work at all, and listed one line per
//     node under Deep Context in a file re-read on every matching edit.
//   · CLAUDE.md cut the vision at its first period and carried no stack.
//
// So an agent's answer to "what am I building, and how do I know it is done"
// depended on which tool the reader happened to be.
//
// This file pins the settlement: one CORE in all three, three renderings, and
// a clean split from Specification.md, which is the document a PERSON reads.
// These are content assertions on real output, not source-text pins.
import { describe, it, expect } from 'vitest';
import { formatAsClaude, formatAsAgents, formatAsCursorRules, extractOpenWork, extractFileOwnership } from '../ui/utils/export-agent-rules.js';
import { formatSpecificationReadme } from '../ui/utils/export-specification.js';
import { exportCounts, exportPreviewLine, type ProjectExportData } from '../ui/utils/export-context.js';

const VISION = 'Shelfie keeps a reader honest about what they have actually finished. It is a shelf, not a wishlist, and the difference is the whole product.';

const DATA: ProjectExportData = {
  meta: {
    projectName: 'Shelfie',
    exportedAt: '2026-09-17T00:00:00.000Z',
    schemaVersion: 3,
    graphHash: 'abc123',
    nodeCount: 2, edgeCount: 1, contractCount: 1, artifactCount: 2, testCount: 2,
  },
  specification: {
    vision: VISION,
    sections: [{ name: 'Web' }],
    requirements: [
      {
        requirementId: 'REQ-001',
        name: 'Mark a book finished',
        description: 'A reader marks a book finished and the shelf reflects it at once.',
        category: 'functional',
        status: 'active',
        sectionName: 'Web',
        acceptanceCriteria: [
          { text: 'the shelf shows the book in Finished within one second', met: true },
          { text: 'the finished date is the reader local date, not UTC', met: false },
          { text: 'marking finished twice does not double count', met: false },
        ],
      },
      {
        requirementId: 'REQ-002',
        name: 'Import a reading history',
        description: 'A reader imports a CSV of past reading.',
        category: 'functional',
        status: 'active',
        acceptanceCriteria: [
          { text: 'a malformed row is reported by line number and skipped', met: false },
        ],
      },
      {
        requirementId: 'REQ-003',
        name: 'Sign in',
        description: 'A reader signs in with email.',
        category: 'functional',
        status: 'active',
        acceptanceCriteria: [{ text: 'an unverified email cannot sign in', met: true }],
      },
    ],
    constraints: [
      { type: 'privacy', description: 'a reading history never leaves the reader account' },
      { type: 'performance', description: 'the shelf renders under 200ms at 5000 books' },
    ],
    preferences: {
      languages: ['TypeScript'],
      frameworks: ['React'],
      databases: ['Postgres'],
      deploymentTarget: 'Vercel',
      architecturePattern: 'monolith',
    },
  },
  nodes: [
    { id: 'n1', label: 'Web', type: 'frontend', technology: 'React', artifactPaths: ['src/App.tsx'] },
    { id: 'n2', label: 'API', type: 'service', technology: 'Node', artifactPaths: ['api/shelf.ts'], rationale: 'one service, one owner' },
  ],
  edges: [
    { id: 'e1', sourceId: 'n1', targetId: 'n2', sourceNode: 'Web', targetNode: 'API', contractId: 'c1', contractName: 'ShelfAPI', contractKind: 'rest', transport: 'https' },
  ],
  contracts: [{ id: 'c1', name: 'ShelfAPI', kind: 'rest' }],
  artifacts: [
    { id: 'a1', nodeId: 'n1', nodeLabel: 'Web', path: 'src/App.tsx', kind: 'source' },
    { id: 'a2', nodeId: 'n2', nodeLabel: 'API', path: 'api/shelf.ts', kind: 'source' },
  ],
  testSuite: [
    { testId: 'TC-001', name: 'finished within a second', testType: 'e2e', framework: 'playwright', status: 'passed', requirementName: 'Mark a book finished', requirementId: 'REQ-001' },
    { testId: 'TC-002', name: 'local date not UTC', testType: 'unit', framework: 'vitest', status: 'failed', requirementName: 'Mark a book finished', requirementId: 'REQ-001' },
  ],
};

const claude = formatAsClaude(DATA);
const agents = formatAsAgents(DATA);
const cursor = formatAsCursorRules(DATA);
const spec = formatSpecificationReadme(DATA)!;

const AGENT_FILES: Array<[string, string]> = [['CLAUDE.md', claude], ['AGENTS.md', agents], ['.cursor/rules', cursor]];

/** Every criterion a reader has NOT met. The defect was that these went
 *  missing, so they are named once and asserted everywhere. */
const UNMET = [
  'the finished date is the reader local date, not UTC',
  'marking finished twice does not double count',
  'a malformed row is reported by line number and skipped',
];
const MET = 'the shelf shows the book in Finished within one second';

describe('the core: what every agent file must carry', () => {
  it('extractOpenWork keeps only requirements with work left, and every unmet criterion of them', () => {
    const open = extractOpenWork(DATA);
    expect(open.map((r) => r.requirementId)).toEqual(['REQ-001', 'REQ-002']);
    expect(open[0].unmet).toEqual([UNMET[0], UNMET[1]]);
    expect(open[0].metCount).toBe(1);
    expect(open[0].totalCount).toBe(3);
    // REQ-003 is fully met, so it is not open work.
    expect(open.some((r) => r.requirementId === 'REQ-003')).toBe(false);
  });

  it.each(AGENT_FILES)('%s carries EVERY unmet criterion, not the first one', (_name, text) => {
    for (const criterion of UNMET) expect(text).toContain(criterion);
  });

  it.each(AGENT_FILES)('%s names the requirement each criterion belongs to', (_name, text) => {
    expect(text).toContain('REQ-001');
    expect(text).toContain('REQ-002');
    expect(text).toContain('Mark a book finished');
  });

  it.each(AGENT_FILES)('%s carries the constraints that bind', (_name, text) => {
    expect(text).toContain('a reading history never leaves the reader account');
    expect(text).toContain('the shelf renders under 200ms at 5000 books');
  });

  it.each(AGENT_FILES)('%s carries the stack', (_name, text) => {
    expect(text).toContain('TypeScript');
    expect(text).toContain('React');
    expect(text).toContain('Vercel');
  });

  it.each(AGENT_FILES)('%s names the architecture and how it connects', (_name, text) => {
    expect(text).toContain('Web');
    expect(text).toContain('API');
    expect(text).toContain('rest');
  });

  it.each(AGENT_FILES)('%s says which node owns which files', (_name, text) => {
    expect(text).toContain('src/App.tsx');
    expect(text).toContain('api/shelf.ts');
  });

  it('extractFileOwnership groups paths under their node label', () => {
    expect([...extractFileOwnership(DATA).entries()]).toEqual([['Web', ['src/App.tsx']], ['API', ['api/shelf.ts']]]);
  });

  it('an unmet criterion is a checkbox, so an agent can work the list', () => {
    for (const [, text] of AGENT_FILES) expect(text).toContain(`[ ] ${UNMET[0]}`);
  });
});

describe('what legitimately differs: the mechanism each file is read by', () => {
  it('CLAUDE.md carries the vision in full, not its first sentence', () => {
    expect(claude).toContain(VISION);
    // the bug: the H1 used to end at the first period and the rest was lost
    expect(claude).not.toContain('# Shelfie -- Shelfie keeps a reader honest');
  });

  it('CLAUDE.md follows @imports, so its deep context is a list of them', () => {
    expect(claude).toContain('@.nodespec/context/web.md');
    expect(claude).toContain('@.nodespec/context/api.md');
  });

  it('AGENTS.md is the self-contained one: per-component detail inline', () => {
    expect(agents).toContain('### Web');
    expect(agents).toContain('### API');
    expect(agents).toContain('one service, one owner');
    expect(agents).toContain('Integrations:');
  });

  it('AGENTS.md rolls the MET requirements up so an agent does not rebuild them', () => {
    expect(agents).toContain('## Met Requirements');
    expect(agents).toContain('REQ-003 Sign in');
    // and never as a bare count, which was the defect
    expect(agents).not.toContain('[2 unmet]');
    expect(agents).not.toContain('[done]');
  });

  it('the Cursor rules stay terse: a pointer to the context directory, not a listing', () => {
    expect(cursor).toContain('.nodespec/context/');
    expect(cursor).not.toContain('@.nodespec/context/web.md');
    expect(cursor).not.toContain('- @.nodespec/context/api.md');
  });

  it('the Cursor rules keep their glob frontmatter, which is how they attach at all', () => {
    expect(cursor.startsWith('---\n')).toBe(true);
    expect(cursor).toContain('globs: "');
    expect(cursor).toContain('alwaysApply: false');
    expect(cursor).toContain('api/**');
    expect(cursor).toContain('src/**');
  });
});

describe('Specification.md is the document a PERSON reads', () => {
  it('it carries the met criteria too, which no agent file does', () => {
    expect(spec).toContain(`[x] ${MET}`);
    for (const [name, text] of AGENT_FILES) expect(text, name).not.toContain(MET);
  });

  it('it carries test coverage and a progress table, which answer "where are we"', () => {
    expect(spec).toContain('**Test Coverage:**');
    expect(spec).toContain('local date not UTC');
    expect(spec).toContain('## Implementation Progress');
    expect(spec).toContain('### Requirements Coverage');
  });

  it('no agent file carries the progress tables — an agent is told what to do, not how it is tracking', () => {
    for (const [name, text] of AGENT_FILES) {
      expect(text, name).not.toContain('## Implementation Progress');
      expect(text, name).not.toContain('Requirements Coverage');
    }
  });

  it('it carries the vision, the constraints and the requirements in their own sections', () => {
    expect(spec).toContain('## Vision');
    expect(spec).toContain(VISION);
    expect(spec).toContain('### Constraints');
    expect(spec).toContain('## Requirements');
    expect(spec).toContain('**ID:** REQ-001');
    expect(spec).toContain('REQ-003');
  });

  it('it is null without a specification: there is no spec to write', () => {
    expect(formatSpecificationReadme({ ...DATA, specification: undefined })).toBeNull();
  });
});

describe('the export list puts them in the order a person picks them', () => {
  it('Specification.md sits directly under Commit to Git', () => {
    const modal = readModal();
    const order = [...modal.matchAll(/^\s{6}id: '([a-z-]+)',$/gm)].map((m) => m[1]);
    expect(order[0]).toBe('git-push');
    expect(order[1]).toBe('spec');
    // and the agent files follow, in the order they are named above
    expect(order.slice(2)).toEqual(['publish-marketplace', 'claude', 'agents', 'cursor', 'mermaid', 'zip']);
  });
});

function readModal(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(process.cwd(), 'src/ui/components/common/ProjectExportModal.tsx'), 'utf8');
}

// ── V3 4.5 (2026-09-20): the export rail says what each file carries, and four counts ──
// Held against Export.dc.html (2026-09-20): the design's four counts (criteria
// open, criteria proven, nodes, constraints) and a preview of the chosen file
// under its own line.
describe('V3 4.5 · the rail is what the file carries, plus the design\'s four counts', () => {
  it('exportCounts: criteria open, criteria proven, nodes, constraints', () => {
    // the fixture: five criteria, two met, two nodes, two constraints
    expect(exportCounts(DATA)).toEqual([
      { value: 3, label: 'criteria open' },
      { value: 2, label: 'criteria proven' },
      { value: 2, label: 'nodes' },
      { value: 2, label: 'constraints' },
    ]);
    // no specification: nothing to count constraints in
    expect(exportCounts({ ...DATA, specification: undefined })).toEqual([
      { value: 0, label: 'criteria open' }, { value: 0, label: 'criteria proven' }, { value: 2, label: 'nodes' },
    ]);
    // AC: below Indie the specification carries no constraints and the board does not count them
    const { constraints: _dropped, ...community } = DATA.specification!;
    expect(exportCounts({ ...DATA, specification: community })).toEqual([
      { value: 3, label: 'criteria open' }, { value: 2, label: 'criteria proven' }, { value: 2, label: 'nodes' },
    ]);
  });
  it('the line over a previewed file: the files that carry criteria say the proof count; the diagram says its size; a bundle says nothing', () => {
    for (const id of ['spec', 'claude', 'agents', 'cursor']) expect(exportPreviewLine(id, DATA), id).toBe('2 of 5 criteria proven');
    expect(exportPreviewLine('mermaid', DATA)).toBe('2 nodes, 1 edge');
    expect(exportPreviewLine('zip', DATA)).toBeNull();
    expect(exportPreviewLine('claude', { ...DATA, specification: undefined })).toBe('0 of 0 criteria proven');
    // no export formatter names a candidate or an outcome
    for (const f of ['src/ui/utils/export-agent-rules.ts', 'src/ui/utils/export-specification.ts']) expect(readFile(f)).not.toMatch(/candidate|outcome/i);
  });
  it('the modal reads the counts from that one function, previews a file under its line, and each card says only what the file carries', () => {
    const modal = readModal();
    expect(modal).toContain('const stats = exportCounts(data);');
    expect(modal).toContain('data-testid="export-preview-toggle"');
    expect(modal).toContain('data-testid="export-preview"');
    expect(modal).toContain('data-testid="export-preview-line"');
    expect(modal).toContain('{line && <span data-testid="export-preview-line"');
    expect(modal).not.toContain('placement');
    expect(modal).not.toContain("label: 'edges'");
    expect(modal).not.toContain("label: 'artifacts'");
  });
});

function readFile(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(process.cwd(), p), 'utf8');
}
