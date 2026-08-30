// N8.1 (owner 2026-07-26): "The Node inspector should not have a dropdown where the
// user can configure the Technology" + the Configuration section states its empty
// contract instead of silently vanishing ("No configuration inputs — AI-selected
// defaults apply."). Source pins in the repo's established style — they fail if a
// refactor reintroduces the dropdown or drops the empty state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../ui/components/panels/SimplifiedInspector.tsx'),
  'utf-8',
);

describe('N8.1 inspector minimal', () => {
  it('has NO technology rebind select (technology is a creation-time choice)', () => {
    expect(src).not.toContain('Choose technology…');
    expect(src).not.toContain("updates: { technology:");
  });

  it('still renders the bound technology read-only with the nature line', () => {
    expect(src).toContain('deriveNodeNature(roleForTech, boundTech).line');
    expect(src).toContain('(custom)');
  });

  it('configuration is a per-node CHOICE: AI decides vs I’ll specify (N8.1b, owner-corrected)', () => {
    // Owner: "Give the user the option to allow AI to provide configuration or manual
    // inputs, but this has to be node by node, technology by technology dependent and
    // of high quality" — an explicit toggle, persisted OUTSIDE config so it never
    // renders as a packet line; NO generic free-text catch-all.
    expect(src).toContain("modeButton('ai', 'AI decides')");
    expect(src).toContain('I’ll specify');
    expect(src).toContain('configSource: next');
    expect(src).not.toContain('Configuration intent');
    expect(src).not.toContain('nextConfig.intent');
  });

  it('manual mode renders the technology’s CURATED fields; schema-less says so honestly', () => {
    expect(src).toContain('<DynamicMetadataForm');
    expect(src).toContain("config: { ...values, [key]: value }");
    expect(src).toContain('No curated fields for this technology yet');
  });

  it('existing config values imply manual mode (values always win over the toggle)', () => {
    // REVERSED 2026-07-30 (owner bug: "cannot click AI Decides" once values exist).
    // The values-win precedence pinned the toggle to manual; THE rule now lives in
    // core/src/config-choice.ts and the explicit choice wins.
    expect(src).toContain('resolveConfigChoice(node.metadata');
    expect(src).toContain("const source = choice === 'user-specified' ? 'manual' : 'ai'");
    expect(src).not.toContain("|| hasValues ? 'manual' : 'ai'");
  });
});

describe('N8.4a-4c options tolerance — 64 catalog rows declared type "string" WITH options', () => {
  const formSrc = readFileSync(
    resolve(__dirname, '../ui/components/panels/DynamicMetadataForm.tsx'),
    'utf-8',
  );
  it('options present ⇒ select renders regardless of declared type (reader tolerant; N8.3 gate normalizes data)', () => {
    expect(formSrc).toContain("field.options && field.options.length > 0 && field.type !== 'multiselect'");
    expect(formSrc).not.toContain("field.type === 'enum' && field.options");
  });
});

describe('N8.1b multiselect — "which parts of this service do you use" (Stripe apiAreas pattern)', () => {
  const formSrc = readFileSync(
    resolve(__dirname, '../ui/components/panels/DynamicMetadataForm.tsx'),
    'utf-8',
  );
  it('DynamicMetadataForm renders multiselect options as a checkbox list writing string[]', () => {
    expect(formSrc).toContain("field.type === 'multiselect' && field.options");
    expect(formSrc).toContain('selected.includes(opt)');
    expect(formSrc).toContain('selected.filter(s => s !== opt)');
  });
});
