// 9.14 (owner report): "the pills for Decomposition/Architecture/Export are on
// top of the Starting new project three selectable categories ... make this
// portion of our app mobile and screen responsive so it doesn't clash."
//
// The clash was structural, not cosmetic. Three absolutely-positioned boxes
// each claimed `top: 16px` from three different files, each sized by its own
// hard-coded padding, and none of them could know the others existed:
//
//   · the ideation MODE pill (Workflow | Trace | Priority), top-left
//   · the VIEW pill (Work | Architecture | Export), top-right
//   · the START card (the three ways to begin), centered and `100% - 32px`
//
// On a wide desktop they miss each other by luck. They are fixed widths
// against a viewport that is not.
//
// This file is the reason the fix can be trusted: the layout is pure
// arithmetic over the viewport width, so a test can SWEEP every width a real
// screen might have and assert the boxes never share a pixel. A screenshot at
// one window size cannot tell you that, which is exactly how this shipped.
import { describe, it, expect } from 'vitest';
import {
  canvasChromeLayout, boxesOverlap, boxRight, boxBottom,
  pillWidth, pillHeight, buttonWidth, buttonHeight, labelWidth, startCardWidth, TOUCH_TARGET_MIN,
  VIEW_PILL, VIEW_PILL_NO_EXPORT,
  PILL_METRICS, CHROME_TOP, CHROME_GUTTER, CHROME_SPACING, START_CARD_MAX,
  type ChromeDensity, type ChromeBox, type PillSpec,
} from '../ui/components/common/canvas-chrome.js';

// V3 4.1 retired the mode pill (Workflow | Trace | Priority) with the
// surfaces it switched. The sweep keeps a second pill of that shape so the
// arithmetic stays proven for the day another pill shares the band.
const MODE_PILL: PillSpec = { labels: ['Workflow', 'Trace', 'Priority'] };
const MODE_PILL_TAGGED: PillSpec = { ...MODE_PILL, extra: 46 };
import { breakpointFor, viewportOf, PHONE_MAX, TABLET_MAX, SSR_WIDTH } from '../ui/hooks/useViewport.js';

/** Every width worth caring about, one pixel at a time. 320 is the narrowest
 *  phone still in use; 2560 is a wide desktop. Stepping by 1 is cheap here
 *  because the layout is arithmetic, and it is the only way to catch a rung
 *  of the ladder that is off by a pixel at its boundary. */
const WIDTHS: number[] = [];
for (let w = 320; w <= 2560; w += 1) WIDTHS.push(w);

/** The named screens, so a failure says WHICH device broke. */
const SCREENS: Array<[string, number]> = [
  ['iPhone SE', 320],
  ['iPhone 12 mini', 360],
  ['iPhone 15', 393],
  ['iPhone 15 Pro Max', 430],
  ['small tablet portrait', 600],
  ['iPad portrait', 768],
  ['iPad landscape', 1024],
  ['small laptop', 1280],
  ['laptop', 1440],
  ['desktop', 1920],
  ['wide desktop', 2560],
];

const full = (vw: number) => canvasChromeLayout({ vw, modePill: MODE_PILL, viewPill: VIEW_PILL, startCard: true });

