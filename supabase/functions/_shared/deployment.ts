/*
  SHIP-1(e) · THE deployment-mode seam (runbook §6: "First SaaS-only
  divergence introduces ONE deployment-mode flag — config, never a branch").

  NODESPEC_DEPLOYMENT=self-hosted is that flag. This module is the ONLY place
  server code branches on it for tier resolution: hosted deployments read the
  Stripe-synced subscription (user-tier.ts, unchanged); self-hosted
  deployments read the signed license (selfhost-license.ts) — same PlanTier
  vocabulary, different source, per the SHIP-1 doctrine. Everything downstream
  keeps speaking PlanTier and never learns where it came from.

  The license verdict is cached per isolate: the license is deployment-wide
  (not per-user), verification is pure CPU, and a warm cache keeps the seam
  free for every tool call.
*/
import { canonicalizeTier, hostedTier, TIER_RANK, type PlanTier } from './tiers.ts';
import { featureAllowed, type Edition } from './feature-rules.ts';
import { getUserTier } from './user-tier.ts';
import { resolveSelfHostTier } from './selfhost-license.ts';

type EnvReader = { get(name: string): string | undefined };

/** The Deno environment, read through globalThis: the app's type check also
 *  reaches this file (its tests import the task-document generator, whose
 *  constraints loader asks the owner's plan). Evaluated only when called. */
const denoEnv = (): EnvReader => (globalThis as unknown as { Deno: { env: EnvReader } }).Deno.env;

export function isSelfHosted(env: EnvReader = denoEnv()): boolean {
  return env.get('NODESPEC_DEPLOYMENT') === 'self-hosted';
}

/** The build this server is (audit, owner 2026-09-27): the managed site's
 *  functions ('hosted'), a self-hosted install, or the future Government
 *  build, which sets NODESPEC_EDITION=government beside
 *  NODESPEC_DEPLOYMENT=self-hosted. The server cannot tell an open source
 *  install from an Enterprise one (the licence decides their tier), so a
 *  self-hosted server is 'enterprise' unless it says 'oss'. Classification
 *  asks this: it is the Government build's alone. */
export function serverEdition(env: EnvReader = denoEnv()): Edition {
  if (!isSelfHosted(env)) return 'hosted';
  const named = env.get('NODESPEC_EDITION');
  return named === 'government' ? 'government' : named === 'oss' ? 'oss' : 'enterprise';
}

let cachedLicenseTier: { tier: PlanTier; licensee?: string; reason?: string } | null = null;

let markedSelfHosted = false;

/** Test seam: the per-isolate license cache (and the self-hosted mark). */
export function resetLicenseTierCache(): void {
  cachedLicenseTier = null;
  markedSelfHosted = false;
}

/**
 * V3 Q: the database checks the plan on the app's own writes (migration
 * 20260922110000) and defers to the licence when public.deployment_settings
 * says self-hosted. The container init and the self-host bootstrap write
 * that row; this keeps an install marked when it was upgraded without them.
 * Once per isolate, best-effort: a client without the right (or a database
 * without the table) changes nothing here.
 *
 * Audit (owner 2026-09-27): the mark is never cleared, and it opens every
 * plan check in the database. A managed Supabase project (*.supabase.co) is
 * the hosted edition and never a self-hosted install, so a self-hosted flag
 * set there by mistake is refused and said, not written.
 */
