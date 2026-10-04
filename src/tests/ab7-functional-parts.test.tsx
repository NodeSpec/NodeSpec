// @vitest-environment jsdom
// AB.7 (owner 2026-09-24): "this is too much visual clutter. We need to make
// the database schema view a toggle capability in the functional view; not
// deployment." An exploded node is a card in the functional view, closed until
// the viewer opens it: a data store's toggle shows its schema, any other
// node's its parts. Opening is the viewer's own view state (it never writes a
// patch); the deployment view never shows parts (graph-to-reactflow).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { ContainerNode } from '../ui/components/nodes/ContainerNode.js';

type Props = React.ComponentProps<typeof ContainerNode>;
const card = (data: Record<string, unknown>) => {
  const props = {
    id: 'db', type: 'container', selected: false, dragging: false, zIndex: 1, isConnectable: false, positionAbsoluteX: 0, positionAbsoluteY: 0,
    data: { label: 'Canopy Postgres', nodeType: 'database', artifacts: [], ports: [], hasError: false, isDraft: false, metadata: {}, ...data },
  } as unknown as Props;
  return render(
    <ThemeProvider>
      <ReactFlowProvider>
        <ContainerNode {...props} />
      </ReactFlowProvider>
    </ThemeProvider>,
  );
};

describe('AB.7 · the schema opens in the functional view, on demand', () => {
  it('a database card is closed by default and its toggle says it shows the schema', () => {
    const onUpdateMetadata = vi.fn();
    const { getByTitle, getByText } = card({ exploded: true, dataShape: { model: 'relational', groups: 4, items: 8 }, onUpdateMetadata });
    expect(getByText('relational')).toBeTruthy();
    const toggle = getByTitle('Show schema');
    expect(toggle.getAttribute('aria-label')).toBe('Show schema: Canopy Postgres');
    fireEvent.click(toggle);
    expect(onUpdateMetadata).toHaveBeenCalledWith({ partsShown: true });
  });

  it('opened, the toggle hides the schema again', () => {
    const onUpdateMetadata = vi.fn();
    const { getByTitle } = card({ exploded: true, dataShape: { model: 'relational', groups: 4, items: 8 }, metadata: { partsShown: true }, onUpdateMetadata });
    fireEvent.click(getByTitle('Hide schema'));
    expect(onUpdateMetadata).toHaveBeenCalledWith({ partsShown: false });
  });

  it('any other exploded node shows its parts; a container still expands and collapses as before', () => {
    expect(card({ exploded: true, label: 'Canopy console', nodeType: 'desktop-app' }).getByTitle('Show parts')).toBeTruthy();
    expect(card({ label: 'AWS', nodeType: 'aws' }).getByTitle('Collapse container')).toBeTruthy();
  });

  it('opening is the viewer\'s view state, kept like a container\'s expanded state, never a patch', () => {
    const canvas = readFileSync(resolve(__dirname, '../ui/components/layout/Canvas.tsx'), 'utf-8');
    const keys = canvas.slice(canvas.indexOf('const VISUAL_META_KEYS'), canvas.indexOf(']);', canvas.indexOf('const VISUAL_META_KEYS')));
    expect(keys).toContain("'partsShown'");
    expect(keys).toContain("'containerExpanded'");
  });
});
