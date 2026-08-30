/*
  M5 — THE catalog read-boundary schema. Mirrored at
  core/src/catalog-schemas.ts (the enums.ts pattern).

  Principle 1: "the final migration is canonical via our zod schema."

  Until now the catalog was NOT schema-guarded at all. `node_roles` and `technology_catalog`
  rows were read with a raw `as` cast at the repository boundary, and the only enforcement
  anywhere was six DB CHECK constraints. That is precisely why the vocabulary columns
  drifted: `palette_category` accumulated 15 free-text values including a dead one,
  `suggested_contracts` accumulated 9 retired interaction tokens across 57 occurrences, and
  `technology_catalog.node_shape` held `cylinder` — a value outside its own declared TS union
  — while `rectangle`, a value the union declared, had zero rows.

  A cast cannot catch any of that. A schema can, and this is where it goes: at the boundary
  where DB rows become application objects, on BOTH runtimes, from the same definition.

  DESIGN NOTE — why this parses leniently rather than throwing.
  A malformed catalog row must not blank the canvas. `parseRole`/`parseTechnology` return
  `{ok, value, issues}`: valid rows flow through unchanged, invalid rows are reported and
  SKIPPED. The loader surfaces the issue count (the N9b-2 degraded-catalog banner already
  exists for exactly this class of failure). Strictness lives at the WRITE boundary instead —
  `validateCatalogFiling` below is the insert-time gate, and the DB CHECKs are the backstop.
*/
import { z } from "npm:zod@3.22.4";

// ── The four behavioral axes (M1) ──────────────────────────────────────────────────────
export const NatureSchema = z.enum(['build', 'integrate', 'host', 'engine', 'call']);
export const InterfaceKindSchema = z.enum([
  'service', 'data', 'object_store', 'queue', 'event_bus', 'auth', 'telemetry',
]);
export const ContainerStyleSchema = z.enum(['hosting', 'logical-boundary']);

/** M2: the display grouping. 13 values, no semantics — but a typo still drops a role out
 *  of a prompt section, so it is pinned like everything else. N11(b) 2026-08-09: the
 *  'requirements' member is SHED with its only role — requirements are spec-plane rows
 *  and Decomposition-canvas UI, never catalog citizens (the M5-pinned debt, repaid). */
export const PaletteCategorySchema = z.enum([
  'Services', 'Database', 'Networking', 'AI & ML', 'Messaging', 'Infrastructure',
  'Platform', 'Automation', 'External', 'Observability', 'Hardware',
  'Game Development', 'Logical',
]);

/** Render hint, NOT an ontology axis (NODE_REFERENCE §12.2). Pinned to the values that
 *  actually occur; `database` is deliberately absent — zero roles carry it and the static
 *  fallback redirects it to `service`, so it was a declared-but-dead value. */
export const RfVisualTypeSchema = z.enum([
  'service', 'icon', 'container', 'api', 'queue', 'cache', 'external', 'library',
]);

/** The CURRENT interaction vocabulary. `suggested_contracts` seeds must speak it (M4
 *  re-seeded them); retired tokens survive only as read-boundary tolerance for replayed
 *  hash-chained patches, never as stored catalog data. */
export const SuggestedContractTokenSchema = z.enum([
  'request_response', 'event', 'queue', 'data_read', 'data_write', 'data_sync',
  'file_transfer', 'auth', 'telemetry', 'ipc', 'dependency',
]);

export const CanContainRuleSchema = z.object({
  roleIds: z.array(z.string()).optional(),
  natures: z.array(NatureSchema).optional(),
  interfaceKinds: z.array(InterfaceKindSchema).optional(),
  providers: z.array(z.string()).optional(),
}).strict();

export const CanContainSchema = z.union([z.array(z.string()), CanContainRuleSchema]);