export function isManagedSupabase(env: EnvReader = denoEnv()): boolean {
  try {
    return new URL(env.get('SUPABASE_URL') ?? '').hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

export async function markSelfHostedDatabase(supabase: unknown, env: EnvReader = denoEnv()): Promise<void> {
  if (markedSelfHosted) return;
  markedSelfHosted = true;
  if (isManagedSupabase(env)) {
    console.error('[deployment] NODESPEC_DEPLOYMENT=self-hosted on a managed Supabase project: the database is not marked self-hosted. Unset it on the hosted functions.');
    return;
  }
  try {
    const client = supabase as { from(table: string): { upsert(row: Record<string, unknown>, opts?: Record<string, unknown>): PromiseLike<unknown> } };
    await client.from('deployment_settings').upsert({ id: true, mode: 'self-hosted', updated_at: new Date().toISOString() }, { onConflict: 'id' });
  } catch {
    /* the init scripts are the primary writer */
  }
}

export async function getLicenseTier(
  env: EnvReader = denoEnv(),
  now: Date = new Date(),
): Promise<{ tier: PlanTier; licensee?: string; reason?: string }> {
  if (!cachedLicenseTier) {
    cachedLicenseTier = await resolveSelfHostTier(
      { license: env.get('NODESPEC_LICENSE'), publicKey: env.get('NODESPEC_LICENSE_PUBLIC_KEY') },
      now,
    );
    if (cachedLicenseTier.reason) {
      // Fail-closed is doctrine, silent is not: the reason names the fix.
      console.warn(`[selfhost-license] running unlicensed (tier 'community'): ${cachedLicenseTier.reason}`);
    }
  }
  return cachedLicenseTier;
}

/**
 * The tier every caller should use. Hosted → Stripe subscription;
 * self-hosted → signed license (fail-closed 'community'). AMENDED 2026-08-25
 * (open-core GTM): tiers now gate two things — the hosted community project
 * cap and repo import (indie+ on hosted; absent from the community bundle).
 */
export async function getEffectiveTier(
  // Structural type mirrors user-tier.ts's SubscriptionQueryClient seam.
  supabase: Parameters<typeof getUserTier>[0],
  userId: string,
  env: EnvReader = denoEnv(),
): Promise<PlanTier> {
  if (isSelfHosted(env)) {
    await markSelfHostedDatabase(supabase, env);
    return (await getLicenseTier(env)).tier;
  }
  return getUserTier(supabase, userId);
}

// ── Decision 1 (owner ruling 2026-09-26): the project owner's plan governs ──
//
// What a project carries (Workflows, constraints, repo import, the work
// plan, classification, seats) is its owner's plan, for everyone seated on
// it; the caller's own plan governs only what is the person's (the agent
// connection allowance, the project count). The database reads it the same
// way (plan_allows(feature, project) and project_plan_tier(project)).

type Row = Record<string, unknown>;
type Reader = { from: (t: string) => { select: (c: string) => Chain } };
type Chain = PromiseLike<{ data: unknown; error?: { message: string } | null }> & {
  eq: (c: string, v: unknown) => Chain;
  in: (c: string, v: unknown[]) => Chain;
  limit: (n: number) => Chain;
  maybeSingle: () => PromiseLike<{ data: unknown; error?: { message: string } | null }>;
};

/** The plan a project runs on: its owner's. Call it once the caller's
 *  membership is established (resolveProjectByName); a project row that
 *  cannot be read answers Community (fail closed: a seat's own plan is
 *  never borrowed for the project). Self-hosted: the licence is the plan
 *  for everyone. Pass the caller's role on the project when it is known:
 *  an owner's project plan is their own, with no read. Pass `read` when
 *  the call only reads: an example project then answers at Team. */
export async function getProjectTier(
  supabase: unknown,
  projectId: string,
  callerId: string,
  opts: { role?: string | null; env?: EnvReader; read?: boolean } = {},
): Promise<PlanTier> {
  const tier = await ownerPlanTier(supabase, projectId, callerId, opts);
  if (!opts.read || TIER_RANK[tier] >= TIER_RANK[EXAMPLE_READ_TIER]) return tier;
  return (await isExampleProject(supabase, projectId)) ? EXAMPLE_READ_TIER : tier;
}

/** AJ.6 (owner 2026-09-30): every account has an example project, marked in
 *  projects.metadata.example, that shows every feature the build carries.
 *  What its owner's plan does not carry is there to read, never to change:
 *  a read of it (getProjectTier with `read`) answers at Team, and every
 *  write is decided by the owner's plan as on any project. Only the
 *  database's ensure_example_project writes the mark. */
export const EXAMPLE_READ_TIER: PlanTier = 'team';

/** Whether a project row's metadata marks it as the account's example. */
export function isExampleMetadata(metadata: unknown): boolean {
  return !!metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    && (metadata as Row).example !== undefined && (metadata as Row).example !== null;
}

/** Whether the project is an account's example. A read that fails answers no. */
export async function isExampleProject(supabase: unknown, projectId: string): Promise<boolean> {
  try {
    const { data } = await (supabase as Reader).from('projects').select('metadata').eq('id', projectId).maybeSingle();
    return isExampleMetadata((data as Row | null)?.metadata);
  } catch {
    return false;
  }
}

async function ownerPlanTier(
  supabase: unknown,
  projectId: string,
  callerId: string,
  opts: { role?: string | null; env?: EnvReader },
): Promise<PlanTier> {
  const env = opts.env ?? denoEnv();
  if (isSelfHosted(env)) return getEffectiveTier(supabase as never, callerId, env);
  // The caller owns it (resolveProjectByName said so): its plan is theirs.
  if (opts.role === 'owner') return getUserTier(supabase as never, callerId);
  let owner: string | null = null;
  try {
    const { data } = await (supabase as Reader).from('projects').select('owner_id').eq('id', projectId).maybeSingle();
    const id = (data as Row | null)?.owner_id;
    if (typeof id === 'string' && id) owner = id;
  } catch { /* unread: Community below */ }
  return owner ? getUserTier(supabase as never, owner) : 'community';
}

/** Below Team a project is its owner's alone (owner 2026-09-26): a seat
 *  reaches a project only while the project's plan carries seats (the
 *  team_lanes feature, Team and above). Below it the seat row is kept and
 *  reaches nothing, and it comes back when the owner is on Team again.
 *  Answers, for the owners asked, the plan of each whose plan carries
 *  seats; an owner below Team is left out. Hosted: each owner's own plan;
 *  self-hosted: the licence, the same for every project. A read that
 *  fails leaves everyone out. */
export async function ownersCarryingSeats(
  supabase: unknown,
  ownerIds: readonly string[],
  env: EnvReader = denoEnv(),
): Promise<Map<string, PlanTier>> {
  const owners = [...new Set(ownerIds.filter((o) => typeof o === 'string' && o))];
  const carried = new Map<string, PlanTier>();
  if (owners.length === 0) return carried;
  try {
    if (isSelfHosted(env)) {
      const licence = await getEffectiveTier(supabase as never, owners[0], env);
      if (featureAllowed(licence, 'team_lanes')) for (const o of owners) carried.set(o, licence);
      return carried;
    }
    const { data: subs, error } = await (supabase as Reader).from('stripe_subscriptions')
      .select('user_id, plan_name, status, current_period_end').in('user_id', owners).in('status', ['active', 'trialing']);
    if (error) return carried;
    // the latest period per owner, as getUserTier reads one
    const latest = new Map<string, Row>();
    for (const sub of (subs ?? []) as Row[]) {
      const id = sub.user_id;
      if (typeof id !== 'string') continue;
      const seen = latest.get(id);
      if (!seen || String(sub.current_period_end ?? '') > String(seen.current_period_end ?? '')) latest.set(id, sub);
    }
    for (const [id, sub] of latest) {
      const tier = hostedTier(canonicalizeTier(typeof sub.plan_name === 'string' ? sub.plan_name : null) ?? 'community');
      if (featureAllowed(tier, 'team_lanes')) carried.set(id, tier);
    }
  } catch { /* nobody's seats count */ }
  return carried;
}

/** The best plan a person can work under anywhere: their own, or the plan
 *  of a Team (or higher) project they hold a seat on. It decides what
 *  tools/list serves a credential (a Free person seated on a Team project
 *  needs the Team tools); each call is then decided by the project it
 *  names. A seat on a project below Team reaches nothing, so adds nothing. */
export const REACH_SEAT_LIMIT = 200;
export async function getReachTier(
  supabase: unknown,
  userId: string,
  env: EnvReader = denoEnv(),
): Promise<PlanTier> {
  if (isSelfHosted(env)) return getEffectiveTier(supabase as never, userId, env);
  const own = await getUserTier(supabase as never, userId);
  let best: PlanTier = own;
  try {
    const db = supabase as Reader;
    const { data: seats } = await db.from('project_members').select('project_id').eq('user_id', userId).limit(REACH_SEAT_LIMIT);
    const projectIds = [...new Set(((seats ?? []) as Row[]).map((r) => r.project_id).filter((v): v is string => typeof v === 'string'))];
    if (projectIds.length === 0) return best;
    const { data: projects } = await db.from('projects').select('owner_id').in('id', projectIds);
    const owners = [...new Set(((projects ?? []) as Row[]).map((r) => r.owner_id).filter((v): v is string => typeof v === 'string' && v !== userId))];
    for (const tier of (await ownersCarryingSeats(supabase, owners, env)).values()) {
      if (TIER_RANK[tier] > TIER_RANK[best]) best = tier;
    }
  } catch { /* the person's own plan */ }
  return best;
}
