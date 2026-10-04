import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { WorkflowOrigin, ProjectCreateResult } from '../ui/components/panels/ProjectCreatePopup.js';
import { validateProjectName } from '../ui/components/panels/ProjectCreatePopup.js';
import {
  SPEC_HANDOFF_TOOL,
  SPEC_CONVERSION_TOOLS,
  START_NEW_TOOLS,
  SPEC_STAGE_MAX_CHARS,
  MCP_TOOLS_DOCS_PATH,
  buildStagedSpecImport,
  readStagedSpecImport,
  buildSpecHandoffPrompt,
  buildSpecInlinePrompt,
  buildStartNewPrompt,
} from '../ui/utils/spec-import-staging.js';
import { startPaths } from '../ui/components/common/ProjectStartPopup.js';

// Owner spike 2026-09-04: project creation is a light in-canvas popup (name
// only); the three start paths live on the canvas afterwards; a pasted
// specification is STAGED on the project for the user's AI instead of being
// streamed to the retired in-app agent endpoint ("failed to fetch").

const src = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('Project creation popup', () => {
  it('creation result carries only the name — no workflow category at creation', () => {
    const result: ProjectCreateResult = { name: 'My SaaS Platform' };
    expect(Object.keys(result)).toEqual(['name']);
  });

  it('validates the name the way the old wizard did (required, ≥3 chars, trimmed)', () => {
    expect(validateProjectName('')).toBe('Project name is required');
    expect(validateProjectName('   ')).toBe('Project name is required');
    expect(validateProjectName('AB')).toBe('Project name must be at least 3 characters');
    expect(validateProjectName('  AB  ')).toBe('Project name must be at least 3 characters');
    expect(validateProjectName('ABC')).toBeNull();
    expect(validateProjectName('  My Project  ')).toBeNull();
  });

  it('never dims or blocks the canvas: no fixed overlay, no backdrop, no dark scrim', () => {
    const popup = src('ui/components/panels/ProjectCreatePopup.tsx');
    expect(popup.includes("position: 'fixed'")).toBe(false);
    expect(popup.includes('backdropFilter')).toBe(false);
    expect(popup.includes('rgba(0, 0, 0, 0.6)')).toBe(false);
    // Anchored inside the canvas wrapper; the wrapper itself lets clicks through.
    expect(popup.includes("position: 'absolute'")).toBe(true);
    expect(popup.includes("pointerEvents: 'none'")).toBe(true);
  });

  it('the old three-category wizard is gone and nothing imports it', () => {
    expect(() => src('ui/components/panels/ProjectOnboardingWizard.tsx')).toThrow();
    for (const rel of ['App.tsx', 'ui/components/GraphEditor.tsx', 'ui/components/panels/index.ts', 'ui/components/common/EmptyCanvasPrompt.tsx']) {
      expect(src(rel).includes('ProjectOnboardingWizard')).toBe(false);
    }
  });

  it('App creates the first project with empty metadata; GraphEditor likewise', () => {
    expect(src('App.tsx').includes('handleCreateProject(name, {})')).toBe(true);
    expect(src('ui/components/GraphEditor.tsx').includes('onCreateProject(name, {})')).toBe(true);
  });
});