describe('the top band never overlaps itself, at any width', () => {
  it.each(SCREENS)('%s (%ipx): the two pills do not touch', (_name, vw) => {
    const l = full(vw);
    expect(l.modePill).not.toBeNull();
    expect(l.viewPill).not.toBeNull();
    expect(boxesOverlap(l.modePill!, l.viewPill!)).toBe(false);
  });

  it.each(SCREENS)('%s (%ipx): the start card clears both pills', (_name, vw) => {
    const l = full(vw);
    // The card's height is its content's, so the contract is on its TOP edge:
    // either it is beside both pills, or it begins below them.
    const card = { ...l.startCard!, height: 1 };
    expect(boxesOverlap(card, l.modePill!)).toBe(false);
    expect(boxesOverlap(card, l.viewPill!)).toBe(false);
  });

  it('sweeps every width from 320 to 2560 and finds no overlap anywhere', () => {
    const clashes: string[] = [];
    for (const vw of WIDTHS) {
      const l = full(vw);
      const card: ChromeBox = { ...l.startCard!, height: 1 };
      if (boxesOverlap(l.modePill!, l.viewPill!)) clashes.push(`${vw}: mode/view`);
      if (boxesOverlap(card, l.modePill!)) clashes.push(`${vw}: card/mode`);
      if (boxesOverlap(card, l.viewPill!)) clashes.push(`${vw}: card/view`);
    }
    expect(clashes).toEqual([]);
  });

  it('nothing is ever pushed off the left or right edge', () => {
    for (const vw of WIDTHS) {
      const l = full(vw);
      for (const box of [l.modePill!, l.viewPill!, l.startCard!]) {
        expect(box.left, `left at ${vw}`).toBeGreaterThanOrEqual(0);
        expect(boxRight(box), `right at ${vw}`).toBeLessThanOrEqual(vw);
      }
    }
  });

  it('the sweep is not vacuous: the same widths DO clash under the old fixed geometry', () => {
    // The bug, reconstructed: every box pinned to top 16, the pills at their
    // full desktop width whatever the viewport, the card centered at
    // min(720, 100% - 32). If this does not clash, the sweep above proves
    // nothing.
    const clashed = WIDTHS.filter((vw) => {
      const h = pillHeight('full');
      const mode: ChromeBox = { left: CHROME_GUTTER, top: CHROME_TOP, width: pillWidth(MODE_PILL, 'full'), height: h };
      const viewW = pillWidth(VIEW_PILL, 'full');
      const view: ChromeBox = { left: vw - CHROME_GUTTER - viewW, top: CHROME_TOP, width: viewW, height: h };
      const cardW = startCardWidth(vw);
      const card: ChromeBox = { left: (vw - cardW) / 2, top: CHROME_TOP, width: cardW, height: 1 };
      return boxesOverlap(mode, view) || boxesOverlap(card, mode) || boxesOverlap(card, view);
    });
    // The owner saw this on a real window, so the broken range has to include
    // ordinary laptop widths, not just phones.
    expect(clashed.length).toBeGreaterThan(400);
    expect(clashed).toContain(1280);
    expect(clashed).toContain(1024);
    expect(clashed).toContain(390);
  });
});

