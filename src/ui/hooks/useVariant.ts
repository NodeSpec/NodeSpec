// V3 P3 (task 3.3): the variant hook — the one place a component asks
// "individual or team presentation?". Composes the live plan (the same
// subscription read useFeatureGate gates features with) with the build
// edition; resolution itself is the pure resolveVariant, pinned in
// variant-resolution.test.ts. Consumers: the P4 lane board (multi-lane
// vs single-lane), P6 presence chrome.
import { useMemo } from 'react';
import { useProjectFeatureGate } from './useProjectFeatureGate.js';
import { resolveVariant, type UIVariant } from '../config/variant.js';
import { featureInEdition } from '../config/feature-rules.js';
import { buildEdition } from '../config/edition.js';

export interface VariantState {
  variant: UIVariant;
  /** True while the subscription read is in flight — render the
   *  individual baseline rather than flashing team chrome. */
  loading: boolean;
}

/** Pass the project a surface shows: its presentation follows the
 *  project's plan (its owner's, decision 1); without one, the person's.
 *  The account's example shows Team mode on every plan, in a build that
 *  ships it (AJ.6). */
export function useVariant(projectId?: string | null): VariantState {
  const { plan, loading, example } = useProjectFeatureGate(projectId ?? null);
  return useMemo(() => ({
    variant: loading ? 'individual' : example && featureInEdition('team_lanes', buildEdition) ? 'team' : resolveVariant(plan),
    loading,
  }), [plan, loading, example]);
}
