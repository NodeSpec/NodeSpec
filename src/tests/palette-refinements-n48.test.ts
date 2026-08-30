// N4.8 (owner bench refinements 2026-07-25, after verifying through N5.16): the
// Recently-Used picker is gone, `requirement` never appears in a picker, icons degrade
// through the ontology instead of collapsing to a generic box, and four header buttons
// (bug / feedback / artifact-workbench toggle / activity log) are removed with the
// activity popup.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Box, Database, Brain, Globe } from 'lucide-react';
import { getRoleOrCategoryIcon } from '../ui/utils/palette-roles.js';
import { PaletteCategorySchema, RfVisualTypeSchema } from '@nodespec/core/catalog-schemas.js';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const sidebar = read('src/ui/components/layout/TabbedSidebar.tsx');
const topBar = read('src/ui/components/panels/TopBar.tsx');
const graphEditor = read('src/ui/components/GraphEditor.tsx');
const nodeIcon = read('src/ui/components/common/NodeIcon.tsx');

describe('N4.8 (3) icon fallback defers to the parent category node-type', () => {
  it('uses the role icon when the catalog names one we render', () => {
    expect(getRoleOrCategoryIcon('database', 'Database')).toBe(Database);
  });

  it('falls back to the PALETTE CATEGORY icon when the role icon is unknown', () => {
    // The "parent category node-type iconography" — not a generic box.
    expect(getRoleOrCategoryIcon('no-such-icon-name', 'AI & ML')).toBe(Brain);
    expect(getRoleOrCategoryIcon(null, 'Services')).toBe(Globe);
    expect(getRoleOrCategoryIcon(undefined, 'Database')).toBe(Database);
  });

  it('falls back to the generic box only when BOTH are unknown', () => {
    expect(getRoleOrCategoryIcon('no-such-icon', 'No Such Category')).toBe(Box);
    expect(getRoleOrCategoryIcon(null, null)).toBe(Box);
  });

  it('NodeIcon resolves logo → caller icon → role icon → category icon; never emoji', () => {
    expect(nodeIcon).toContain('getRoleOrCategoryIcon');
    expect(nodeIcon).toContain('CatalogService.getRoleForNodeType');
    // The emoji slot is only ever honored when it is a real lucide NAME.
    expect(nodeIcon).toContain('isLucideIconName(emojiIcon)');
  });
});

describe('N4.8 (1) the Recently-Used picker is gone', () => {
  it('no recent-roles state, storage key, or section header remains', () => {
    expect(sidebar).not.toContain('specgraph-recent-roles');
    expect(sidebar).not.toContain('recentRoleIds');
    expect(sidebar).not.toContain('Recently Used');
  });

  it('the three browse sections stay', () => {
    for (const header of ['Structure', 'Technology', 'Functional Node Types']) {
      expect(sidebar).toContain(header);
    }
  });
});

describe('N4.8 (2) `requirement` never appears in a picker', () => {
  // N11(b) 2026-08-09 superseded the original mechanism: the pickers no longer
  // FILTER the kind out — the kind no longer exists. The 'requirement' role row
  // is deleted (migration 20260809160000) and its enum members are shed from the
  // canonical vocabulary, so nothing can re-enter a picker without failing the
  // M5 write gate. Pin the non-existence, not the retired defensive filters.
  it('the vocabulary itself excludes the kind — no filter needed', () => {
    expect(PaletteCategorySchema.safeParse('requirements').success).toBe(false);
    expect(RfVisualTypeSchema.safeParse('requirement').success).toBe(false);
  });

  it('the retired defensive filters stay retired (no zombie re-adds)', () => {
    const paletteList = read('src/ui/utils/palette-list.ts');
    expect(sidebar).not.toContain("!== 'requirements'");
    expect(paletteList).not.toContain("!== 'requirements'");
  });
});

describe('N4.8 (4) header cleanup', () => {
  it('bug, feedback, artifact-workbench and activity buttons are gone from the header', () => {
    expect(topBar).not.toContain('BugReportModal');
    expect(topBar).not.toContain('FeedbackModal');
    expect(topBar).not.toContain('Report a Bug');
    expect(topBar).not.toContain('Send Feedback');
    expect(topBar).not.toContain('onToggleWorkbench');
    expect(topBar).not.toContain('Artifact Workbench');
    expect(topBar).not.toContain('onToggleActivity');
    expect(topBar).not.toContain('Activity Log');
  });

  it('the activity-log popup is unmounted with its button', () => {
    expect(graphEditor).not.toContain('<SidePanel');
    expect(graphEditor).not.toContain('activityExpanded');
  });

  it('the workbench ITSELF survives — only the toggle button was removed', () => {
    // Owner: "artifact workbench button only". Files still open by clicking a file.
    expect(graphEditor).toContain('sidepaneTab');
    expect(graphEditor).toContain("setSidepaneTab('files')");
  });
});

// N6.1 (owner 2026-07-25): header reduction — counters, token meter/purchase, reset,
// and save-draft removed; undo/redo controls added. Merge-to-Main survives.
describe('N6.1 header reduction', () => {
  const topBarN61 = readFileSync(new URL('../../src/ui/components/panels/TopBar.tsx', import.meta.url), 'utf8');
  const graphEditorN61 = readFileSync(new URL('../../src/ui/components/GraphEditor.tsx', import.meta.url), 'utf8');

  it('counters, token meter/purchase, reset and save-draft are gone', () => {
    for (const gone of ['nodeCount', 'edgeCount', 'tokenUsage', 'TokenPurchaseModal',
                        'Buy Tokens', 'ResetBranchButton', 'onSaveDraft', 'Save Draft']) {
      expect(topBarN61).not.toContain(gone);
    }
    // The header patch STAT is gone. (2026-07-30: the per-branch "N changes"
    // readout in the Branches dropdown is gone too — owner: stale and not useful
    // once a branch is git-bound. Only the `default` marker on main survives.)
    expect(topBarN61).not.toContain('{patchCount}');
    expect(topBarN61).toContain('availableBranches');
  });

  it('undo/redo controls replace them; Merge to Main survives', () => {
    expect(topBarN61).toContain('Undo (Cmd/Ctrl+Z)');
    expect(topBarN61).toContain('Redo (Cmd/Ctrl+Shift+Z)');
    expect(topBarN61).toContain('canUndo');
    expect(topBarN61).toContain('canRedo');
    expect(topBarN61).toContain('Merge to Main');
    // The autosave indicator stays — it is how the user knows work is pending.
    expect(topBarN61).toContain('hasUnsavedChanges');
  });

  it('the editor wires undo/redo and persists reverted snapshots', () => {
    expect(graphEditorN61).toContain('onUndo={handleUndo}');
    expect(graphEditorN61).toContain('onRedo={handleRedo}');
    expect(graphEditorN61).toContain('graphRevision');
    expect(graphEditorN61).not.toContain('handleSaveDraft');
    expect(graphEditorN61).not.toContain('handleReset');
  });
});
