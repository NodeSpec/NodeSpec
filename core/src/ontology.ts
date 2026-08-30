/*
  N1 — the canonical node identity model, as code (V2_PLAN §1.C).
  M1b — collapsed onto `nature` (docs/NODE_REFERENCE.md §1).

  A node = ROLE (identity; open set) + optional TECHNOLOGY (open set, bound via
  role_affinities) + graph position.

  ONE stored behavioral axis answers "who runs this, and do you author it":

      nature = build | integrate | host | engine | call

  Everything else about that question DERIVES from it:
  - TREATMENT (leaf | container | boundary) = nature + is_container. `build` is the only
    nature you author, so it is the only leaf; a container is structural regardless.
  - OWNERSHIP (build | integrate | host | call) — in-graph it also folds in structure (who
    parents/hosts the node); at palette time it falls straight out of nature.

  `nature` replaces the former `kind` (13 values) + `treatment_mode` (3). Only four of the
  thirteen kinds were ever read by a consumer; the other nine — including `app_service`,
  which was 51 of 109 live roles — keyed off nothing that `interface_kind` + `is_container`
  did not already say. The collapse was verified lossless against the live catalog before it
  shipped: nature + is_container reproduced treatment_mode on 125/125 rows, and nature
  reproduced the old kind-based ownership default on 125/125.

  The former `altitude` axis is GONE, not moved. Its only reader tested `=== 'component'`,
  a band that was deliberately never populated, so the value it stored was never read by
  anything. Zoom banding is viewport state (src/ui/utils/semantic-zoom.ts), not a role axis.

  OWNERSHIP IS STILL DERIVED, NEVER STORED. The same technology shifts ownership per project
  (Airflow self-hosted = build vs Cloud Composer = integrate) and multi-domain products
  (Supabase) make any single stored value wrong. Derived values cannot drift — and they
  survive the git anchor, because STRUCTURE crosses into model.json while metadata does not.

  This module is mirrored at supabase/functions/_shared/ontology.ts (Deno). The two
  implementations are pinned to the same golden fixture (supabase/functions/tests/fixtures/
  ontology-golden.json) — change one, and the other side's suite tells you.
*/

/** What a node IS, and therefore who runs it and whether you author its internals. */
export type NodeNature = 'build' | 'integrate' | 'host' | 'engine' | 'call';

/**
 * What an edge INTO this node MEANS — the connect-time contract-birth axis (N8.6A).
 * Replaces `functional_kind`, dropping the five values (compute, edge_runtime, deployment,
 * ai_runtime, infrastructure) that all resolved to the same rest/request_response fallback
 * and therefore made a filing distinction the system did not actually have.
 */
export type InterfaceKind =
  | 'service' | 'data' | 'object_store' | 'queue' | 'event_bus' | 'auth' | 'telemetry';

/**
 * Who runs the thing, in-graph. `engine` is deliberately absent: an engine you configure is
 * still yours to operate, so it owns as `build` — the engine-ness shows up in TREATMENT
 * (you never author its internals), not in ownership.
 */
export type OwnershipMode = 'build' | 'integrate' | 'host' | 'call';

export type TreatmentMode = 'leaf' | 'container' | 'boundary';

export interface RoleAxesInput {
  /** The role's stored nature. Absent is treated as 'build' — the column default. */
  nature?: NodeNature | string | null;
  is_container?: boolean | null;
}

/**
 * A role's treatment, derived. MUST match the M1a migration SQL and the
 * `node_roles_nature_containment_check` constraint.
 *
 * Boundary = you configure and connect it but never author its internals: managed
 * capabilities (`integrate`), engines that own their insides (`engine`), and third-party
 * systems (`call`). `build` is the only nature whose code you write, so it is the only leaf.
 */
export function treatmentForRole(r: RoleAxesInput): TreatmentMode {
  if (r.is_container) return 'container';
  return (r.nature ?? 'build') === 'build' ? 'leaf' : 'boundary';
}

/**
 * A node's EFFECTIVE treatment (N2.2). Treatment is partly technology-dependent: a role
 * authored as code (a data pipeline written in Python) is a `leaf`, but the SAME role
 * implemented with an engine that owns its internals (n8n / NiFi / Airflow) is a `boundary`.
 * The role carries the DEFAULT; a boundary-engine TECHNOLOGY can raise it.
 *
 * Rules: a container role is structural and never overridden; otherwise the technology
 * override wins, else the role default, else leaf. The override only expresses `boundary` —
 * a technology never demotes an intrinsically-boundary role (an `integrate` or `call` role)
 * to a leaf.
 */
export function effectiveTreatment(
  roleTreatment?: TreatmentMode | null,
  techTreatmentOverride?: string | null,
): TreatmentMode {
  if (roleTreatment === 'container') return 'container';
  if (techTreatmentOverride === 'boundary') return 'boundary';
  return roleTreatment ?? 'leaf';
}

/** Convenience: role → effective treatment in one step, without the caller reading a column. */
export function effectiveTreatmentForRole(
  role: RoleAxesInput,
  techTreatmentOverride?: string | null,
): TreatmentMode {
  return effectiveTreatment(treatmentForRole(role), techTreatmentOverride);
}

/** Palette-time ownership default (no node exists yet): purely from the role's nature. */
export function paletteOwnershipDefault(nature?: NodeNature | string | null): OwnershipMode {
  switch (nature) {
    case 'host': return 'host';
    case 'integrate': return 'integrate';
    case 'call': return 'call';
    // 'engine' and 'build' both own as build — see OwnershipMode.
    default: return 'build';
  }
}

export interface OwnershipContext {
  /** nature of the node's own role. */
  nature?: NodeNature | string | null;
  /** nature of the parent node's role, when parented. */
  parentNature?: NodeNature | string | null;
}

/**
 * In-graph ownership, derived from structure. Precedence:
 *  1. `call` role        -> call      (consumed by contract, full stop)
 *  2. `host` role        -> host      (it IS the hosting boundary)
 *  3. `integrate` role   -> integrate (a provider-operated capability by definition)
 *  4. hosted placement (hosts | deployed_to, or a `host` parent) -> integrate
 *  5. otherwise          -> build
 */
export function deriveOwnership(
  node: { parentId?: string | null; placementKind?: string | null },
  ctx: OwnershipContext,
): OwnershipMode {
  if (ctx.nature === 'call') return 'call';
  if (ctx.nature === 'host') return 'host';
  if (ctx.nature === 'integrate') return 'integrate';
  if (node.parentId) {
    if (node.placementKind === 'hosts' || node.placementKind === 'deployed_to') return 'integrate';
    if (ctx.parentNature === 'host') return 'integrate';
  }
  return 'build';
}
