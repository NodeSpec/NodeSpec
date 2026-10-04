// AA.3 (owner 2026-09-23): the part roles. A part (module, handler, table
// group...) is a node_roles row tagged 'part'. Mirror of core
// PART_CAPABILITY_TAG (container-types.ts). Kept apart from role-registry.ts
// so the task document generator can read it without the registry.
import type { NodeRoleRow } from "./catalog-loader.ts";

export const PART_CAPABILITY_TAG = 'part';

export function isPartRole(row: { capability_tags?: string[] | null } | null | undefined): boolean {
  return Array.isArray(row?.capability_tags) && row!.capability_tags!.includes(PART_CAPABILITY_TAG);
}

/** The role ids a can_contain names explicitly (either shape). */
export function namedRoleIds(canContain: NodeRoleRow['can_contain'] | null | undefined): string[] {
  if (Array.isArray(canContain)) return canContain;
  if (canContain && typeof canContain === 'object') return canContain.roleIds ?? [];
  return [];
}
