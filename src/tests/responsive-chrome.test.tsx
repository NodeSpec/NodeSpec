// @vitest-environment jsdom
//
// 9.14, the other half: canvas-chrome.test.ts proves the ARITHMETIC never
// overlaps. This file proves the components actually use it.
//
// That split matters. A geometry module can be perfect and still fix nothing
// if a component keeps its own hard-coded `top: 16px`, and a source-text pin
// on "does the file mention canvasChromeLayout" would pass either way. So
// these mount the real components at real widths and read the inline styles
// React wrote, which is where the position ends up.
//
// jsdom has no layout, so this cannot ask "do these two boxes visually
// overlap" — that is what the arithmetic sweep is for. What it CAN ask, and
// does, is whether each component's position and density change with the
// window at all, and whether the label that disappears on a phone is still
// reachable by a screen reader.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import { act } from 'react';
import { ThemeProvider } from '../ui/theme/ThemeContext.js';
import { ViewToggle } from '../ui/components/common/ViewToggle.js';
import { EmptyCanvasPrompt } from '../ui/components/common/EmptyCanvasPrompt.js';
import { canvasChromeLayout, VIEW_PILL, PILL_METRICS } from '../ui/components/common/canvas-chrome.js';
import { breakpointFor } from '../ui/hooks/useViewport.js';

const PHONE = 320; // V3 4.1: the lone view pill fits compact at 390; the SE is where it goes to icons
const TABLET = 860;
const DESKTOP = 1440;

/** jsdom's window has a width, and it is settable. `resize` is what
 *  useViewport listens for, and the hook coalesces into a frame — so the
 *  helper flushes one. */
function setWidth(width: number): void {
  (window as unknown as { innerWidth: number }).innerWidth = width;
  (window as unknown as { innerHeight: number }).innerHeight = 900;
  act(() => { window.dispatchEvent(new Event('resize')); });
}

/** requestAnimationFrame under jsdom is a timer; run it synchronously so a
 *  resize lands inside the same `act`. */
let rafOriginal: typeof globalThis.requestAnimationFrame;
beforeEach(() => {
  rafOriginal = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 1; }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
});
afterEach(() => {
  globalThis.requestAnimationFrame = rafOriginal;
  cleanup();
});

function mountToggle(width: number, props: Partial<Parameters<typeof ViewToggle>[0]> = {}) {
  (window as unknown as { innerWidth: number }).innerWidth = width;
  (window as unknown as { innerHeight: number }).innerHeight = 900;
  const r = render(
    <ThemeProvider>
      <ViewToggle viewMode="ideation" onToggle={() => {}} onExport={() => {}} {...props} />
    </ThemeProvider>,
  );
  return r;
}

