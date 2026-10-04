// Z (owner 2026-09-23): one identity for a constraint, whoever files it.
//
// project_constraints carries UNIQUE(project_id, source_hash). The app's
// add and the agent's create_constraint mint the SAME hash for the same
// (ctype, description), so a constraint recorded once is "already recorded"
// the second time, from either door, instead of a silent duplicate. (The v3f
// backfill used md5 in SQL with no prefix; this family never collides with
// it, and each is idempotent within itself.) Cross-runtime: the app imports
// this module directly, as it does task-deltas.ts.

/** The canonical constraint types, in the order the rail groups them. */
export const CONSTRAINT_TYPES = [
  "technology", "architecture", "deployment", "performance",
  "security", "compliance", "cost", "other",
] as const;
export type ConstraintTypeName = typeof CONSTRAINT_TYPES[number];

/** sha-256 over ctype, a NUL, the trimmed description; prefixed. Same
 *  input, same hash (the app minted these before the agent could). */
export async function constraintIdentity(ctype: string, description: string): Promise<string> {
  const canonical = `${ctype}\u0000${description.trim()}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `app-sha256:${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