// ── ai_context: ONE dialect, gated at write (N8.3′) ────────────────────────────────────
// The consumer-read key census IS the schema — a key no consumer renders is dead data
// (the assistantsApiNote lesson). Dialect B (summary/strengths/limitations) reached zero
// rows 2026-07-28 (4h-2, export-verified by 4i-2) and is rejected BY NAME so it can never
// creep back. `documentationUrls` RULING (N8.3′, 2026-08-09): never adopted — no consumer
// reads it anywhere; apiReference.docsUrl is the rendered reference-URL surface. The READ
// boundary stays lenient (a legacy free-form key must never vanish a row from the
// palette); this schema is enforced ONLY by validateTechnologyFiling — the write gate —
// and by the enrichment-provenance DB trigger one layer down.
// NOTE: SetupInstructionTypeSchema must stay value-identical with SetupInstructionType in
// core/src/node-types.ts (the mirror file cannot import it, so it is declared here).
export const SetupInstructionTypeSchema = z.enum([
  'account_setup', 'dashboard_config', 'environment_variable', 'dns_config', 'webhook_config',
  'sdk_install', 'manual_workflow', 'billing', 'toolchain_install', 'certificate', 'permissions',
]);

/** N8.1c: who/when/where a row's curated enrichment was verified. 'model-knowledge' is
 *  legal and VISIBLE — honesty over fake rigor. */
export const AiContextProvenanceSchema = z.object({
  verifiedAt: z.string().min(1),
  method: z.enum(['live-docs', 'model-knowledge', 'vendor-import']),
  sources: z.array(z.string()).optional(),
  notes: z.string().optional(),
}).strict();

export const AiContextSchema = z.object({
  purpose: z.string().optional(),
  typicalTech: z.array(z.string()).optional(),
  bestPractices: z.array(z.string()).optional(),
  antiPatterns: z.array(z.string()).optional(),
  integrationPatterns: z.array(z.string()).optional(),
  securityGuidance: z.string().optional(),
  /** N8.4g: dated freshness facts — a RENDERED surface (packet + lookup). */
  freshnessNote: z.string().optional(),
  sdkInitPattern: z.string().optional(),
  commonApiPatterns: z.array(z.object({
    name: z.string(), codeTemplate: z.string(), description: z.string().optional(),
  }).strict()).optional(),
  configurationTemplate: z.string().optional(),
  setupInstructions: z.array(z.object({
    title: z.string(), type: SetupInstructionTypeSchema, instructions: z.string(),
    commands: z.array(z.string()).optional(), url: z.string().optional(), required: z.boolean(),
  }).strict()).optional(),
  testingPatterns: z.object({ framework: z.string().optional() }).passthrough().optional(),
  /** N8.1b: curated per-service API reference the node CARRIES (no external fetch). */
  apiReference: z.object({
    docsUrl: z.string().optional(),
    areas: z.record(z.string(), z.object({
      docsUrl: z.string().optional(), endpoints: z.array(z.string()).optional(),
    }).strict()).optional(),
  }).strict().optional(),
  /** Deliverable-kind override consumed by classifyNodeDeliverable — previously read
   *  everywhere via casts and declared NOWHERE (the N8.3′ divergence). */
  configMode: z.enum(['none', 'code', 'definition-as-code', 'declarative', 'external']).optional(),
  /** B10 lifecycle: rows kept for history but outside the enrichment program. 'retired'
   *  rows have no successor; a migrationTarget names the catalog row that replaced this
   *  one; 'platform-umbrella' marks provider container rows (aws/azure/gcp/supabase)
   *  pending the owner's dedicated-platform-bar ruling. */
  lifecycle: z.enum(['retired', 'platform-umbrella']).optional(),
  migrationTarget: z.string().optional(),
  /** 'boundary' is the only value effectiveTreatment honors; anything else was a
   *  silent no-op, which is exactly the drift class this gate exists to stop. */
  treatmentOverride: z.literal('boundary').optional(),
  provenance: AiContextProvenanceSchema.optional(),
}).strict();
export type AiContext = z.infer<typeof AiContextSchema>;

/** Enrichment payloads — curated operational content that must carry provenance, or the
 *  row is unauditable the day the vendor moves (N8.1c). */
export const AI_CONTEXT_ENRICHMENT_KEYS = ['apiReference', 'sdkInitPattern', 'configurationTemplate', 'setupInstructions'] as const;

const AI_CONTEXT_DEAD_KEYS: Record<string, string> = {
  summary: "dialect-B is retired (zero rows since 2026-07-28) — use 'purpose'",
  strengths: "dialect-B is retired — fold into 'bestPractices'",
  limitations: "dialect-B is retired — fold into 'antiPatterns' or 'freshnessNote'",
  documentationUrls: "never adopted (N8.3 ruling 2026-08-09) — apiReference.docsUrl is the reference-URL surface",
};