describe('the view pill changes shape with the window', () => {
  it('a desktop shows the words', () => {
    const { getByTestId } = mountToggle(DESKTOP);
    const pill = getByTestId('view-toggle');
    expect(pill.getAttribute('data-density')).toBe('full');
    expect(within(pill).getByText('Work')).toBeTruthy();
    expect(within(pill).getByText('Architecture')).toBeTruthy();
    expect(within(pill).getByText('Export')).toBeTruthy();
  });

  it('a phone shows icons, and the words move to where a screen reader finds them', () => {
    const { getByTestId, queryByText } = mountToggle(PHONE);
    const pill = getByTestId('view-toggle');
    expect(pill.getAttribute('data-density')).toBe('icon');
    // gone from the visible text...
    expect(queryByText('Work')).toBeNull();
    expect(queryByText('Architecture')).toBeNull();
    // ...and still on the button, for a screen reader AND a hover
    const ideation = getByTestId('view-toggle-ideation');
    expect(ideation.getAttribute('aria-label')).toBe('Work');
    expect(ideation.getAttribute('title')).toBe('Work');
    expect(getByTestId('view-toggle-architecture').getAttribute('aria-label')).toBe('Architecture');
    expect(getByTestId('view-toggle-export').getAttribute('aria-label')).toBe('Export');
  });

  it('the full pill needs no title: the label is right there', () => {
    const { getByTestId } = mountToggle(DESKTOP);
    expect(getByTestId('view-toggle-ideation').getAttribute('title')).toBeNull();
  });

  it('it re-lays-out on resize rather than keeping its mount-time shape', () => {
    const { getByTestId } = mountToggle(DESKTOP);
    expect(getByTestId('view-toggle').getAttribute('data-density')).toBe('full');
    setWidth(PHONE);
    expect(getByTestId('view-toggle').getAttribute('data-density')).toBe('icon');
    setWidth(DESKTOP);
    expect(getByTestId('view-toggle').getAttribute('data-density')).toBe('full');
  });

  it('the padding it renders is the padding the geometry costed — not a second set of numbers', () => {
    for (const [w, density] of [[DESKTOP, 'full'], [PHONE, 'icon']] as const) {
      cleanup();
      const { getByTestId } = mountToggle(w);
      const m = PILL_METRICS[density];
      expect(getByTestId('view-toggle').style.padding).toBe(`${m.shellPad}px`);
      // jsdom collapses a shorthand whose sides match, so read the sides.
      const button = getByTestId('view-toggle-ideation');
      expect(button.style.paddingTop).toBe(`${m.padY}px`);
      expect(button.style.paddingLeft).toBe(`${m.padX}px`);
      expect(button.style.fontSize).toBe(`${m.fontSize}px`);
    }
  });

  it('it can never be wider than the canvas, whatever the estimate got wrong', () => {
    const { getByTestId } = mountToggle(PHONE);
    expect(getByTestId('view-toggle').style.maxWidth).toBe('calc(100% - 32px)');
  });

  it('V3 4.1: no mode pill shares the line in either view, so both keep their labels on a tablet', () => {
    cleanup();
    const a = mountToggle(TABLET, { viewMode: 'architecture' });
    expect(a.getByTestId('view-toggle').getAttribute('data-density')).toBe('full');
    cleanup();
    const d = mountToggle(TABLET, { viewMode: 'ideation' });
    expect(d.getByTestId('view-toggle').getAttribute('data-density')).toBe('full');
  });

  it('its top edge comes from the band, not from a literal 16', () => {
    const { getByTestId } = mountToggle(DESKTOP);
    const expected = canvasChromeLayout({ vw: DESKTOP, modePill: null, viewPill: VIEW_PILL }).viewPill!.top;
    expect(getByTestId('view-toggle').style.top).toBe(`${expected}px`);
  });
});

describe('the empty-canvas prompt fits the screen it is on', () => {
  const mountPrompt = (width: number) => {
    (window as unknown as { innerWidth: number }).innerWidth = width;
    return render(<ThemeProvider><EmptyCanvasPrompt /></ThemeProvider>);
  };

  it('a phone gets a column that gives way to the viewport, not a 500px one with 48px of padding', () => {
    const { container } = mountPrompt(PHONE);
    // the inner column is the second div: overlay > column
    const column = container.querySelector('div > div > div') as HTMLElement;
    expect(column.style.padding).toBe('24px 20px');
    expect(column.style.width).toBe('100%');
    expect(column.style.boxSizing).toBe('border-box');
  });

  it('a desktop keeps the roomy original', () => {
    const { container } = mountPrompt(DESKTOP);
    const column = container.querySelector('div > div > div') as HTMLElement;
    expect(column.style.padding).toBe('48px');
    expect(column.style.maxWidth).toBe('500px');
  });
});

describe('the sources agree: nothing in the band keeps its own top', () => {
  // The clash was three files each writing `top: 16px`. A regression would
  // most likely be someone putting one back, so it is worth naming.
  const read = (p: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve } = require('node:path') as typeof import('node:path');
    return readFileSync(resolve(process.cwd(), p), 'utf8');
  };

  const BAND_FILES = [
    'src/ui/components/common/ViewToggle.tsx',
    'src/ui/components/common/ProjectStartPopup.tsx',
    'src/ui/components/common/SpecImportStagingPopup.tsx',
    'src/ui/components/work/WorkSurface.tsx',
  ];

  it.each(BAND_FILES)('%s takes its top from canvas-chrome', (file) => {
    const src = read(file);
    expect(src).toContain('canvasChromeLayout');
    expect(src).not.toMatch(/top: '16px'/);
  });

  it('WorkSurface pads its content by the band, never a hard-coded 84px', () => {
    const src = read('src/ui/components/work/WorkSurface.tsx');
    expect(src).not.toContain("padding: '84px 24px 24px'");
    expect(src).toContain('layout.contentTop');
  });

  it('the breakpoints are one import away from any file that needs them', () => {
    expect(breakpointFor(PHONE)).toBe('phone');
    expect(breakpointFor(TABLET)).toBe('tablet');
    expect(breakpointFor(DESKTOP)).toBe('desktop');
  });
});
