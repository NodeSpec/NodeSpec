/*
  Feature rules — the SERVER table (V3 task 7.1, open-core ruling R1;
  amended 2026-09-15 by R9, the editions-and-tiers matrix).

  TWO AXES decide whether a capability is available. They are independent,
  and conflating them is the mistake this table exists to prevent:

    EDITION — which build carries the code at all.
      oss         the Apache-2.0 community container, exactly what
                  .github/workflows/oss-export.yml publishes (the
                  closed-paths manifests remove the closed families and
                  lay refusal stubs; the catalog ships as the STARTER
                  subset from gen-starter-seed.mjs).
      hosted      nodespec.io (VITE_NODESPEC_EDITION=hosted).
      enterprise  the licensed customer bundle (VITE_NODESPEC_EDITION=
                  enterprise, --catalog full, a signed NODESPEC_LICENSE).
      Enforced by CODE ABSENCE: an excluded module is not in the tree and
      its import boundary answers from a stub. No runtime flag can turn a
      missing module on, which is why the OSS boundary is provable.

    TIER — what a running account may do: community | indie | team |
      enterprise | government, resolved by getEffectiveTier (hosted →
      Stripe subscription; self-hosted → the signed license, fail-closed
      to community). Enforced by requireFeature at the MCP boundary.

  The ladder, as ruled (owner 2026-08-26, confirmed 2026-09-15):

    Community (OSS container)   the core, minus repo import; starter catalog
    Free (hosted, community)    the same core, hosted, capped at 2 projects
    Indie                       + repo import, + the Plan tab, unlimited projects
    Team                        + the multi-user lane (roster, seats, exports)
    Enterprise                  + licensed self-host, custom catalog, support
    Government                  everything in Enterprise + gov-only catalog
                                rows + classification (+ compliance, planned)

  Free and Community are the same TIER ('community') in two editions — the
  hosted card and the container. That is why the 2-project cap is hosted-only
  (HOSTED_COMMUNITY_PROJECT_LIMIT) and the container is uncapped.

  status 'planned' means DECLARED, NOT BUILT: featureAvailable is false for
  it at every tier, so a gate wired to it fails closed instead of pretending.

  The client mirror is src/ui/config/feature-rules.ts, kept in lockstep by
  src/tests/feature-rules-parity.test.ts; the edition column is kept honest
  against the export manifests by src/tests/editions-matrix.test.ts, and the
  whole matrix is documented in docs/EDITIONS_AND_TIERS.md.
*/
import { TIER_RANK, type PlanTier } from './tiers.ts';

/** Which build carries the code. 'government' is the future Government build
 *  (owner 2026-09-27): the only build that carries classification. */
export type Edition = 'oss' | 'hosted' | 'enterprise' | 'government';

export const EDITIONS: readonly Edition[] = ['oss', 'hosted', 'enterprise', 'government'];

/** Everything that is not deliberately closed ships in every build. */
const ALL_EDITIONS: readonly Edition[] = EDITIONS;
/** Closed families: present in the paid builds, absent from the OSS tree. */
const CLOSED_IN_OSS: readonly Edition[] = ['hosted', 'enterprise', 'government'];
/** Government classification is in the Government build and no other
 *  (owner 2026-09-27): not the open source tree, not the managed site, not
 *  the Enterprise bundle. */
const GOVERNMENT_ONLY: readonly Edition[] = ['government'];

export type Feature =
  | 'chat'
  | 'node_generate'
  | 'architecture_generation'
  | 'git_push'
  | 'git_pull'
  | 'repo_import'
  | 'node_context_export'
  | 'unlimited_projects'
  | 'mcp_connectivity'
  | 'mcp_write_scope'
  | 'workflow_space'
  | 'priority_board'
  | 'work_exports'
  | 'team_lanes'
  | 'classification'
  | 'full_catalog'
  | 'custom_catalog'
  | 'gov_catalog'
  | 'self_host'
  | 'compliance';

export interface FeatureRule {
  minimumTier: PlanTier;
  /** Whose plan decides it (owner ruling 2026-09-26, decision 1): 'project'
   *  is the project owner's plan, for everyone seated on the project;
   *  'person' is the caller's own (the agent connection allowance, the
   *  project count, the key's scopes, the licence). */
  governs: 'project' | 'person';
  /** The builds whose tree carries this code (edition axis). */
  editions: readonly Edition[];
  /** Declared but not built — never available, at any tier. */
  status?: 'planned';
  label: string;
  upgradeMessage: string;
}

