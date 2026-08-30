// M5 — the canonical gate (NODE_REFERENCE §4 "M5"). Principle 1: "the final migration is
// canonical via our zod schema."
//
// These pin the two boundaries the catalog now passes through:
//   READ  — parseRole/parseTechnology. Lenient by design: a malformed row is SKIPPED and
//           reported, never thrown, because one bad row must not blank the canvas.
//   WRITE — validateCatalogFiling/validateTechnologyFiling. Strict by design: this is the
//           gate a node pack or a user-defined role goes through, and it is what makes the
//           model scalable without drift (§14.6) — identity is free, axes are not.
//
// The bench check this file implements: "inserting a row with nature='platform' or a
// dangling affinity fails". The DB CHECKs and triggers in 20260731190000 are the same rules
// one layer down; a guard nothing tests is a comment.
import { describe, it, expect } from 'vitest';
import {
  parseRole,
  parseTechnology,
  validateCatalogFiling,
  validateTechnologyFiling,
  NatureSchema,
  InterfaceKindSchema,
  RfVisualTypeSchema,
  SuggestedContractTokenSchema,
} from '@nodespec/core/catalog-schemas.js';

/** A minimal role row that passes, so each test can vary exactly one field. */
function role(over: Record<string, unknown> = {}) {
  return {
    id: 'backend-service',
    label: 'Backend Service',
    description: 'An HTTP service you author.',
    icon_name: 'server',
    color: '#2563eb',
    rf_visual_type: 'service',
    palette_category: 'Services',
    nature: 'build',
    interface_kind: 'service',
    is_container: false,
    can_contain: [],
    sort_order: 10,
    ...over,
  };
}

function tech(over: Record<string, unknown> = {}) {
  return {
    id: 'express',
    name: 'Express',
    role_affinities: ['backend-service'],
    ...over,
  };
}

const KNOWN = { knownRoleIds: new Set(['backend-service', 'worker', 'aws-lambda']) };

describe('M5 read boundary — parseRole', () => {
  it('accepts a well-formed row and applies the axis defaults', () => {
    const r = parseRole(role({ nature: undefined, interface_kind: undefined }));
    expect(r.ok).toBe(true);
    // absence means the DB column defaults, not undefined — mapRole relies on this
    expect(r.value?.nature).toBe('build');
    expect(r.value?.interface_kind).toBe('service');
  });

  it('REJECTS a retired axis value, and names the row', () => {
    // `platform` was a `kind` value; M1b collapsed kind into nature and it did not survive.
    const r = parseRole(role({ nature: 'platform' }));
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toContain('backend-service');
    expect(r.issues.join(' ')).toContain('nature');
  });

  it('REJECTS a palette_category outside the 14, and an unknown rf_visual_type', () => {
    expect(parseRole(role({ palette_category: 'Process' })).ok).toBe(false);
    expect(parseRole(role({ palette_category: 'Frontend' })).ok).toBe(false);
    // `database` is deliberately absent from the union: zero roles carry it and the static
    // fallback redirects it to `service`, so it was a declared-but-dead value.
    expect(parseRole(role({ rf_visual_type: 'database' })).ok).toBe(false);
    expect(RfVisualTypeSchema.safeParse('database').success).toBe(false);
  });

  it('is LENIENT — a bad row yields issues, never a throw', () => {
    expect(() => parseRole(null)).not.toThrow();
    expect(() => parseRole({ nonsense: true })).not.toThrow();
    expect(parseRole(null).ok).toBe(false);
    expect(parseRole({ nonsense: true }).issues.join(' ')).toContain('<no id>');
  });

  it('rejects an unknown key inside a can_contain rule object', () => {
    // `.strict()` — `kinds` and `functionalKinds` were dropped by M1c. A rule that still
    // carries them would silently admit nothing.
    expect(parseRole(role({ can_contain: { roleIds: ['worker'] } })).ok).toBe(true);
    expect(parseRole(role({ can_contain: { kinds: ['app_service'] } })).ok).toBe(false);
    expect(parseRole(role({ can_contain: { functionalKinds: ['compute'] } })).ok).toBe(false);
  });
});

