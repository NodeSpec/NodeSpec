// V3 1.2 (2026-09-19): one branch, one chip. The Branch Manager's dropdown
// (switch, delete, New Branch) retired with multi-branch: two NodeSpec
// branches split the canvas from the specification and the tick stream
// (docs/V3_OVERHAUL_PLAN.md, 2.2). The `branches` row stays as the graph
// plane's key; the user sees one chip that names it. Nothing here is
// clickable.
interface BranchChipProps {
  currentBranch: string;
  availableBranches: Array<{ id: string; name: string; isPrimary?: boolean }>;
  /** Owner 2026-07-30: the integration's default git ref (e.g. "master"). DISPLAY
   *  ONLY: when the bound ref is called something else, the chip annotates it
   *  instead of pretending the ref is called main. */
  gitDefaultBranch?: string | null;
  /** The autosave dot: pending canvas patches not yet in the snapshot. */
  hasUnsavedChanges?: boolean;
}

export function BranchChip({
  currentBranch,
  availableBranches,
  gitDefaultBranch,
  hasUnsavedChanges = false,
}: BranchChipProps) {
  // Owner spike 2026-08-23: primacy is the FLAG. Connect renames the trunk
  // row to the bound git branch, so the chip shows the real name; the
  // naming rule is the legacy fallback for a trunk whose rename was skipped.
  const isPrimaryBranch = (name: string) =>
    availableBranches.find(b => b.name === name)?.isPrimary ?? name === 'main';
  const primary = isPrimaryBranch(currentBranch);
  const mainRefLabel = isPrimaryBranch(currentBranch) && gitDefaultBranch && gitDefaultBranch !== currentBranch
    ? gitDefaultBranch
    : null;
  const title = mainRefLabel
    ? `NodeSpec's design branch "${currentBranch}" is bound to the git branch "${mainRefLabel}"`
    : `NodeSpec's design branch "${currentBranch}"`;

  return (
    <div
      data-testid="branch-chip"
      title={title}
      style={{
        padding: '6px 12px',
        backgroundColor: primary ? '#10b981' : '#3b82f6',
        color: 'white',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '14px',
        fontWeight: '500',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
      </svg>
      <span>{currentBranch}</span>
      {mainRefLabel && (
        <span style={{ fontSize: '12px', fontWeight: 400, opacity: 0.85 }}>
          → {mainRefLabel}
        </span>
      )}
      {hasUnsavedChanges && (
        <span title="Unsaved canvas changes" style={{ color: '#fde68a', marginLeft: '2px' }}>●</span>
      )}
    </div>
  );
}