export const FEATURE_RULES: Record<Feature, FeatureRule> = {
  chat: {
    minimumTier: 'community',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'AI Chat',
    upgradeMessage: 'AI chat is available on all plans.',
  },
  node_generate: {
    minimumTier: 'community',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'Generate Code',
    upgradeMessage: 'Code generation is available on all plans.',
  },
  architecture_generation: {
    minimumTier: 'community',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'Architecture Generation',
    upgradeMessage: 'Architecture generation is available on all plans.',
  },
  git_push: {
    minimumTier: 'community',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'Git Export',
    upgradeMessage: 'Git export is available on all tiers.',
  },
  git_pull: {
    minimumTier: 'community',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'Git Import',
    upgradeMessage: 'Git import is available on all tiers.',
  },
  repo_import: {
    minimumTier: 'indie',
    governs: 'project',
    editions: CLOSED_IN_OSS,
    label: 'Repo Import',
    upgradeMessage: 'Repo import reverse visualization is available on Indie and above.',
  },
  node_context_export: {
    minimumTier: 'community',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'Node Context Export',
    upgradeMessage: 'Node context export is available on all tiers.',
  },
  unlimited_projects: {
    minimumTier: 'indie',
    governs: 'person',
    editions: ALL_EDITIONS,
    label: 'Multiple Projects',
    upgradeMessage: 'Hosted Free includes 2 projects; Indie and above are unlimited. A self-hosted container has no project cap; like Free it connects one agent.',
  },
  mcp_connectivity: {
    minimumTier: 'community',
    governs: 'person',
    editions: ALL_EDITIONS,
    label: 'Agent Connectivity (MCP)',
    upgradeMessage: 'MCP agent connectivity is available on all tiers.',
  },
  mcp_write_scope: {
    minimumTier: 'community',
    governs: 'person',
    editions: ALL_EDITIONS,
    label: 'Agent Write Scope',
    upgradeMessage: 'The MCP write scope is available on all tiers.',
  },
  workflow_space: {
    // P (owner 2026-09-22): Workflows start at Indie. Below it, outcomes and
    // requirements keep working; only the journeys, their steps and the
    // outcome-to-step maps are closed.
    minimumTier: 'indie',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'Workflows',
    upgradeMessage: 'Workflows are available on Indie and above: journeys, their steps, and outcomes placed on those steps. Outcomes and requirements work on every plan.',
  },
  priority_board: {
    minimumTier: 'indie',
    governs: 'project',
    editions: CLOSED_IN_OSS,
    label: 'Plan',
    upgradeMessage: 'The Plan tab, the order of operations over a work plan, is available on Indie and above.',
  },
  work_exports: {
    minimumTier: 'team',
    governs: 'project',
    editions: CLOSED_IN_OSS,
    status: 'planned',
    label: 'Work Exports',
    upgradeMessage: 'Work exports to Slack, Jira and Notion are available on Team and above.',
  },
  team_lanes: {
    minimumTier: 'team',
    governs: 'project',
    editions: CLOSED_IN_OSS,
    label: 'Team Lanes & Seats',
    upgradeMessage: 'Lanes with owners, project seats and shared approvals are available on Team and above.',
  },
  classification: {
    minimumTier: 'government',
    governs: 'project',
    editions: GOVERNMENT_ONLY,
    label: 'Classification Marks',
    upgradeMessage: 'Classification marks on items are available on Government.',
  },
  full_catalog: {
    minimumTier: 'community',
    governs: 'project',
    editions: CLOSED_IN_OSS,
    label: 'Full Technology Catalog',
    upgradeMessage: 'The community container ships the curated starter catalog; the hosted app and licensed bundles carry the full catalog.',
  },
  custom_catalog: {
    minimumTier: 'enterprise',
    governs: 'project',
    editions: ALL_EDITIONS,
    label: 'Custom Catalog Additions',
    upgradeMessage: 'Catalog additions curated for your organization are part of an Enterprise agreement.',
  },
  gov_catalog: {
    minimumTier: 'government',
    governs: 'project',
    editions: GOVERNMENT_ONLY,
    label: 'Government Catalog',
    upgradeMessage: 'Government-only catalog technologies and context ship with the Government edition.',
  },
  self_host: {
    minimumTier: 'enterprise',
    governs: 'person',
    editions: ['enterprise', 'government'],
    label: 'Licensed Self-Host Deployment',
    upgradeMessage: 'A licensed, supported self-hosted deployment is part of an Enterprise agreement. The Apache-2.0 community container is self-hosted and free, without the licensed tiers.',
  },
  compliance: {
    minimumTier: 'government',
    governs: 'project',
    editions: GOVERNMENT_ONLY,
    status: 'planned',
    label: 'Compliance Package Builder',
    upgradeMessage: 'The compliance package builder ships with the Government edition.',
  },
};

export const FEATURES = Object.keys(FEATURE_RULES) as Feature[];

/** TIER axis only: does this plan reach the feature's minimum tier? */
/** Decision 1: true when the project owner's plan decides the feature. */
export function governedByProject(feature: Feature): boolean {
  return FEATURE_RULES[feature].governs === 'project';
}

export function featureAllowed(tier: PlanTier, feature: Feature): boolean {
  return TIER_RANK[tier] >= TIER_RANK[FEATURE_RULES[feature].minimumTier];
}

/** EDITION axis only: does this build carry the code at all? */
export function featureInEdition(feature: Feature, edition: Edition): boolean {
  return FEATURE_RULES[feature].editions.includes(edition);
}

/** Declared but not built — false at every tier, in every edition. */
export function featurePlanned(feature: Feature): boolean {
  return FEATURE_RULES[feature].status === 'planned';
}