describe('M5 read boundary — parseTechnology', () => {
  it('accepts a well-formed row and defaults the collection columns', () => {
    const t = parseTechnology(tech({ role_affinities: undefined }));
    expect(t.ok).toBe(true);
    expect(t.value?.role_affinities).toEqual([]);
    expect(t.value?.ai_context).toEqual({});
  });

  it('rejects a row with no id', () => {
    expect(parseTechnology(tech({ id: '' })).ok).toBe(false);
  });
});

describe('M5 write boundary — validateCatalogFiling (the triple must cohere)', () => {
  it('passes a coherent row', () => {
    expect(validateCatalogFiling(role(), KNOWN)).toEqual([]);
  });

  it('a host that is not a container is refused — a platform IS the boundary', () => {
    const errs = validateCatalogFiling(role({ nature: 'host', is_container: false }), KNOWN);
    expect(errs.join(' ')).toContain('is_container');
  });

  it('a `call` or `engine` container is refused — you do not author its internals', () => {
    for (const nature of ['call', 'engine']) {
      const errs = validateCatalogFiling(
        role({ nature, is_container: true, container_style: 'hosting', can_contain: ['worker'] }),
        KNOWN,
      );
      expect(errs.join(' ')).toContain('cannot be a container');
    }
  });

  it('a container must declare its style, and a non-container must not carry one', () => {
    expect(
      validateCatalogFiling(role({ is_container: true, can_contain: ['worker'] }), KNOWN).join(' '),
    ).toContain('container_style');
    expect(
      validateCatalogFiling(role({ container_style: 'hosting' }), KNOWN).join(' '),
    ).toContain('non-container');
  });

  it('container_layer must agree with container_style — the double-encoding cannot contradict', () => {
    // 2026-08-05 audit: the two columns encode hosting-vs-logical twice with no
    // cross-column constraint; a contradictory pair renders one truth in ContainerNode's
    // boundary styling and the other in its layer badge.
    expect(
      validateCatalogFiling(
        role({ is_container: true, container_style: 'hosting', container_layer: 'logical', can_contain: ['worker'] }),
        KNOWN,
      ).join(' '),
    ).toContain("contradicts container_style 'hosting'");
    expect(
      validateCatalogFiling(
        role({ is_container: true, container_style: 'logical-boundary', container_layer: 'runtime' }),
        KNOWN,
      ).join(' '),
    ).toContain("contradicts container_style 'logical-boundary'");
    // agreeing pairs pass both ways
    expect(
      validateCatalogFiling(
        role({ is_container: true, container_style: 'logical-boundary', container_layer: 'logical' }),
        KNOWN,
      ),
    ).toEqual([]);
    expect(
      validateCatalogFiling(
        role({ is_container: true, container_style: 'hosting', container_layer: 'runtime', can_contain: ['worker'] }),
        KNOWN,
      ),
    ).toEqual([]);
  });

  it('a hosting container that admits nothing is a dead box', () => {
    const errs = validateCatalogFiling(
      role({ nature: 'host', is_container: true, container_style: 'hosting', can_contain: [] }),
      KNOWN,
    );
    expect(errs.join(' ')).toContain('admits nothing');
  });

  it('a logical boundary may legitimately admit nothing declared', () => {
    const errs = validateCatalogFiling(
      role({ is_container: true, container_style: 'logical-boundary', can_contain: [] }),
      KNOWN,
    );
    expect(errs).toEqual([]);
  });

  it('can_contain must RESOLVE — both shapes', () => {
    expect(
      validateCatalogFiling(
        role({ is_container: true, container_style: 'hosting', can_contain: ['no-such-role'] }),
        KNOWN,
      ).join(' '),
    ).toContain('unknown role "no-such-role"');
    expect(
      validateCatalogFiling(
        role({ is_container: true, container_style: 'hosting', can_contain: { roleIds: ['ghost'] } }),
        KNOWN,
      ).join(' '),
    ).toContain('unknown role "ghost"');
  });

  it('suggested_contracts must speak the CURRENT interaction vocabulary', () => {
    // 9 of 14 seeded tokens were retired; M4 re-seeded them and this is what stops the drift
    // coming back. `event_publish` is the highest-count offender (20 rows).
    const errs = validateCatalogFiling(
      role({ suggested_contracts: ['event_publish', 'data_access', 'event'] }),
      KNOWN,
    );
    expect(errs).toHaveLength(2);
    expect(errs.join(' ')).toContain('event_publish');
    expect(errs.join(' ')).toContain('data_access');
    expect(SuggestedContractTokenSchema.safeParse('event').success).toBe(true);
  });

  it('surfaces the parse issues rather than the filing rules when the row will not parse', () => {
    const errs = validateCatalogFiling(role({ nature: 'platform' }), KNOWN);
    expect(errs.join(' ')).toContain('nature');
  });
});

