// AA.5 / AA.3 (owner 2026-09-23): the explode signal. A node whose files fall
// into groups with no imports between them, and whose leases keep colliding
// or queueing, is suggested for exploding; the agent then proposes the parts
// from its reading of the code. Explode answers lasting contention; it is no
// longer the only way to work in parallel.
//
// This is the first half, pure: the node's files split by their imports into
// groups (connected components, imports read both ways). The caller adds the
// second half: it only speaks when a claim on the node was just refused, and
// only for a node whose role lists parts.

export interface FileGroup {
  size: number;
  /** A few of the group's files, sorted, so the agent can name the part. */
  sample: string[];
}

/** Groups of at least two files that import nothing in another group, largest first. */
export function fileGroups(files: readonly string[], imports: ReadonlyArray<{ from: string; to: string }>): FileGroup[] {
  const parent = new Map<string, string>();
  for (const f of files) parent.set(f, f);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const { from, to } of imports) {
    if (!parent.has(from) || !parent.has(to)) continue;
    const a = find(from); const b = find(to);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const r = find(f);
    groups.set(r, [...(groups.get(r) ?? []), f]);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({ size: g.length, sample: [...g].sort().slice(0, 3) }))
    .sort((a, b) => b.size - a.size || a.sample[0].localeCompare(b.sample[0]));
}

/** The words the refusal carries, or null when the files do not split. */
export function explodeSignalLine(groups: readonly FileGroup[], nodeLabel: string): string | null {
  if (groups.length < 2) return null;
  const shown = groups.slice(0, 4).map((g) => `${g.sample[0]}${g.size > 1 ? ` and ${g.size - 1} more` : ''}`);
  return `"${nodeLabel}"'s files fall into ${groups.length} groups with no imports between them (${shown.join('; ')}${groups.length > 4 ? '; ...' : ''}). If work here keeps colliding, explode it (explode_node) so each group can be leased on its own.`;
}
