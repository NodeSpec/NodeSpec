// Design import B.2c + B.2d ("Canvas Simplification", Section B, owner 2026-07-29).
// B.2c: node actions (scaffold / lock / export + file count) ride ONE contextual
//       floating toolbar shown on node CLICK (selection), replacing the per-node
//       corner badges and hover-card button rows.
// B.2d: zoom, fit, layer mode, view toggle, and the edge legend live in ONE
//       bottom dock (legend expands in place on hover) — superseding the RF
//       <Controls/>, the floating LayerModeToggle pill stack, and the
//       bottom-left EdgeLegend button.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

const ACTION_BEARING_NODE_COMPONENTS = [
  'ui/components/nodes/BaseNode.tsx',
  'ui/components/nodes/IconNode.tsx',
  'ui/components/nodes/CompactIconNode.tsx',
  'ui/components/nodes/ContainerNode.tsx',
  'ui/components/nodes/EnhancedDatabaseNode.tsx',
  'ui/components/nodes/EventBusNode.tsx',
  'ui/components/nodes/LibraryNode.tsx',
];

describe('B.2c — contextual floating toolbar on click', () => {
  it('NodeActionToolbar is a React Flow NodeToolbar carrying lock/export/undock/delete', () => {
    // Owner merge ruling 2026-08-13: ONE pane under the node — lock, export,
    // undock, delete. Scaffold is GONE (it routed to the retired internal
    // agent and had been a silent no-op).
    const source = read('ui/components/nodes/NodeActionToolbar.tsx');
    expect(source).toContain("import { NodeToolbar, Position } from '@xyflow/react'");
    expect(source).toContain('isVisible={visible}');
    expect(source).toContain('Position.Bottom');
    expect(source).not.toContain('onScaffold');
    expect(source).toContain('data.onToggleLock');
    expect(source).toContain('data.onExport');
    expect(source).toContain('data.onUndock');
    expect(source).toContain('data.onDelete');
    // the file count stays in the pane (design: "3 files" chip)
    expect(source).toContain('artifactCount');
  });

  it.each(ACTION_BEARING_NODE_COMPONENTS)('%s renders the toolbar on selection', (rel) => {
    const source = read(rel);
    // UX-1.3 (2026-08-21): hover visibility is ADDITIVE — selection alone
    // must still show the pane, exactly as before.
    expect(source).toContain('<NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />');
  });

  it.each(ACTION_BEARING_NODE_COMPONENTS)('%s no longer renders corner action badges', (rel) => {
    const source = read(rel);
    // the retired pattern: absolutely-positioned lock/scaffold badge styles
    expect(source).not.toContain('lockBadgeStyles');
    expect(source).not.toContain('scaffoldBadgeStyles');
    expect(source).not.toContain('handleLockClick');
    expect(source).not.toContain('handleScaffoldClick');
  });
});

describe('B.2d — unified bottom dock', () => {
  it('Canvas renders CanvasDock and no longer mounts Controls / LayerModeToggle / EdgeLegend', () => {
    const source = read('ui/components/layout/Canvas.tsx');
    expect(source).toContain('<CanvasDock');
    expect(source).toContain('onToggle={handleLayerModeToggle}');
    expect(source).not.toContain('<Controls');
    expect(source).not.toContain('<LayerModeToggle');
    expect(source).not.toContain('<EdgeLegend');
    expect(source).not.toContain("from '../common/LayerModeToggle.js'");
  });

  it('the dock consolidates zoom, fit, layer toggle, view toggle, and the legend', () => {
    const source = read('ui/components/common/CanvasDock.tsx');
    expect(source).toContain('zoomIn');
    expect(source).toContain('zoomOut');
    expect(source).toContain('fitView');
    expect(source).toContain('Functional');
    expect(source).toContain('Deployment');
    expect(source).toContain('Regular');
    expect(source).toContain('Compact');
    // legend expands in place on hover, drawn from THE shared kind tables
    expect(source).toContain('legendOpen');
    expect(source).toContain("from '../panels/inspector/kind-maps.js'");
    // owner follow-up: the edge-visibility toggle + Contract Types filters are
    // retired — deployment view is always summary, the dock carries no popover
    expect(source).not.toContain('EdgeVisibilityPopover');
  });

  it('the superseded chrome components are deleted (kill list executed)', () => {
    expect(existsSync(join(SRC, 'ui/components/common/LayerModeToggle.tsx'))).toBe(false);
    expect(existsSync(join(SRC, 'ui/components/common/EdgeLegend.tsx'))).toBe(false);
  });
});
