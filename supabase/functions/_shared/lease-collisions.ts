// V3 4b.5 (R8): git reality vs the lease board. A commit that touches files
// bound to a node whose task someone ELSE holds — or an artifact someone
// holds at code level — is a collision nothing surfaced before: the
// webhook saw the files, the board saw the lease, nobody joined them. This
// is the join, pure and dependency-free so the app mirrors it byte for
// byte (src/ui/components/ideation/lease-collisions.ts, cross-pinned) and
// both sides flag the same commits.
//
// Matching is on path. AA.5: a work lease that recorded its reach (the files
// it named, their imports inside the node, what the same tests verify) is
// matched against that reach, not only the files bound to its ref; a reach of
// '*' (no files named) is the whole node; a node lease holds every file bound
// to its node. Commits that touch nothing bound to held work are not
// collisions — the board is a warning, not a gate.

export interface CollisionChange {
  changeEventId: string; commitSha: string | null; author?: string | null; changedFiles: Array<{ path?: unknown } | string> | null;
  /** AD.3: the card's files grouped by the author of the commits that changed them. */
  authors?: Array<{ author: string; commits: string[]; files: string[] }> | null;
}
export interface CollisionLease {
  id: string; level: string; holder_label: string; credential?: string | null;
  task_item_id: string | null; artifact_id: string | null;
  /** AA.5: the node a node lease locks (and a work lease sits in). */
  node_id?: string | null;
  /** AA.5: meta.reach, when the lease recorded one. AD.3: the commits its
   *  holder reported (meta.commits, meta.commitSha, meta.verified.commitSha). */
  meta?: { reach?: unknown; commitSha?: unknown; commits?: unknown; verified?: unknown } | null;
}
export interface CollisionTask { id: string; node_id: string | null; display_id?: string | null; title?: string | null }
export interface CollisionArtifact { id: string; node_id: string | null; path: string | null }

export interface LeaseCollision {
  changeEventId: string;
  commitSha: string | null;
  author: string | null;
  checkoutId: string;
  level: string;
  holder: string;
  credential: string | null;
  refLabel: string;
  paths: string[];
  /** AD.3: who made the commits that changed the held files, when the card
   *  says; never the holder's own reported commits. */
  by: string[];
}

/** AD.3: the commits a lease's holder reported as its own. */
export function ownCommits(meta: CollisionLease['meta']): string[] {
  const out: string[] = [];
  const add = (v: unknown) => { if (typeof v === 'string' && /^[0-9a-f]{7,64}$/i.test(v)) out.push(v.toLowerCase()); };
  if (Array.isArray(meta?.commits)) for (const c of meta!.commits as unknown[]) add(c);
  add(meta?.commitSha);
  add((meta?.verified as { commitSha?: unknown } | null | undefined)?.commitSha);
  return out;
}

const sameCommit = (a: string, b: string): boolean => {
  const x = a.toLowerCase(), y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
};

const pathOf = (f: { path?: unknown } | string): string | null =>
  typeof f === 'string' ? f : (typeof f?.path === 'string' ? f.path : null);

/** Every (pending change, active lease) pair whose changed paths hit the
 *  artifacts bound to the lease's target. Ordered by change, then lease. */
export function collisionsBetween(
  changes: CollisionChange[],
  leases: CollisionLease[],
  tasks: CollisionTask[],
  artifacts: CollisionArtifact[],
): LeaseCollision[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const artifactsByNode = new Map<string, CollisionArtifact[]>();
  for (const a of artifacts) {
    if (!a.node_id) continue;
    const list = artifactsByNode.get(a.node_id) ?? [];
    list.push(a);
    artifactsByNode.set(a.node_id, list);
  }
  const artifactById = new Map(artifacts.map((a) => [a.id, a]));
  const out: LeaseCollision[] = [];
  for (const change of changes) {
    const changed = new Set((change.changedFiles ?? []).map(pathOf).filter((p): p is string => !!p));
    if (changed.size === 0) continue;
    for (const lease of leases) {
      let bound: CollisionArtifact[] = [];
      let refLabel = lease.id;
      const reach = Array.isArray(lease.meta?.reach) ? (lease.meta!.reach as unknown[]).map(String) : null;
      const named = reach && !reach.includes('*') ? reach.filter((r) => !r.startsWith('criterion:') && !r.startsWith('task:')) : null;
      if (lease.level === 'node' && lease.node_id) {
        bound = artifactsByNode.get(lease.node_id) ?? [];
        refLabel = 'the node';
      } else if (lease.level === 'task' && lease.task_item_id) {
        const task = taskById.get(lease.task_item_id);
        if (!task) continue;
        bound = task.node_id ? (artifactsByNode.get(task.node_id) ?? []) : [];
        refLabel = [task.display_id, task.title].filter(Boolean).join(' · ') || lease.task_item_id;
      } else if (lease.level === 'code' && lease.artifact_id) {
        const artifact = artifactById.get(lease.artifact_id);
        if (!artifact) continue;
        bound = [artifact];
        refLabel = artifact.path ?? lease.artifact_id;
      } else {
        continue; // advisory levels bind no files
      }
      const held = named && lease.level !== 'node' ? [...named, ...(lease.level === 'code' ? bound.map((a) => a.path).filter((p): p is string => !!p) : [])] : bound.map((a) => a.path).filter((p): p is string => !!p);
      let paths = held.filter((p) => changed.has(p));
      // AD.3 (D23): the holder's own commits are its work, not a collision.
      // With the card's attribution a held file counts only when an author
      // made a commit the holder did not report; a file no read commit
      // accounts for still counts (nobody can say it was the holder's).
      const by = new Set<string>();
      if (change.authors && change.authors.length > 0) {
        const own = ownCommits(lease.meta);
        paths = paths.filter((p) => {
          const touching = change.authors!.filter((g) => g.files.includes(p));
          if (touching.length === 0) return true;
          let someoneElse = false;
          for (const g of touching) {
            if (g.commits.some((sha) => !own.some((o) => sameCommit(o, sha)))) {
              someoneElse = true;
              by.add(g.author);
            }
          }
          return someoneElse;
        });
      }
      if (paths.length === 0) continue;
      out.push({
        changeEventId: change.changeEventId,
        commitSha: change.commitSha,
        author: change.author ?? null,
        checkoutId: lease.id,
        level: lease.level,
        holder: lease.holder_label,
        credential: lease.credential ?? null,
        refLabel,
        paths: [...new Set(paths)].sort(),
        by: [...by].sort(),
      });
    }
  }
  return out;
}
