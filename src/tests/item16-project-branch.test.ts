// Item 16 (owner 2026-09-26): a project has one branch, its primary.
//
// The real Supabase repositories (project, branch, graph) and the real
// functions the app calls (src/ui/services/project-branch.ts) run against an
// in-memory stand-in for the database client that stores rows and answers the
// queries those repositories make: insert, update by id, select by project
// ordered by created_at. Nothing about the app's code is stubbed.
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseProjectRepository } from '../persistence/supabase/project-repository.js';
import { createSupabaseBranchRepository } from '../persistence/supabase/branch-repository.js';
import { createSupabaseGraphRepository } from '../persistence/supabase/graph-repository.js';
import { createProjectWithPrimaryBranch, openBranchName, pickProjectBranch } from '../ui/services/project-branch.js';

type Row = Record<string, unknown>;

/** Just enough of PostgREST for the three repositories. */
function database() {
  const tables = new Map<string, Row[]>();
  let clock = Date.parse('2026-09-26T09:00:00Z');
  let ids = 0;
  const rows = (t: string) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t)!; };
  const client = {
    from(table: string) {
      let op: 'select' | 'insert' | 'update' = 'select';
      let payload: Row = {};
      const filters: Array<[string, unknown]> = [];
      let order: { col: string; asc: boolean } | null = null;
      const run = () => {
        if (op === 'insert') {
          const row = { id: `${table}-${++ids}`, created_at: new Date(clock += 1000).toISOString(), updated_at: new Date(clock).toISOString(), ...payload };
          rows(table).push(row);
          return [row];
        }
        const hit = rows(table).filter((r) => filters.every(([c, v]) => r[c] === v));
        if (op === 'update') { for (const r of hit) Object.assign(r, payload); return hit; }
        const out = [...hit];
        if (order) out.sort((a, b) => String(a[order!.col]).localeCompare(String(b[order!.col])) * (order!.asc ? 1 : -1));
        return out;
      };
      const q = {
        insert(p: Row) { op = 'insert'; payload = p; return q; },
        update(p: Row) { op = 'update'; payload = p; return q; },
        select() { return q; },
        eq(c: string, v: unknown) { filters.push([c, v]); return q; },
        order(col: string, o: { ascending: boolean }) { order = { col, asc: o.ascending }; return q; },
        single: async () => ({ data: run()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(res: (v: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: run(), error: null }).then(res); },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, rows, seed: (t: string, r: Row) => rows(t).push({ created_at: new Date(clock += 1000).toISOString(), ...r }) };
}

describe('item 16: a new project is created with its one branch as the primary', () => {
  it('the branch row is written flagged, named main, and linked to the empty graph it starts from', async () => {
    const db = database();
    const { project, branch } = await createProjectWithPrimaryBranch({
      projects: createSupabaseProjectRepository(db.client),
      branches: createSupabaseBranchRepository(db.client),
      graphs: createSupabaseGraphRepository(db.client),
    }, { name: 'Shelfie', userId: 'person-1', metadata: { origin: 'blank' } });

    expect(db.rows('projects')).toEqual([expect.objectContaining({ id: project.id, name: 'Shelfie', owner_id: 'person-1', metadata: { origin: 'blank' } })]);
    const [row] = db.rows('branches');
    expect(row).toEqual(expect.objectContaining({ project_id: project.id, name: 'main', is_primary: true }));
    const [snapshot] = db.rows('graph_snapshots');
    expect(snapshot).toEqual(expect.objectContaining({ project_id: project.id, branch_id: row.id, patch_sequence: 0 }));
    expect(row.base_snapshot_id).toBe(snapshot.id);
    expect(branch.isPrimary).toBe(true);
    expect(branch.baseSnapshotId).toBe(snapshot.id);
  });
});

describe('item 16: a project opens on its primary, read through the real branch repository', () => {
  const open = async (seedRows: Row[]) => {
    const db = database();
    for (const r of seedRows) db.seed('branches', { project_id: 'p1', created_by: 'person-1', base_snapshot_id: null, metadata: {}, ...r });
    const listed = await createSupabaseBranchRepository(db.client).listByProject('p1');
    if (!listed.success) throw new Error('list failed');
    return { listed: listed.data.map((b) => b.name), picked: pickProjectBranch(listed.data)?.name ?? null };
  };

  it('the flagged primary, even when a newer design branch sits first in the list', async () => {
    const r = await open([{ id: 'b1', name: 'develop', is_primary: true }, { id: 'b2', name: 'feature/x', is_primary: false }]);
    expect(r.listed[0]).toBe('feature/x'); // newest first, which the old fallback took
    expect(r.picked).toBe('develop');
  });

  it('a legacy project with no flagged row opens its main, then its oldest row, never the newest', async () => {
    expect((await open([{ id: 'b1', name: 'main', is_primary: false }, { id: 'b2', name: 'feature/x', is_primary: false }])).picked).toBe('main');
    expect((await open([{ id: 'b1', name: 'design-a', is_primary: false }, { id: 'b2', name: 'design-b', is_primary: false }])).picked).toBe('design-a');
    // a row from before the flag existed (no value) named main reads as the primary
    expect((await open([{ id: 'b1', name: 'feature/y', is_primary: false }, { id: 'b2', name: 'main', is_primary: null }])).picked).toBe('main');
  });

  it('a project with no branch opens nothing', async () => {
    expect((await open([])).picked).toBeNull();
  });
});

describe('item 16: the open branch is named as the database names it now', () => {
  it('after connect renames the primary, the name comes from the loaded rows by id; before they load, the name it opened with', () => {
    expect(openBranchName([{ id: 'b1', name: 'develop' }], 'b1', 'main')).toBe('develop');
    expect(openBranchName([], 'b1', 'main')).toBe('main');
    expect(openBranchName([{ id: 'other', name: 'develop' }], 'b1', 'main')).toBe('main');
    expect(openBranchName([], null, null)).toBeNull();
  });
});
