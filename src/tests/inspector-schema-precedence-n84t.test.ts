// N8.4t — owner bench 2026-07-27: "AWS project 'I'll specify' in inspector still doesn't
// show anything."
//
// The DATA was correct: node_roles.aws/azure/gcp all carry a full metadata_schema. The
// inspector resolved it with `boundTech?.metadataSchema ?? roleRow?.metadataSchema`, and
// `??` only falls through on null/undefined. An unenriched technology row carries `{}`,
// which is neither — so an empty technology schema SHADOWED the role's real one and the
// panel said "No curated fields for this technology yet".
//
// Scope of the bug: every platform container node bound to `technology: 'aws' | 'azure' |
// 'gcp'` (those three rows are `{}` by construction — they are name-only rows), plus any
// of the 131 empty-schema technologies sitting on a schema-bearing role.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '../ui/components/panels/SimplifiedInspector.tsx'), 'utf-8');

/** Mirror of the shipped helper — kept in the test so the SEMANTIC is pinned, with a
 *  source assertion below tying it to the real implementation. */
function firstPopulatedSchema(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, unknown> | null {
  for (const src of sources) {
    if (src && Object.keys(src).length > 0) return src;
  }
  return null;
}

const ROLE_SCHEMA = { accountAlias: {}, primaryRegion: {}, environment: {} };
const TECH_SCHEMA = { runtime: {}, memorySize: {} };

describe('inspector schema precedence', () => {
  it('an EMPTY technology schema falls through to the role (the reported bug)', () => {
    // The AWS project container: technology 'aws' exists but is a name-only row.
    expect(firstPopulatedSchema({}, ROLE_SCHEMA, null)).toBe(ROLE_SCHEMA);
  });

  it('a populated technology schema still wins over the role', () => {
    expect(firstPopulatedSchema(TECH_SCHEMA, ROLE_SCHEMA, null)).toBe(TECH_SCHEMA);
  });

  it('null and undefined sources are skipped as before', () => {
    expect(firstPopulatedSchema(null, undefined, ROLE_SCHEMA)).toBe(ROLE_SCHEMA);
  });

  it('all-empty yields null, so the honest "no curated fields" line still shows', () => {
    expect(firstPopulatedSchema({}, {}, undefined)).toBeNull();
    expect(firstPopulatedSchema(null, null, null)).toBeNull();
  });

  it('the inspector uses this helper and no longer chains ?? across schemas', () => {
    expect(SRC).toContain('function firstPopulatedSchema(');
    expect(SRC).toContain('const schema = firstPopulatedSchema(');
    expect(SRC).not.toContain('boundTech?.metadataSchema ?? roleRow?.metadataSchema');
  });
});