describe('Start popup: the paths on the canvas', () => {
  const popup = src('ui/components/common/ProjectStartPopup.tsx');

  it('offers Start new and Import a specification, and Import a repository where the plan runs repo import (AL.21, owner 2026-10-03; rendered in al21-import-start-and-intent.test.tsx)', () => {
    expect(startPaths(false).map((p) => p.label)).toEqual(['Start new', 'Import a specification']);
    expect(startPaths(true).map((p) => p.label)).toEqual(['Start new', 'Import a repository', 'Import a specification']);
    expect((popup.match(/data-start-path=/g) ?? []).length).toBe(1); // one render loop over the plan's paths
    // held against Start.dc.html (2026-09-20): the design's heading
    expect(popup).not.toContain('How do you want to start');
  });

  it('Start new names the MCP tools (update_vision first) and links the tool list', () => {
    expect(START_NEW_TOOLS[0]).toBe('update_vision');
    expect(START_NEW_TOOLS).toEqual(['update_vision', 'create_requirement', 'propose_patches']);
    expect(popup.includes('START_NEW_TOOLS[0]')).toBe(true);
    expect(popup.includes('MCP_TOOLS_DOCS_PATH')).toBe(true);
    expect(MCP_TOOLS_DOCS_PATH).toBe('/docs/mcp');
    expect(src('App.tsx').includes('path="/docs/mcp"')).toBe(true);
  });

  it('the repository card opens the toolbar\'s Git window and records the start path, on the plan\'s gate', () => {
    const editor = src('ui/components/GraphEditor.tsx');
    expect(editor).toContain('onConnectRepository={() => setShowGitModal(true)}');
    expect(editor).toContain("onImportRepository={() => stampWorkflowOrigin('code')}");
    expect(editor).toContain("canImportRepository={!gate.loading && gate.can('repo_import') && !gate.viewOnly?.('repo_import')}");
    expect(src('ui/components/panels/TopBar.tsx')).toContain('data-tour="git"');
  });

  it('Import a specification opens the staging window and names the hand-off tool', () => {
    expect(popup.includes('SPEC_HANDOFF_TOOL')).toBe(true);
    expect(popup.includes('call this tool')).toBe(true);
    const editor = src('ui/components/GraphEditor.tsx');
    expect(editor.includes('onImportSpecification={() => setShowSpecStaging(true)}')).toBe(true);
    expect(editor.includes('<SpecImportStagingPopup')).toBe(true);
  });

  it('the editor hands the walkthrough the project\'s plan, its surfaces and the first run, and holds the Start card behind it', () => {
    // Wiring only: the tour, the plan filter and startCardShows run in walkthrough.test.tsx.
    const editor = src('ui/components/GraphEditor.tsx');
    expect(editor).toContain('firstRun={hasSeenOnboarding === false}');
    expect(editor).toContain('featureGate={gate}\n          onSurface={handleWalkthroughSurface}');
    expect(editor).toContain('projectId, walkthroughOpen: showOnboarding,');
    expect(editor).toContain('setHasSeenOnboarding(seenWalkthrough(read, localFlag))');
  });

  it('is non-blocking (absolute, click-through wrapper) and only shows on an empty project', () => {
    expect(popup.includes("position: 'absolute'")).toBe(true);
    expect(popup.includes("position: 'fixed'")).toBe(false);
    // The editor asks startCardShows; its cases run in walkthrough.test.tsx.
    expect(src('ui/components/GraphEditor.tsx').includes('startCardShows({')).toBe(true);
  });
});

