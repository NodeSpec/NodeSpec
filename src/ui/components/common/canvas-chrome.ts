// The floating chrome band at the top of the canvas, and the ONE place that
// decides where each piece of it goes.
//
// 9.14 (owner report): "the pills for Decomposition/Architecture/Export are on
// top of the Starting new project three selectable categories."
//
// Three things were each absolutely positioned at `top: 16px` by three
// different files, each sized by its own hard-coded padding, and none of them
// knew the others existed:
//
//   · the ideation MODE pill   (Workflow | Trace | Priority)   top-left (retired in V3 4.1)
//   · the VIEW pill            (Work | Architecture | Export)  top-right
//   · the START card           (the three ways to begin a project) centered
//
// On a wide desktop they happen to miss each other. They are all fixed widths
// against a viewport that is not, so as the window narrows: the start card
// grows to `100% - 32px` and slides under the view pill, and below roughly
// 850px the two pills reach each other as well. Nothing in the code could
// notice, because no file knew more than its own box.
//
// So the geometry lives here, as pure arithmetic over the viewport width, and
// every piece of the band reads its box from `canvasChromeLayout`. The rule it
// enforces is the one a person would state: the three boxes never overlap, at
// any width. `canvas-chrome.test.ts` sweeps every width from a small phone to
// a wide desktop and asserts exactly that, which is a thing a screenshot of
// one window size can never tell you.
//
// The ladder, widest first. Each rung is tried in turn and the first one that
// fits is used:
//
//   full     icon + label, the desktop pill
//   compact  icon + label, tighter padding and type
//   icon     icon only, square buttons, the label moves to title/aria
//   stacked  even icon-only will not sit side by side, so the view pill drops
//            to a second row and the content below is pushed down to clear it
//
// Why estimate text width instead of measuring it: measuring means refs, a
// ResizeObserver and a layout pass per pill, which is the machinery 9.6
// deleted from the Workflow board after it shipped a blank canvas. An
// estimate that errs WIDE costs a slightly early step down the ladder; a
// measurement that errs costs an overlap the user sees. The estimate is
// deliberately generous for that reason.

/** A box in canvas coordinates. `right` is the distance from the LEFT edge,
 *  so two boxes overlap horizontally when one's left is under the other's
 *  right. */
export interface ChromeBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const boxRight = (b: ChromeBox): number => b.left + b.width;
export const boxBottom = (b: ChromeBox): number => b.top + b.height;

/** Two boxes share pixels. */
export function boxesOverlap(a: ChromeBox, b: ChromeBox): boolean {
  return a.left < boxRight(b) && b.left < boxRight(a)
    && a.top < boxBottom(b) && b.top < boxBottom(a);
}

/** How much room the pills are given, and how they are drawn there. */
export type ChromeDensity = 'full' | 'compact' | 'icon';

/** The gap the band keeps from the canvas edge, and between its pieces. */
export const CHROME_TOP = 16;
export const CHROME_GUTTER = 16;
/** Two pills on one line never touch: they keep this much air between them. */
export const CHROME_SPACING = 12;

/** A side popup beside the canvas (Proposals, a node's sidepane, Team) starts
 *  below the floating view pill (TopBar 56px + pill top 16px + pill about 50px)
 *  and stacks above it, so the pill never covers its header or close button. */
export const SIDE_POPUP_TOP = 128;
export const SIDE_POPUP_Z = 300;

/** The pill shell: `padding` on the container, `gap` between its buttons.
 *  These are the values the components render, not a description of them. */
export interface PillMetrics {
  /** container padding, all four sides */
  shellPad: number;
  /** gap between buttons inside the shell */
  shellGap: number;
  /** button padding: vertical, horizontal */
  padY: number;
  padX: number;
  /** the button's icon box */
  icon: number;
  /** gap between a button's icon and its label */
  iconGap: number;
  fontSize: number;
  /** false at the `icon` rung: the label moves to title and aria-label */
  showLabel: boolean;
  radius: number;
  buttonRadius: number;
}