describe('M5 write boundary — validateTechnologyFiling (the SILENT failure)', () => {
  it('passes a resolvable row', () => {
    expect(validateTechnologyFiling(tech(), KNOWN)).toEqual([]);
  });

  it('names a dangling affinity', () => {
    const errs = validateTechnologyFiling(tech({ role_affinities: ['backend-service', 'gone'] }), KNOWN);
    expect(errs.join(' ')).toContain('"gone" does not resolve');
  });

  it('calls out the INVISIBLE row — every affinity dead', () => {
    // This is how quartz / deno-edge / vercel-edge stayed unplaceable: the row looked fine
    // in the table, the builder just skipped it, and nothing raised anywhere.
    const errs = validateTechnologyFiling(tech({ role_affinities: ['scheduler'] }), KNOWN);
    expect(errs.join(' ')).toContain('INVISIBLE');
  });

  it('a row with no affinities at all can never be placed', () => {
    expect(validateTechnologyFiling(tech({ role_affinities: [] }), KNOWN).join(' '))
      .toContain('can never be placed');
    // …unless it is user-contributed, which is placed directly rather than browsed.
    expect(validateTechnologyFiling(tech({ role_affinities: [], is_user_contributed: true }), KNOWN))
      .toEqual([]);
  });
});

describe('M5 — the axis vocabularies are exactly what M1 collapsed them to', () => {
  it('nature is the 5 values, interface_kind the 7', () => {
    expect(NatureSchema.options).toEqual(['build', 'integrate', 'host', 'engine', 'call']);
    expect(InterfaceKindSchema.options).toEqual([
      'service', 'data', 'object_store', 'queue', 'event_bus', 'auth', 'telemetry',
    ]);
  });

  it('the retired `kind` and `functional_kind` values do not survive as natures', () => {
    for (const dead of ['app_service', 'platform', 'platform_capability', 'data_store', 'game']) {
      expect(NatureSchema.safeParse(dead).success).toBe(false);
    }
  });
});