describe('Specification import: staged for the user\'s AI, never converted in-app', () => {
  it('no canvas surface streams to the retired agent endpoint', () => {
    // V3 P3 (R4): the spec markdown view this pin used to read is retired;
    // Canvas holds the no-conversion line for the surfaces that remain.
    expect(src('ui/components/layout/Canvas.tsx').includes('onSpecImportComplete')).toBe(false);
    expect(src('ui/components/layout/Canvas.tsx').includes('streamAgent')).toBe(false);
  });

  it('the staging window writes metadata, never calls a network conversion', () => {
    const staging = src('ui/components/common/SpecImportStagingPopup.tsx');
    expect(staging.includes('streamAgent')).toBe(false);
    expect(staging.includes('fetch(')).toBe(false);
    expect(staging.includes('buildStagedSpecImport')).toBe(true);
    expect(staging.includes('Stage for your AI')).toBe(true);
    const editor = src('ui/components/GraphEditor.tsx');
    expect(editor.includes("patchProjectMetadata({ stagedSpecImport: staged, workflowOrigin: 'import-spec' })")).toBe(true);
    expect(editor.includes('patchProjectMetadata({ stagedSpecImport: undefined })')).toBe(true);
  });

  it('buildStagedSpecImport normalises, bounds, and stamps', () => {
    const now = new Date('2026-09-04T10:00:00.000Z');
    const ok = buildStagedSpecImport('  # Spec\r\n- a\r\n  ', now);
    expect(ok).toEqual({ ok: true, staged: { text: '# Spec\n- a', chars: 10, stagedAt: '2026-09-04T10:00:00.000Z' } });
    expect(buildStagedSpecImport('   ')).toEqual({ ok: false, reason: 'empty', chars: 0 });
    const long = 'x'.repeat(SPEC_STAGE_MAX_CHARS + 1);
    expect(buildStagedSpecImport(long)).toEqual({ ok: false, reason: 'too-long', chars: SPEC_STAGE_MAX_CHARS + 1 });
    expect(buildStagedSpecImport('x'.repeat(SPEC_STAGE_MAX_CHARS)).ok).toBe(true);
  });

  it('readStagedSpecImport tolerates junk metadata and round-trips a staged document', () => {
    expect(readStagedSpecImport(null)).toBeNull();
    expect(readStagedSpecImport({})).toBeNull();
    expect(readStagedSpecImport({ stagedSpecImport: 'nope' })).toBeNull();
    expect(readStagedSpecImport({ stagedSpecImport: { text: '  ' } })).toBeNull();
    expect(readStagedSpecImport({ stagedSpecImport: { text: 'abc' } })).toEqual({ text: 'abc', chars: 3, stagedAt: '' });
    const built = buildStagedSpecImport('doc');
    if (!built.ok) throw new Error('unreachable');
    expect(readStagedSpecImport({ other: 1, stagedSpecImport: built.staged })).toEqual(built.staged);
  });

  it('the hand-off note tells the AI which tool to call and which tools convert', () => {
    expect(SPEC_HANDOFF_TOOL).toBe('get_project_status');
    expect(SPEC_CONVERSION_TOOLS).toEqual(['update_vision', 'create_requirement', 'relate_requirements']);
    const note = buildSpecHandoffPrompt('Acme Docs');
    expect(note.includes('get_project_status')).toBe(true);
    expect(note.includes('"Acme Docs"')).toBe(true);
    for (const tool of SPEC_CONVERSION_TOOLS) expect(note.includes(tool)).toBe(true);
    const inline = buildSpecInlinePrompt('Acme Docs', '# The doc');
    expect(inline.endsWith('--- SPECIFICATION ---\n# The doc')).toBe(true);
    expect(inline.includes('Do not invent content')).toBe(true);
    const start = buildStartNewPrompt('Acme Docs');
    expect(start.includes('update_vision')).toBe(true);
    expect(start.includes('get_project_status')).toBe(true);
  });

  it('the server names the same tools the note promises (lead ↔ client contract)', () => {
    const server = readFileSync(resolve(__dirname, '../../supabase/functions/mcp-server/tools/projects.ts'), 'utf8');
    expect(server.includes('readStagedSpecification(metadata)')).toBe(true);
    expect(server.includes('SPECIFICATION DOCUMENT IS STAGED')).toBe(true);
    expect(server.includes('stagedSpecification.text')).toBe(true);
    for (const tool of SPEC_CONVERSION_TOOLS) expect(server.includes(tool)).toBe(true);
    // The metadata key the client writes is the key the server reads.
    expect(server.includes('metadata?.stagedSpecImport')).toBe(true);
    expect(src('ui/utils/spec-import-staging.ts').includes('metadata?.stagedSpecImport')).toBe(true);
  });
});

describe('Workflow origin metadata (recorded by the start popup, read by status)', () => {
  it('round-trips the three origins through JSONB', () => {
    const origins: WorkflowOrigin[] = ['idea', 'code', 'import-spec'];
    for (const origin of origins) {
      const parsed = JSON.parse(JSON.stringify({ workflowOrigin: origin }));
      expect(parsed.workflowOrigin).toBe(origin);
    }
  });

  it('projects without an origin (or with a legacy one) are simply unrouted', () => {
    for (const metadata of [undefined, {}, { workflowOrigin: 'evolve' }, { workflowOrigin: 'invalid-value', otherField: 123 }]) {
      const origin = (metadata as Record<string, unknown> | undefined)?.workflowOrigin;
      const isValid = origin === 'idea' || origin === 'code' || origin === 'import-spec';
      expect(isValid).toBe(false);
    }
  });

  it('the start popup stamps the origin on choice, not at creation', () => {
    const editor = src('ui/components/GraphEditor.tsx');
    expect(editor.includes("onStartNew={() => stampWorkflowOrigin('idea')}")).toBe(true);
    expect(editor.includes('pendingWorkflow')).toBe(false);
  });

  it('empty-canvas copy still has distinct content per origin plus a default', () => {
    const prompt = src('ui/components/common/EmptyCanvasPrompt.tsx');
    for (const title of ['Describe Your Vision', 'Connect Your Repository', 'Import Your Specification', 'Welcome to Your Canvas']) {
      expect(prompt.includes(title)).toBe(true);
    }
    expect(prompt.includes('get_project_status')).toBe(true);
  });
});