export const PILL_METRICS: Record<ChromeDensity, PillMetrics> = {
  full: { shellPad: 6, shellGap: 4, padY: 10, padX: 16, icon: 16, iconGap: 8, fontSize: 14, showLabel: true, radius: 12, buttonRadius: 8 },
  compact: { shellPad: 5, shellGap: 3, padY: 8, padX: 11, icon: 15, iconGap: 6, fontSize: 12.5, showLabel: true, radius: 11, buttonRadius: 8 },
  // The icon rung is the TOUCH rung: it is reached on phones, so its buttons
  // are sized as tap targets (40x40) rather than shrunk to the icon. That
  // makes this the TALLEST pill, which is deliberate and is why nothing here
  // assumes a denser rung is a shorter one.
  icon: { shellPad: 5, shellGap: 3, padY: 11, padX: 11, icon: 18, iconGap: 0, fontSize: 12.5, showLabel: false, radius: 11, buttonRadius: 10 },
};

/** A generous per-character advance for the app's face (Inter) at weight 600.
 *  Mixed-case Latin runs nearer 0.55em; 0.62 is the deliberate over-estimate
 *  described at the top of this file. */
const CHAR_ADVANCE = 0.62;

/** The rendered width of a label, rounded up. */
export function labelWidth(label: string, fontSize: number): number {
  return Math.ceil(label.length * fontSize * CHAR_ADVANCE);
}

/** One button's width at a density. */
export function buttonWidth(label: string, d: ChromeDensity): number {
  const m = PILL_METRICS[d];
  const inner = m.showLabel
    ? m.icon + m.iconGap + labelWidth(label, m.fontSize)
    : m.icon;
  return m.padX * 2 + inner;
}

/** The height of any pill at a density: every button is one line of text or
 *  one icon, so the tallest of the two decides. */
export function pillHeight(d: ChromeDensity): number {
  const m = PILL_METRICS[d];
  const line = Math.max(m.icon, Math.ceil(m.fontSize * 1.2));
  return m.shellPad * 2 + m.padY * 2 + line;
}

/** The smallest a button may get. Below this a finger cannot reliably hit it,
 *  so the icon rung is sized up to meet it rather than down to the glyph. */
export const TOUCH_TARGET_MIN = 40;

/** A button's height at a density, which is its tap target on a phone. */
export function buttonHeight(d: ChromeDensity): number {
  const m = PILL_METRICS[d];
  return m.padY * 2 + Math.max(m.icon, Math.ceil(m.fontSize * 1.2));
}

/** A divider between button groups (the view pill puts one before Export). */
export const DIVIDER_W = 1;
export const DIVIDER_MARGIN = 2;

export interface PillSpec {
  labels: string[];
  /** index the divider is drawn BEFORE, if any */
  dividerBefore?: number;
  /** extra width the pill carries regardless of density (a tier tag chip) */
  extra?: number;
}

/** The width a pill needs at a density. */
export function pillWidth(spec: PillSpec, d: ChromeDensity): number {
  const m = PILL_METRICS[d];
  const buttons = spec.labels.map((l) => buttonWidth(l, d));
  const gaps = m.shellGap * Math.max(0, spec.labels.length - 1);
  const divider = spec.dividerBefore === undefined ? 0 : DIVIDER_W + DIVIDER_MARGIN * 2 + m.shellGap;
  const extra = d === 'icon' ? 0 : (spec.extra ?? 0);
  return m.shellPad * 2 + buttons.reduce((a, b) => a + b, 0) + gaps + divider + extra;
}

// ── the pill the canvas actually renders ───────────────────────────────────
// V3 4.1: the mode pill (Workflow | Trace | Priority) retired with the
// surfaces it switched; Work's tabs sit inside the content. The layout still
// takes a `modePill` so a second pill can be placed without overlap if one
// returns, and the sweep in canvas-chrome.test.ts keeps proving it.

export const VIEW_PILL: PillSpec = { labels: ['Work', 'Architecture', 'Export'], dividerBefore: 2 };
/** The view pill without the Export button (self-hosted, or no handler). */
export const VIEW_PILL_NO_EXPORT: PillSpec = { labels: ['Work', 'Architecture'] };

/** The start card's own width rule, unchanged: a comfortable reading column
 *  that gives way to the viewport on a phone. */
export const START_CARD_MAX = 720;
export function startCardWidth(vw: number): number {
  return Math.min(START_CARD_MAX, Math.max(0, vw - CHROME_GUTTER * 2));
}

export interface ChromeInput {
  /** the canvas width in px */
  vw: number;
  /** a second pill on the band's left; nothing mounts one since V3 4.1 */
  modePill?: PillSpec | null;
  viewPill?: PillSpec | null;
  /** the start card is only mounted on an empty project */
  startCard?: boolean;
}