describe('the density ladder steps down only as far as it has to', () => {
  it('a desktop keeps the full pill, labels and all', () => {
    expect(full(1920).density).toBe('full');
    expect(full(1440).density).toBe('full');
    expect(PILL_METRICS.full.showLabel).toBe(true);
  });

  it('a phone drops to icons, and the label moves off the button', () => {
    expect(full(390).density).toBe('icon');
    expect(PILL_METRICS.icon.showLabel).toBe(false);
  });

  it('the ladder is monotonic: a wider window is never a narrower pill', () => {
    const rank: Record<ChromeDensity, number> = { icon: 0, compact: 1, full: 2 };
    let previous = -1;
    for (const vw of WIDTHS) {
      const r = rank[full(vw).density];
      expect(r, `density went backwards at ${vw}`).toBeGreaterThanOrEqual(previous);
      previous = r;
    }
  });

  it('every rung is actually reachable — a ladder with a dead rung is a lie', () => {
    const seen = new Set(WIDTHS.map((vw) => full(vw).density));
    expect([...seen].sort()).toEqual(['compact', 'full', 'icon']);
  });

  it('stacking is confined to the very narrowest screens, and never a phone in wide use', () => {
    const stacked = WIDTHS.filter((vw) => full(vw).stacked);
    // Six tap targets across is 324px of pill; a 320px iPhone SE is four
    // pixels short of that, so it takes the second row. Every phone from an
    // iPhone 12 mini (360) up keeps both pills on one line.
    expect(stacked).toEqual([320, 321, 322, 323]);
    expect(full(360).stacked).toBe(false);
    expect(full(1440).stacked).toBe(false);
  });

  it('when it does stack, the second row genuinely clears the first', () => {
    const l = full(320);
    expect(l.stacked).toBe(true);
    expect(l.density).toBe('icon');
    expect(l.viewPill!.top).toBeGreaterThanOrEqual(boxBottom(l.modePill!));
    expect(boxesOverlap(l.modePill!, l.viewPill!)).toBe(false);
    // and the start card clears BOTH rows, not just the one it is centered on
    expect(l.startCard!.top).toBeGreaterThanOrEqual(boxBottom(l.viewPill!));
  });

  it('a pill with more buttons stacks sooner — the fallback is about COUNT, not label length', () => {
    // At the icon rung the labels are gone, so a long label cannot force a
    // stack; only more buttons can. Worth stating, because the obvious guess
    // is the opposite.
    const long = { labels: ['A considerably longer label than any real one', 'And another beside it'] };
    expect(canvasChromeLayout({ vw: 360, modePill: long, viewPill: long }).stacked).toBe(false);
    const many = { labels: ['a', 'b', 'c', 'd', 'e', 'f'] };
    expect(canvasChromeLayout({ vw: 360, modePill: many, viewPill: many }).stacked).toBe(true);
  });

  it('one pill alone never stacks, and steps down only when it alone does not fit the canvas (V3 4.1)', () => {
    for (const vw of [320, 390, 768]) {
      expect(canvasChromeLayout({ vw, modePill: null, viewPill: VIEW_PILL }).stacked).toBe(false);
      expect(canvasChromeLayout({ vw, modePill: MODE_PILL, viewPill: null }).stacked).toBe(false);
      const l = canvasChromeLayout({ vw, modePill: null, viewPill: VIEW_PILL });
      expect(pillWidth(VIEW_PILL, l.density) + CHROME_GUTTER * 2 <= vw || l.density === 'icon').toBe(true);
    }
    expect(canvasChromeLayout({ vw: 768, modePill: null, viewPill: VIEW_PILL }).density).toBe('full');
    expect(canvasChromeLayout({ vw: 320, modePill: null, viewPill: VIEW_PILL }).density).toBe('icon');
  });
});

describe('the pieces each view actually mounts', () => {
  it('a second pill on the band costs the view pill its labels sooner than the pill alone would', () => {
    const both = canvasChromeLayout({ vw: 780, modePill: MODE_PILL, viewPill: VIEW_PILL });
    const alone = canvasChromeLayout({ vw: 780, modePill: null, viewPill: VIEW_PILL });
    expect(both.density).not.toBe('full');
    expect(alone.density).toBe('full');
  });

  it('a self-hosted build without Export needs a narrower pill', () => {
    expect(pillWidth(VIEW_PILL_NO_EXPORT, 'full')).toBeLessThan(pillWidth(VIEW_PILL, 'full'));
  });

  it('the tier tag on Priority is counted, so it cannot push the pill over', () => {
    expect(pillWidth(MODE_PILL_TAGGED, 'full')).toBeGreaterThan(pillWidth(MODE_PILL, 'full'));
    // and it is dropped at the icon rung, where there is no room for it
    expect(pillWidth(MODE_PILL_TAGGED, 'icon')).toBe(pillWidth(MODE_PILL, 'icon'));
  });

  it('with the tag mounted the sweep still finds no overlap', () => {
    for (const vw of WIDTHS) {
      const l = canvasChromeLayout({ vw, modePill: MODE_PILL_TAGGED, viewPill: VIEW_PILL, startCard: true });
      expect(boxesOverlap(l.modePill!, l.viewPill!), `${vw}`).toBe(false);
      expect(boxesOverlap({ ...l.startCard!, height: 1 }, l.viewPill!), `${vw}`).toBe(false);
    }
  });
});