/** metadata_schema speaks ONE dialect: a flat field map (fieldName → descriptor). The
 *  July audit found FOUR incompatible shapes; the flat map is the only one
 *  DynamicMetadataForm renders — the others were invisible fields. */
const METADATA_FIELD_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'multiselect', 'array', 'object']);

// ── Rows ───────────────────────────────────────────────────────────────────────────────
export const NodeRoleRowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  icon_name: z.string(),
  color: z.string(),
  rf_visual_type: RfVisualTypeSchema,
  palette_category: PaletteCategorySchema,
  nature: NatureSchema.default('build'),
  interface_kind: InterfaceKindSchema.default('service'),
  provider: z.string().nullable().optional(),
  is_container: z.boolean(),
  container_layer: z.string().nullable().optional(),
  container_style: ContainerStyleSchema.nullable().optional(),
  can_contain: CanContainSchema.nullable().optional(),
  metadata_schema: z.record(z.string(), z.unknown()).nullable().optional(),
  default_ports: z.array(z.unknown()).default([]),
  suggested_contracts: z.array(z.unknown()).default([]),
  sort_order: z.number(),
  capability_tags: z.array(z.string()).default([]),
  when_to_use: z.string().nullable().optional(),
  default_technology: z.string().nullable().optional(),
  deprecated: z.boolean().nullable().optional(),
});

export const TechnologyRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon_url: z.string().nullable().optional(),
  brand_color: z.string().nullable().optional(),
  secondary_color: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  role_affinities: z.array(z.string()).default([]),
  ai_context: z.record(z.string(), z.unknown()).default({}),
  suggested_files: z.array(z.unknown()).nullable().optional(),
  metadata_schema: z.record(z.string(), z.unknown()).nullable().optional(),
  common_connections: z.array(z.unknown()).nullable().optional(),
  is_user_contributed: z.boolean().nullable().optional(),
  project_id: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
});

export interface ParseResult<T> {
  ok: boolean;
  value: T | null;
  /** Human-readable, row-identifying. Surfaced by the loader, never swallowed. */
  issues: string[];
}

function parse<S extends z.ZodTypeAny>(schema: S, row: unknown, kind: string): ParseResult<z.infer<S>> {
  const r = schema.safeParse(row);
  if (r.success) return { ok: true, value: r.data, issues: [] };
  const id = (row as { id?: unknown } | null)?.id ?? '<no id>';
  return {
    ok: false,
    value: null,
    issues: r.error.issues.map(i => `${kind} "${String(id)}": ${i.path.join('.')} — ${i.message}`),
  };
}

export function parseRole(row: unknown): ParseResult<z.infer<typeof NodeRoleRowSchema>> {
  return parse(NodeRoleRowSchema, row, 'node_role');
}

export function parseTechnology(row: unknown): ParseResult<z.infer<typeof TechnologyRowSchema>> {
  return parse(TechnologyRowSchema, row, 'technology');
}

// ── The insert-time filing gate (N8's `validateCatalogFiling`) ─────────────────────────

export interface FilingContext {
  /** Every role id that exists, so affinities and can_contain can be checked to resolve. */
  knownRoleIds: ReadonlySet<string>;
}

/**
 * THE gate a node pack or a user-defined role must pass. This is what makes the model
 * scalable without drift (NODE_REFERENCE §14.6): a pack author can add IDENTITY freely, but
 * cannot invent, mis-file, or drift an axis, because a row is only valid as a coherent
 * `(nature, containment, interface_kind)` triple whose references all resolve.
 */
