// V3 R-series bench rider (concurrency review 2026-09-15): acceptance_criteria
// has ONE locked writer.
//
// WHAT THIS PROVES, and what it deliberately does not:
//
//   · PROVES — the DATABASE guarantee v3r delivers. N test cases bound to N
//     criteria of one requirement, their statuses flipped CONCURRENTLY, all N
//     criteria end met. Before v3r the met-flip trigger read the whole criteria
//     array into a local, rebuilt it and wrote it back with no row lock, so
//     under READ COMMITTED the later writer clobbered the earlier one's flip:
//     measured 1–2 of 4 surviving, run to run. This is the exact shape two
//     agents reporting different criteria of one requirement produce, which the
//     tool contract explicitly permits (checkouts never gate other tools, and
//     requirement holds are advisory).
//
//   · DOES NOT PROVE — that two concurrent report_test_results CALLS are safe.
//     That tool still performs its own read-modify-write of the whole array in
//     phase B (binding) and phase D (the provenance stamp), outside any lock.
//     Routing those through apply_criteria_ops is the next step and changes the
//     tool's response shape, so it does not ride with the migration. This rider
//     drives the status transitions directly, which is precisely the surface
//     v3r changed.
//
// Also pins the PRIVILEGE MODEL, which v3r got wrong and v3s fixed: in this
// schema ALTER DEFAULT PRIVILEGES grants EXECUTE on every new function to anon,
// authenticated and service_role, so a REVOKE must name those roles or a
// SECURITY DEFINER writer stays reachable without a session. The rider asserts
// the end state: anon reaches neither entry point, the service role reaches the
// internal writer (that is how the tools take the lock), and seats reach only
// the wrapper that re-checks membership and clearance.
import { rest, uid, Scenario } from '../lib.mjs';
import { createProject } from '../fixtures.mjs';

const CONCURRENCY = 4;

