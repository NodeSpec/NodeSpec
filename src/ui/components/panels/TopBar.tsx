import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../theme/ThemeContext.js';
import { NotificationCenter } from '../common/NotificationCenter.js';
import { AccountPanel } from './AccountPanel.js';
import { BranchManager } from './BranchManager.js';
import { GitIntegrationModal } from './GitIntegrationModal.js';
import { SkillsMenu } from './SkillsMenu.js';
import { McpStatusIndicator } from './McpStatusIndicator.js';
import { useNotificationStore } from '../../store/notification-store.js';
import { useIsAdmin } from '../../hooks/useAdmin.js';
import { hasTemplatesGallery, hasAdminPortal } from '../../config/edition.js';
import type { FeatureGate } from '../../hooks/useFeatureGate.js';
import logoLight from '../../assets/lightmode_nodal.png';
import logoDark from '../../assets/darkmode_nodal.png';

interface TopBarProps {
  branchName: string;
  /** The trunk's REAL name (may differ from 'main' after a connect rename). */
  primaryBranchName?: string;
  hasUnsavedChanges?: boolean;
  branches?: string[];
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onShowHelp?: () => void;
  userEmail?: string;
  projectName?: string;
  projectId?: string;
  onOpenProjects?: () => void;
  /** P1-7 C1.2: persists any unsaved canvas patches; push waits on it so the snapshot is current. */
  ensureDraftSaved?: () => Promise<boolean>;
  onSwitchBranch?: (branchId: string, branchName: string) => void;
  onCreateBranch?: () => void;
  /** R3-3b: opens the merge dialog (PR default / direct secondary) — never merges directly. */
  onMergeBranch?: () => void;
  onDeleteBranch?: (branchId: string, branchName: string) => void;
  availableBranches?: Array<{ id: string; name: string; patchCount: number }>;
  /** R3-1: canvas reload after restore-from-anchor (git wins). */
  onModelRestored?: () => void | Promise<void>;
  /** R3-3c: the ref-deleted lifecycle card's Archive action (deletes the design branch). */
  onArchiveBranch?: (branchName: string) => Promise<void>;
  /** N6.2(c) rev 2: pending proposal count for the Changes button badge. */
  pendingProposals?: number;
  onOpenChanges?: () => void;
  openGitIntegration?: boolean;
  onGitIntegrationOpened?: () => void;
  /** Fired when the git panel closes — a connect may have RENAMED the trunk
   *  (owner spike 2026-08-23); the branch header must re-read. */
  onGitIntegrationClosed?: () => void;
  featureGate?: FeatureGate;
  /** Returns null on success, or a user-visible error that keeps the card row. */
  onAcceptGitChange?: (artifactId: string, newContent: string, path: string, sourceCommit?: string) => string | null;
  onDeleteGitArtifact?: (artifactId: string, path: string) => string | null;
  /** R3-4c: bind an unattributed repo file (residue) to a node. */
  onBindResidueFile?: (path: string, nodeId: string, content: string, sourceCommit?: string) => string | null;
  /** R3-4c: bindable (non-container) nodes for the residue picker. */
  bindTargetNodes?: Array<{ id: string; label: string }>;
  graphArtifacts?: Record<string, { path?: string; content?: string; nodeId?: string }>;
  pendingGitChanges?: number;
  /** Owner 2026-07-30: the integration's default git ref — display-only annotation on the Branches button. */
  gitDefaultBranch?: string | null;
  onProjectRenamed?: (newName: string) => void;
  openAccount?: boolean;
  onAccountOpened?: () => void;
}

interface ProjectNameButtonProps {
  projectName: string;
  projectId?: string;
  c: ReturnType<typeof useTheme>['theme']['colors'];
  branchBadgeStyles: React.CSSProperties;
  branchIconStyles: React.CSSProperties;
  onOpenProjects: () => void;
  onProjectRenamed?: (newName: string) => void;
}