export function validateCatalogFiling(
  row: unknown,
  ctx: FilingContext = { knownRoleIds: new Set() },
): string[] {
  const parsed = parseRole(row);
  if (!parsed.ok || !parsed.value) return parsed.issues;

  const r = parsed.value;
  const errors: string[] = [];
  const where = `node_role "${r.id}"`;

  // ── the triple must be coherent ──────────────────────────────────────────────────────
  // A `host` IS the hosting boundary — it cannot be a leaf.
  if (r.nature === 'host' && !r.is_container) {
    errors.push(`${where}: nature 'host' requires is_container (a platform IS a container)`);
  }
  // `call` and `engine` are things you never author the internals of, so they hold nothing.
  if ((r.nature === 'call' || r.nature === 'engine') && r.is_container) {
    errors.push(`${where}: nature '${r.nature}' cannot be a container — you do not author its internals`);
  }
  // A container must declare its style, or nothing can tell hosting from organizational —
  // and that distinction decides whether it gets a provisioning packet or none at all.
  if (r.is_container && !r.container_style) {
    errors.push(`${where}: containers must set container_style ('hosting' or 'logical-boundary')`);
  }
  if (!r.is_container && r.container_style) {
    errors.push(`${where}: container_style is set on a non-container`);
  }
  // `container_layer` is a render hint (M1c kept it), but it double-encodes the
  // hosting-vs-logical split — a contradictory pair renders one truth in one component
  // and the other truth in the next. The pair must agree.
  if (r.is_container && r.container_layer === 'logical' && r.container_style === 'hosting') {
    errors.push(`${where}: container_layer 'logical' contradicts container_style 'hosting'`);
  }
  if (r.is_container && r.container_layer && r.container_layer !== 'logical' && r.container_style === 'logical-boundary') {
    errors.push(`${where}: container_layer '${r.container_layer}' contradicts container_style 'logical-boundary'`);
  }

  // ── references must resolve ──────────────────────────────────────────────────────────
  if (ctx.knownRoleIds.size > 0 && r.can_contain) {
    const ids = Array.isArray(r.can_contain) ? r.can_contain : (r.can_contain.roleIds ?? []);
    for (const id of ids) {
      if (!ctx.knownRoleIds.has(id)) {
        errors.push(`${where}: can_contain references unknown role "${id}"`);
      }
    }
  }

  // ── a container that admits nothing is a dead box ────────────────────────────────────
  if (r.is_container && r.container_style === 'hosting') {
    const cc = r.can_contain;
    const empty = !cc
      || (Array.isArray(cc) && cc.length === 0)
      || (!Array.isArray(cc) && !cc.roleIds?.length && !cc.natures?.length
          && !cc.interfaceKinds?.length && !cc.providers?.length);
    if (empty) errors.push(`${where}: hosting container admits nothing — no can_contain rule is populated`);
  }

  // ── suggested_contracts must speak the current vocabulary ────────────────────────────
  for (const c of r.suggested_contracts) {
    if (typeof c === 'string' && !SuggestedContractTokenSchema.safeParse(c).success) {
      errors.push(`${where}: suggested_contracts token "${c}" is not a current interaction kind`);
    }
  }

  return errors;
}

/** Affinity integrity for a technology row — the failure mode that is otherwise SILENT:
 *  a technology whose affinities do not resolve simply vanishes from the palette. */
export function validateTechnologyFiling(row: unknown, ctx: FilingContext): string[] {
  const parsed = parseTechnology(row);
  if (!parsed.ok || !parsed.value) return parsed.issues;

  const t = parsed.value;
  const errors: string[] = [];
  const where = `technology "${t.id}"`;

  if (ctx.knownRoleIds.size > 0) {
    const live = t.role_affinities.filter(a => ctx.knownRoleIds.has(a));
    for (const a of t.role_affinities) {
      if (!ctx.knownRoleIds.has(a)) errors.push(`${where}: role_affinity "${a}" does not resolve`);
    }
    if (t.role_affinities.length > 0 && live.length === 0) {
      errors.push(`${where}: no affinity resolves — the row would be INVISIBLE in the palette`);
    }
  }
  if (t.role_affinities.length === 0 && !t.is_user_contributed) {
    errors.push(`${where}: no role_affinities — the row can never be placed`);
  }

  // ── ai_context: ONE dialect + provenance-required enrichment (N8.3′) ─────────────────
  const ai = (t.ai_context ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(ai)) {
    if (k in AI_CONTEXT_DEAD_KEYS) errors.push(`${where}: ai_context key "${k}" — ${AI_CONTEXT_DEAD_KEYS[k]}`);
  }
  const aiLive = Object.fromEntries(Object.entries(ai).filter(([k]) => !(k in AI_CONTEXT_DEAD_KEYS)));
  const aiParsed = AiContextSchema.safeParse(aiLive);
  if (!aiParsed.success) {
    for (const i of aiParsed.error.issues) {
      errors.push(`${where}: ai_context.${i.path.join('.') || '(root)'} — ${i.message}`);
    }
  }
  const enrichment = AI_CONTEXT_ENRICHMENT_KEYS.filter((k) => aiLive[k] !== undefined);
  if (enrichment.length > 0) {
    if (aiLive['provenance'] === undefined) {
      errors.push(`${where}: enrichment payload (${enrichment.join(', ')}) carries NO provenance — stamp { verifiedAt, method: 'live-docs' | 'model-knowledge' | 'vendor-import', sources?, notes? }`);
    } else if (!AiContextProvenanceSchema.safeParse(aiLive['provenance']).success) {
      errors.push(`${where}: enrichment provenance is malformed — verifiedAt and a valid method are required`);
    }
  }

  // ── metadata_schema: the ONE flat field-map dialect ──────────────────────────────────
  if (t.metadata_schema !== null && t.metadata_schema !== undefined) {
    for (const [field, def] of Object.entries(t.metadata_schema)) {
      if (typeof def !== 'object' || def === null || Array.isArray(def)) {
        errors.push(`${where}: metadata_schema.${field} is not a field descriptor — ONE shape only: fieldName → { type, label, ... } (no JSON-schema 'properties', no 'fields' lists)`);
        continue;
      }
      const d = def as Record<string, unknown>;
      if (typeof d.type !== 'string' || !METADATA_FIELD_TYPES.has(d.type)) {
        errors.push(`${where}: metadata_schema.${field}.type "${String(d.type)}" is not a field type (${[...METADATA_FIELD_TYPES].join(', ')})`);
      }
      if (typeof d.label !== 'string' || d.label.length === 0) {
        errors.push(`${where}: metadata_schema.${field}.label is required — the inspector renders it`);
      }
      if ((d.type === 'enum' || d.type === 'multiselect') && (!Array.isArray(d.options) || d.options.length === 0)) {
        errors.push(`${where}: metadata_schema.${field} (${String(d.type)}) needs non-empty options — the form would render an empty control`);
      }
    }
  }

  return errors;
}

