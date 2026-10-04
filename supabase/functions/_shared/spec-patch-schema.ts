// V3 P2 (task 2.3): the spec-plane patch vocabulary — the representations
// that give the design's four approval kinds (requirement | outcome |
// patch | workflow) a lane through ai_proposals. The GRAPH union in
// patch-schema.ts stays exactly as it is: these are a SEPARATE
// discriminated union so the graph apply engine never sees a spec op and
// its thirty type pins never move. The proposal store carries both;
// AnyProposalPatchSchema is the widened parse the change router (task 2.4)
// switches propose_patches to — until then nothing accepts these over MCP,
// so this module is pure capability, zero behavior change.
//
// Kind derivation is a TABLE, not branches (the repo's rules-as-rows
// doctrine): SPEC_PATCH_KIND maps every spec op to its approval kind, and
// patchKindOf() folds graph ops to 'patch'. NEVER_AUTO_APPLY carries the
// one doctrine the router must enforce at every autonomy level: promotion
// is a human act — a promote_candidate patch may travel the proposal lane
// only, never the auto-apply lane.
import { z } from "npm:zod@3.22.4";
import { PatchMetadataSchema, PatchOperationSchema } from "./patch-schema.ts";
import { CONSTRAINT_TYPES } from "./constraint-identity.ts";
import { CHECK_SEVERITIES } from "./constraint-rules.ts";

/** Mirrors requirements.ts CriterionInput: string, or { text, verification }. */
export const CriterionInputSchema = z.union([
  z.string().min(1),
  z.object({
    // v3l: a stable id so derivations can claim it; minted at write when absent.
    id: z.string().min(1).max(64).optional(),
    text: z.string().min(1),
    verification: z.enum(["automated", "manual"]).optional(),
  }),
]);

const RequirementCategorySchema = z.enum(["functional", "non-functional", "technical", "business"]);
const RequirementStatusSchema = z.enum(["pending", "in-progress", "implemented", "validated", "blocked"]);

// ── requirement kind ─────────────────────────────────────────────────────────

export const CreateRequirementPatchSchema = z.object({
  type: z.literal("create_requirement"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    category: RequirementCategorySchema.optional(),
    criteria: z.array(CriterionInputSchema).optional(),
    section: z.string().min(1).optional(),
    /** 7.3 (Government): a classification mark such as 'CUI' or 'CUI//SP-PRVCY'. */
    mark: z.string().nullable().optional(),
  }),
});

export const UpdateRequirementPatchSchema = z.object({
  type: z.literal("update_requirement"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    requirementId: z.string().min(1), // REQ-xxx or row UUID
    changes: z.object({
      name: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      category: RequirementCategorySchema.optional(),
      status: RequirementStatusSchema.optional(),
      criteria: z.array(CriterionInputSchema).optional(),
      /** 7.3 (Government): a classification mark; null clears it. */
      mark: z.string().nullable().optional(),
      /** 9.8 (v3y): the explicit archive — true sets archived_at, false clears it. */
      archived: z.boolean().optional(),
    }),
  }),
});

export const DeleteRequirementPatchSchema = z.object({
  type: z.literal("delete_requirement"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    requirementId: z.string().min(1),
    force: z.boolean().optional(),
  }),
});

export const UpdateVisionPatchSchema = z.object({
  type: z.literal("update_vision"),
  metadata: PatchMetadataSchema,
  payload: z.object({ vision: z.string().min(1) }),
});

export const MapRequirementPatchSchema = z.object({
  type: z.literal("map_requirement"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    requirementId: z.string().min(1),
    nodeIds: z.array(z.string().uuid()),
    mode: z.enum(["add", "remove", "replace"]).optional(),
    mappingType: z.enum(["implements", "depends_on", "validates", "supports"]).optional(),
    branchId: z.string().uuid().optional(),
  }),
});

export const RelateRequirementsPatchSchema = z.object({
  type: z.literal("relate_requirements"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    fromRequirementId: z.string().min(1),
    toRequirementId: z.string().min(1),
    relationType: z.enum(["expands", "depends_on", "relates_to"]),
    mode: z.enum(["add", "remove"]).optional(),
    notes: z.string().optional(),
  }),
});