/** Both axes plus the planned guard — the whole truth for one build+account. */
export function featureAvailable(tier: PlanTier, feature: Feature, edition: Edition): boolean {
  return !featurePlanned(feature) && featureInEdition(feature, edition) && featureAllowed(tier, feature);
}

const tierLabel = (t: PlanTier) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * The server refusal, in the repo-import shape every closed tool speaks:
 * what is gated (the rule's label, or the surface the caller names — a tool
 * list reads better than a product noun), whose plan it is (the caller's
 * own account, or, for a seat refused a project feature, the owner's:
 * decision 1; pass `seat`),
 * where to upgrade, and what stays available. Pure: the caller resolves
 * the tier (getProjectTier for a project feature, getEffectiveTier for the
 * person's own) and passes it in.
 *
 * Pass `edition` to check the build axis too — an OSS tree answers from its
 * stubs, so this is belt-and-braces for code that survives the export.
 */
export function requireFeature(
  tier: PlanTier,
  feature: Feature,
  opts: { surface?: string; stays?: string; edition?: Edition; seat?: boolean } = {},
): { ok: true } | { ok: false; error: string } {
  const rule = FEATURE_RULES[feature];
  const what = opts.surface ?? rule.label;
  if (featurePlanned(feature)) {
    return {
      ok: false,
      error: `${what} is planned and not built yet — nothing to enable. ${rule.upgradeMessage}`,
    };
  }
  if (opts.edition && !featureInEdition(feature, opts.edition)) {
    if (!featureInEdition(feature, 'hosted') && featureInEdition(feature, 'government')) {
      return {
        ok: false,
        error: `${what} is part of NodeSpec for Government only; this build does not carry it.${opts.stays ? ` ${opts.stays}` : ''}`,
      };
    }
    return {
      ok: false,
      error:
        `${what} is not included in the community edition. ` +
        `It is available on NodeSpec hosted and in licensed bundles — https://nodespec.io/pricing.` +
        `${opts.stays ? ` ${opts.stays}` : ''}`,
    };
  }
  if (featureAllowed(tier, feature)) return { ok: true };
  const min = tierLabel(rule.minimumTier);
  const reach = rule.minimumTier === 'government' ? `on ${min}` : `on ${min} and above`;
  // Decision 1: a project feature is the project owner's plan. Below Team
  // a project is its owner's alone, so a seat is refused only on a Team (or
  // higher) project, for what is above its owner's plan: that sentence names
  // the project and who can change it. Everyone else is the owner, told
  // about their own account.
  const whose = rule.governs === 'project' && opts.seat
    ? `this project runs on its owner's ${tierLabel(tier)} plan. The project owner can upgrade at https://nodespec.io/pricing; then call again.`
    : `this account resolves to the ${tierLabel(tier)} tier. Upgrade at https://nodespec.io/pricing and call again.`;
  return {
    ok: false,
    error: `${what} is available ${reach}; ${whose}${opts.stays ? ` ${opts.stays}` : ''}`,
  };
}

// ── Connected agents per person (owner ruling 2026-09-21) ────────────────────
//
// A connection is one credential that names one agent and belongs to one
// person: an API key, or an OAuth client holding a live token family. The
// tier never changes what a connection may do (the person's seats and role
// decide that); it only caps how many one person keeps connected at once.
// Team and above is the same allowance for every seat holder. Enforced
// where a connection is born: create_api_key (mcp-server/tools/keys.ts)
// and the OAuth consent mint (mcp-server/oauth.ts), both counting through
// agent_connection_count (migration 20260921130000).

export const AGENT_CONNECTION_LIMIT: Record<PlanTier, number> = {
  community: 1,
  indie: 5,
  team: 5,
  enterprise: 5,
  government: 5,
};

export function agentConnectionLimit(tier: PlanTier): number {
  return AGENT_CONNECTION_LIMIT[tier];
}

const CONNECTION_COUNT_WORD: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
const connectionCountWord = (n: number) => CONNECTION_COUNT_WORD[n] ?? String(n);
const connectionTierWord = (t: PlanTier) => t.charAt(0).toUpperCase() + t.slice(1);

/** The line under the count on the Connected tab: what the plan allows. */
export function agentConnectionAllowanceLine(tier: PlanTier): string {
  const limit = agentConnectionLimit(tier);
  // Q: the standing line says what THIS plan includes; the upgrade is named
  // only in the refusal, when the allowance is spent.
  if (limit === 1) return 'Your plan includes one connected agent.';
  return `${connectionTierWord(tier)} connects up to ${connectionCountWord(limit)} agents per person.`;
}

/** The one refusal every surface speaks when the allowance is spent. */
export function agentConnectionCapMessage(tier: PlanTier): string {
  const limit = agentConnectionLimit(tier);
  if (limit === 1) {
    return 'Your plan includes one connected agent, and it is in use. Revoke it under Agents, Connected, or upgrade to Indie to connect up to five.';
  }
  return `${connectionTierWord(tier)} connects up to ${connectionCountWord(limit)} agents per person, and yours are all in use. Revoke one under Agents, Connected, to connect another.`;
}
