// N4: semantic zoom — the ontology's altitude axis finally does render-time work.
// Pure functions only (the Canvas wires them to viewport state); all effects go through
// the EXISTING machinery: the compact→icon type swap and the visual-meta collapse overlay
// (visual-only — zero graph patches, zero anchor impact).
//
// The invariant that matters: a BOUNDARY node (engine you configure, never author —
// n8n, a managed service with treatmentOverride) NEVER explodes and never dissolves
// into an anonymous icon. It has no internals to reveal, and its identity (name + tech)
// IS its interface — it keeps its card at every band.

export type ZoomBand = 'detail' | 'service' | 'system';

/** Discrete bands over the React Flow zoom value. Thresholds assume minZoom 0.15 /
 *  default max 2: ≥0.75 you're working (detail) · ≥0.4 you're arranging (service) ·
 *  below that you're surveying the system. Band changes are sampled at gesture end
 *  (onMoveEnd), which is the hysteresis — no per-frame churn. */
export function zoomBandForZoom(zoom: number): ZoomBand {
  if (zoom >= 0.75) return 'detail';
  if (zoom >= 0.4) return 'service';
  return 'system';
}

export interface SemanticNodeInfo {
  /** M7: the `altitude` field is gone from this shape too. M1c deleted the axis and left
   *  the parameter behind, so every caller was threading a value nothing read — and
   *  graph-to-reactflow had already stopped assigning it, so it was always undefined. */
  /** Containers are never icon-demoted — they COLLAPSE (summary chip) instead. */
  isContainer: boolean;
  /** effectiveTreatment(role, tech) === 'boundary' — the never-explodes exemption. */
  sealedBoundary?: boolean;
}

/** Should this node render as a bare icon at the given band?
 *  detail → never · service → never · system → all leaves.
 *  Containers and sealed-boundary nodes are exempt at every band.
 *
 *  M1c: the `altitude` axis is gone and this is where it died. Its ONLY read was the
 *  service-band test `altitude === 'component'`, and the `component` band was deliberately
 *  never populated (the N1 migration calls it "a reserved band") — so that branch was
 *  always false on every one of the 125 catalog rows. Removing the axis therefore changes
 *  no rendering; it just stops pretending the service band does something it never did. */
export function demotesToIcon(band: ZoomBand, info: SemanticNodeInfo): boolean {
  if (band === 'detail') return false;
  if (info.isContainer || info.sealedBoundary) return false;
  return band === 'system';
}

/** N4.1: a collapsed module should read as ONE representative thing — "the React module",
 *  not an anonymous box. Returns up to `max` distinct child technology ids, dominant
 *  (most frequent) first; frequency ties break alphabetically for a stable render.
 *  Children without a technology don't vote. */
export function dominantChildTechnologies(
  children: Array<{ technology?: string | null }>,
  max = 3,
): string[] {
  const counts = new Map<string, number>();
  for (const child of children) {
    if (!child.technology) continue;
    counts.set(child.technology, (counts.get(child.technology) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([tech]) => tech);
}
