import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// UX-1.3 (docs/V2_TASKS.md, owner spec 2026-08-21): the node action pane
// "should just appear upon node click or hover", and the right-click menu is
// deprecated COMPLETELY — with every action it exclusively held MIGRATED, not
// dropped: Add-to-Container → the toolbar's Dock popover; Export Node Context
// (JSON, gated) → the export modal's anchor-slice download; Delete Edge → the
// selected-connection chip; requirement delete → the RequirementInspector
// (which already had it).

const ui = (p: string) => readFileSync(resolve(__dirname, '../ui', p), 'utf-8');

const NODE_COMPONENTS = [
  'components/nodes/BaseNode.tsx',
  'components/nodes/ContainerNode.tsx',
  'components/nodes/CompactIconNode.tsx',
  'components/nodes/EventBusNode.tsx',
  'components/nodes/LibraryNode.tsx',
  'components/nodes/EnhancedDatabaseNode.tsx',
  'components/nodes/IconNode.tsx',
];

describe('the action pane appears on hover as well as selection', () => {
  for (const path of NODE_COMPONENTS) {
    it(`${path.split('/').pop()} wires the hover hook with the bridge`, () => {
      const src = ui(path);
      expect(src).toContain('useNodeToolbarHover');
      expect(src).toContain('toolbarHover.hoverVisible');
      expect(src).toContain('bridgeProps={toolbarHover.bridgeProps}');
      // Selection alone must still show it — hover is additive, not a swap.
      expect(src).toMatch(/visible=\{!!selected \|\| toolbarHover\.hoverVisible\}/);
    });
  }

  it('the hook bridges the node→toolbar gap (leaving the node cannot instantly hide the pane)', () => {
    const toolbar = ui('components/nodes/NodeActionToolbar.tsx');
    expect(toolbar).toContain('export function useNodeToolbarHover');
    expect(toolbar).toContain('hideTimer');
    // The pane itself cancels the hide when the pointer reaches it.
    expect(toolbar).toContain('{...(bridgeProps ?? {})}');
  });
});

describe('the right-click menu is fully deprecated — actions migrated, component deleted', () => {
  it('no canvas registers a context menu and the component is gone', () => {
    const canvas = ui('components/layout/Canvas.tsx');
    const decomp = ui('components/layout/DecompositionCanvas.tsx');
    for (const src of [canvas, decomp]) {
      expect(src).not.toContain('ContextMenu');
      expect(src).not.toContain('onNodeContextMenu');
      expect(src).not.toContain('onEdgeContextMenu');
    }
    expect(existsSync(resolve(__dirname, '../ui/components/common/ContextMenu.tsx'))).toBe(false);
    expect(ui('components/common/index.ts')).not.toContain('ContextMenu');
  });

  it('Add-to-Container lives in the toolbar as the Dock popover, same rules the menu used', () => {
    const toolbar = ui('components/nodes/NodeActionToolbar.tsx');
    expect(toolbar).toContain("label: 'Dock'");
    expect(toolbar).toContain('onAssignToContainer');
    const canvas = ui('components/layout/Canvas.tsx');
    // Non-container nodes only; options exclude self and the current parent.
    expect(canvas).toContain('containerOptions: !getContainerTypeById(');
    expect(canvas).toMatch(/n\.id !== node\.id && n\.id !== graph\.nodes\[node\.id\]\?\.parentId/);
    // The assign handler sits ABOVE the nodes memo that injects it (TDZ).
    expect(canvas.indexOf('const handleAssignToContainer'))
      .toBeLessThan(canvas.indexOf('onAssignToContainer: (containerId: string)'));
  });

  it('Delete Edge lives on the selected-connection chip', () => {
    const canvas = ui('components/layout/Canvas.tsx');
    expect(canvas).toContain('selectedEdges.size > 0 && (');
    expect(canvas).toContain("Delete {selectedEdges.size === 1 ? 'connection'");
    expect(canvas).toContain('handleDeleteEdge(id)');
  });

  it('the gated anchor-slice export lives in the export modal, and the toolbar path carries the gate', () => {
    const modal = ui('components/common/NodeExportModal.tsx');
    expect(modal).toContain('onDownloadAnchorSlice');
    expect(modal).toContain('Anchor slice (.json)');
    const editor = ui('components/GraphEditor.tsx');
    expect(editor).toContain('onDownloadAnchorSlice={() => { void handleExportNodeContext(nodeExportContext.node.id); }}');
    // The modal is the ONE export surface — its opener enforces the same
    // gate the right-click JSON export carried, so no ungated side door.
    const handler = editor.slice(editor.indexOf('const handleNodeExport'), editor.indexOf('const handleNodeExport') + 700);
    expect(handler).toContain("gate.check('node_context_export')");
  });

  it('requirement deletion stays reachable through the RequirementInspector', () => {
    const inspector = ui('components/panels/RequirementInspector.tsx');
    expect(inspector).toContain('handleDelete');
    const decomp = ui('components/layout/DecompositionCanvas.tsx');
    expect(decomp).toContain('RequirementInspector');
  });
});
