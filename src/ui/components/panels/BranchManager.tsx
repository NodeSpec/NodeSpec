import { useState } from 'react';

interface BranchManagerProps {
  currentBranch: string;
  availableBranches: Array<{ id: string; name: string; patchCount: number; isPrimary?: boolean }>;
  onSwitchBranch: (branchId: string, branchName: string) => void;
  onDeleteBranch: (branchId: string, branchName: string) => void;
  onCreateBranch?: () => void;
  /** Owner 2026-07-30: the integration's default git ref (e.g. "master"). DISPLAY
   *  ONLY — NodeSpec's main branch is structurally named 'main' (name-derived
   *  main-ness across the gitops stack); when the bound ref differs, the button
   *  annotates it instead of pretending the ref is called main. */
  gitDefaultBranch?: string | null;
}

export function BranchManager({
  currentBranch,
  availableBranches,
  onSwitchBranch,
  onDeleteBranch,
  onCreateBranch,
  gitDefaultBranch,
}: BranchManagerProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  // Owner spike 2026-08-23: primacy is the FLAG — connect renames the trunk
  // row to the bound git branch, so the header shows the real name. The
  // → alias only remains for legacy trunks whose rename was skipped.
  const isPrimaryBranch = (name: string) =>
    availableBranches.find(b => b.name === name)?.isPrimary ?? name === 'main';
  const mainRefLabel = isPrimaryBranch(currentBranch) && gitDefaultBranch && gitDefaultBranch !== currentBranch
    ? gitDefaultBranch
    : null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        style={{
          padding: '6px 12px',
          backgroundColor: isPrimaryBranch(currentBranch) ? '#10b981' : '#3b82f6',
          color: 'white',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '6px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '14px',
          fontWeight: '500',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"/>
        </svg>
        <span>{currentBranch}</span>
        {mainRefLabel && (
          <span
            title={`NodeSpec's main design branch is bound to the git branch "${mainRefLabel}"`}
            style={{ fontSize: '12px', fontWeight: 400, opacity: 0.85 }}
          >
            → {mainRefLabel}
          </span>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 9L1 4h10L6 9z"/>
        </svg>
      </button>

      {showDropdown && (
        <>
          <div
            onClick={() => setShowDropdown(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
              minWidth: '280px',
              zIndex: 1000,
              overflow: 'hidden',
            }}
          >
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#f9fafb',
            }}>
              <span style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>Branches</span>
            </div>

            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {availableBranches.map(branch => (
                <div
                  key={branch.id}
                  style={{
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: currentBranch === branch.name ? '#e0f2fe' : 'transparent',
                    color: '#111827',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    if (currentBranch !== branch.name) {
                      e.currentTarget.style.backgroundColor = '#f3f4f6';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentBranch !== branch.name) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <div
                    onClick={() => {
                      onSwitchBranch(branch.id, branch.name);
                      setShowDropdown(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flex: 1,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: '14px', color: '#111827' }}>{branch.name}</span>
                    {currentBranch === branch.name && (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                      </svg>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {/* Owner 2026-07-30: the per-branch "N changes" count is GONE —
                        it counted local patch rows, which says nothing useful once
                        a branch is git-bound (and read as stale the moment work was
                        committed). Only the 'default' marker on main survives. */}
                    {(branch.isPrimary ?? branch.name === 'main') && (
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>default</span>
                    )}
                    {!(branch.isPrimary ?? branch.name === 'main') && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete branch "${branch.name}"? This will permanently remove all saved changes in this branch.`)) {
                            onDeleteBranch(branch.id, branch.name);
                            setShowDropdown(false);
                          }
                        }}
                        style={{
                          padding: '4px 6px',
                          backgroundColor: 'transparent',
                          color: '#ef4444',
                          border: '1px solid transparent',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#fee2e2';
                          e.currentTarget.style.borderColor = '#ef4444';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.borderColor = 'transparent';
                        }}
                        title="Delete branch"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M11 1.75V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675a.75.75 0 10-1.492.15l.66 6.6A1.75 1.75 0 005.405 15h5.19c.9 0 1.652-.681 1.741-1.576l.66-6.6a.75.75 0 00-1.492-.149l-.66 6.6a.25.25 0 01-.249.225h-5.19a.25.25 0 01-.249-.225l-.66-6.6z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              padding: '8px',
              borderTop: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}>
              {onCreateBranch && (
                <button
                  onClick={() => {
                    onCreateBranch();
                    setShowDropdown(false);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#ffffff',
                    color: '#111827',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'background-color 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#f3f4f6';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ffffff';
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New Branch
                </button>
              )}

            </div>
          </div>
        </>
      )}
    </div>
  );
}
