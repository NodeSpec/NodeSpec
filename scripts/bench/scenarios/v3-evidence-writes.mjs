// V3 R2 bench rider: every criteria writer goes through the one locked writer.
//
// v3r/v3-criteria-race proved the DATABASE guarantee — concurrent status
// transitions no longer lose a met flip. It explicitly did not prove that two
// concurrent report_test_results CALLS are safe, because the tool still did its
// own read-modify-write of the whole array in phase B (binding) and phase D
// (the flip/stamp). R2 routes those, update_test_case's release and rebind
// lanes, and the app's own maintenance writes through apply_criteria_ops.
//
// THIS rider is the missing proof, at the level a user actually hits:
//
//   1 · two agents each run their own test for their own criterion of the SAME
//       requirement and report at the same instant. Both criteria must end met,
//       both must carry test provenance, and neither receipt may claim a flip
//       the other erased. Pre-R2 phase D's re-read-then-write dropped one.
//   2 · the ops a release sends are ORDERED: mark_stale selects by the testId
//       the criterion still carries, so it has to land before unbind strips it.
//       Reversed, a retired case leaves its criterion reading proven-by-nothing
//       with no evidence-due mark — the silent version of the bug.
//   3 · the grant model (v3s): a seat reaches only the wrapper that re-checks
//       contributor membership AND the v3q classification rule; a non-member is
//       refused by that wrapper even though the function is SECURITY DEFINER.
import { rest, callFn, signIn, Scenario, sleep } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const direct = async (env, session, tool, args) => (await callFn(env, session, 'mcp-server', { tool, arguments: args })).data;