// Z (owner 2026-09-23): a standing constraint (project_constraints), filed
// by the agent the way the app files one. Project-wide on every plan; scoped
// to one workflow (workflowId, or workflowName for a lane made earlier in the
// same proposal) on Indie and above, checked at propose, at apply and by the
// database. It rides the requirement kind: a constraint is spec, like the
// vision, and answers to the Requirements autonomy lane.
// R.2b (owner 2026-09-24): a check is one predicate of a closed vocabulary,
// evaluated on the graph; its scope and parameters are the project's own.
const Severity = z.enum(CHECK_SEVERITIES);
export const CheckSpecSchema = z.discriminatedUnion("predicate", [
  z.object({ predicate: z.literal("contract_has_schema"), severity: Severity }),
  z.object({ predicate: z.literal("no_calls_between_roles"), severity: Severity, params: z.object({ from: z.string().min(1), to: z.string().min(1) }) }),
  z.object({ predicate: z.literal("technology_in_list"), severity: Severity, params: z.object({ technologies: z.array(z.string().min(1)).min(1).max(50) }) }),
  z.object({ predicate: z.literal("sync_calls_at_most"), severity: Severity, params: z.object({ max: z.number().int().min(0).max(100) }) }),
]);

/** R.2b: who a constraint holds for, other than the project or one workflow. */
export const ConstraintScopeSchema = z.object({
  kind: z.enum(["role", "technology", "contract_kind", "node"]),
  value: z.string().min(1),
});

/** R.2c: where a constraint came from in this project. */
export const ConstraintOriginSchema = z.object({
  source: z.enum(["review", "recurring_gap", "implementation_context"]),
  proposalId: z.string().uuid().optional(),
  gap: z.string().min(1).max(80).optional(),
  nodeIds: z.array(z.string().min(1)).max(50).optional(),
});

export const CreateConstraintPatchSchema = z.object({
  type: z.literal("create_constraint"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    ctype: z.enum(CONSTRAINT_TYPES),
    /** The constraint itself; with ctype, its identity (a second filing is refused as already recorded). */
    description: z.string().min(1),
    /** The rule in a few words, when it has a short name. */
    title: z.string().min(1).optional(),
    /** Why it holds. */
    rationale: z.string().optional(),
    workflowId: z.string().uuid().optional(),
    workflowName: z.string().min(1).optional(),
    /** R.2b: guidance (default) rides into the packets in scope; a check is evaluated. */
    kind: z.enum(["guide", "check"]).optional(),
    /** R.2b: a role, technology, contract kind or node instead of the project. */
    scope: ConstraintScopeSchema.optional(),
    check: CheckSpecSchema.optional(),
    origin: ConstraintOriginSchema.optional(),
  }).superRefine((p, ctx) => {
    if ((p.kind === "check") !== !!p.check) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a check carries check { predicate, severity, params }, and guidance carries none" });
    }
    if (p.scope && (p.workflowId || p.workflowName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a constraint holds for one scope: a workflow or scope, not both" });
    }
  }),
});

/** R.2b: change a constraint's words or its check, or add or lift a waiver.
 *  The person accepts it in the app (NEVER_AUTO_APPLY): a waiver or a
 *  relaxed check weakens what the build is held to. */
export const UpdateConstraintPatchSchema = z.object({
  type: z.literal("update_constraint"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    constraintId: z.string().uuid(),
    changes: z.object({
      title: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      rationale: z.string().optional(),
      check: CheckSpecSchema.optional(),
    }).optional(),
    /** The node or edge the check does not hold against, and why. */
    addWaiver: z.object({
      target: z.string().min(1),
      reason: z.string().min(1).max(500),
      expiresAt: z.string().datetime().optional(),
    }).optional(),
    removeWaiver: z.string().min(1).optional(),
  }).refine((p) => !!p.changes || !!p.addWaiver || !!p.removeWaiver, { message: "update_constraint changes something: changes, addWaiver or removeWaiver" }),
});

/** R.2c: retire a constraint (one that has not been used, or no longer holds). Person-accepted. */
export const DeleteConstraintPatchSchema = z.object({
  type: z.literal("delete_constraint"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    constraintId: z.string().uuid(),
    reason: z.string().min(1).max(500),
  }),
});

// ── outcome kind (requirement_candidates — the pre-canonical plane) ─────────

/** AA.1: vision sentence refs an outcome cites (ids or the sentence's words). */
const ServesSchema = z.array(z.string().min(1)).min(1).max(20);

