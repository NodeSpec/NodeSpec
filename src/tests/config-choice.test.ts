// Owner bug 2026-07-30: "After I click 'I'll specify' in the inspector, and make a
// manual change, I cannot click 'AI Decides'."
//
// Root cause was NOT a dead button — the click wrote `configSource: 'ai'` every
// time, but every reader derived the mode as `configSource === 'manual' || hasValues`,
// so a single config value forced the derived mode back to manual on the very next
// render. The delegation was unreachable, not un-clickable.
//
// THE rule (core/src/config-choice.ts, mirrored server-side): an EXPLICIT choice
// wins; values only imply user-specified when NO choice was ever recorded (the
// back-compat path for nodes older than the toggle). Values are never destroyed by
// delegating, so the round-trip returns them intact.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveConfigChoice } from '@nodespec/core/config-choice.js';

describe('resolveConfigChoice — the one configuration-choice rule', () => {
  it('THE BUG: an explicit delegation wins even with values present', () => {
    expect(resolveConfigChoice({ configSource: 'ai', config: { memory: 512 } })).toBe('delegated');
  });

  it('round-trip: delegating keeps values, switching back restores user-specified', () => {
    const afterSpecifying = { configSource: 'manual', config: { memory: 512 } };
    expect(resolveConfigChoice(afterSpecifying)).toBe('user-specified');
    // user clicks "AI decides" — only configSource changes, values stay
    const afterDelegating = { ...afterSpecifying, configSource: 'ai' };
    expect(resolveConfigChoice(afterDelegating)).toBe('delegated');
    // user clicks "I'll specify" again — the values were never destroyed
    const afterReturning = { ...afterDelegating, configSource: 'manual' };
    expect(resolveConfigChoice(afterReturning)).toBe('user-specified');
    expect((afterReturning.config as Record<string, unknown>).memory).toBe(512);
  });

  it('explicit manual with no values yet is still user-specified', () => {
    expect(resolveConfigChoice({ configSource: 'manual' })).toBe('user-specified');
    expect(resolveConfigChoice({ configSource: 'manual', config: {} })).toBe('user-specified');
  });

  it('BACK-COMPAT: values with no recorded choice read as user-specified', () => {
    expect(resolveConfigChoice({ config: { memory: 512 } })).toBe('user-specified');
  });

  it('nothing chosen and nothing set is unchosen (the packet asks the user)', () => {
    expect(resolveConfigChoice({})).toBe('unchosen');
    expect(resolveConfigChoice(undefined)).toBe('unchosen');
    expect(resolveConfigChoice(null)).toBe('unchosen');
    expect(resolveConfigChoice({ config: {} })).toBe('unchosen');
  });

  it('an unrecognized configSource falls back to the value inference, never throws', () => {
    expect(resolveConfigChoice({ configSource: 'nonsense' })).toBe('unchosen');
    expect(resolveConfigChoice({ configSource: 'nonsense', config: { a: 1 } })).toBe('user-specified');
  });
});

describe('every surface reads THE rule (no surface can contradict another)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf-8');

  it('the inspector derives its toggle from resolveConfigChoice', () => {
    expect(read('ui/components/panels/SimplifiedInspector.tsx')).toContain('resolveConfigChoice(node.metadata');
  });

  it('the node context export never emits dormant values as chosen', () => {
    const src = read('ui/utils/export-context.ts');
    expect(src).toContain('resolveConfigChoice(meta)');
    expect(src).toContain("configuration: configChoice === 'delegated' ? undefined : config");
  });

  it('the client and server rule modules are mirrored verbatim', () => {
    const strip = (s: string) => s.replace(/MIRRORED at [^\n]*/, '').trim();
    const client = readFileSync(join(__dirname, '../../core/src/config-choice.ts'), 'utf-8');
    const server = readFileSync(join(__dirname, '../../supabase/functions/_shared/config-choice.ts'), 'utf-8');
    expect(strip(server)).toBe(strip(client));
  });
});
