import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { Notification } from '../../store/notification-store.js';

export type { Notification };

interface NotificationCenterProps {
  notifications: Notification[];
  onMarkAsRead: (id: string) => void;
  onClearAll: () => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onActionExecute?: (action: any) => void;
}

function NotificationCenterComponent({
  notifications,
  onClearAll,
  onRemove,
  onClose,
  onActionExecute,
}: NotificationCenterProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const containerStyles: React.CSSProperties = {
    position: 'absolute',
    top: '56px',
    right: '16px',
    width: '420px',
    maxHeight: '600px',
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '8px',
    boxShadow: '0 8px 16px rgba(0,0,0,0.15)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
  };

  const headerStyles: React.CSSProperties = {
    padding: '16px',
    borderBottom: `1px solid ${c.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const titleStyles: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
    color: c.text,
  };

  const headerActionsStyles: React.CSSProperties = {
    display: 'flex',
    gap: '8px',
  };

  const actionButtonStyles: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: '11px',
    color: c.textMuted,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  };

  const listStyles: React.CSSProperties = {
    overflowY: 'auto',
    maxHeight: '500px',
  };

  const emptyStyles: React.CSSProperties = {
    padding: '32px',
    textAlign: 'center',
    color: c.textMuted,
    fontSize: '13px',
  };

  const notificationItemStyles = (notification: Notification): React.CSSProperties => ({
    padding: '12px 16px',
    borderBottom: `1px solid ${c.border}`,
    backgroundColor: notification.read ? c.surface : c.background,
    transition: 'background-color 0.15s',
  });

  const notificationHeaderStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '6px',
  };

  const typeIconStyles = (type: Notification['type']): React.CSSProperties => ({
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    backgroundColor:
      type === 'error' ? c.error :
      type === 'success' ? c.success :
      type === 'warning' ? '#f59e0b' :
      type === 'validation' ? '#8b5cf6' :
      c.primary,
    color: 'white',
  });

  const messageStyles: React.CSSProperties = {
    fontSize: '13px',
    color: c.text,
    lineHeight: '1.5',
    marginBottom: '4px',
  };

  const descriptionStyles: React.CSSProperties = {
    fontSize: '12px',
    color: c.textSecondary,
    lineHeight: '1.4',
    marginTop: '6px',
  };

  const actionsContainerStyles: React.CSSProperties = {
    marginTop: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  };

  const actionItemStyles: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: '12px',
    color: c.primary,
    backgroundColor: c.background,
    border: `1px solid ${c.border}`,
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    textAlign: 'left',
  };

  const timestampStyles: React.CSSProperties = {
    fontSize: '11px',
    color: c.textMuted,
  };

  const closeButtonStyles: React.CSSProperties = {
    marginLeft: '8px',
    padding: '2px 6px',
    fontSize: '11px',
    color: c.textMuted,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
  };

  const getTypeIcon = (type: Notification['type']) => {
    switch (type) {
      case 'error': return '✕';
      case 'success': return '✓';
      case 'warning': return '!';
      case 'validation': return '⚠';
      default: return 'i';
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const handleActionClick = (notificationId: string, action: any) => {
    if (onActionExecute) {
      onActionExecute(action);
      onRemove(notificationId);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const validationCount = notifications.filter(n => n.type === 'validation').length;

  return (
    <div style={containerStyles}>
      <div style={headerStyles}>
        <div style={titleStyles}>
          Notifications {unreadCount > 0 && `(${unreadCount})`}
          {validationCount > 0 && (
            <span style={{ color: c.textMuted, fontWeight: 400, marginLeft: '8px' }}>
              {validationCount} validation
            </span>
          )}
        </div>
        <div style={headerActionsStyles}>
          {notifications.length > 0 && (
            <button
              style={actionButtonStyles}
              onClick={onClearAll}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = c.background;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              Clear all
            </button>
          )}
          <button
            style={actionButtonStyles}
            onClick={onClose}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = c.background;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={listStyles}>
        {notifications.length === 0 ? (
          <div style={emptyStyles}>No notifications</div>
        ) : (
          notifications.map((notification) => (
            <div
              key={notification.id}
              style={notificationItemStyles(notification)}
            >
              <div style={notificationHeaderStyles}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={typeIconStyles(notification.type)}>
                    {getTypeIcon(notification.type)}
                  </div>
                  <div style={timestampStyles}>
                    {formatTimestamp(notification.timestamp)}
                  </div>
                </div>
                <button
                  style={closeButtonStyles}
                  onClick={() => onRemove(notification.id)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = c.background;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={messageStyles}>
                {notification.message}
              </div>

              {notification.description && (
                <div style={descriptionStyles}>
                  {notification.description}
                </div>
              )}

              {notification.actions && notification.actions.length > 0 && (
                <div style={actionsContainerStyles}>
                  {notification.actions.map((action, idx) => (
                    <button
                      key={idx}
                      style={actionItemStyles}
                      onClick={() => handleActionClick(notification.id, action.action)}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = c.backgroundSecondary;
                        e.currentTarget.style.borderColor = c.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = c.background;
                        e.currentTarget.style.borderColor = c.border;
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{action.label}</div>
                      {action.description && (
                        <div style={{ fontSize: '11px', color: c.textMuted, marginTop: '2px' }}>
                          {action.description}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export const NotificationCenter = memo(NotificationCenterComponent);
