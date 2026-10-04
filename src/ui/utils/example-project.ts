// AJ.6 (owner 2026-09-30): every account has an example project, the Harbor
// Lane Bakery demo (AJ.6b) under the account's own ids, made once by the database
// (ensure_example_project) on the first sign-in after it ships. It carries
// projects.metadata.example, which only the database writes; it does not
// count against the plan's projects; deleted, it is not made again.
import { FEATURE_RULES, type Feature } from '../config/feature-rules.js';

/** Whether a project row is the account's example. */
export function isExampleProject(project: { metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  const mark = project?.metadata?.example;
  return mark !== undefined && mark !== null;
}

/** The projects that count against the plan's cap: all but the example. */
export function countedProjects<T extends { metadata?: Record<string, unknown> | null }>(projects: readonly T[]): number {
  return projects.filter((p) => !isExampleProject(p)).length;
}

/** The project to open with none remembered: the newest of the account's
 *  own, and the example when it has none (a new account lands in it). */
export function projectToOpen<T extends { metadata?: Record<string, unknown> | null }>(projects: readonly T[]): T | null {
  return projects.find((p) => !isExampleProject(p)) ?? projects[0] ?? null;
}

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** Asks the database for the account's example: made on the first call,
 *  its id after that, null once it was given and deleted. A failure (an
 *  older database, no network) is null: the app opens as before. */
export async function ensureExampleProject(client: RpcClient): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('ensure_example_project');
    return !error && typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

const SHOWN: Partial<Record<Feature, { name: string; plural: boolean }>> = {
  workflow_space: { name: 'Workflows and constraints', plural: true },
  priority_board: { name: 'The Plan', plural: false },
  repo_import: { name: 'Repository import', plural: false },
  team_lanes: { name: 'Team mode', plural: false },
};
const TIER_NAME: Record<string, string> = { community: 'Free', indie: 'Indie', team: 'Team', enterprise: 'Enterprise', government: 'Government' };

/** The line a surface of the example carries when it shows a feature above
 *  the owner's plan: it reads and does not change. */
export function viewOnlyLine(feature: Feature): string {
  const shown = SHOWN[feature] ?? { name: FEATURE_RULES[feature].label, plural: false };
  const tier = TIER_NAME[FEATURE_RULES[feature].minimumTier] ?? FEATURE_RULES[feature].minimumTier;
  return `View only. ${shown.name} ${shown.plural ? 'are' : 'is'} on ${tier} and above; the example shows ${shown.plural ? 'them' : 'it'} with its own data.`;
}
