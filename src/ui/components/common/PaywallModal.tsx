import { memo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../theme/ThemeContext.js';
import type { Feature, PlanTier } from '../../hooks/useFeatureGate.js';
import { getFeatureRule } from '../../hooks/useFeatureGate.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { SubscriptionService } from '../../services/SubscriptionService.js';
import { tierDisplayName } from '../../config/tiers.js';

interface PaywallModalProps {
  feature: Feature;
  currentPlan: PlanTier;
  onClose: () => void;
}


async function attemptDirectCheckout(planId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;

    const service = new SubscriptionService(supabase);
    const result = await service.createCheckoutSession(planId, 'month', session.access_token);
    if ('error' in result) return false;

    window.location.href = result.url;
    return true;
  } catch {
    return false;
  }
}

function PaywallModalComponent({ feature, currentPlan, onClose }: PaywallModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const navigate = useNavigate();
  const rule = getFeatureRule(feature);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleUpgrade = useCallback(async () => {
    setCheckoutLoading(true);
    const success = await attemptDirectCheckout(rule.minimumTier);
    if (!success) {
      navigate('/pricing');
    }
    setCheckoutLoading(false);
  }, [rule.minimumTier, navigate]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: c.surface,
          borderRadius: '16px',
          border: `1px solid ${c.border}`,
          padding: '32px',
          maxWidth: '420px',
          width: '90%',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '20px',
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <div style={{
          fontSize: '18px',
          fontWeight: 700,
          color: c.text,
          marginBottom: '8px',
        }}>
          {rule.label}
        </div>

        <div style={{
          fontSize: '14px',
          color: c.textMuted,
          lineHeight: '1.6',
          marginBottom: '8px',
        }}>
          {rule.upgradeMessage}
        </div>

        <div style={{
          fontSize: '12px',
          color: c.textMuted,
          marginBottom: '24px',
          padding: '8px 12px',
          backgroundColor: c.background,
          borderRadius: '8px',
          border: `1px solid ${c.border}`,
        }}>
          Current plan: <span style={{ fontWeight: 600, color: c.text }}>{tierDisplayName(currentPlan)}</span>
          {' | '}
          Required: <span style={{ fontWeight: 600, color: '#3b82f6' }}>{tierDisplayName(rule.minimumTier)}+</span>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleUpgrade}
            disabled={checkoutLoading}
            style={{
              flex: 1,
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: 600,
              border: 'none',
              borderRadius: '10px',
              cursor: checkoutLoading ? 'wait' : 'pointer',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              transition: 'all 0.2s',
              opacity: checkoutLoading ? 0.7 : 1,
            }}
            onMouseEnter={(e) => {
              if (!checkoutLoading) e.currentTarget.style.backgroundColor = '#2563eb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = '#3b82f6';
            }}
          >
            {checkoutLoading ? 'Redirecting...' : `Upgrade to ${tierDisplayName(rule.minimumTier)}`}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: 500,
              border: `1px solid ${c.border}`,
              borderRadius: '10px',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              color: c.text,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = c.background;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export const PaywallModal = memo(PaywallModalComponent);

interface PaywallBannerProps {
  feature: Feature;
  currentPlan: PlanTier;
  compact?: boolean;
}

function PaywallBannerComponent({ feature, currentPlan, compact }: PaywallBannerProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const navigate = useNavigate();
  const rule = getFeatureRule(feature);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleUpgrade = useCallback(async () => {
    setCheckoutLoading(true);
    const success = await attemptDirectCheckout(rule.minimumTier);
    if (!success) {
      navigate('/pricing');
    }
    setCheckoutLoading(false);
  }, [rule.minimumTier, navigate]);

  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        backgroundColor: c.background,
        borderRadius: '8px',
        border: `1px solid ${c.border}`,
        fontSize: '12px',
        color: c.textMuted,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>{tierDisplayName(rule.minimumTier)}+ required</span>
        <button
          onClick={handleUpgrade}
          disabled={checkoutLoading}
          style={{
            marginLeft: 'auto',
            fontSize: '11px',
            fontWeight: 600,
            color: '#3b82f6',
            background: 'none',
            border: 'none',
            cursor: checkoutLoading ? 'wait' : 'pointer',
            padding: 0,
          }}
        >
          {checkoutLoading ? '...' : 'Upgrade'}
        </button>
      </div>
    );
  }

  return (
    <div style={{
      padding: '16px',
      backgroundColor: c.background,
      borderRadius: '10px',
      border: `1px solid ${c.border}`,
      textAlign: 'center',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        marginBottom: '8px',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
          {rule.label}
        </span>
      </div>
      <div style={{ fontSize: '12px', color: c.textMuted, marginBottom: '12px', lineHeight: '1.5' }}>
        {rule.upgradeMessage}
      </div>
      <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '12px' }}>
        You're on the <strong style={{ color: c.text }}>{tierDisplayName(currentPlan)}</strong> plan
      </div>
      <button
        onClick={handleUpgrade}
        disabled={checkoutLoading}
        style={{
          padding: '8px 20px',
          fontSize: '13px',
          fontWeight: 600,
          border: 'none',
          borderRadius: '8px',
          cursor: checkoutLoading ? 'wait' : 'pointer',
          backgroundColor: '#3b82f6',
          color: '#ffffff',
          transition: 'all 0.2s',
          opacity: checkoutLoading ? 0.7 : 1,
        }}
        onMouseEnter={(e) => { if (!checkoutLoading) e.currentTarget.style.backgroundColor = '#2563eb'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#3b82f6'; }}
      >
        {checkoutLoading ? 'Redirecting...' : `Upgrade to ${tierDisplayName(rule.minimumTier)}`}
      </button>
    </div>
  );
}

export const PaywallBanner = memo(PaywallBannerComponent);