/*
  ═══════════════════════════════════════════════════════════════════════════════════════
  N10(b) — THE GTM-READY BAR (owner 2026-07-25: "as we enrich each node with reference
  data for how an AI will read it … we have to maintain consistency").

  Defined ONCE, here, so the enrichment tracker, the coverage sweep, and the import lane
  cannot diverge on what "done" means for a technology row. This is an ASSESSOR, not a
  write gate: legacy-thin rows must keep saving (the bar is the enrichment program's
  definition of done, burned down chunk by chunk) — validateTechnologyFiling stays the
  gate for CORRECTNESS, this measures COMPLETENESS.
  ═══════════════════════════════════════════════════════════════════════════════════════
*/

/** configModes whose configuration lives in the user's repo — the packet's Suggested
 *  Files section is real work product for these, so the bar demands suggested_files. */
const CODE_BEARING_CONFIG_MODES = new Set(['code', 'definition-as-code', 'declarative']);

export interface GtmReadinessOptions {
  /** ISO timestamp treated as "now" for provenance-age math. Callers pass it (scripts,
   *  tests) so the assessor stays deterministic. */
  now?: string;
  /** Provenance freshness window in days (owner-suggested default ≤6 months). */
  freshWindowDays?: number;
  /** Top-tier technologies additionally require method 'live-docs' AND a fresh
   *  verifiedAt (N8.1c). Non-top-tier rows only need provenance to EXIST. */
  topTier?: boolean;
}

export interface GtmReadinessResult {
  ready: boolean;
  /** Named gaps, one per failed bar line — each is an enrichment-tracker work item. */
  missing: string[];
  /** 'fresh-live-docs' | 'fresh' | 'stale' | 'unverified' — reported for every row so
   *  the coverage sweep can rank the re-verification backlog. */
  provenanceStatus: string;
  /** B10: set when the row is outside the enrichment program — 'migrated' (a
   *  migrationTarget names the successor), 'retired' (no successor), or
   *  'platform-umbrella' (provider container pending a dedicated platform bar).
   *  Exempt rows report ready with no gaps; coverage tooling lists them apart. */
  exempt?: 'migrated' | 'retired' | 'platform-umbrella';
}

/** The GTM bar for one technology row. Input is the RAW row shape (post-parse); the
 *  caller decides tiering. Every `missing` entry is phrased as the work to do. */
