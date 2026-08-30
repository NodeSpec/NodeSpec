import { useState, useCallback, useEffect, useRef } from 'react';
import type { GraphValidationIssue, QuickFixAction } from '@nodespec/core/validation/types';

export interface NotificationAction {
  label: string;
  description?: string;
  action: QuickFixAction;
}

export interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'validation';
  timestamp: number;
  read: boolean;
  description?: string;
  actions?: NotificationAction[];
  nodeId?: string;
  edgeId?: string;
  artifactId?: string;
  category?: string;
}

let globalNotifications: Notification[] = [];
let globalListeners: Set<() => void> = new Set();

function notifyListeners() {
  globalListeners.forEach(listener => listener());
}

export function useNotificationStore() {
  const [, forceUpdate] = useState({});

  const rerender = useRef(() => {
    forceUpdate({});
  });

  useEffect(() => {
    const listener = rerender.current;
    globalListeners.add(listener);
    return () => {
      globalListeners.delete(listener);
    };
  }, []);

  const addNotification = useCallback((message: string, type: Notification['type']) => {
    const notification: Notification = {
      id: `${Date.now()}-${Math.random()}`,
      message,
      type,
      timestamp: Date.now(),
      read: false,
    };

    globalNotifications = [notification, ...globalNotifications].slice(0, 50);
    notifyListeners();
  }, []);

  const addValidationIssue = useCallback((issue: GraphValidationIssue) => {
    const notification: Notification = {
      id: issue.id,
      message: issue.message,
      type: 'validation',
      timestamp: Date.now(),
      read: false,
      description: issue.description,
      actions: issue.quickFixes?.map(fix => ({
        label: fix.label,
        description: fix.description,
        action: fix.action,
      })),
      nodeId: issue.nodeId,
      edgeId: issue.edgeId,
      artifactId: issue.artifactId,
      category: issue.category,
    };

    const existingIndex = globalNotifications.findIndex(n => n.id === notification.id);
    if (existingIndex >= 0) {
      globalNotifications[existingIndex] = notification;
    } else {
      globalNotifications = [notification, ...globalNotifications].slice(0, 50);
    }
    notifyListeners();
  }, []);

  const removeNotification = useCallback((id: string) => {
    globalNotifications = globalNotifications.filter(n => n.id !== id);
    notifyListeners();
  }, []);

  const markAsRead = useCallback((id: string) => {
    globalNotifications = globalNotifications.map((n) =>
      n.id === id ? { ...n, read: true } : n
    );
    notifyListeners();
  }, []);

  const clearAll = useCallback(() => {
    globalNotifications = [];
    notifyListeners();
  }, []);

  const clearValidationIssues = useCallback(() => {
    globalNotifications = globalNotifications.filter(n => n.type !== 'validation');
    notifyListeners();
  }, []);

  return {
    notifications: globalNotifications,
    addNotification,
    addValidationIssue,
    removeNotification,
    markAsRead,
    clearAll,
    clearValidationIssues,
  };
}
