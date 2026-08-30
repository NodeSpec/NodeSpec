import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../theme/ThemeContext.js';
import type { Project } from '../../../persistence/types.js';
import { useAuth, useProject } from '../../context/ServiceContext.js';
import type { FeatureGate } from '../../hooks/useFeatureGate.js';
import { hasTemplatesGallery } from '../../config/edition.js';

interface ProjectExplorerProps {
  currentProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onClose: () => void;
  onDeleteCurrentProject?: () => void;
  featureGate?: FeatureGate;
}

export function ProjectExplorer({
  currentProjectId,
  onSelectProject,
  onCreateProject,
  onClose,
  onDeleteCurrentProject,
  featureGate,
}: ProjectExplorerProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const navigate = useNavigate();
  const auth = useAuth();
  const projectService = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; isActive: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await auth.getSession();

      if (!session) {
        throw new Error('Not authenticated');
      }

      const projectList = await projectService.listProjects(session.user.id);
      setProjects(projectList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [auth, projectService]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDeleteProject = useCallback((projectId: string, projectName: string, isActive: boolean) => {
    setPendingDelete({ id: projectId, name: projectName, isActive });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await projectService.deleteProject(pendingDelete.id);
      setPendingDelete(null);
      if (pendingDelete.isActive) {
        onClose();
        onDeleteCurrentProject?.();
      } else {
        await loadProjects();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, projectService, loadProjects, onClose, onDeleteCurrentProject]);

  const overlayStyles: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    backdropFilter: 'blur(4px)',
  };

  const panelStyles: React.CSSProperties = {
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '12px',
    boxShadow: theme.mode === 'dark' ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 32px rgba(0,0,0,0.2)',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerStyles: React.CSSProperties = {
    padding: '20px 24px',
    borderBottom: `1px solid ${c.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const titleStyles: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 600,
    color: c.text,
  };

  const contentStyles: React.CSSProperties = {
    padding: '16px',
    overflowY: 'auto',
    flex: 1,
  };

  const projectListStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  const projectItemStyles = (isActive: boolean): React.CSSProperties => ({
    padding: '12px 16px',
    backgroundColor: isActive ? c.primary : c.backgroundSecondary,
    color: isActive ? '#fff' : c.text,
    border: `1px solid ${isActive ? c.primary : c.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: 'all 0.2s',
  });

  const projectInfoStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  };

  const projectNameStyles: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
  };

  const projectMetaStyles: React.CSSProperties = {
    fontSize: '11px',
    opacity: 0.7,
  };

  const buttonContainerStyles: React.CSSProperties = {
    padding: '16px 24px',
    borderTop: `1px solid ${c.border}`,
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
  };

  const buttonStyles = (isPrimary: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    borderRadius: '6px',
    border: isPrimary ? 'none' : `1px solid ${c.border}`,
    backgroundColor: isPrimary ? c.primary : 'transparent',
    color: isPrimary ? '#fff' : c.text,
    cursor: 'pointer',
    transition: 'all 0.2s',
  });

  const deleteButtonStyles: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: '11px',
    backgroundColor: '#ef4444',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginLeft: '8px',
  };

  if (pendingDelete) {
    return (
      <div style={overlayStyles} onClick={() => !deleting && setPendingDelete(null)}>
        <div
          style={{
            backgroundColor: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: '12px',
            boxShadow: theme.mode === 'dark' ? '0 8px 32px rgba(0,0,0,0.7)' : '0 8px 32px rgba(0,0,0,0.25)',
            width: '420px',
            maxWidth: '90%',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '17px', fontWeight: 600, color: c.text }}>
              Delete project?
            </div>
            <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: '1.5' }}>
              <span style={{ fontWeight: 600, color: c.text }}>{pendingDelete.name}</span> will be permanently deleted.
              This action cannot be undone.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
              style={{
                padding: '8px 18px',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '6px',
                border: `1px solid ${c.border}`,
                backgroundColor: 'transparent',
                color: c.text,
                cursor: deleting ? 'not-allowed' : 'pointer',
                opacity: deleting ? 0.5 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              Cancel
            </button>
            <button
              disabled={deleting}
              onClick={handleConfirmDelete}
              style={{
                padding: '8px 18px',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#dc2626',
                color: '#fff',
                cursor: deleting ? 'not-allowed' : 'pointer',
                opacity: deleting ? 0.7 : 1,
                transition: 'opacity 0.15s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {deleting ? 'Deleting...' : 'Delete project'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyles} onClick={onClose}>
      <div style={panelStyles} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyles}>
          <div style={titleStyles}>Projects</div>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: c.textMuted,
              cursor: 'pointer',
              fontSize: '20px',
              padding: '4px 8px',
            }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div style={contentStyles}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px', color: c.textMuted }}>
              Loading projects...
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '12px',
                backgroundColor: '#fee',
                border: '1px solid #fcc',
                borderRadius: '6px',
                color: '#c00',
                fontSize: '13px',
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && projects.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: c.textMuted }}>
              No projects yet. Create your first project!
            </div>
          )}

          {!loading && !error && projects.length > 0 && (
            <div style={projectListStyles}>
              {projects.map((project) => {
                const isActive = project.id === currentProjectId;
                return (
                  <div
                    key={project.id}
                    style={projectItemStyles(isActive)}
                    onClick={() => !isActive && onSelectProject(project.id)}
                  >
                    <div style={projectInfoStyles}>
                      <div style={projectNameStyles}>{project.name}</div>
                      <div style={projectMetaStyles}>
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {isActive && (
                        <div
                          style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '4px 8px',
                            backgroundColor: 'rgba(255,255,255,0.2)',
                            borderRadius: '4px',
                          }}
                        >
                          ACTIVE
                        </div>
                      )}
                      <button
                        style={deleteButtonStyles}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteProject(project.id, project.name, isActive);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={buttonContainerStyles}>
          {featureGate && featureGate.projectLimitReached(projects.length) && (
            <div style={{
              fontSize: '11px',
              color: c.textMuted,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginRight: 'auto',
            }}>
              Community: 2 project limit
            </div>
          )}
          <button style={buttonStyles(false)} onClick={onClose}>
            Close
          </button>
          {hasTemplatesGallery && (
          <button
            style={{
              ...buttonStyles(false),
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={() => { onClose(); navigate('/templates'); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Start from Template
          </button>
          )}
          <button
            style={{
              ...buttonStyles(true),
              ...(featureGate?.projectLimitReached(projects.length) ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
            }}
            onClick={onCreateProject}
            disabled={featureGate?.projectLimitReached(projects.length)}
          >
            + New Project
          </button>
        </div>
      </div>
    </div>
  );
}
