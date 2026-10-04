// AD.0 (docs/V3_OVERHAUL_PLAN.md), live: git-push and git-pull decrypt a
// project's repository token only for someone with a seat on that project.
// A signed-in stranger who holds the integration id gets the answer an id
// that does not exist gets, and nothing moves in the repository; the owner's
// own push still goes through.
import { callFn, github, uid, Scenario, adminCreateUser, adminDeleteUser, signInAs } from '../lib.mjs';
import { createProject, connectRepo } from '../fixtures.mjs';

const NOT_FOUND = 'Integration not found';

export const gitStranger = {
  name: 'ad0-git-stranger',
  boxes: ['AD.0 git-push needs a seat', 'AD.0 git-pull needs a seat', 'AD.0 a refusal reads as an unknown id'],
  async run(env, session) {
    const s = new Scenario(this.name, this.boxes);
    const fx = await createProject(env, session, 'ad0');
    const { integrationId } = await connectRepo(env, session, callFn, fx.ids.project);
    const gh = github(env);
    const mainBefore = await gh.headSha('main');

    const email = `bench-stranger-${uid().slice(0, 8)}@nodespec.local`;
    const password = `bench-${uid()}`;
    const strangerId = await adminCreateUser(env, email, password);
    try {
      const stranger = await signInAs(env, email, password);
      const pushBody = { projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true };

      const push = await callFn(env, stranger, 'git-push', pushBody);
      s.check('a stranger\'s git-push is refused as an unknown integration',
        push.status === 404 && push.data?.error === NOT_FOUND, `status ${push.status}: ${JSON.stringify(push.data).slice(0, 200)}`);

      const read = await callFn(env, stranger, 'git-pull', { integrationId, mode: 'tree-scan', branchName: 'main' });
      s.check('a stranger\'s git-pull read is refused the same way',
        read.status === 404 && read.data?.error === NOT_FOUND, `status ${read.status}: ${JSON.stringify(read.data).slice(0, 200)}`);

      const write = await callFn(env, stranger, 'git-pull', { integrationId, mode: 'restore-spec', branchName: 'main' });
      s.check('a stranger\'s git-pull write is refused the same way',
        write.status === 404 && write.data?.error === NOT_FOUND, `status ${write.status}: ${JSON.stringify(write.data).slice(0, 200)}`);

      const unknown = await callFn(env, stranger, 'git-push', { ...pushBody, integrationId: uid() });
      s.check('the refusal is the one an unknown id gets, so it does not confirm the id exists',
        unknown.status === push.status && JSON.stringify(unknown.data) === JSON.stringify(push.data),
        `stranger: ${push.status} ${JSON.stringify(push.data)}; unknown id: ${unknown.status} ${JSON.stringify(unknown.data)}`);

      const mainAfter = await gh.headSha('main');
      s.check('nothing moved in the repository', !!mainBefore && mainAfter === mainBefore, `before=${mainBefore} after=${mainAfter}`);
    } finally {
      await adminDeleteUser(env, strangerId);
    }

    const own = await callFn(env, session, 'git-push', { projectId: fx.ids.project, branchName: 'main', integrationId, confirmOverwrite: true });
    s.check('the owner\'s own push still goes through', own.status === 200 && own.data?.success === true,
      `status ${own.status}: ${JSON.stringify(own.data).slice(0, 200)}`);
    return { s, fx, integrationId };
  },
};

export default [gitStranger];