const criteriaRace = {
  name: 'v3-criteria-race',
  boxes: [
    'V3-R concurrent flips all survive',
    'V3-R single-writer semantics unchanged',
    'V3-R no new callable surface',
  ],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const db = rest(env);
    const fx = await createProject(env, session, 'v3race');

    // One requirement, CONCURRENCY criteria, one binding test case each — the
    // budget the skill asks for and the shape the race needs.
    const texts = Array.from({ length: CONCURRENCY }, (_, i) => `concurrent criterion ${i + 1}`);
    const [req] = await db.insert('specification_requirements', {
      specification_id: fx.ids.spec,
      requirement_id: 'REQ-RACE',
      name: 'Concurrent evidence survives',
      description: 'Four criteria, four binding tests, reported at the same instant.',
      category: 'functional',
      acceptance_criteria: texts.map((text, i) => ({ id: `rc${i + 1}`, text, verification: 'automated', met: false })),
    });

    const cases = await db.insert(
      'test_cases',
      texts.map((_, i) => ({
        requirement_id: req.id,
        test_id: `TC-RACE-${i + 1}`,
        name: `race case ${i + 1}`,
        status: 'not_started',
      })),
    );
    s.check(`${CONCURRENCY} test cases created on one requirement`, cases.length === CONCURRENCY, JSON.stringify(cases).slice(0, 200));

    // Bind each criterion to its case the way report_test_results phase B does:
    // criterion.testId = the test-case ROW uuid. Done up front and serially, so
    // the concurrent part below is purely the status transitions the trigger
    // owns — binding is the tool's lane, not the database's.
    const bound = texts.map((text, i) => ({ id: `rc${i + 1}`, text, verification: 'automated', met: false, testId: cases[i].id }));
    await db.update('specification_requirements', `id=eq.${req.id}`, { acceptance_criteria: bound });

    const metCount = async () => {
      const [row] = await db.select('specification_requirements', `id=eq.${req.id}&select=acceptance_criteria`);
      return (row?.acceptance_criteria ?? []).filter((c) => c.met === true).length;
    };

    // ── the race ────────────────────────────────────────────────────────────
    // Three rounds: a lost update is a timing window, and one clean round
    // proves nothing. Pre-v3r this lost at least one flip in every round.
    let worst = CONCURRENCY;
    for (let round = 1; round <= 3; round++) {
      await db.update('specification_requirements', `id=eq.${req.id}`, { acceptance_criteria: bound });
      await Promise.all(cases.map((c) => db.update('test_cases', `id=eq.${c.id}`, { status: 'not_started' })));

      await Promise.all(cases.map((c) => db.update('test_cases', `id=eq.${c.id}`, { status: 'passed' })));
      const n = await metCount();
      worst = Math.min(worst, n);
      s.check(`round ${round}: ${CONCURRENCY} concurrent passing reports → ${n}/${CONCURRENCY} criteria met`,
        n === CONCURRENCY, `only ${n} of ${CONCURRENCY} flips survived — the array writer is racing`);
    }
    s.check('no flip was lost in any round', worst === CONCURRENCY, `worst round kept ${worst}/${CONCURRENCY}`);

    // ── single-writer semantics are unchanged ───────────────────────────────
    const one = cases[0];
    const metOf = async (i) => {
      const [row] = await db.select('specification_requirements', `id=eq.${req.id}&select=acceptance_criteria`);
      return (row?.acceptance_criteria ?? [])[i]?.met;
    };
    await db.update('test_cases', `id=eq.${one.id}`, { status: 'failed' });
    s.check('a failed report flips met to false — the RED step of the loop is real', (await metOf(0)) === false, 'failed did not unset met');

    await db.update('test_cases', `id=eq.${one.id}`, { status: 'passed' });
    s.check('a passing report flips it back', (await metOf(0)) === true, 'passed did not set met');

    await db.update('test_cases', `id=eq.${one.id}`, { status: 'skipped' });
    s.check('skipped leaves the criterion alone', (await metOf(0)) === true, 'skipped moved met');

    await db.update('test_cases', `id=eq.${one.id}`, { status: 'running' });
    s.check('running leaves the criterion alone', (await metOf(0)) === true, 'running moved met');

    // An INSERT must never flip: report_test_results lands a new case at
    // 'not_started' and then updates, and that two-step protocol depends on it.
    // UAT hardening 2026-09-27: the probe used to bind nothing, so no trigger
    // could have flipped anything. Now a criterion already names the case's
    // row id before the case exists, which is the one way an INSERT could flip it.
    const freshId = uid();
    const [preBound] = await db.select('specification_requirements', `id=eq.${req.id}&select=acceptance_criteria`);
    const withProbe = (preBound?.acceptance_criteria ?? []).map((c, i) => (i === 1 ? { ...c, testId: freshId, met: false } : c));
    await db.update('specification_requirements', `id=eq.${req.id}`, { acceptance_criteria: withProbe });
    await db.insert('test_cases', {
      id: freshId, requirement_id: req.id, test_id: 'TC-RACE-INSERT', name: 'insert probe', status: 'passed',
    });
    const [after] = await db.select('specification_requirements', `id=eq.${req.id}&select=acceptance_criteria`);
    const insertProbe = (after?.acceptance_criteria ?? [])[1];
    s.check('an INSERT never fires the flip, even for a criterion already bound to it (the two-step protocol still holds)',
      insertProbe?.testId === freshId && insertProbe?.met === false,
      JSON.stringify(insertProbe ?? null).slice(0, 200));

    // ── the privilege model (v3s) ───────────────────────────────────────
    // v3r claimed "no new callable surface" on the strength of a REVOKE FROM
    // PUBLIC. That was wrong: Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE
    // on every new function to anon, authenticated and service_role explicitly,
    // and a PUBLIC revoke does not touch an explicit role grant. v3s revokes by
    // name. These checks are the ones that would have caught it.
    const rpc = (key, fn, body) => fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const probe = { p_requirement_id: req.id, p_ops: [{ op: 'set_met', criterion_id: 'rc1', value: false }] };

    const anonDirect = await rpc(env.SUPABASE_ANON_KEY, 'apply_criteria_ops', probe);
    s.check('anon cannot reach the UNCHECKED criteria writer (the v3r hole, closed in v3s)',
      anonDirect.status === 404 || anonDirect.status === 403 || anonDirect.status === 401,
      `anon got ${anonDirect.status} from apply_criteria_ops — a definer writer with no membership check`);

    const anonWrapped = await rpc(env.SUPABASE_ANON_KEY, 'apply_criteria_ops_as_member', probe);
    s.check('anon cannot reach the member wrapper either',
      anonWrapped.status === 404 || anonWrapped.status === 403 || anonWrapped.status === 401,
      `anon got ${anonWrapped.status} from apply_criteria_ops_as_member`);

    s.check('neither refused call changed anything', (await metOf(0)) === true, 'a refused call still wrote');

    // The server, by contrast, is SUPPOSED to reach it — that is how the tools
    // take the lock instead of racing for the column.
    const svc = await rpc(env.SUPABASE_SERVICE_ROLE_KEY, 'apply_criteria_ops',
      { p_requirement_id: req.id, p_ops: [{ op: 'clear_stale', criterion_id: 'rc1' }] });
    s.check('the service role CAN call it — the tools write through the lock', svc.status === 200, `service role got ${svc.status}`);

    return { s };
  },
};

export default [criteriaRace];
