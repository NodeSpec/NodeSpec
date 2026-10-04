// @vitest-environment jsdom
// Owner 2026-09-29: "In functional, regular view, ensure icons (even the custom
// technology or ones that don't have a defined icon in supabase storage) show
// the parent category icon (this currently happens in compact view)."
// The regular node kinds (the leaf card, the database card, the queue card)
// resolve their icon through the same chain as the compact node: the
// technology's logo, then the role icon, then the palette category icon (N4.8).
// Nothing renders empty and no emoji renders.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { nodeTypes } from '../ui/components/nodes/SpecializedNodes.js';
import { CatalogService } from '../ui/services/CatalogService.js';
import { TECHNOLOGY_LOGO_MAP } from '../ui/utils/technology-logo-map.js';

type Kind = 'service' | 'database' | 'queue';

function mount(kind: Kind, data: Record<string, unknown>) {
  const Node = nodeTypes[kind] as unknown as React.ComponentType<Record<string, unknown>>;
  const props = {
    id: 'n1', type: kind, selected: false, dragging: false, zIndex: 1, isConnectable: false, positionAbsoluteX: 0, positionAbsoluteY: 0,
    data: { label: 'Orders', artifacts: [], ports: [], metadata: {}, hasError: false, isDraft: false, ...data },
  };
  return render(
    <ThemeProvider>
      <ReactFlowProvider>
        <Node {...props} />
      </ReactFlowProvider>
    </ThemeProvider>,
  );
}

const lucide = (el: Element, name: string) => el.querySelector(`svg.lucide-${name}`);

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(TECHNOLOGY_LOGO_MAP)) delete TECHNOLOGY_LOGO_MAP[k];
});

describe('regular nodes fall back to the category icon', () => {
  const cases: Array<[Kind, string, string]> = [
    ['service', 'inference-service', 'AI & ML'],
    ['database', 'database', 'Database'],
    ['queue', 'queue', 'Messaging'],
  ];

  for (const [kind, role, category] of cases) {
    it(`${kind}: a custom technology with no logo and a role with no icon shows the ${category} category icon`, () => {
      vi.spyOn(CatalogService, 'getRoleForNodeType').mockReturnValue({ id: role, iconName: null, paletteCategory: category } as never);
      const { container } = mount(kind, { nodeType: role, technology: 'our-own-thing' });
      const svg = container.querySelector('svg.lucide');
      expect(svg, 'an icon renders').not.toBeNull();
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  }

  it('the category decides the icon: AI & ML draws the brain, Services the globe', () => {
    vi.spyOn(CatalogService, 'getRoleForNodeType').mockReturnValue({ id: 'x', iconName: null, paletteCategory: 'AI & ML' } as never);
    expect(lucide(mount('service', { nodeType: 'x', technology: 'our-own-thing' }).container, 'brain')).not.toBeNull();
    vi.spyOn(CatalogService, 'getRoleForNodeType').mockReturnValue({ id: 'y', iconName: null, paletteCategory: 'Services' } as never);
    expect(lucide(mount('service', { nodeType: 'y', technology: 'our-own-thing' }).container, 'globe')).not.toBeNull();
  });

  it('a role icon the app renders wins over the category', () => {
    vi.spyOn(CatalogService, 'getRoleForNodeType').mockReturnValue({ id: 'x', iconName: 'database', paletteCategory: 'AI & ML' } as never);
    const { container } = mount('service', { nodeType: 'x', technology: 'our-own-thing' });
    expect(lucide(container, 'database')).not.toBeNull();
    expect(lucide(container, 'brain')).toBeNull();
  });

  it('an emoji icon on the node never renders; the category icon does', () => {
    vi.spyOn(CatalogService, 'getRoleForNodeType').mockReturnValue({ id: 'x', iconName: null, paletteCategory: 'AI & ML' } as never);
    for (const kind of ['service', 'database', 'queue'] as Kind[]) {
      const { container } = mount(kind, { nodeType: 'x', technology: 'our-own-thing', icon: '🗄️' });
      expect(container.textContent, kind).not.toContain('🗄️');
      expect(lucide(container, 'brain'), kind).not.toBeNull();
    }
  });

  it('a technology with a stored logo shows the logo, and a logo that fails to load falls back to the category', () => {
    vi.spyOn(CatalogService, 'getRoleForNodeType').mockReturnValue({ id: 'x', iconName: null, paletteCategory: 'AI & ML' } as never);
    TECHNOLOGY_LOGO_MAP['openai'] = 'https://example.test/openai.svg';
    const { container } = mount('service', { nodeType: 'x', technology: 'openai' });
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.test/openai.svg');
    fireEvent.error(img!);
    expect(container.querySelector('img')).toBeNull();
    expect(lucide(container, 'brain')).not.toBeNull();
  });
});
