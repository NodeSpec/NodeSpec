import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/*
  Walkthrough + header UX (owner ruling 2026-08-29):
  - The spotlight is a true CUTOUT — the dimming layer is the ring's giant
    box-shadow, so the highlighted header control never fades behind the
    backdrop (the reported bug).
  - No gate: users progress through the walkthrough without connecting MCP.
  - Header buttons are self-explanatory text: "MCP connected/disconnected"
    and "Skills" (copy or download as .md).
  - The final step tours every header control with the same spotlight.
*/

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');
const modal = read('../ui/components/common/OnboardingModal.tsx');
const mcp = read('../ui/components/panels/McpStatusIndicator.tsx');
const skills = read('../ui/components/panels/SkillsMenu.tsx');
const topBar = read('../ui/components/panels/TopBar.tsx');

describe('walkthrough spotlight', () => {
  it('is a cutout: the dim layer rides the ring shadow, never over the control', () => {
    expect(modal).toContain('0 0 0 9999px rgba(0, 0, 0, 0.6)');
    // The full-screen backdrop steps aside whenever a control is spotlighted.
    expect(modal).toContain("anchorRect ? 'transparent' : 'rgba(0, 0, 0, 0.6)'");
    expect(modal).toContain("anchorRect ? undefined : 'blur(4px)'");
  });

  it('never gates: no hold-until-connected state survives', () => {
    expect(modal).not.toContain('gateHolds');
    expect(modal).not.toContain('Waiting for your AI…');
    // First-run copy still nudges without blocking.
    expect(modal).toContain('Connect later — Next');
  });

  it('offline-first: the connect step SAYS skipping is fine and points at the header', () => {
    // Owner ruling 2026-08-31: the community container's default context is
    // an offline machine with any harness (or none). The step must never
    // read as a requirement.
    const step = read('../ui/components/common/MCPConnectStep.tsx');
    expect(step).toContain('No AI on hand, or working offline?');
    expect(step).toContain('(optional — skip ahead any time)');
    expect(step).toContain('MCP disconnected');
  });

  it('ends with the header tour step wired to the shared spotlight', () => {
    expect(modal).toContain('Know Your Header');
    expect(modal).toContain('StepHeaderTour');
    expect(modal).toContain('HEADER_TOUR_ITEMS');
    expect(modal).toContain('[data-tour="${tourKey}"]');
  });

  it('every tour item key has a live data-tour anchor in the header components', () => {
    const keys = [...modal.matchAll(/\{ key: '([a-z]+)', title:/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    const anchors = `${topBar}\n${mcp}\n${skills}`;
    for (const key of keys) {
      expect(anchors, `missing data-tour anchor for '${key}'`).toContain(`data-tour="${key}"`);
    }
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
