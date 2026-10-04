// Rendering React Flow under jsdom.
//
// jsdom implements no layout, and React Flow measures: it needs a
// ResizeObserver, a DOMMatrix for the viewport transform, and elements that
// report a non-zero box. Without these the canvas mounts with zero dimensions
// and renders nothing to assert against. These are the shims React Flow's own
// testing guidance calls for, kept in one place because all three canvases
// need them.
//
// NOTE what jsdom does NOT do: it never honours `pointer-events: none` when
// dispatching events. A click test alone would pass straight through the bug
// this file exists to catch, so the pointer-events contract is asserted on the
// node wrapper's own inline style — which is where React Flow writes it.
import { ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { ThemeProvider } from '../../ui/theme/ThemeContext.js';

export function installReactFlowShims(): void {
  class ResizeObserverStub {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

  class DOMMatrixStub {
    m22 = 1;
    constructor(readonly transform?: string) {}
  }
  (globalThis as Record<string, unknown>).DOMMatrixReadOnly ??= DOMMatrixStub;
  (globalThis as Record<string, unknown>).DOMMatrix ??= DOMMatrixStub;

  if (!(globalThis as Record<string, unknown>).__rfBoxPatched) {
    (globalThis as Record<string, unknown>).__rfBoxPatched = true;
    // CAUTION: this shim makes every element report a usable box, which is
    // what React Flow needs to render here at all — and it is also BLIND to
    // a container that collapses in a real browser. `clamp(...)` and any
    // other non-numeric height fall through to 800, so a stage sized to zero
    // by flex-basis still measures tall in jsdom. A canvas that must be tall
    // has to assert its own style (see workflow-first-run.test.tsx), not its
    // measured height.
    Object.defineProperties(globalThis.HTMLElement.prototype, {
      offsetHeight: { get() { return parseFloat(this.style.height) || 800; } },
      offsetWidth: { get() { return parseFloat(this.style.width) || 1200; } },
    });
    (globalThis.SVGElement as unknown as { prototype: Record<string, unknown> }).prototype.getBBox =
      () => ({ x: 0, y: 0, width: 0, height: 0 });
  }
}

/** A canvas needs a themed tree; nothing here talks to Supabase. */
export function renderCanvas(ui: ReactNode): RenderResult {
  installReactFlowShims();
  return render(<ThemeProvider defaultMode="light" readOnly>{ui}</ThemeProvider>);
}

/** React Flow stamps each node wrapper `rf__node-<id>`; the inline
 *  `pointer-events` it writes there is what decides whether anything inside
 *  the node can be clicked at all. */
export function nodeWrapper(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="rf__node-${id}"]`);
  if (!el) throw new Error(`no node wrapper for "${id}" — rendered: ${[...container.querySelectorAll('[data-id]')].map((n) => n.getAttribute('data-id')).join(', ') || 'none'}`);
  return el;
}

export const pointerEventsOf = (el: HTMLElement): string => el.style.pointerEvents;
