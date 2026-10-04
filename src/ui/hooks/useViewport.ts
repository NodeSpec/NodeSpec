// The viewport, as a value a component can lay itself out from.
//
// 9.14: this app draws itself with inline styles, so a `@media` rule is not
// available to it — a style object has no breakpoints. Anything that has to
// change shape with the window therefore needs the width as DATA, which is
// what this returns.
//
// SSR-safe by construction: the build prerenders eight HTML files, so the
// first render can happen with no `window` at all. It starts at a desktop
// width (the overwhelmingly common case, and the arrangement that needs no
// special handling) and corrects itself on mount, which is one paint.
//
// One listener per hook instance, on `resize` — not a ResizeObserver over
// elements. The distinction matters: the thing being watched here is the
// WINDOW, which is one object that already emits an event, not a tree of
// boxes that has to be measured.
import { useEffect, useState } from 'react';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

/** The widest phone and the widest tablet. A phone in landscape lands in
 *  `tablet`, which is the right answer: what the layout cares about is how
 *  much horizontal room it has, not what the device is called. */
export const PHONE_MAX = 639;
export const TABLET_MAX = 1023;

export function breakpointFor(width: number): Breakpoint {
  if (width <= PHONE_MAX) return 'phone';
  if (width <= TABLET_MAX) return 'tablet';
  return 'desktop';
}

/** The width assumed before the window is known (prerender, or the first
 *  render of a test that never sets one). */
export const SSR_WIDTH = 1440;
export const SSR_HEIGHT = 900;

export interface Viewport {
  width: number;
  height: number;
  breakpoint: Breakpoint;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** phone OR tablet: "there is not much room", which is what most callers
   *  actually want to ask. */
  isCompact: boolean;
  /** true until the real window has been read, so a component can avoid
   *  animating from the assumed width to the real one. */
  assumed: boolean;
}

export function viewportOf(width: number, height: number, assumed = false): Viewport {
  const breakpoint = breakpointFor(width);
  return {
    width,
    height,
    breakpoint,
    isPhone: breakpoint === 'phone',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    isCompact: breakpoint !== 'desktop',
    assumed,
  };
}

function read(): Viewport {
  if (typeof window === 'undefined') return viewportOf(SSR_WIDTH, SSR_HEIGHT, true);
  return viewportOf(window.innerWidth, window.innerHeight);
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() =>
    typeof window === 'undefined' ? viewportOf(SSR_WIDTH, SSR_HEIGHT, true) : read());

  useEffect(() => {
    // Coalesce to one update per frame while a window is being dragged:
    // without it a drag fires resize far faster than React can render, and
    // every consumer of this hook re-renders on each one.
    //
    // The flag is separate from the frame id ON PURPOSE. Writing
    // `frame = requestAnimationFrame(...)` and testing `if (frame)` looks
    // equivalent and is not: when the callback runs synchronously (a test
    // stub, or a browser that flushes during an event), the callback clears
    // the id BEFORE the assignment lands, the id is then written as truthy
    // and never cleared, and every later resize is dropped. The window then
    // silently stops re-laying-out, which is the exact failure this hook
    // exists to prevent.
    let pending = false;
    let frame = 0;
    const onResize = () => {
      if (pending) return;
      pending = true;
      frame = window.requestAnimationFrame(() => { pending = false; setVp(read()); });
    };
    // The window may already differ from the assumed width by the time the
    // effect runs (hydration, a restored window size), so read once here.
    setVp(read());
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return vp;
}
