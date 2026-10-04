// V3 8.2 (bound to 1.6): the Autonomy settings' data — the project's
// automation_policy (one jsonb on projects, keyed by tier) read and
// written through the user's own session (RLS: a maintainer or the owner
// updates the project row; anyone else sees the refusal as an error). The
// architecture lane also mirrors the canvas driver's opt-in
// (metadata.autoApproveProposals) so "Auto-apply" on that lane IS the
// existing canvas auto-approve, never a parallel switch. Only lanes that
// differ from the shipped default are stored (policyToStored) — an empty
// object stays "today's routing", resolved in code on both sides.
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import {
  type AutonomyLane, type AutonomyLevel, type AutonomyPolicy,
  resolveAutonomyPolicy, policyToStored, presetPolicy,
} from '../../utils/autonomy.js';

export interface AutonomySettings {
  policy: AutonomyPolicy;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setLane: (lane: AutonomyLane, level: AutonomyLevel) => Promise<void>;
  applyPreset: (preset: 'approve' | 'auto') => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAutonomySettings(projectId: string | null | undefined): AutonomySettings {
  const [policy, setPolicy] = useState<AutonomyPolicy>(() => resolveAutonomyPolicy({}));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) { setPolicy(resolveAutonomyPolicy({})); setLoading(false); return; }
    try {
      const { data, error: err } = await getSupabaseClient()
        .from('projects')
        .select('automation_policy, metadata')
        .eq('id', projectId)
        .maybeSingle();
      if (err) throw err;
      const row = data as { automation_policy?: unknown; metadata?: Record<string, unknown> | null } | null;
      const resolved = resolveAutonomyPolicy(row?.automation_policy);
      // the canvas opt-in is the architecture lane's "Auto-apply" when the policy is silent on it
      const stored = (row?.automation_policy ?? {}) as Record<string, unknown>;
      if (stored.architecture === undefined && row?.metadata?.autoApproveProposals === true) resolved.architecture = 2;
      setPolicy(resolved);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const write = useCallback(async (next: AutonomyPolicy) => {
    if (!projectId) return;
    const previous = policy;
    setPolicy(next);
    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      // Read-modify-write on metadata so sibling keys survive the mirror.
      const { data } = await supabase.from('projects').select('metadata').eq('id', projectId).maybeSingle();
      const metadata = { ...(((data as { metadata?: Record<string, unknown> | null } | null)?.metadata) ?? {}), autoApproveProposals: next.architecture === 2 };
      const { data: updated, error: err } = await supabase
        .from('projects')
        .update({ automation_policy: policyToStored(next), metadata })
        .eq('id', projectId)
        .select('id');
      if (err) throw err;
      // RLS: a seat below maintainer updates nothing — say so instead of pretending.
      if (!updated || (updated as unknown[]).length === 0) throw new Error('Only the project owner or a maintainer can change Autonomy settings.');
      setError(null);
    } catch (e) {
      setPolicy(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [projectId, policy]);

  const setLane = useCallback(async (lane: AutonomyLane, level: AutonomyLevel) => {
    if (lane === 'code') return; // pinned by the database
    await write({ ...policy, [lane]: level, code: 0 });
  }, [policy, write]);

  const applyPreset = useCallback(async (preset: 'approve' | 'auto') => {
    await write(presetPolicy(preset));
  }, [write]);

  return { policy, loading, saving, error, setLane, applyPreset, refresh };
}