function ProjectNameButton({
  projectName,
  projectId,
  c,
  branchBadgeStyles,
  branchIconStyles,
  onOpenProjects,
  onProjectRenamed,
}: ProjectNameButtonProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(projectName);
  }, [projectName]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== projectName && onProjectRenamed && projectId) {
      onProjectRenamed(trimmed);
    } else {
      setEditValue(projectName);
    }
  }, [editValue, projectName, onProjectRenamed, projectId]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={editValue}
        onChange={e => setEditValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={e => {
          if (e.key === 'Enter') commitRename();
          if (e.key === 'Escape') {
            setEditValue(projectName);
            setEditing(false);
          }
        }}
        style={{
          ...branchBadgeStyles,
          border: `2px solid ${c.primary}`,
          backgroundColor: c.surface,
          color: c.text,
          outline: 'none',
          minWidth: '120px',
          fontWeight: 500,
        }}
      />
    );
  }

  return (
    <button
      style={{
        ...branchBadgeStyles,
        cursor: 'pointer',
        border: `1px solid ${c.border}`,
        backgroundColor: c.surface,
        transition: 'all 0.2s',
      }}
      onClick={onOpenProjects}
      onDoubleClick={e => {
        e.stopPropagation();
        if (onProjectRenamed && projectId) {
          setEditing(true);
        }
      }}
      title="Click to switch project, double-click to rename"
    >
      <svg style={branchIconStyles} viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.11-.9-2-2-2h-8l-2-2z"/>
      </svg>
      {projectName}
    </button>
  );
}

