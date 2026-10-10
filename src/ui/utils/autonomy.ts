// V3 8.2 (bound to 1.6): the Autonomy settings' vocabulary — the client
// mirror of the server's change router (supabase/functions/mcp-server/
// tools/change-router.ts: AUTOMATION_LANES, EFFECTIVE_DEFAULTS,
// resolveAutomationPolicy; cross-pinned in autonomy-settings.test.ts).
//
// The "lanes" here are the six TIERS (never the workflow lanes): what an
// agent may do on each without asking. Levels: 0 Ask first (the tool
// refuses and names this setting), 1 Propose (a proposal waits in the
// queue), 2 Auto-apply (applied and logged). An EMPTY stored policy is
// the shipped default — today's effective routing, resolved here and on
// the server, never stored. Code is pinned at 0 by the database:
// NodeSpec never writes code. Each setting states its effect, so the
// user reads what changes before they change it.

export type AutonomyLane = 'candidates' | 'requirements' | 'architecture' | 'tasks' | 'tests' | 'code';
export type AutonomyLevel = 0 | 1 | 2;
export type AutonomyPolicy = Record<AutonomyLane, AutonomyLevel>;

export const AUTONOMY_LANES: readonly AutonomyLane[] = [
  'candidates', 'requirements', 'architecture', 'tasks', 'tests', 'code',
];

/** M.3 (owner's ruling 2026-09-22): the lanes the settings panel SHOWS.
 *  Code is policy, not a setting — it is pinned at 0 by the resolver and by
 *  the server's router, and NodeSpec never writes code, so a control nobody
 *  can move was one more row to read past. The lane itself stays in the
 *  policy vocabulary above: the resolver still pins it, the server still
 *  mirrors it, and a stored row that names it is still normalized. */
export const AUTONOMY_LANES_SHOWN: readonly AutonomyLane[] = AUTONOMY_LANES.filter((l) => l !== 'code');

/** Today's effective routing — the no-regression default (shipped ≠ recommended). */
export const EFFECTIVE_DEFAULTS: Readonly<AutonomyPolicy> = {
  candidates: 2,
  requirements: 2,
  architecture: 1,
  tasks: 2,
  tests: 2,
  code: 0,
};

export const LEVEL_LABEL: Record<AutonomyLevel, string> = { 0: 'Ask first', 1: 'Propose', 2: 'Auto-apply' };

export const LANE_LABEL: Record<AutonomyLane, string> = {
  candidates: 'Outcomes & workflow',
  requirements: 'Requirements',
  architecture: 'Architecture',
  tasks: 'Tasks',
  tests: 'Tests',
  code: 'Code',
};

/** What the lane governs, in the person's words (the tools are in the skill). */
export const LANE_SCOPE: Record<AutonomyLane, string> = {
  candidates: 'Outcomes, criteria, workflow steps',
  requirements: 'Requirements, vision, mappings, relations, constraints',
  architecture: 'Nodes, edges, contracts, artifacts',
  tasks: 'Task documents',
  tests: 'The test plan',
  code: 'Your repository',
};

/** Normalize a stored automation_policy (values arrive as '0'|'1'|'2'
 *  strings or numbers; anything unreadable falls back to the default; the
 *  code lane can never be raised, whatever the row says). Mirror of the
 *  server's resolveAutomationPolicy. */
export function resolveAutonomyPolicy(raw: unknown): AutonomyPolicy {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out = {} as AutonomyPolicy;
  for (const lane of AUTONOMY_LANES) {
    const v = src[lane];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
    out[lane] = (n === 0 || n === 1 || n === 2) ? (n as AutonomyLevel) : EFFECTIVE_DEFAULTS[lane];
  }
  out.code = 0;
  return out;
}

/** The sentence under each setting: what changes for the agent, in one
 *  line. The tools' own vocabulary (routed: proposed | applied, refused)
 *  lives in the skill and the receipts, not here. */
export function laneEffect(lane: AutonomyLane, level: AutonomyLevel): string {
  if (lane === 'code') {
    return 'NodeSpec never writes code. Your AI builds in your repository and reports evidence back.';
  }
  if (lane === 'architecture') {
    switch (level) {
      case 0: return 'Agents cannot change the architecture. You draw on the canvas.';
      case 1: return 'Each agent graph change waits as a proposal on the canvas.';
      case 2: return 'Agent graph changes apply on the canvas, app open or not, and are logged. Imports, git loads and locked nodes still wait for you.';
    }
  }
  // V3 2.4: the lane governs OPEN rows; confirm and lock are the row-level
  // brakes, and they hold whatever the lane says.
  const rungs = lane === 'requirements' ? ' Confirmed requirements still come back as proposals; locked ones refuse every change.' : '';
  const settle = lane === 'candidates' && level === 2 ? ' Promotion and settle still wait for you.'
    : lane === 'tasks' && level === 2 ? ' A proposed build order is accepted as it files.' : '';
  // AL.6: an agent's batch now applies at Auto; changing or retiring a
  // constraint stays the person's (resolve_proposal's NEVER_AUTO_APPLY).
  if (lane === 'requirements' && level === 2) {
    return 'Agents apply: changes land at once and are logged. Confirmed requirements and changes to a constraint still wait; locked ones refuse.';
  }
  switch (level) {
    case 0: return `Agents ask first: changes here are refused and name this setting.${rungs}`;
    case 1: return `Agents propose: changes here wait in Proposals for you.${rungs}`;
    case 2: return `Agents apply: changes here land at once and are logged.${settle}${rungs}`;
  }
}

/** The header control's word for the whole policy. */
export function policySummary(policy: AutonomyPolicy): 'Approve each' | 'Auto' | 'Mixed' {
  const editable = AUTONOMY_LANES.filter((l) => l !== 'code');
  if (editable.every((l) => policy[l] === 2)) return 'Auto';
  if (editable.every((l) => policy[l] <= 1)) return 'Approve each';
  return 'Mixed';
}

/** The design's two presets: approve every agent action, or let agents run and review after. */
export function presetPolicy(preset: 'approve' | 'auto'): AutonomyPolicy {
  const level: AutonomyLevel = preset === 'auto' ? 2 : 1;
  return { candidates: level, requirements: level, architecture: level, tasks: level, tests: level, code: 0 };
}

/** What is stored: only the lanes that differ from the shipped default (an
 *  empty object stays "today's routing", resolved in code — never frozen). */
export function policyToStored(policy: AutonomyPolicy): Record<string, number> {
  const out: Record<string, number> = {};
  for (const lane of AUTONOMY_LANES) {
    if (lane === 'code') continue;
    if (policy[lane] !== EFFECTIVE_DEFAULTS[lane]) out[lane] = policy[lane];
  }
  return out;
}