export const CreateCandidatePatchSchema = z.object({
  type: z.literal("create_candidate"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    branchId: z.string().uuid(),
    /** 9.5 (v3v): the outcome's HOME workflow. Optional — absent, the
     *  database homes it in the project's first lane (never orphaned). */
    workflowId: z.string().uuid().optional(),
    /** 9.6: the home lane BY NAME — for a lane an earlier upsert_workflow in
     *  the same proposal creates. Resolved at apply; an Individual plan's
     *  single lane absorbs it. */
    workflowName: z.string().min(1).optional(),
    /** AA.2: the step of the home lane this outcome is filed on, by name
     *  (a change's template steps exist once its upsert_workflow applies,
     *  earlier in the same proposal). Needs workflowName or workflowId. */
    stepName: z.string().min(1).optional(),
    key: z.string().min(1).optional(), // defaults to outcome:<uuid8> at apply
    name: z.string().min(1),
    description: z.string().optional(),
    category: RequirementCategorySchema.optional(),
    criteria: z.array(CriterionInputSchema).optional(),
    /** AA.1: the vision sentence or sentences this outcome serves, by id
     *  (`v:1a2b3c4d`, get_outcome_board lists them) or by their words.
     *  Resolved at propose and at apply against the vision as it then is. */
    serves: ServesSchema.optional(),
  }),
});

export const UpdateCandidatePatchSchema = z.object({
  type: z.literal("update_candidate"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    candidateId: z.string().uuid(),
    changes: z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      category: RequirementCategorySchema.optional(),
      criteria: z.array(CriterionInputSchema).optional(),
      /** AA.1: replaces the outcome's citations. The one change a settled outcome takes. */
      serves: ServesSchema.optional(),
    }),
  }),
});

export const DismissCandidatePatchSchema = z.object({
  type: z.literal("dismiss_candidate"),
  metadata: PatchMetadataSchema,
  payload: z.object({ candidateId: z.string().uuid() }),
});

// v3l (R5): promotion DERIVES. criteriaIds selects the slice this
// derivation claims (default: every unclaimed criterion); name/description
// let a derivation name its own requirement (a second derivation should).
export const PromoteCandidatePatchSchema = z.object({
  type: z.literal("promote_candidate"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    candidateId: z.string().uuid(),
    section: z.string().min(1).optional(),
    criteriaIds: z.array(z.string().min(1)).min(1).optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  }),
});

// 9.3: attach DERIVES against an EXISTING requirement — the brownfield
// bridge (a hand-written outcome becomes the origin of a backfilled REQ) and
// what makes "more than one outcome per requirement" a product behaviour.
// It mints nothing: one outcome_derivations row, the slice as the record,
// the requirement's own criteria untouched. Human-only like promote (R6).
// requirementId is a REQ ref (REQ-007) or the row uuid.
export const AttachCandidatePatchSchema = z.object({
  type: z.literal("attach_candidate"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    candidateId: z.string().uuid(),
    requirementId: z.string().min(1),
    criteriaIds: z.array(z.string().min(1)).min(1).optional(),
  }),
});

// v3l (R5): the owner's explicit "fully covered" — writes the terminal
// 'accepted'. Human-only like promote (R6).
export const SettleCandidatePatchSchema = z.object({
  type: z.literal("settle_candidate"),
  metadata: PatchMetadataSchema,
  payload: z.object({ candidateId: z.string().uuid() }),
});

// ── workflow kind (the Ideation lanes) ───────────────────────────────────────

export const UpsertWorkflowPatchSchema = z.object({
  type: z.literal("upsert_workflow"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid().optional(), // absent = create
    name: z.string().min(1),
    color: z.string().optional(),
    ownerLabel: z.string().optional(),
    contributors: z.array(z.string()).optional(),
    sortOrder: z.number().int().optional(),
    /** AA.2: 'change' is a change a person is making to an imported system.
     *  The imported lane is the system's and is never written here. */
    kind: z.enum(["workflow", "change"]).optional(),
    /** AA.2: on create, the change's steps come from this intent's template
     *  (change-intent.ts); implies kind 'change'. */
    intent: z.enum(["migrate", "harden", "component", "extend"]).optional(),
  }),
});

