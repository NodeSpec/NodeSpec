import { useEffect, useRef } from 'react';
import { useTheme } from '../../theme/ThemeContext';

export interface GenerationActivity {
  id: string;
  type: 'step' | 'node' | 'artifact' | 'connection';
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  title: string;
  subtitle?: string;
  startTime?: number;
  endTime?: number;
  metadata?: {
    nodeCount?: number;
    nodeTypes?: string[];
    fileName?: string;
    lineCount?: number;
    fileSize?: string;
  };
  children?: GenerationActivity[];
}

interface GenerationFeedOverlayProps {
  activities: GenerationActivity[];
  title?: string;
  onCancel?: () => void;
}

export function GenerationFeedOverlay({
  activities,
  title = 'AI is Designing Your Architecture',
  onCancel,
}: GenerationFeedOverlayProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [activities]);

  const getStatusIcon = (status: GenerationActivity['status']) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in-progress':
        return '⏳';
      case 'error':
        return '✗';
      case 'pending':
        return '○';
    }
  };

  const getStatusColor = (status: GenerationActivity['status']) => {
    switch (status) {
      case 'completed':
        return '#22c55e';
      case 'in-progress':
        return c.primary;
      case 'error':
        return '#ef4444';
      case 'pending':
        return c.textMuted;
    }
  };


  const overlayStyles: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    animation: 'fadeIn 0.2s ease-out',
  };

  const cardStyles: React.CSSProperties = {
    backgroundColor: c.surface,
    borderRadius: '16px',
    boxShadow:
      theme.mode === 'dark'
        ? '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1)'
        : '0 20px 60px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05)',
    width: '600px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyles: React.CSSProperties = {
    padding: '24px 24px 16px',
    borderBottom: `1px solid ${c.border}`,
  };

  const feedStyles: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  };

  const footerStyles: React.CSSProperties = {
    padding: '16px 24px',
    borderTop: `1px solid ${c.border}`,
    display: 'flex',
    justifyContent: 'flex-end',
  };

  const renderActivity = (activity: GenerationActivity, depth: number = 0) => {
    const statusColor = getStatusColor(activity.status);
    const isActive = activity.status === 'in-progress';

    const activityStyles: React.CSSProperties = {
      marginLeft: `${depth * 20}px`,
      padding: '12px',
      borderRadius: '8px',
      backgroundColor: isActive
        ? theme.mode === 'dark'
          ? 'rgba(255, 255, 255, 0.03)'
          : 'rgba(0, 0, 0, 0.02)'
        : 'transparent',
      border: isActive ? `1px solid ${c.border}` : '1px solid transparent',
      transition: 'all 0.2s ease',
    };

    const titleRowStyles: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: activity.subtitle || activity.metadata ? '6px' : 0,
    };

    const iconStyles: React.CSSProperties = {
      fontSize: '16px',
      color: statusColor,
      fontWeight: 'bold',
      minWidth: '20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      animation: isActive ? 'pulse 2s ease-in-out infinite' : 'none',
    };

    const titleStyles: React.CSSProperties = {
      fontSize: depth === 0 ? '14px' : '13px',
      fontWeight: depth === 0 ? 600 : 500,
      color: c.text,
      flex: 1,
    };

    const progressBarContainerStyles: React.CSSProperties = {
      marginTop: '8px',
      marginLeft: '32px',
      height: '3px',
      backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
      borderRadius: '2px',
      overflow: 'hidden',
    };

    const getProgressBarStyles = (): React.CSSProperties => {
      const baseStyles: React.CSSProperties = {
        height: '100%',
        borderRadius: '2px',
        transition: 'width 0.3s ease',
      };

      if (activity.status === 'completed') {
        return {
          ...baseStyles,
          width: '100%',
          backgroundColor: '#10b981',
        };
      }

      if (activity.status === 'error') {
        return {
          ...baseStyles,
          width: '100%',
          backgroundColor: '#ef4444',
        };
      }

      if (activity.status === 'in-progress') {
        return {
          ...baseStyles,
          width: '100%',
          backgroundColor: statusColor,
          animation: 'indeterminateProgress 1.5s ease-in-out infinite',
        };
      }

      return {
        ...baseStyles,
        width: '0%',
        backgroundColor: c.textMuted,
      };
    };

    return (
      <div key={activity.id}>
        <div style={activityStyles}>
          <div style={titleRowStyles}>
            <span style={iconStyles}>{getStatusIcon(activity.status)}</span>
            <span style={titleStyles}>{activity.title}</span>
          </div>

          <div style={progressBarContainerStyles}>
            <div style={getProgressBarStyles()} />
          </div>

          {activity.subtitle && (
            <div
              style={{
                fontSize: '12px',
                color: c.textSecondary,
                marginLeft: '32px',
                lineHeight: '1.5',
              }}
            >
              {activity.subtitle}
            </div>
          )}

          {activity.metadata && (
            <div
              style={{
                fontSize: '12px',
                color: c.textMuted,
                marginLeft: '32px',
                marginTop: '6px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              {activity.metadata.nodeCount !== undefined && (
                <span>→ {activity.metadata.nodeCount} nodes</span>
              )}
              {activity.metadata.nodeTypes && activity.metadata.nodeTypes.length > 0 && (
                <span>({activity.metadata.nodeTypes.join(', ')})</span>
              )}
              {activity.metadata.fileName && (
                <span
                  style={{
                    fontFamily: 'monospace',
                    color: c.textSecondary,
                  }}
                >
                  {activity.metadata.fileName}
                </span>
              )}
              {activity.metadata.lineCount !== undefined && (
                <span>({activity.metadata.lineCount} lines)</span>
              )}
            </div>
          )}
        </div>

        {activity.children && activity.children.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            {activity.children.map((child) => renderActivity(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes indeterminateProgress {
          0% {
            transform: translateX(-100%);
          }
          50% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(100%);
          }
        }
      `}</style>
      <div style={overlayStyles}>
        <div style={cardStyles}>
          <div style={headerStyles}>
            <div
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: c.text,
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  border: `3px solid ${c.border}`,
                  borderTop: `3px solid ${c.primary}`,
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              {title}
            </div>
          </div>

          <div ref={feedRef} style={feedStyles}>
            {activities.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  color: c.textMuted,
                  padding: '32px',
                  fontSize: '14px',
                }}
              >
                Initializing...
              </div>
            ) : (
              activities.map((activity) => renderActivity(activity))
            )}
          </div>

          {onCancel && (
            <div style={footerStyles}>
              <button
                onClick={onCancel}
                style={{
                  padding: '10px 20px',
                  backgroundColor: 'transparent',
                  border: `1px solid ${c.border}`,
                  borderRadius: '8px',
                  color: c.text,
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                Cancel Generation
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
