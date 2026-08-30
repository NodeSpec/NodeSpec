// Owner spike 2026-08-23: the trunk's identity moves from the LITERAL name
// 'main' to branches.is_primary, freeing connect to rename the trunk row to
// the git branch it mirrors — the header stops lying, and later branches
// wanting the real name stop colliding.
import { getPrimaryBranch, computePrimaryRename, isPrimaryRow } from '../_shared/primary-branch.ts';
import { FakeSupabase, assert, assertEquals } from './helpers.ts';

Deno.test('computePrimaryRename: renames to the bound git branch when the header would lie', () => {
  const d = computePrimaryRename({ primaryName: 'main', gitBranch: 'develop', siblingNames: ['feature-x'] });
  assertEquals(d.rename, true);
  assertEquals(d.to, 'develop');
});

Deno.test('computePrimaryRename: already-aligned and empty targets are no-ops', () => {
  assertEquals(computePrimaryRename({ primaryName: 'main', gitBranch: 'main', siblingNames: [] }).rename, false);
  assertEquals(computePrimaryRename({ primaryName: 'develop', gitBranch: 'develop', siblingNames: [] }).rename, false);
  assertEquals(computePrimaryRename({ primaryName: 'main', gitBranch: '', siblingNames: [] }).rename, false);
  assertEquals(computePrimaryRename({ primaryName: 'main', gitBranch: null, siblingNames: [] }).rename, false);
  assertEquals(computePrimaryRename({ primaryName: 'main', gitBranch: '   ', siblingNames: [] }).rename, false);
});

Deno.test('computePrimaryRename: NEVER steals a sibling branch name — the collision this spike prevents', () => {
  const d = computePrimaryRename({ primaryName: 'main', gitBranch: 'develop', siblingNames: ['develop', 'feature-x'] });
  assertEquals(d.rename, false);
  assert(d.reason.includes('collision'), d.reason);
});

Deno.test('isPrimaryRow: flag wins; the naming convention covers only un-flagged legacy rows', () => {
  assertEquals(isPrimaryRow({ is_primary: true, name: 'develop' }), true);
  assertEquals(isPrimaryRow({ is_primary: false, name: 'main' }), false); // flagged data is authoritative
  assertEquals(isPrimaryRow({ name: 'main' }), true);                     // legacy fallback
  assertEquals(isPrimaryRow({ is_primary: null, name: 'main' }), true);
  assertEquals(isPrimaryRow({ name: 'feature-x' }), false);
});

Deno.test('getPrimaryBranch: the is_primary row wins; legacy name lookup only when no row is flagged', async () => {
  const sb = new FakeSupabase();
  sb.script('branches', 'select', { data: { id: 'b1', name: 'develop', git_ref: 'develop', is_primary: true }, error: null });
  const hit = await getPrimaryBranch(sb as never, 'p1');
  assertEquals(hit?.name, 'develop');
  assertEquals(sb.callsTo('branches', 'select').length, 1, 'flag hit needs no fallback query');

  const sb2 = new FakeSupabase();
  sb2.script('branches', 'select', { data: null, error: null }); // no flagged row
  sb2.script('branches', 'select', { data: { id: 'b1', name: 'main', git_ref: null }, error: null });
  const legacy = await getPrimaryBranch(sb2 as never, 'p1');
  assertEquals(legacy?.name, 'main');
  assertEquals(sb2.callsTo('branches', 'select').length, 2, 'fallback ran');

  const sb3 = new FakeSupabase();
  const none = await getPrimaryBranch(sb3 as never, 'p1');
  assertEquals(none, null);
});
