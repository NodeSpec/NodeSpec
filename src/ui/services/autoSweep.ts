// AL.24 (owner 2026-10-05): Auto is the server's. A proposal an agent files
// under Auto applies as it files, whether or not the app is open; the app no
// longer polls to accept anything. What it still does is ask the server to
// sweep the backlog: when a lane is set to Auto (what waited under Propose
// applies now) and when a project opens (anything that could not apply
// before, such as a file git had not served yet, is tried again). The sweep
// is resolve_proposal action 'auto', with the person's session; it applies
// only what each proposal's own filer could have had applied at filing.
import { callEdgeFunction } from '../../persistence/supabase/client.js';

export interface AutoSweep {
  applied: Array<{ proposalId: string; plane: 'spec' | 'canvas' }>;
  waiting: Array<{ proposalId: string; reason: string }>;
  setAside: Array<{ proposalId: string; reason: string }>;
  busy: string[];
  plans: Array<{ planId: string; status: 'accepted' | 'waiting'; reason?: string }>;
}

/** Ask the server to apply what the Auto lanes cover. Null when it could not
 *  (no seat to decide, or the call failed): nothing changed. */
export async function sweepAutoLanes(projectId: string): Promise<AutoSweep | null> {
  try {
    const r = await callEdgeFunction<{ success: boolean; data?: AutoSweep }>('mcp-server', {
      tool: 'resolve_proposal',
      arguments: { project_id: projectId, action: 'auto' },
    });
    return r.success && r.data ? r.data : null;
  } catch {
    return null;
  }
}

/** What the sweep did, in one line for the person, or null when it changed nothing. */
export function sweepLine(sweep: AutoSweep | null): string | null {
  if (!sweep) return null;
  const applied = sweep.applied.length + sweep.plans.filter((p) => p.status === 'accepted').length;
  const setAside = sweep.setAside.length;
  if (applied + setAside === 0) return null;
  const parts: string[] = [];
  if (applied > 0) parts.push(`Auto applied ${applied} waiting proposal${applied === 1 ? '' : 's'}.`);
  if (setAside > 0) parts.push(`${setAside} could not apply and ${setAside === 1 ? 'was' : 'were'} set aside; ${setAside === 1 ? 'its agent reads' : 'their agents read'} why.`);
  return parts.join(' ');
}
