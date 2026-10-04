// AA.7: the node's memory for the rail, one read (node_memory, migration
// 20260923210000) plus who is looking, so a person's own edit reads "you".
import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { rawNodeMemory, type RawNodeMemory } from '../../utils/node-memory.js';

export interface NodeMemoryRead { raw: RawNodeMemory | null; you: string | null; loading: boolean; error: string | null }

const EMPTY: NodeMemoryRead = { raw: null, you: null, loading: false, error: null };

export function useNodeMemory(projectId: string | null | undefined, branchId: string | null | undefined, nodeId: string | null | undefined): NodeMemoryRead {
  const [state, setState] = useState<NodeMemoryRead>(EMPTY);
  useEffect(() => {
    if (!projectId || !branchId || !nodeId) { setState(EMPTY); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const [mem, user] = await Promise.all([
          supabase.rpc('node_memory', { p_project_id: projectId, p_branch_id: branchId, p_node_id: nodeId, p_limit: 20 }),
          supabase.auth.getUser(),
        ]);
        if (cancelled) return;
        if (mem.error) { setState({ raw: null, you: null, loading: false, error: 'The node\'s history could not be read.' }); return; }
        setState({ raw: rawNodeMemory(mem.data), you: user.data?.user?.id ?? null, loading: false, error: null });
      } catch {
        if (!cancelled) setState({ raw: null, you: null, loading: false, error: 'The node\'s history could not be read.' });
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, branchId, nodeId]);
  return state;
}