// ── N8.3′ — the ai_context gate: the LAST unguarded catalog surface ────────────────────
// One dialect (the consumer-read key census), provenance-required enrichment, one
// metadata_schema shape. Dead keys are rejected BY NAME with the reason; the read
// boundary stays lenient (none of this can vanish a row from the palette).
describe('N8.3 ai_context write gate', () => {
  const PROV = { verifiedAt: '2026-08-09', method: 'live-docs', sources: ['https://example.com/docs'] };

  it('dialect-B keys are rejected BY NAME with the migration path', () => {
    const errs = validateTechnologyFiling(tech({ ai_context: { summary: 's', strengths: ['x'], limitations: ['y'] } }), KNOWN);
    expect(errs.some(e => e.includes('"summary"') && e.includes('dialect-B'))).toBe(true);
    expect(errs.some(e => e.includes('"strengths"') && e.includes('bestPractices'))).toBe(true);
    expect(errs.some(e => e.includes('"limitations"'))).toBe(true);
  });

  it('documentationUrls is rejected per the N8.3 ruling — apiReference.docsUrl is the surface', () => {
    const errs = validateTechnologyFiling(tech({ ai_context: { documentationUrls: ['https://x'] } }), KNOWN);
    expect(errs.some(e => e.includes('documentationUrls') && e.includes('apiReference.docsUrl'))).toBe(true);
  });

  it('an unknown free-form key is rejected (the assistantsApiNote class — keys that render nowhere are dead data)', () => {
    const errs = validateTechnologyFiling(tech({ ai_context: { assistantsApiNote: 'renders nowhere' } }), KNOWN);
    expect(errs.some(e => e.includes('ai_context') && /unrecognized/i.test(e))).toBe(true);
  });

  it('enrichment WITHOUT provenance is rejected, naming the payload keys', () => {
    const errs = validateTechnologyFiling(tech({ ai_context: { sdkInitPattern: 'init()' } }), KNOWN);
    expect(errs.some(e => e.includes('sdkInitPattern') && e.includes('NO provenance'))).toBe(true);
  });

  it('enrichment with MALFORMED provenance (no method) is rejected; valid provenance passes', () => {
    const bad = validateTechnologyFiling(tech({ ai_context: { configurationTemplate: 'cfg', provenance: { verifiedAt: '2026-08-09' } } }), KNOWN);
    expect(bad.some(e => e.includes('provenance is malformed'))).toBe(true);
    const good = validateTechnologyFiling(tech({
      ai_context: { configurationTemplate: 'cfg', apiReference: { docsUrl: 'https://d' }, provenance: PROV },
    }), KNOWN);
    expect(good).toEqual([]);
  });

  it('configMode speaks the classifier vocabulary; treatmentOverride admits ONLY boundary (anything else was a silent no-op)', () => {
    expect(validateTechnologyFiling(tech({ ai_context: { configMode: 'declarative', treatmentOverride: 'boundary' } }), KNOWN)).toEqual([]);
    expect(validateTechnologyFiling(tech({ ai_context: { configMode: 'serverless' } }), KNOWN)
      .some(e => e.includes('ai_context.configMode'))).toBe(true);
    expect(validateTechnologyFiling(tech({ ai_context: { treatmentOverride: 'leaf' } }), KNOWN)
      .some(e => e.includes('ai_context.treatmentOverride'))).toBe(true);
  });

  it('setupInstructions speak the SetupInstructionType vocabulary and require provenance like any enrichment', () => {
    const errs = validateTechnologyFiling(tech({
      ai_context: {
        setupInstructions: [{ title: 'T', type: 'not-a-type', instructions: 'do it', required: true }],
        provenance: PROV,
      },
    }), KNOWN);
    expect(errs.some(e => e.includes('setupInstructions') && e.includes('type'))).toBe(true);
  });

  it('metadata_schema: the flat field map passes; the JSON-schema dialect and shapeless entries are rejected', () => {
    expect(validateTechnologyFiling(tech({
      metadata_schema: {
        region: { type: 'enum', label: 'Region', options: ['us-east-1', 'eu-west-1'] },
        services: { type: 'multiselect', label: 'Services', options: ['db', 'auth'] },
        poolSize: { type: 'number', label: 'Pool size' },
      },
    }), KNOWN)).toEqual([]);
    const jsonSchema = validateTechnologyFiling(tech({
      metadata_schema: { properties: { region: { type: 'string' } }, required: ['region'] },
    }), KNOWN);
    expect(jsonSchema.some(e => e.includes('metadata_schema.properties'))).toBe(true);
    expect(jsonSchema.some(e => e.includes('metadata_schema.required'))).toBe(true);
  });

  it('metadata_schema: enum/multiselect without options and missing labels are named — the form would render an empty control', () => {
    const errs = validateTechnologyFiling(tech({
      metadata_schema: { region: { type: 'enum' } },
    }), KNOWN);
    expect(errs.some(e => e.includes('region') && e.includes('options'))).toBe(true);
    expect(errs.some(e => e.includes('region.label'))).toBe(true);
  });

  it('regression: a bare technology row (no ai_context, no metadata_schema) still files clean', () => {
    expect(validateTechnologyFiling(tech(), KNOWN)).toEqual([]);
  });
});