export const DeleteWorkflowPatchSchema = z.object({
  type: z.literal("delete_workflow"),
  metadata: PatchMetadataSchema,
  payload: z.object({ id: z.string().uuid() }),
});

export const UpsertWorkflowStepPatchSchema = z.object({
  type: z.literal("upsert_workflow_step"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    id: z.string().uuid().optional(),
    /** One of workflowId | workflowName (9.6): a lane created earlier in the
     *  same proposal has no id yet, so a step names it. Checked at apply. */
    workflowId: z.string().uuid().optional(),
    workflowName: z.string().min(1).optional(),
    name: z.string().min(1),
    sortOrder: z.number().int().optional(),
  }),
});

export const DeleteWorkflowStepPatchSchema = z.object({
  type: z.literal("delete_workflow_step"),
  metadata: PatchMetadataSchema,
  payload: z.object({ id: z.string().uuid() }),
});

export const SetOutcomeStepMapsPatchSchema = z.object({
  type: z.literal("set_outcome_step_maps"),
  metadata: PatchMetadataSchema,
  payload: z.object({
    candidateId: z.string().uuid(),
    branchId: z.string().uuid(),
    stepIds: z.array(z.string().uuid()),
  }),
});

// ── the union, the kind table, the doctrine set ──────────────────────────────

export const SpecPatchOperationSchema = z.discriminatedUnion("type", [
  CreateRequirementPatchSchema,
  UpdateRequirementPatchSchema,
  DeleteRequirementPatchSchema,
  UpdateVisionPatchSchema,
  MapRequirementPatchSchema,
  RelateRequirementsPatchSchema,
  CreateConstraintPatchSchema,
  UpdateConstraintPatchSchema,
  DeleteConstraintPatchSchema,
  CreateCandidatePatchSchema,
  UpdateCandidatePatchSchema,
  DismissCandidatePatchSchema,
  PromoteCandidatePatchSchema,
  AttachCandidatePatchSchema,
  SettleCandidatePatchSchema,
  UpsertWorkflowPatchSchema,
  DeleteWorkflowPatchSchema,
  UpsertWorkflowStepPatchSchema,
  DeleteWorkflowStepPatchSchema,
  SetOutcomeStepMapsPatchSchema,
]);
export type SpecPatchOperation = z.infer<typeof SpecPatchOperationSchema>;

export type ApprovalKind = "requirement" | "outcome" | "patch" | "workflow";

/** Every spec op's approval kind — rows, not branches. */
export const SPEC_PATCH_KIND: Readonly<Record<SpecPatchOperation["type"], ApprovalKind>> = {
  create_requirement: "requirement",
  update_requirement: "requirement",
  delete_requirement: "requirement",
  update_vision: "requirement",
  map_requirement: "requirement",
  relate_requirements: "requirement",
  create_constraint: "requirement",
  update_constraint: "requirement",
  delete_constraint: "requirement",
  create_candidate: "outcome",
  update_candidate: "outcome",
  dismiss_candidate: "outcome",
  promote_candidate: "outcome",
  attach_candidate: "outcome",
  settle_candidate: "outcome",
  upsert_workflow: "workflow",
  delete_workflow: "workflow",
  upsert_workflow_step: "workflow",
  delete_workflow_step: "workflow",
  set_outcome_step_maps: "workflow",
};

/** Approval kind for ANY proposal patch: spec ops by table, graph ops = 'patch'. */
export function patchKindOf(type: string): ApprovalKind {
  return (SPEC_PATCH_KIND as Record<string, ApprovalKind>)[type] ?? "patch";
}

/** Crossing the promotion line is a human act at EVERY autonomy level
 *  (R6): promote derives a canonical requirement, settle closes the source.
 *  R.2b: so is weakening what the build is held to: a waiver, a changed
 *  check and a retired constraint (update_constraint, delete_constraint).
 *  These ops may travel the proposal lane only — the change router refuses
 *  to auto-apply them, and only the app's session (JWT) may accept them. */
export const NEVER_AUTO_APPLY: ReadonlySet<string> = new Set(["promote_candidate", "attach_candidate", "settle_candidate", "update_constraint", "delete_constraint"]);

/** The widened parse for the proposal store (task 2.4 switches
 *  propose_patches to this; nothing consumes it before then). */
export const AnyProposalPatchSchema = z.union([PatchOperationSchema, SpecPatchOperationSchema]);
