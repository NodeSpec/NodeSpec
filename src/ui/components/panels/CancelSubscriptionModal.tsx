import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { SubscriptionInfo, CancellationResult } from '../../services/SubscriptionService.js';

interface CancelSubscriptionModalProps {
  subscription: SubscriptionInfo;
  onConfirm: () => Promise<CancellationResult>;
  onClose: () => void;
}

export function CancelSubscriptionModal({ subscription, onConfirm, onClose }: CancelSubscriptionModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CancellationResult | null>(null);
  const [error, setError] = useState('');

  const isAnnual = subscription.billingInterval === 'year';
  const periodStart = subscription.currentPeriodStart
    ? new Date(subscription.currentPeriodStart)
    : null;
  const now = new Date();
  const daysSinceStart = periodStart
    ? Math.floor((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))
    : 999;
  const eligibleForRefund = isAnnual && daysSinceStart <= 30;
  const estimatedRefundCents = eligibleForRefund
    ? Math.round((subscription.amountCents * 11) / 12)
    : 0;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError('');
    const res = await onConfirm();
    setLoading(false);

    if (!res.success) {
      setError(res.error || 'Cancellation failed. Please try again.');
      return;
    }

    setResult(res);
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
    width: '440px',
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

  if (result) {
    return (
      <div style={overlayStyles} onClick={onClose}>
        <div style={modalStyles} onClick={(e) => e.stopPropagation()}>
          <div style={headerStyles}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: c.text }}>
              Subscription Cancelled
            </div>
          </div>
          <div style={bodyStyles}>
            {result.cancellationType === 'immediate_with_refund' ? (
              <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: '1.6' }}>
                <p style={{ margin: '0 0 12px' }}>
                  Your subscription has been cancelled immediately. A refund of{' '}
                  <strong style={{ color: c.text }}>
                    ${(result.refundAmountCents / 100).toFixed(2)}
                  </strong>{' '}
                  has been issued to your payment method. It may take 5-10 business days to appear.
                </p>
                <p style={{ margin: 0 }}>
                  Your account has been reverted to the Free tier.
                </p>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: '1.6' }}>
                <p style={{ margin: '0 0 12px' }}>
                  Your subscription has been set to cancel at the end of your current billing period.
                </p>
                <p style={{ margin: 0 }}>
                  You will retain full access until{' '}
                  <strong style={{ color: c.text }}>
                    {formatDate(result.effectiveEndDate)}
                  </strong>.
                  After that, your account will revert to the Free tier.
                </p>
              </div>
            )}
          </div>
          <div style={footerStyles}>
            <button
              onClick={onClose}
              style={{ ...btnBase, backgroundColor: c.primary, color: 'white' }}
            >
              Done
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
          <div style={{ fontSize: '15px', fontWeight: 600, color: c.text }}>
            Cancel Subscription
          </div>
          <div style={{ fontSize: '12px', color: c.textMuted, marginTop: '4px' }}>
            Are you sure you want to cancel your subscription?
          </div>
        </div>
        <div style={bodyStyles}>
          {eligibleForRefund ? (
            <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 12px' }}>
                Your annual subscription started less than 30 days ago. You are eligible for a
                prorated refund of approximately{' '}
                <strong style={{ color: c.text }}>
                  ${(estimatedRefundCents / 100).toFixed(2)}
                </strong>{' '}
                (11 months equivalent).
              </p>
              <p style={{ margin: 0 }}>
                Your subscription will be cancelled immediately and your account will
                revert to the Free tier.
              </p>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 12px' }}>
                Your subscription will remain active until the end of your current billing period
                on <strong style={{ color: c.text }}>{formatDate(subscription.currentPeriodEnd)}</strong>.
              </p>
              <p style={{ margin: 0 }}>
                You will not be charged for the next period. After the current period ends,
                your account will revert to the Free tier.
              </p>
            </div>
          )}

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
            Keep My Plan
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              ...btnBase,
              backgroundColor: '#dc2626',
              color: 'white',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading
              ? 'Cancelling...'
              : eligibleForRefund
                ? 'Cancel & Refund'
                : 'Confirm Cancellation'}
          </button>
        </div>
      </div>
    </div>
  );
}
