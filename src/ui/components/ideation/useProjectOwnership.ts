// V3 AE.7 (owner 2026-09-25): who the signed-in person is to the project
// the Work surface shows. The owner writes the Workflows tables directly; a
// teammate's edit is a proposal (or a direct write when the project's
// Outcomes & workflow setting is Auto-apply). One read per project.
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';

export interface ProjectOwnership {
  /** Both reads answered; until then the person is treated as the owner. */
  loaded: boolean;
  isOwner: boolean;
  /** The person's sign-in email: the name a proposal carries. */
  email: string | null;
}

const UNKNOWN: ProjectOwnership = { loaded: false, isOwner: true, email: null };

export function useProjectOwnership(projectId: string | null | undefined): ProjectOwnership {
  const [state, setState] = useState<ProjectOwnership>(UNKNOWN);
  useEffect(() => {
    if (!projectId) { setState(UNKNOWN); return; }
    let cancelled = false;
    setState(UNKNOWN);
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const [{ data: row }, { data: auth }] = await Promise.all([
          supabase.from('projects').select('owner_id').eq('id', projectId).maybeSingle(),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        const ownerId = (row as { owner_id?: string } | null)?.owner_id ?? null;
        const me = auth?.user?.id ?? null;
        setState({ loaded: true, isOwner: !!ownerId && !!me && ownerId === me, email: auth?.user?.email ?? null });
      } catch {
        if (!cancelled) setState({ loaded: true, isOwner: true, email: null });
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);
  return state;
}