describe('the content below the band is told where the band ends', () => {
  it('contentTop always clears the lowest pill', () => {
    for (const vw of WIDTHS) {
      const l = full(vw);
      expect(l.contentTop, `${vw}`).toBeGreaterThanOrEqual(boxBottom(l.viewPill!));
      expect(l.contentTop, `${vw}`).toBeGreaterThanOrEqual(boxBottom(l.modePill!));
    }
  });

  it('a stacked band pushes the content further down than a side-by-side one', () => {
    const stacked = WIDTHS.filter((vw) => full(vw).stacked);
    const wide = full(1440);
    expect(full(stacked[0]).contentTop).toBeGreaterThan(wide.contentTop);
  });

  it('the old hard-coded 84px is no longer the source of truth', () => {
    // It happened to be right for exactly one arrangement.
    const widths = new Set(WIDTHS.map((vw) => full(vw).contentTop));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe('the arithmetic underneath', () => {
  it('a longer label is a wider button', () => {
    expect(buttonWidth('Architecture', 'full')).toBeGreaterThan(buttonWidth('Export', 'full'));
  });

  it('the label estimate errs WIDE, which is the safe direction', () => {
    // Inter at 600 runs nearer 0.55em for mixed-case Latin; the estimate is
    // deliberately above that so the ladder steps early rather than late.
    const perChar = labelWidth('Architecture', 14) / 'Architecture'.length / 14;
    expect(perChar).toBeGreaterThan(0.58);
  });

  it('an icon-only button carries no label width at all', () => {
    expect(buttonWidth('Architecture', 'icon')).toBe(buttonWidth('Export', 'icon'));
  });

  it('compact is tighter than full, and the icon rung is sized for a FINGER', () => {
    expect(pillHeight('compact')).toBeLessThanOrEqual(pillHeight('full'));
    // The icon rung is reached on phones, so its buttons are tap targets. It
    // is therefore the tallest pill, on purpose.
    expect(buttonHeight('icon')).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
    expect(buttonWidth('Export', 'icon')).toBeGreaterThanOrEqual(TOUCH_TARGET_MIN);
  });

  it('the start card gives way to the viewport, never overflows it', () => {
    expect(startCardWidth(2560)).toBe(START_CARD_MAX);
    expect(startCardWidth(360)).toBe(360 - CHROME_GUTTER * 2);
    expect(startCardWidth(20)).toBe(0);
  });

  it('boxesOverlap is edge-exclusive: touching is not overlapping', () => {
    const a = { left: 0, top: 0, width: 10, height: 10 };
    expect(boxesOverlap(a, { left: 10, top: 0, width: 10, height: 10 })).toBe(false);
    expect(boxesOverlap(a, { left: 9, top: 0, width: 10, height: 10 })).toBe(true);
    expect(boxesOverlap(a, { left: 0, top: 10, width: 10, height: 10 })).toBe(false);
  });

  it('pills keep real air between them, not a shared edge', () => {
    for (const vw of WIDTHS) {
      const l = full(vw);
      if (l.stacked) continue;
      expect(l.viewPill!.left - boxRight(l.modePill!), `${vw}`).toBeGreaterThanOrEqual(0);
    }
    // on a comfortable width the gap is the full spacing, not a hair
    const l = full(1440);
    expect(l.viewPill!.left - boxRight(l.modePill!)).toBeGreaterThanOrEqual(CHROME_SPACING);
  });
});

describe('the viewport hook, as data', () => {
  it('names the breakpoints at their boundaries', () => {
    expect(breakpointFor(PHONE_MAX)).toBe('phone');
    expect(breakpointFor(PHONE_MAX + 1)).toBe('tablet');
    expect(breakpointFor(TABLET_MAX)).toBe('tablet');
    expect(breakpointFor(TABLET_MAX + 1)).toBe('desktop');
  });

  it('isCompact means phone OR tablet, which is what callers ask', () => {
    expect(viewportOf(390, 800).isCompact).toBe(true);
    expect(viewportOf(768, 1024).isCompact).toBe(true);
    expect(viewportOf(1440, 900).isCompact).toBe(false);
  });

  it('the prerender width is a desktop, so a built HTML file is not laid out as a phone', () => {
    expect(breakpointFor(SSR_WIDTH)).toBe('desktop');
    expect(viewportOf(SSR_WIDTH, 900, true).assumed).toBe(true);
    expect(viewportOf(SSR_WIDTH, 900).assumed).toBe(false);
  });
});
