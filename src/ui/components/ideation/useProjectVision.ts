// The project's VISION, read and written where it is now shown: the Workflow
// board. It used to live in the Spec sidebar, which also quietly created the
// project_specifications row on first open. That responsibility comes with it,
// so the vision can be written on a project that has never had a spec row.
//
// One row per project by the P0 UNIQUE; the read takes the newest and the
// write targets it, creating it only when there is none. Same direct-table
// pattern as the rest of the ideation hooks, so the lock and membership
// policies meet it in the database rather than in a service layer.
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';

export interface ProjectVisionApi {
  vision: string;
  specId: string | null;
  loading: boolean;
  /** null on success, else the refusal in the database's own words. */
  error: string | null;
  refresh: () => Promise<void>;
  save: (vision: string) => Promise<string | null>;
}

export function useProjectVision(projectId: string | null | undefined, dataVersion = 0): ProjectVisionApi {
  const [vision, setVision] = useState('');
  const [specId, setSpecId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) { setVision(''); setSpecId(null); return; }
    setLoading(true);
    try {
      const { data, error: err } = await getSupabaseClient()
        .from('project_specifications')
        .select('id, vision')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (err) throw new Error(err.message);
      setSpecId((data?.id as string | undefined) ?? null);
      setVision(typeof data?.vision === 'string' ? data.vision : '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the vision');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh, dataVersion]);

  const save = useCallback(async (next: string): Promise<string | null> => {
    if (!projectId) return 'No project.';
    const text = next.trim();
    try {
      const supabase = getSupabaseClient();
      if (specId) {
        const { error: err } = await supabase
          .from('project_specifications')
          .update({ vision: text, updated_at: new Date().toISOString() })
          .eq('id', specId);
        if (err) return err.message;
      } else {
        // The sidebar used to mint this row on open. Nothing does now, so the
        // first vision written on a fresh project creates it.
        const { data, error: err } = await supabase
          .from('project_specifications')
          .insert({ project_id: projectId, vision: text, raw_input: '', phase_status: 'drafting_requirements' })
          .select('id')
          .single();
        if (err || !data) return err?.message ?? 'Failed to create the specification';
        setSpecId(data.id as string);
      }
      setVision(text);
      setError(null);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Failed to save the vision';
    }
  }, [projectId, specId]);

  return { vision, specId, loading, error, refresh, save };
}