export function assessTechnologyGtmReadiness(
  row: { id: string; ai_context?: unknown; metadata_schema?: unknown; suggested_files?: unknown },
  opts: GtmReadinessOptions = {},
): GtmReadinessResult {
  const ai = (row.ai_context ?? {}) as Record<string, unknown>;
  const missing: string[] = [];

  // ── B10 lifecycle exemptions: a migrated/retired row is not an enrichment work
  //    item, and the platform umbrellas await their own bar — report them exempt
  //    instead of forever-failing, so the coverage metric measures real work.
  const migrationTarget = typeof ai.migrationTarget === 'string' && ai.migrationTarget.length > 0
    ? ai.migrationTarget : undefined;
  const lifecycle = typeof ai.lifecycle === 'string' ? ai.lifecycle : '';
  if (migrationTarget || lifecycle === 'retired' || lifecycle === 'platform-umbrella') {
    const exemptProv = ai.provenance as { verifiedAt?: unknown; method?: unknown } | undefined;
    const exemptStatus = exemptProv && typeof exemptProv.verifiedAt === 'string' && typeof exemptProv.method === 'string'
      ? (exemptProv.method === 'live-docs' ? 'fresh-live-docs' : 'fresh')
      : 'unverified';
    return {
      ready: true,
      missing: [],
      provenanceStatus: exemptStatus,
      exempt: migrationTarget ? 'migrated' : lifecycle === 'retired' ? 'retired' : 'platform-umbrella',
    };
  }

  if (typeof ai.purpose !== 'string' || ai.purpose.trim().length === 0) {
    missing.push('purpose: one paragraph of what this technology is FOR');
  }
  if (typeof ai.configMode !== 'string') {
    missing.push('configMode: none | code | definition-as-code | declarative | external');
  }
  const apiRef = ai.apiReference as { docsUrl?: unknown } | undefined;
  if (typeof apiRef?.docsUrl !== 'string' || apiRef.docsUrl.length === 0) {
    missing.push('apiReference.docsUrl: at least one reference URL');
  }
  if (typeof ai.sdkInitPattern !== 'string' && typeof ai.configurationTemplate !== 'string') {
    missing.push('sdkInitPattern OR configurationTemplate: one concrete starting point');
  }
  if (!Array.isArray(ai.bestPractices) || ai.bestPractices.length < 3) {
    missing.push('bestPractices: at least 3');
  }
  if (!Array.isArray(ai.antiPatterns) || ai.antiPatterns.length < 3) {
    missing.push('antiPatterns: at least 3');
  }
  if (typeof ai.securityGuidance !== 'string' || ai.securityGuidance.trim().length === 0) {
    missing.push('securityGuidance: the security posture a generating AI must respect');
  }
  if (ai.configMode === 'external' && (!Array.isArray(ai.setupInstructions) || ai.setupInstructions.length === 0)) {
    missing.push('setupInstructions: console-configured technology with no setup steps');
  }
  if (typeof ai.configMode === 'string' && CODE_BEARING_CONFIG_MODES.has(ai.configMode)
      && (!Array.isArray(row.suggested_files) || row.suggested_files.length === 0)) {
    missing.push('suggested_files: code-bearing configMode with no file suggestions');
  }

  // ── provenance (N8.1c): presence for everyone; fresh live-docs for the top tier ──────
  let provenanceStatus = 'unverified';
  const prov = ai.provenance as { verifiedAt?: unknown; method?: unknown } | undefined;
  if (prov && typeof prov.verifiedAt === 'string' && typeof prov.method === 'string') {
    const windowDays = opts.freshWindowDays ?? 183;
    const verified = Date.parse(prov.verifiedAt);
    const nowMs = opts.now ? Date.parse(opts.now) : NaN;
    const isFresh = Number.isFinite(verified) && Number.isFinite(nowMs)
      ? nowMs - verified <= windowDays * 24 * 60 * 60 * 1000
      : true; // no `now` supplied → age is unknowable; presence carries the check
    provenanceStatus = !isFresh ? 'stale' : prov.method === 'live-docs' ? 'fresh-live-docs' : 'fresh';
  } else {
    missing.push('provenance: { verifiedAt, method } — unauditable the day the vendor moves');
  }
  if (opts.topTier) {
    if (provenanceStatus === 'stale') missing.push(`provenance.verifiedAt: older than the ${opts.freshWindowDays ?? 183}-day window (top tier)`);
    if (provenanceStatus === 'fresh') missing.push("provenance.method: top-tier rows require 'live-docs' verification");
  }

  return { ready: missing.length === 0, missing, provenanceStatus };
}
