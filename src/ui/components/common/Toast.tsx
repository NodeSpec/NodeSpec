import { useEffect, useState } from 'react';
import { useNotificationStore } from '../../store/notification-store.js';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info' | 'success';
  duration?: number;
}

interface ToastProps {
  message: ToastMessage;
  onDismiss: (id: string) => void;
}

function Toast({ message, onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const duration = message.duration ?? 4000;
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onDismiss(message.id), 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [message.id, message.duration, onDismiss]);

  const bgColor = {
    error: '#dc2626',
    warning: '#f59e0b',
    info: '#3b82f6',
    success: '#10b981',
  }[message.type];

  return (
    <div
      style={{
        backgroundColor: bgColor,
        color: 'white',
        padding: '12px 16px',
        borderRadius: '6px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        maxWidth: '400px',
        fontSize: '14px',
        lineHeight: '1.5',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(-10px)',
        transition: 'all 0.3s ease',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
      onClick={() => {
        setIsVisible(false);
        setTimeout(() => onDismiss(message.id), 300);
      }}
    >
      <span style={{ flex: 1 }}>{message.message}</span>
      <button
        style={{
          background: 'transparent',
          border: 'none',
          color: 'white',
          cursor: 'pointer',
          padding: '4px',
          fontSize: '16px',
          lineHeight: '1',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setIsVisible(false);
          setTimeout(() => onDismiss(message.id), 300);
        }}
      >
        ×
      </button>
    </div>
  );
}

interface ToastContainerProps {
  messages: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ messages, onDismiss }: ToastContainerProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: '70px',
        right: '20px',
        // Owner bench 2026-07-29: toasts sat at the SAME z-index as the git modal
        // (10000) and rendered behind it — error feedback was invisible while any
        // modal was open. Toasts must clear every overlay (highest is 10005).
        zIndex: 12000,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        pointerEvents: 'none',
      }}
    >
      {messages.map((msg) => (
        <div key={msg.id} style={{ pointerEvents: 'auto' }}>
          <Toast message={msg} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const { addNotification } = useNotificationStore();

  const showToast = (
    message: string,
    type: ToastMessage['type'] = 'info',
    duration?: number
  ) => {
    addNotification(message, type);
    const id = `toast-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { id, message, type, duration }]);
  };

  const dismissToast = (id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  };

  return {
    messages,
    showToast,
    dismissToast,
    showError: (msg: string, duration?: number) => showToast(msg, 'error', duration),
    showWarning: (msg: string, duration?: number) => showToast(msg, 'warning', duration),
    showInfo: (msg: string, duration?: number) => showToast(msg, 'info', duration),
    showSuccess: (msg: string, duration?: number) => showToast(msg, 'success', duration),
  };
}
