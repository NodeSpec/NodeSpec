// N8.1 — containment matrix audit (owner requirement 2026-07-26: containment rules must
// be AUDITABLE and SCALABLE; "I already see errors here" — confirmed by the 2026-07-26
// audit: 8 deprecated ids across 20/29 containers, replacements never added).
//
// Pure function over loaded role rows — no DB, no I/O — so it runs identically in Deno
// tests (fixtures), in N7's future invariants suite (live bench rows), and mirrors
// scripts/audit-containment.sql, which the owner can run in Studio at any time.
//
// Finding kinds:
//   dead-ref        (error)  can_contain references a deprecated role
//   unknown-ref     (error)  can_contain references a role id that does not exist
//   empty-container (warn)   is_container=true but no populated rules (admits nothing
//                            explicitly; note server treats [] as allow-all — the
//                            asymmetry itself is an N7 ruling item)
//   starved-role    (warn)   live placeable leaf role admitted by ZERO live containers —
//                            unreachable by nesting. Boundary-treated roles are exempt
//                            (the N2.3 precedence bypasses can_contain for them), as are
//                            host-nature and Logical roles (root-level by design).

import type { CanContainRule, NodeRoleRow } from "./catalog-loader.ts";
import { treatmentForRole } from "./ontology.ts";

export interface ContainmentFinding {
  severity: "error" | "warn";
  kind: "dead-ref" | "unknown-ref" | "empty-container" | "starved-role";
  roleId: string;
  detail: string;
}

// M7: was keyed on `kind` — a column M1c DROPPED, and not on NodeRoleRow, so this was a
// Deno type error the client tsc run could not see. At runtime `role.kind` was undefined,
// so NOTHING matched: every exemption below silently stopped applying and the audit would
// report boundary roles as "starved". Re-keyed onto `nature`, plus the organizational
// category. ("requirements" sat here too until N11(b) 2026-08-09 shed the category with
// its role — spec-plane rows are not catalog citizens, so nothing can carry it now.)
const STARVATION_EXEMPT_NATURES = new Set(["host"]);
const STARVATION_EXEMPT_CATEGORIES = new Set(["Logical"]);

// Boundary treatment bypasses can_contain entirely (N2.3), so these kinds are always
// placeable regardless of enumeration. Mirrors the 20260719200000 backfill rule.
// Boundary by nature: you never author its internals, so "no container admits it" is not a
// defect — it is reached through a contract or its provider, not by nesting.
const BOUNDARY_NATURES = new Set(["integrate", "call", "engine"]);

function ruleRoleIds(canContain: NodeRoleRow["can_contain"]): string[] {
  if (Array.isArray(canContain)) return canContain;
  if (canContain && typeof canContain === "object") return (canContain as CanContainRule).roleIds ?? [];
  return [];
}

function hasAnyRule(canContain: NodeRoleRow["can_contain"]): boolean {
  if (Array.isArray(canContain)) return canContain.length > 0;
  if (canContain && typeof canContain === "object") {
    const r = canContain as CanContainRule;
    return Boolean(r.roleIds?.length || r.natures?.length || r.interfaceKinds?.length || r.providers?.length);
  }
  return false;
}

/** True when the container's rules admit the role by ANY populated allowlist. */
function containerAdmits(container: NodeRoleRow, role: NodeRoleRow): boolean {
  const cc = container.can_contain;
  if (Array.isArray(cc)) return cc.includes(role.id);
  if (cc && typeof cc === "object") {
    const r = cc as CanContainRule;
    if (r.roleIds?.includes(role.id)) return true;
    if (r.natures?.length && role.nature && r.natures.includes(role.nature)) return true;
    if (r.interfaceKinds?.length && role.interface_kind && r.interfaceKinds.includes(role.interface_kind)) return true;
    if (r.providers?.length && role.provider && r.providers.includes(role.provider)) return true;
    // Provider prefix on the role id (aws-lambda et al.) — mirror of the evaluators.
    if (r.providers?.length) {
      for (const p of r.providers) if (role.id.startsWith(`${p}-`)) return true;
    }
  }
  return false;
}

export function auditContainmentMatrix(roles: NodeRoleRow[]): ContainmentFinding[] {
  const findings: ContainmentFinding[] = [];
  const byId = new Map(roles.map((r) => [r.id, r]));
  const liveContainers = roles.filter((r) => r.is_container && !r.deprecated);

  for (const role of roles) {
    if (!role.is_container) continue;
    const refs = ruleRoleIds(role.can_contain);
    for (const ref of refs) {
      const target = byId.get(ref);
      if (!target) {
        findings.push({ severity: "error", kind: "unknown-ref", roleId: role.id, detail: `can_contain references unknown role "${ref}"` });
      } else if (target.deprecated) {
        findings.push({ severity: "error", kind: "dead-ref", roleId: role.id, detail: `can_contain references deprecated role "${ref}"` });
      }
    }
    if (!role.deprecated && !hasAnyRule(role.can_contain)) {
      findings.push({ severity: "warn", kind: "empty-container", roleId: role.id, detail: "live container with no populated can_contain rules" });
    }
  }

  for (const role of roles) {
    if (role.is_container || role.deprecated) continue;
    const nature = role.nature ?? "build";
    if (STARVATION_EXEMPT_NATURES.has(nature)) continue;
    if (STARVATION_EXEMPT_CATEGORIES.has(role.palette_category)) continue;
    // M7: treatment is DERIVED now (nature + containment), never read from a column.
    const treatment = treatmentForRole({ nature: role.nature, is_container: role.is_container });
    if (treatment === "boundary" || BOUNDARY_NATURES.has(nature)) continue;
    const admitted = liveContainers.some((c) => containerAdmits(c, role));
    if (!admitted) {
      findings.push({
        severity: "warn",
        kind: "starved-role",
        roleId: role.id,
        detail: "live leaf role admitted by zero live containers — unplaceable by nesting",
      });
    }
  }

  return findings;
}
