import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { DeleteAccountResult } from '../../services/SubscriptionService.js';

interface DeleteAccountModalProps {
  userEmail: string;
  onConfirm: () => Promise<DeleteAccountResult>;
  onClose: () => void;
}

export function DeleteAccountModal({ userEmail, onConfirm, onClose }: DeleteAccountModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [step, setStep] = useState<'warning' | 'confirm'>('warning');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canConfirm = confirmText === 'DELETE';

  const handleDelete = async () => {
    if (!canConfirm) return;
    setLoading(true);
    setError('');

    const res = await onConfirm();

    if (!res.success) {
      setLoading(false);
      setError(res.error || 'Failed to delete account. Please try again.');
    }
  };

  const overlayStyles: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  };

  const modalStyles: React.CSSProperties = {
    width: '460px',
    maxWidth: '90vw',
    backgroundColor: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: '12px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    overflow: 'hidden',
  };

  const headerStyles: React.CSSProperties = {
    padding: '20px 24px 16px',
    borderBottom: `1px solid ${c.border}`,
  };

  const bodyStyles: React.CSSProperties = {
    padding: '20px 24px',
  };

  const footerStyles: React.CSSProperties = {
    padding: '16px 24px',
    borderTop: `1px solid ${c.border}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
  };

  const btnBase: React.CSSProperties = {
    padding: '9px 18px',
    fontSize: '13px',
    fontWeight: 500,
    borderRadius: '6px',
    cursor: 'pointer',
    border: 'none',
    transition: 'opacity 0.15s',
  };

  const warningBoxStyles: React.CSSProperties = {
    padding: '12px 14px',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#991b1b',
    lineHeight: '1.6',
    marginBottom: '14px',
  };

  if (step === 'warning') {
    return (
      <div style={overlayStyles} onClick={onClose}>
        <div style={modalStyles} onClick={(e) => e.stopPropagation()}>
          <div style={headerStyles}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#dc2626' }}>
              Delete Account
            </div>
            <div style={{ fontSize: '12px', color: c.textMuted, marginTop: '4px' }}>
              This action is permanent and cannot be undone.
            </div>
          </div>
          <div style={bodyStyles}>
            <div style={warningBoxStyles}>
              Deleting your account will permanently remove:
            </div>
            <ul style={{
              margin: '0 0 16px',
              paddingLeft: '20px',
              fontSize: '13px',
              color: c.textMuted,
              lineHeight: '1.8',
            }}>
              <li>All your projects, architecture diagrams, and specifications</li>
              <li>All requirement mappings, features, and test cases</li>
              <li>AI generation history and conversation data</li>
              <li>Git integrations and sync history</li>
              <li>Your active subscription (cancelled immediately, no refund)</li>
              <li>Your user account and all settings</li>
            </ul>
            <div style={{ fontSize: '13px', color: c.textMuted }}>
              If you want a refund on an annual plan, please cancel your subscription first
              before deleting your account.
            </div>
          </div>
          <div style={footerStyles}>
            <button
              onClick={onClose}
              style={{
                ...btnBase,
                backgroundColor: c.background,
                color: c.text,
                border: `1px solid ${c.border}`,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => setStep('confirm')}
              style={{ ...btnBase, backgroundColor: '#dc2626', color: 'white' }}
            >
              I Understand, Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyles} onClick={onClose}>
      <div style={modalStyles} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyles}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#dc2626' }}>
            Confirm Account Deletion
          </div>
          <div style={{ fontSize: '12px', color: c.textMuted, marginTop: '4px' }}>
            Account: {userEmail}
          </div>
        </div>
        <div style={bodyStyles}>
          <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: '1.6', marginBottom: '16px' }}>
            To confirm, type <strong style={{ color: c.text }}>DELETE</strong> in the field below.
          </div>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: '13px',
              color: c.text,
              backgroundColor: c.background,
              border: `1px solid ${canConfirm ? '#dc2626' : c.border}`,
              borderRadius: '6px',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s',
            }}
          />
          {error && (
            <div style={{
              marginTop: '12px',
              padding: '10px 12px',
              backgroundColor: `${c.error}12`,
              border: `1px solid ${c.error}30`,
              borderRadius: '6px',
              fontSize: '12px',
              color: c.error,
            }}>
              {error}
            </div>
          )}
        </div>
        <div style={footerStyles}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              ...btnBase,
              backgroundColor: c.background,
              color: c.text,
              border: `1px solid ${c.border}`,
              opacity: loading ? 0.5 : 1,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canConfirm || loading}
            style={{
              ...btnBase,
              backgroundColor: canConfirm ? '#dc2626' : '#999',
              color: 'white',
              opacity: loading ? 0.7 : 1,
              cursor: canConfirm && !loading ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? 'Deleting Account...' : 'Permanently Delete Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