export interface ChromeLayout {
  density: ChromeDensity;
  /** true when the pills could not sit side by side and the view pill moved
   *  to its own row under the mode pill. */
  stacked: boolean;
  modePill: ChromeBox | null;
  viewPill: ChromeBox | null;
  startCard: ChromeBox | null;
  /** The top padding scrolling canvas content needs so the band never covers
   *  its first line. */
  contentTop: number;
}

const DENSITY_LADDER: ChromeDensity[] = ['full', 'compact', 'icon'];

/**
 * Where every piece of the top band goes, at this viewport width.
 *
 * The order of decisions:
 *   1 · pick the widest density at which both pills fit on one line;
 *   2 · if none does, keep `icon` and STACK — the view pill takes a second
 *       row, which is the only arrangement that always fits;
 *   3 · place the start card under whichever rows are occupied, because a
 *       centered card wide enough to read is always wide enough to reach a
 *       corner pill on a narrow screen.
 */
export function canvasChromeLayout(input: ChromeInput): ChromeLayout {
  const { vw } = input;
  const mode = input.modePill ?? null;
  const view = input.viewPill ?? null;

  // V3 4.1: with one pill on the band, "fits" means the pill fits the
  // canvas by itself. Before, a lone pill never stepped down and relied on
  // its labels wrapping; on a phone that wrapped the Work | Architecture |
  // Export pill onto three lines.
  const fitsSideBySide = (d: ChromeDensity): boolean => {
    if (!mode && !view) return true;
    const widths = [mode, view].filter((p): p is PillSpec => !!p).map((p) => pillWidth(p, d));
    const need = widths.reduce((a, b) => a + b, 0) + CHROME_SPACING * (widths.length - 1) + CHROME_GUTTER * 2;
    return need <= vw;
  };

  let density: ChromeDensity = 'icon';
  for (const d of DENSITY_LADDER) {
    if (fitsSideBySide(d)) { density = d; break; }
  }
  const stacked = !!mode && !!view && !fitsSideBySide('icon');

  const h = pillHeight(density);
  const modeBox: ChromeBox | null = mode
    ? { left: CHROME_GUTTER, top: CHROME_TOP, width: Math.min(pillWidth(mode, density), Math.max(0, vw - CHROME_GUTTER * 2)), height: h }
    : null;

  let viewBox: ChromeBox | null = null;
  if (view) {
    const w = Math.min(pillWidth(view, density), Math.max(0, vw - CHROME_GUTTER * 2));
    viewBox = stacked
      // Second row, still right-aligned, clearing the mode pill above it.
      ? { left: Math.max(CHROME_GUTTER, vw - CHROME_GUTTER - w), top: CHROME_TOP + h + CHROME_SPACING, width: w, height: h }
      : { left: Math.max(CHROME_GUTTER, vw - CHROME_GUTTER - w), top: CHROME_TOP, width: w, height: h };
  }

  // The lowest pixel any pill occupies. The start card and the scrolling
  // content both hang off this, so neither can be told a stale number.
  const bandBottom = Math.max(
    modeBox ? boxBottom(modeBox) : CHROME_TOP,
    viewBox ? boxBottom(viewBox) : CHROME_TOP,
  );

  let startBox: ChromeBox | null = null;
  if (input.startCard) {
    const w = startCardWidth(vw);
    const left = Math.max(CHROME_GUTTER, Math.round((vw - w) / 2));
    const card: ChromeBox = { left, top: CHROME_TOP, width: w, height: 0 };
    // A card that would touch either pill goes under the whole band instead.
    // Height is 0 here on purpose: the card's real height is its content's,
    // and only its TOP edge is a layout decision.
    const wouldTouch = [modeBox, viewBox].some((p) => {
      if (!p) return false;
      const sameRow = p.top < CHROME_TOP + 1;
      return sameRow && left < boxRight(p) && p.left < left + w;
    });
    startBox = wouldTouch || stacked
      ? { ...card, top: bandBottom + CHROME_SPACING }
      : card;
  }

  const contentTop = bandBottom + CHROME_SPACING + (input.startCard ? 0 : 0);

  return { density, stacked, modePill: modeBox, viewPill: viewBox, startCard: startBox, contentTop };
}
