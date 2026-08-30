import { useState, useEffect } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';

const ACCENT = '#8B8FE6';

interface ProjectItem {
  id: string;
  name: string;
}

export interface TemplateApplyChoice {
  mode: 'new' | 'overwrite';
  projectId?: string;
  projectName?: string;
}

interface TemplateApplyDialogProps {
  templateName: string;
  userId: string;
  onConfirm: (choice: TemplateApplyChoice) => void;
  onCancel: () => void;
}

export function TemplateApplyDialog({
  templateName,
  userId,
  onConfirm,
  onCancel,
}: TemplateApplyDialogProps) {
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'new' | 'overwrite'>('new');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState(`${templateName} Project`);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase
      .from('projects')
      .select('id, name, created_at')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const items = (data ?? []) as ProjectItem[];
        setProjects(items);
        if (items.length > 0) {
          setSelectedProjectId(items[0].id);
        }
        setLoading(false);
      });
  }, [userId]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const handleConfirm = () => {
    if (mode === 'new') {
      onConfirm({ mode: 'new', projectName: newProjectName.trim() || `${templateName} Project` });
    } else if (selectedProjectId && confirmOverwrite) {
      onConfirm({ mode: 'overwrite', projectId: selectedProjectId });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: '100%',
        maxWidth: '480px',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '24px 28px 20px',
          borderBottom: '1px solid #f0f0f0',
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '18px',
            fontWeight: 700,
            color: '#1f2937',
            letterSpacing: '-0.01em',
          }}>
            Apply Template
          </h2>
          <p style={{
            margin: '6px 0 0',
            fontSize: '13px',
            color: '#6b7280',
            lineHeight: 1.5,
          }}>
            Choose how to apply "{templateName}"
          </p>
        </div>

        <div style={{ padding: '20px 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '14px 16px',
                borderRadius: '10px',
                border: `1.5px solid ${mode === 'new' ? ACCENT : '#e5e7eb'}`,
                backgroundColor: mode === 'new' ? 'rgba(139, 143, 230, 0.04)' : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onClick={() => { setMode('new'); setConfirmOverwrite(false); }}
            >
              <input
                type="radio"
                name="template-mode"
                checked={mode === 'new'}
                onChange={() => { setMode('new'); setConfirmOverwrite(false); }}
                style={{ marginTop: '2px', accentColor: ACCENT }}
              />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>
                  Create new project
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                  Start a fresh project with this template's architecture
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '14px 16px',
                borderRadius: '10px',
                border: `1.5px solid ${mode === 'overwrite' ? ACCENT : '#e5e7eb'}`,
                backgroundColor: mode === 'overwrite' ? 'rgba(139, 143, 230, 0.04)' : '#ffffff',
                cursor: projects.length === 0 ? 'not-allowed' : 'pointer',
                opacity: projects.length === 0 ? 0.5 : 1,
                transition: 'all 0.15s ease',
              }}
              onClick={() => { if (projects.length > 0) { setMode('overwrite'); setConfirmOverwrite(false); } }}
            >
              <input
                type="radio"
                name="template-mode"
                checked={mode === 'overwrite'}
                disabled={projects.length === 0}
                onChange={() => { setMode('overwrite'); setConfirmOverwrite(false); }}
                style={{ marginTop: '2px', accentColor: ACCENT }}
              />
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>
                  Overwrite existing project
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                  Replace an existing project's content with this template
                </div>
              </div>
            </label>
          </div>

          {mode === 'new' && (
            <div style={{ marginBottom: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>
                Project name
              </label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="My Project"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '14px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  color: '#1f2937',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s ease',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = ACCENT; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
              />
            </div>
          )}

          {mode === 'overwrite' && !loading && (
            <div>
              <label style={{ fontSize: '13px', fontWeight: 500, color: '#374151', display: 'block', marginBottom: '6px' }}>
                Select project to overwrite
              </label>
              <select
                value={selectedProjectId ?? ''}
                onChange={(e) => { setSelectedProjectId(e.target.value); setConfirmOverwrite(false); }}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  fontSize: '14px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  color: '#1f2937',
                  backgroundColor: '#ffffff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  cursor: 'pointer',
                }}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {selectedProject && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    marginTop: '14px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    border: '1px solid rgba(239, 68, 68, 0.15)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={confirmOverwrite}
                    onChange={(e) => setConfirmOverwrite(e.target.checked)}
                    style={{ marginTop: '2px', accentColor: '#ef4444' }}
                  />
                  <span style={{ fontSize: '12px', color: '#b91c1c', lineHeight: 1.5 }}>
                    I understand this will permanently replace all content in
                    <strong> "{selectedProject.name}"</strong> with the template.
                    Existing architecture, specifications, and related data will be removed.
                  </span>
                </label>
              )}
            </div>
          )}

          {mode === 'overwrite' && loading && (
            <div style={{ fontSize: '13px', color: '#6b7280', padding: '8px 0' }}>
              Loading projects...
            </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          padding: '16px 28px 20px',
          borderTop: '1px solid #f0f0f0',
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '9px 20px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              backgroundColor: '#ffffff',
              color: '#374151',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f9fafb'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={
              (mode === 'new' && !newProjectName.trim()) ||
              (mode === 'overwrite' && (!selectedProjectId || !confirmOverwrite))
            }
            style={{
              padding: '9px 20px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '8px',
              border: 'none',
              backgroundColor:
                (mode === 'new' && !newProjectName.trim()) ||
                (mode === 'overwrite' && (!selectedProjectId || !confirmOverwrite))
                  ? '#d1d5db'
                  : mode === 'overwrite' ? '#dc2626' : ACCENT,
              color: '#ffffff',
              cursor:
                (mode === 'new' && !newProjectName.trim()) ||
                (mode === 'overwrite' && (!selectedProjectId || !confirmOverwrite))
                  ? 'not-allowed'
                  : 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {mode === 'overwrite' ? 'Overwrite Project' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
