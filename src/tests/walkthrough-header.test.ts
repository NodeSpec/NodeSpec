import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { walkthroughStops, HEADER_ITEMS } from '../ui/components/common/walkthrough.js';

/*
  Walkthrough + header UX (owner ruling 2026-08-29; the tour itself was
  rewritten 2026-09-30 and runs in walkthrough.test.tsx):
  - Header buttons are self-explanatory text: "MCP connected/disconnected"
    and "Skills" (copy or download as .md).
  - Every control the tour spotlights carries its anchor in the app.
*/

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');
const mcp = read('../ui/components/panels/McpStatusIndicator.tsx');
const skills = read('../ui/components/panels/SkillsMenu.tsx');

describe('walkthrough anchors', () => {
  // The tour itself runs in walkthrough.test.tsx over a page that carries
  // the anchors; this holds the app to drawing them.
  it('every control and surface the tour spotlights carries its data-tour anchor in the app', () => {
    const sources = [
      '../ui/components/panels/TopBar.tsx', '../ui/components/panels/McpStatusIndicator.tsx', '../ui/components/panels/SkillsMenu.tsx',
      '../ui/components/common/ViewToggle.tsx', '../ui/components/common/CanvasDock.tsx', '../ui/components/layout/TabbedSidebar.tsx',
      '../ui/components/work/WorkSurface.tsx', '../ui/components/panels/ChangesPanel.tsx',
    ].map(read).join('\n');
    const anchors = [
      ...walkthroughStops({ workflows: true, plan: true, repoImport: true, team: true }).map((s) => s.anchor).filter((a): a is string => !!a),
      ...HEADER_ITEMS.map((i) => i.anchor),
    ];
    expect(anchors.length).toBeGreaterThanOrEqual(15);
    for (const a of anchors) expect(sources, `missing data-tour anchor for '${a}'`).toContain(`data-tour="${a}"`);
    // The sidebar draws two ways, open and collapsed; the tour finds it in either.
    expect(read('../ui/components/layout/TabbedSidebar.tsx').split('data-tour="nodes-sidebar"')).toHaveLength(3);
  });

});

describe('header buttons say what they are', () => {
  it('MCP indicator is a text button: connected / disconnected', () => {
    expect(mcp).toContain("'MCP connected' : 'MCP disconnected'");
    // The walkthrough anchor + tour anchor stay on the wrapper.
    expect(mcp).toContain('id="nodespec-mcp-header-anchor"');
    expect(mcp).toContain('data-tour="mcp"');
  });

  it('Skills is a text button whose rows offer Copy AND Download (.md)', () => {
    expect(skills).toContain('>\n        Skills\n      </button>');
    expect(skills).toContain('downloadSkill');
    expect(skills).toContain("type: 'text/markdown'");
    expect(skills).toContain('a.download = `${base}.md`');
    // Copy lane intact, sharing one fetch path with download.
    expect(skills).toContain('copySkill');
    expect(skills).toContain('fetchSkillText');
    expect(skills).toContain('navigator.clipboard.writeText');
  });
});