function TopBarComponent({
  branchName,
  primaryBranchName,
  hasUnsavedChanges = false,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onShowHelp,
  userEmail,
  projectName,
  projectId,
  onOpenProjects,
  ensureDraftSaved,
  onSwitchBranch,
  onMergeBranch,
  onCreateBranch,
  onDeleteBranch,
  availableBranches = [],
  onModelRestored,
  onArchiveBranch,
  pendingProposals = 0,
  onOpenChanges,
  openGitIntegration,
  onGitIntegrationOpened,
  onGitIntegrationClosed,
  featureGate,
  onProjectRenamed,
  openAccount,
  onAccountOpened,
  onAcceptGitChange,
  onDeleteGitArtifact,
  onBindResidueFile,
  bindTargetNodes,
  graphArtifacts,
  pendingGitChanges = 0,
  gitDefaultBranch,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const c = theme.colors;
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [gitIntegrationOpen, setGitIntegrationOpen] = useState(false);

  useEffect(() => {
    if (openGitIntegration && !gitIntegrationOpen) {
      setGitIntegrationOpen(true);
      onGitIntegrationOpened?.();
    }
  }, [openGitIntegration, gitIntegrationOpen, onGitIntegrationOpened]);

  useEffect(() => {
    if (openAccount && !accountOpen) {
      setAccountOpen(true);
      onAccountOpened?.();
    }
  }, [openAccount, accountOpen, onAccountOpened]);
  const { notifications, markAsRead, clearAll, removeNotification } = useNotificationStore();

  const unreadCount = notifications.filter(n => !n.read).length;

  const barStyles: React.CSSProperties = {
    height: '56px',
    backgroundColor: c.surface,
    borderBottom: `1px solid ${c.border}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    position: 'relative',
    zIndex: 1100,
  };

  const leftStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  };

  const logoStyles: React.CSSProperties = {
    height: '40px',
    width: 'auto',
    display: 'block',
  };

  const branchBadgeStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    backgroundColor: c.background,
    borderRadius: '16px',
    fontSize: '12px',
    color: c.textMuted,
  };

  const branchIconStyles: React.CSSProperties = {
    width: '14px',
    height: '14px',
  };

  const rightStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  };




  const themeToggleStyles: React.CSSProperties = {
    width: '36px',
    height: '36px',
    borderRadius: '8px',
    border: `1px solid ${c.border}`,
    backgroundColor: c.background,
    color: c.textMuted,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
  };

  const notificationButtonStyles: React.CSSProperties = {
    ...themeToggleStyles,
    position: 'relative',
    backgroundColor: notificationsOpen ? c.primary : c.background,
    color: notificationsOpen ? 'white' : c.textMuted,
  };

  const badgeStyles: React.CSSProperties = {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    backgroundColor: c.error,
    color: 'white',
    fontSize: '10px',
    fontWeight: 600,
    padding: '2px 5px',
    borderRadius: '10px',
    minWidth: '18px',
    textAlign: 'center',
  };

  return (
    <div style={barStyles}>
      <div style={leftStyles}>
        <img
          src={theme.mode === 'dark' ? logoDark : logoLight}
          alt="NodeSpec"
          style={logoStyles}
        />
        {hasAdminPortal && isAdmin && (
          <button
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#fff',
              backgroundColor: '#ef4444',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              letterSpacing: '0.3px',
              transition: 'all 0.15s',
            }}
            onClick={() => navigate('/admin')}
            title="Admin Dashboard"
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#dc2626'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#ef4444'; }}
          >
            Admin
          </button>
        )}
        {onOpenProjects && projectName && (
          <ProjectNameButton
            projectName={projectName}
            projectId={projectId}
            c={c}
            branchBadgeStyles={branchBadgeStyles}
            branchIconStyles={branchIconStyles}
            onOpenProjects={onOpenProjects}
            onProjectRenamed={onProjectRenamed}
          />
        )}
        {hasTemplatesGallery && (
        <button
          style={themeToggleStyles}
          onClick={() => navigate('/templates')}
          data-tour="templates"
          title="Browse Templates"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
            <path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" />
            <path d="M12 3v6" />
          </svg>
        </button>
        )}
        {!onSwitchBranch && (
          <div style={branchBadgeStyles}>
            <svg style={branchIconStyles} viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 3v2h-2V3H5v2H3V3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zm0 18v-2h-2v2H5v-2H3v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM3 9h2v6H3V9zm16 0h2v6h-2V9zm-8-3a6 6 0 0 0-6 6 6 6 0 0 0 6 6 6 6 0 0 0 6-6 6 6 0 0 0-6-6zm0 2c2.22 0 4 1.79 4 4s-1.78 4-4 4-4-1.79-4-4 1.78-4 4-4z" />
            </svg>
            {branchName}
            {hasUnsavedChanges && <span style={{ color: '#f59e0b', marginLeft: '4px' }}>●</span>}
          </div>
        )}
        {branchName !== (primaryBranchName ?? 'main') && onMergeBranch && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {(
              <button
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 4px rgba(16, 185, 129, 0.3)',
                }}
                onClick={onMergeBranch}
                title="Merge this design branch into main — opens a pull request (default) or merges directly in git"
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#059669';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#10b981';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {/* Owner ruling 2026-07-30: the ellipsis is the fix — the button
                    OPENS the PR-or-direct chooser, it does not merge on click.
                    The verb stays "Merge" because both dialog paths ARE merges
                    (the PR is the review-first vehicle). */}
                ↑ Merge to Main…
              </button>
            )}
          </div>
        )}
      </div>

      <div style={rightStyles}>
        {/* Owner-directed header rework (2026-07-28): Branches + a PERMANENT Git
            button live on the RIGHT, next to the history controls. The Git button
            used to exist only while changes were pending (invisible otherwise) and
            Git Integration was buried in the Branches dropdown. Amber + badge when
            changes are pending; neutral otherwise. */}
        {onSwitchBranch && onDeleteBranch && (
          <BranchManager
            currentBranch={branchName}
            availableBranches={availableBranches}
            onSwitchBranch={onSwitchBranch}
            onDeleteBranch={onDeleteBranch}
            onCreateBranch={onCreateBranch}
            gitDefaultBranch={gitDefaultBranch}
          />
        )}
        <McpStatusIndicator buttonStyle={themeToggleStyles} />
        <SkillsMenu buttonStyle={themeToggleStyles} />
        {onOpenChanges && (
          <button
            onClick={onOpenChanges}
            data-tour="changes"
            title={pendingProposals > 0
              ? `Changes — ${pendingProposals} pending proposal${pendingProposals !== 1 ? 's' : ''} to review`
              : 'Changes — pending proposals & history'}
            style={{
              ...themeToggleStyles,
              position: 'relative',
              ...(pendingProposals > 0 ? {
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                borderColor: '#2563eb',
                color: '#2563eb',
              } : {}),
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l4 2" />
            </svg>
            {pendingProposals > 0 && (
              <span style={{
                position: 'absolute', top: '-4px', right: '-4px',
                backgroundColor: '#2563eb', color: '#fff',
                fontSize: '10px', fontWeight: 700,
                width: '16px', height: '16px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}>
                {pendingProposals > 9 ? '9+' : pendingProposals}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => setGitIntegrationOpen(true)}
          data-tour="git"
          title={pendingGitChanges > 0
            ? `Git Integration — ${pendingGitChanges} external change${pendingGitChanges !== 1 ? 's' : ''} detected`
            : 'Git Integration'}
          style={{
            ...themeToggleStyles,
            position: 'relative',
            ...(pendingGitChanges > 0 ? {
              backgroundColor: '#fffbeb',
              borderColor: '#f59e0b',
              color: '#d97706',
            } : {}),
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3v12" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          {pendingGitChanges > 0 && (
            <span style={{
              position: 'absolute', top: '-4px', right: '-4px',
              backgroundColor: '#f59e0b', color: '#fff',
              fontSize: '10px', fontWeight: 700,
              width: '16px', height: '16px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}>
              {pendingGitChanges > 9 ? '9+' : pendingGitChanges}
            </span>
          )}
        </button>
        {/* N6.1 (owner): counters and the token meter are gone; the header now
            carries the canvas history controls. Canvas edits autosave but are NOT
            automatic git pushes, so undo/redo is the safety net. */}
        <button
          style={{ ...themeToggleStyles, opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'default' }}
          onClick={canUndo ? onUndo : undefined}
          disabled={!canUndo}
          title="Undo (Cmd/Ctrl+Z)"
        >
          <Undo2 size={16} strokeWidth={2} />
        </button>
        <button
          style={{ ...themeToggleStyles, opacity: canRedo ? 1 : 0.35, cursor: canRedo ? 'pointer' : 'default' }}
          onClick={canRedo ? onRedo : undefined}
          disabled={!canRedo}
          title="Redo (Cmd/Ctrl+Shift+Z)"
        >
          <Redo2 size={16} strokeWidth={2} />
        </button>
        {onShowHelp && (
          <button
            style={themeToggleStyles}
            onClick={onShowHelp}
            data-tour="help"
            title="Help & Terminology"
          >
            ?
          </button>
        )}
        <button
          style={notificationButtonStyles}
          onClick={() => {
            setNotificationsOpen(!notificationsOpen);
            setAccountOpen(false);
          }}
          data-tour="notifications"
          title="Notifications"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          {unreadCount > 0 && (
            <span style={badgeStyles}>{unreadCount}</span>
          )}
        </button>
        <button
          style={{
            ...themeToggleStyles,
            backgroundColor: accountOpen ? c.primary : c.background,
            color: accountOpen ? 'white' : c.textMuted,
          }}
          onClick={() => {
            setAccountOpen(!accountOpen);
            setNotificationsOpen(false);
          }}
          data-tour="account"
          title="Account Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </button>
        <button style={themeToggleStyles} onClick={toggleTheme} title={`Switch to ${theme.mode === 'dark' ? 'light' : 'dark'} mode`}>
          {theme.mode === 'dark' ? '\u2600' : '\u263E'}
        </button>
      </div>

      {notificationsOpen && (
        <NotificationCenter
          notifications={notifications}
          onMarkAsRead={markAsRead}
          onClearAll={clearAll}
          onRemove={removeNotification}
          onClose={() => setNotificationsOpen(false)}
        />
      )}

      {accountOpen && (
        <AccountPanel
          userEmail={userEmail}
          onClose={() => setAccountOpen(false)}
        />
      )}

      {gitIntegrationOpen && projectId && (
        <GitIntegrationModal
          isOpen={gitIntegrationOpen}
          onClose={() => { setGitIntegrationOpen(false); onGitIntegrationClosed?.(); }}
          projectId={projectId}
          currentBranch={branchName}
          onModelRestored={onModelRestored}
          onArchiveBranch={onArchiveBranch}
          featureGate={featureGate}
          onAcceptChange={onAcceptGitChange}
          onDeleteArtifact={onDeleteGitArtifact}
          onBindResidueFile={onBindResidueFile}
          bindTargetNodes={bindTargetNodes}
          graphArtifacts={graphArtifacts}
          ensureDraftSaved={ensureDraftSaved}
        />
      )}

    </div>
  );
}

export const TopBar = memo(TopBarComponent);