async function adminCreateUser(env, email, password) {
  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.id) throw new Error(`admin create user ${email} → ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data.id;
}
const adminDeleteUser = (env, id) => fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
  method: 'DELETE',
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
}).catch(() => {});

/** PostgREST RPC as a given key/session — the lane the app uses. */
const rpcAs = (env, token, apikey, fn, body) => fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const evidenceWrites = {
  name: 'v3-evidence-writes',
  boxes: [
    'V3-R2 concurrent report calls both survive',
    'V3-R2 release ops are ordered',
    'V3-R2 the wrapper enforces membership',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const db = rest(env);
    const fx = await createProject(env, session, 'v3r2');

    // ── 1 · two agents, one requirement, simultaneous reports ──────────────
    const texts = ['agent one proves this', 'agent two proves this'];
    const [req] = await db.insert('specification_requirements', {
      specification_id: fx.ids.spec,
      requirement_id: 'REQ-R2',
      name: 'Two agents, one requirement',
      description: 'Each agent runs the test for its own criterion and reports at the same instant.',
      category: 'functional',
      acceptance_criteria: texts.map((text, i) => ({ id: `w${i + 1}`, text, verification: 'automated', met: false })),
    });

    const read = async () => {
      const [row] = await db.select('specification_requirements', `id=eq.${req.id}&select=acceptance_criteria`);
      return row?.acceptance_criteria ?? [];
    };

    // Both calls bind (phase B) AND flip+stamp (phase D) on the same row. This
    // is the shape the tool contract permits: checkouts never gate other tools.
    const [r1, r2] = await Promise.all([
      direct(env, session, 'report_test_results', {
        project_id: fx.ids.project, requirement_id: req.id,
        results: [{ test_id: 'TC-A', status: 'passed', criterion_text: texts[0], framework: 'vitest' }],
      }),
      direct(env, session, 'report_test_results', {
        project_id: fx.ids.project, requirement_id: req.id,
        results: [{ test_id: 'TC-B', status: 'passed', criterion_text: texts[1], framework: 'vitest' }],
      }),
    ]);
    s.check('both reports succeed', r1?.success === true && r2?.success === true, JSON.stringify({ r1, r2 }).slice(0, 400));

    const after = await read();
    const metNow = after.filter((c) => c.met === true).length;
    s.check('BOTH criteria end met — neither agent erased the other (pre-R2 this dropped one)',
      metNow === 2, `only ${metNow}/2 met: ${JSON.stringify(after)}`);
    s.check('both carry test provenance, not just the last writer\'s',
      after.every((c) => c.provenance?.source === 'test'), JSON.stringify(after.map((c) => c.provenance)));
    s.check('each criterion is bound to its OWN case', new Set(after.map((c) => c.testId)).size === 2, JSON.stringify(after.map((c) => c.testId)));

    // The receipt is the writer's post-lock return, not a re-read — so what the
    // agent was told must still be true afterwards.
    const claimed = [...(r1?.data?.flippedCriteria ?? []), ...(r2?.data?.flippedCriteria ?? [])]
      .filter((c) => c.met === true).map((c) => c.text);
    // UAT hardening 2026-09-27: two receipts, one flip each; an empty list
    // used to pass.
    s.check('every flip the receipts claimed is still true on the row',
      claimed.length === 2 && claimed.every((t) => after.find((c) => c.text === t)?.met === true),
      `claimed ${JSON.stringify(claimed)} but the row reads ${JSON.stringify(after.map((c) => [c.text, c.met]))}`);

    // ── 2 · the release ops are ordered ────────────────────────────────────
    const caseB = after.find((c) => c.text === texts[1])?.testId;
    const retire = await direct(env, session, 'update_test_case', {
      project_id: fx.ids.project, requirement_id: req.id, test_id: 'TC-B',
      retire: true, retire_reason: 'superseded by TC-A',
    });
    s.check('retire succeeds', retire?.success === true, JSON.stringify(retire).slice(0, 300));

    const released = (await read()).find((c) => c.text === texts[1]);
    s.check('the retired case\'s criterion is unbound', released?.testId === undefined, JSON.stringify(released));
    s.check('met is PRESERVED — evidence-due, never silently unproven', released?.met === true, JSON.stringify(released));
    s.check('and it carries the evidence-due mark — proof mark_stale ran BEFORE unbind',
      released?.evidenceStale?.reason === 'case-retired' && typeof released?.evidenceStale?.at === 'string',
      `no evidenceStale on the released criterion: ${JSON.stringify(released)} (if unbind had run first the mark would have nothing to select)`);
    s.check('the other agent\'s criterion is untouched by the release',
      (await read()).find((c) => c.text === texts[0])?.met === true, 'the release reached a foreign criterion');

    // revival: a fresh report on the retired id re-proves it and clears the mark
    await direct(env, session, 'report_test_results', {
      project_id: fx.ids.project, requirement_id: req.id,
      results: [{ test_id: 'TC-B', status: 'passed', criterion_text: texts[1], framework: 'vitest' }],
    });
    const revived = (await read()).find((c) => c.text === texts[1]);
    s.check('a fresh run revives the case, re-binds and clears the evidence-due mark',
      revived?.met === true && revived?.testId && revived?.evidenceStale === undefined, JSON.stringify(revived));
    if (caseB && revived?.testId) {
      s.check('revival reuses the same case row (test_id is the upsert key)', revived.testId === caseB, `${revived.testId} vs ${caseB}`);
    }

    // ── 3 · the grant model (v3s) ─────────────────────────────────────────
    // The owner is a member and may write; a signed-in NON-member may not, even
    // though the function is SECURITY DEFINER and would otherwise bypass RLS.
    const email = `r2-outsider-${Date.now()}@nodespec.local`;
    const outsiderId = await adminCreateUser(env, email, 'benchpass123');
    try {
      const outsider = await signIn({ ...env, BENCH_USER: email, BENCH_PASS: 'benchpass123' });
      const probe = { p_requirement_id: req.id, p_ops: [{ op: 'set_met', criterion_id: 'w1', value: false }] };

      const asOutsider = await rpcAs(env, outsider.accessToken, env.SUPABASE_ANON_KEY, 'apply_criteria_ops_as_member', probe);
      const body = await asOutsider.json().catch(() => ({}));
      s.check('a signed-in NON-member is refused by the wrapper (SECURITY DEFINER does not mean unguarded)',
        (asOutsider.status >= 400 && /contributor|not a member|not found/i.test(JSON.stringify(body))) || body?.found === false,
        `status ${asOutsider.status}, body ${JSON.stringify(body).slice(0, 200)}`);
      s.check('and nothing moved', (await read()).find((c) => c.text === texts[0])?.met === true, 'a refused call still wrote');

      const outsiderDirect = await rpcAs(env, outsider.accessToken, env.SUPABASE_ANON_KEY, 'apply_criteria_ops', probe);
      s.check('a seat cannot reach the UNCHECKED writer at all',
        outsiderDirect.status === 404 || outsiderDirect.status === 403 || outsiderDirect.status === 401,
        `a signed-in seat got ${outsiderDirect.status} from the unchecked writer`);

      // the OWNER is a contributor by ownership and may write through the wrapper
      await sleep(50);
      const asOwner = await rpcAs(env, session.accessToken, env.SUPABASE_ANON_KEY, 'apply_criteria_ops_as_member', {
        p_requirement_id: req.id, p_ops: [{ op: 'clear_stale', criterion_id: 'w1' }],
      });
      s.check('the project owner CAN write through the wrapper — this is the app\'s lane',
        asOwner.status === 200, `owner got ${asOwner.status}`);
    } finally {
      await adminDeleteUser(env, outsiderId);
    }

    return { s };
  },
};

export default [evidenceWrites];
