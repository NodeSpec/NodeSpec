import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { projectCapReached, HOSTED_COMMUNITY_PROJECT_LIMIT } from '../ui/config/tiers';

/*
  Self-hosted sign-in must NEVER depend on the billing lane
  (owner ruling 2026-09-01).

  A fresh community container doom-looped sign-in on "Account setup
  encountered an issue" whenever create-free-customer ran without its
  self-host env — a billing repair path was gating entry to a product that
  has no billing. The fix is structural, not defensive: on non-hosted builds
  (community AND enterprise) the client-side Stripe lanes do not exist at
  all — isHostedEdition is a compile-time literal, so Vite drops the code
  from those bundles. Tiers on self-host come from the signed license,
  server-side, and the server already lifts the hosted project cap
  (NODESPEC_DEPLOYMENT check in projects.ts) — the client now mirrors it.
*/

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf-8');
const app = read('../App.tsx');
const gate = read('../ui/hooks/useFeatureGate.ts');

describe('self-hosted builds carry no client billing lane', () => {
  it('App.tsx gates BOTH provisioning entry points on isHostedEdition', () => {
    // getSession handler: /app subscription check is hosted-only, and the
    // signed-in fall-through goes straight to the app on self-host.
    expect(app).toContain('The billing lane is HOSTED-only');
    expect(app).toContain("} else if (!isHostedEdition) {");
    // onAuthStateChange handler: mirror gate before the pending-plan lane.
    expect(app).toContain('Self-hosted builds skip the entire billing lane');
    const authChangeIdx = app.indexOf('onAuthStateChange');
    const mirrorGateIdx = app.indexOf('if (!isHostedEdition) {', authChangeIdx);
    const pendingPlanIdx = app.indexOf("localStorage.getItem('nodespec_pending_plan')", authChangeIdx);
    expect(mirrorGateIdx).toBeGreaterThan(authChangeIdx);
    expect(mirrorGateIdx).toBeLessThan(pendingPlanIdx);
  });

  it('useFeatureGate never provisions on self-host and never applies the hosted cap', () => {
    // Recovery provisioning is the same billing function under another name.
    const recoveryIdx = gate.indexOf('const attemptRecovery');
    const recoveryGateIdx = gate.indexOf('if (!isHostedEdition) return null;', recoveryIdx);
    const ensureIdx = gate.indexOf('ensureFreeCustomer', recoveryIdx);
    expect(recoveryGateIdx).toBeGreaterThan(recoveryIdx);
    expect(recoveryGateIdx).toBeLessThan(ensureIdx);
    // The project cap is the managed site's Free plan's alone; a container's
    // users all resolve to 'community' (no billing rows) and stay uncapped
    // (the gate in each edition: new-project-cap.test.tsx).
    expect(projectCapReached('community', 50, false)).toBe(false);
    expect(projectCapReached('community', HOSTED_COMMUNITY_PROJECT_LIMIT, true)).toBe(true);
    expect(projectCapReached('indie', 50, true)).toBe(false);
  });

  it('server parity: the MCP create_project cap lifts on self-host (regression pin)', () => {
    const projects = readFileSync(
      resolve(__dirname, '../../supabase/functions/mcp-server/tools/projects.ts'),
      'utf-8'
    );
    expect(projects).toContain("Deno.env.get('NODESPEC_DEPLOYMENT') !== 'self-hosted'");
  });
});
