import { memo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../theme/ThemeContext.js';
import { useAuth, useSubscription } from '../../context/ServiceContext.js';
import { getPlanDisplayName } from '../pricing/pricing-data.js';
import type { SubscriptionInfo } from '../../services/SubscriptionService.js';
import { CancelSubscriptionModal } from './CancelSubscriptionModal.js';
import { DeleteAccountModal } from './DeleteAccountModal.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { isHostedEdition, buildEdition } from '../../config/edition.js';
import { PublicProfileEditor } from './PublicProfileEditor.js';
import { useFeatureGate } from '../../hooks/useFeatureGate.js';
import { testTierOverride } from '../../config/test-tier.js';
import { tierDisplayName } from '../../config/tiers.js';
import { resolveVariant } from '../../config/variant.js';

interface AccountPanelProps {
  userEmail?: string;
  userId?: string;
  onClose: () => void;
}

function AccountPanelComponent({ userEmail, userId, onClose }: AccountPanelProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const auth = useAuth();
  const subscriptionService = useSubscription();
  const navigate = useNavigate();
  // N6: the 'ai' tab (AIConfigPanel — BYOK for the frozen internal AI) is unmounted;
  // D-series removes the backend it configured.
  const [activeTab, setActiveTab] = useState<'profile' | 'subscription' | 'publicProfile'>('profile');
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  // R18: the build-identity stamp reads the SAME gate the app's chrome
  // resolves through, so what it prints is what the boards actually render.
  const gate = useFeatureGate();

  useEffect(() => {
    if (activeTab !== 'subscription') return;

    const loadSub = async () => {
      setSubLoading(true);
      let uid = userId;
      if (!uid) {
        const session = await auth.getSession();
        uid = session?.user?.id;
      }
      if (uid) {
        const sub = await subscriptionService.getCurrentSubscription(uid);
        setSubscription(sub);
      }
      setSubLoading(false);
    };

    loadSub();

    // Setup realtime subscription for automatic updates
    const supabase = getSupabaseClient();
    const getUserId = async () => {
      let uid = userId;
      if (!uid) {
        const session = await auth.getSession();
        uid = session?.user?.id;
      }
      return uid;
    };

    getUserId().then((uid) => {
      if (!uid) return;

      const channel = supabase
        .channel('user-subscription')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'stripe_subscriptions',
            filter: `user_id=eq.${uid}`,
          },
          () => {
            // Reload subscription when changes occur
            console.log('[AccountPanel] Subscription change detected, reloading...');
            loadSub();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    });
  }, [activeTab, userId, auth, subscriptionService]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const containerStyles: React.CSSProperties = {
    position: 'absolute',
    top: '56px',
    right: '16px',
    width: 'min(460px, calc(100vw - 32px))',
    maxHeight: 'min(640px, calc(100vh - 72px))',
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

  const closeButtonStyles: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: '16px',
    color: c.textMuted,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  };

  const tabsStyles: React.CSSProperties = {
    display: 'flex',
    borderBottom: `1px solid ${c.border}`,
    padding: '0 16px',
  };

  const tabButtonStyles = (isActive: boolean): React.CSSProperties => ({
    padding: '12px 16px',
    fontSize: '13px',
    fontWeight: isActive ? 600 : 400,
    color: isActive ? c.primary : c.textMuted,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: isActive ? `2px solid ${c.primary}` : '2px solid transparent',
    cursor: 'pointer',
    marginBottom: '-1px',
  });

  const contentStyles: React.CSSProperties = {
    padding: '16px',
    overflowY: 'auto',
    maxHeight: '490px',
  };

  const sectionStyles: React.CSSProperties = {
    marginBottom: '20px',
  };

  const labelStyles: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: c.text,
    marginBottom: '6px',
  };

  const inputStyles: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    fontSize: '13px',
    color: c.text,
    backgroundColor: c.background,
    border: `1px solid ${c.border}`,
    borderRadius: '6px',
    outline: 'none',
  };

  const buttonStyles: React.CSSProperties = {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: 'white',
    backgroundColor: c.primary,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  };

  const secondaryButtonStyles: React.CSSProperties = {
    ...buttonStyles,
    backgroundColor: c.background,
    color: c.text,
    border: `1px solid ${c.border}`,
  };

  const errorStyles: React.CSSProperties = {
    fontSize: '12px',
    color: c.error,
    marginTop: '8px',
  };

  const successStyles: React.CSSProperties = {
    fontSize: '12px',
    color: c.success,
    marginTop: '8px',
  };

  const infoBoxStyles: React.CSSProperties = {
    padding: '12px',
    backgroundColor: c.background,
    border: `1px solid ${c.border}`,
    borderRadius: '6px',
    fontSize: '12px',
    color: c.textMuted,
    lineHeight: '1.5',
  };

  const handlePasswordChange = async () => {
    setPasswordError('');
    setPasswordSuccess('');

    if (!newPassword || !confirmPassword) {
      setPasswordError('Please fill in all fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    try {
      const result = await auth.updatePassword(newPassword);

      if (!result.success) {
        setPasswordError(result.error || 'Failed to update password');
      } else {
        setPasswordSuccess('Password updated successfully');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setPasswordError('Failed to update password');
    }
  };

  const handleSignOut = async () => {
    await auth.signOut();
  };

  const handleCancelSubscription = async () => {
    const session = await auth.getSession();
    if (!session?.session?.access_token) {
      return {
        success: false as const,
        cancellationType: 'end_of_period' as const,
        refundAmountCents: 0,
        effectiveEndDate: '',
        error: 'Session expired. Please sign in again.',
      };
    }
    return subscriptionService.cancelSubscription(session.session.access_token);
  };

  const handleCancelModalClose = async () => {
    setShowCancelModal(false);
    let uid = userId;
    if (!uid) {
      const session = await auth.getSession();
      uid = session?.user?.id;
    }
    if (uid) {
      const sub = await subscriptionService.getCurrentSubscription(uid);
      setSubscription(sub);
    }
  };

  const handleDeleteAccount = async () => {
    const session = await auth.getSession();
    if (!session?.session?.access_token) {
      return { success: false as const, error: 'Session expired. Please sign in again.' };
    }
    const result = await subscriptionService.deleteAccount(session.session.access_token);
    if (result.success) {
      await auth.signOut();
      navigate('/');
    }
    return result;
  };

  const renderProfileTab = () => (
    <div>
      <div style={sectionStyles}>
        <div style={labelStyles}>Email</div>
        <div style={{ ...inputStyles, backgroundColor: c.surface, cursor: 'not-allowed' }}>
          {userEmail || 'Not available'}
        </div>
      </div>

      <div style={sectionStyles}>
        <div style={labelStyles}>Change Password</div>
        <input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={inputStyles}
        />
        <div style={{ height: '8px' }} />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          style={inputStyles}
        />
        {passwordError && <div style={errorStyles}>{passwordError}</div>}
        {passwordSuccess && <div style={successStyles}>{passwordSuccess}</div>}
        <div style={{ height: '12px' }} />
        <button onClick={handlePasswordChange} style={buttonStyles}>
          Update Password
        </button>
      </div>

      <div style={sectionStyles}>
        <button onClick={handleSignOut} style={secondaryButtonStyles}>
          Sign Out
        </button>
      </div>

      <div style={{
        borderTop: `1px solid ${c.border}`,
        paddingTop: '20px',
        marginTop: '4px',
      }}>
        <div style={{ ...labelStyles, color: '#dc2626' }}>Danger Zone</div>
        <div style={{
          padding: '12px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#991b1b',
          lineHeight: '1.5',
          marginBottom: '12px',
        }}>
          Permanently delete your account and all associated data. This action cannot be undone.
        </div>
        <button
          onClick={() => setShowDeleteModal(true)}
          style={{
            ...buttonStyles,
            backgroundColor: 'transparent',
            color: '#dc2626',
            border: '1px solid #dc2626',
          }}
        >
          Delete Account
        </button>
      </div>
    </div>
  );

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  };

  const renderSubscriptionTab = () => {
    if (subLoading) {
      return (
        <div style={{ textAlign: 'center', padding: '24px', color: c.textMuted, fontSize: '13px' }}>
          Loading subscription...
        </div>
      );
    }

    if (!subscription) {
      return (
        <div>
          <div style={sectionStyles}>
            <div style={labelStyles}>Current Plan</div>
            <div style={{ ...infoBoxStyles, padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: c.text }}>
                  Free
                </div>
                <span style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: c.success,
                  backgroundColor: `${c.success}18`,
                  padding: '3px 10px',
                  borderRadius: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}>
                  Active
                </span>
              </div>
              <div style={{ fontSize: '12px', color: c.textMuted }}>
                2 projects, canvas access, and GitHub push. Upgrade to unlock AI generation, repo import, and more.
              </div>
            </div>
          </div>
          <button
            style={buttonStyles}
            onClick={() => { onClose(); navigate('/pricing'); }}
          >
            Upgrade Plan
          </button>
        </div>
      );
    }

    const statusColor = subscription.status === 'active' ? c.success : '#f59e0b';

    return (
      <div>
        <div style={sectionStyles}>
          <div style={labelStyles}>Current Plan</div>
          <div style={{ ...infoBoxStyles, padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: c.text }}>
                {getPlanDisplayName(subscription.planName)}
              </div>
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                color: statusColor,
                backgroundColor: `${statusColor}18`,
                padding: '3px 10px',
                borderRadius: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {subscription.cancelAtPeriodEnd ? 'Cancelling' : subscription.status}
              </span>
            </div>
            <div style={{ fontSize: '13px', color: c.textMuted, marginBottom: '4px' }}>
              ${(subscription.amountCents / 100).toFixed(0)}/{subscription.billingInterval === 'year' ? 'yr' : 'mo'}
              {subscription.billingInterval === 'year' ? ' (annual)' : ' (monthly)'}
            </div>
          </div>
        </div>

        <div style={sectionStyles}>
          <div style={labelStyles}>Billing Period</div>
          <div style={{ ...infoBoxStyles, padding: '12px' }}>
            <div style={{ fontSize: '12px', color: c.textMuted }}>
              {formatDate(subscription.currentPeriodStart)} - {formatDate(subscription.currentPeriodEnd)}
            </div>
          </div>
        </div>

        {subscription.paymentMethodBrand && (
          <div style={sectionStyles}>
            <div style={labelStyles}>Payment Method</div>
            <div style={{ ...infoBoxStyles, padding: '12px' }}>
              <div style={{ fontSize: '12px', color: c.textMuted, textTransform: 'capitalize' }}>
                {subscription.paymentMethodBrand} ending in {subscription.paymentMethodLast4}
              </div>
            </div>
          </div>
        )}

        {subscription.cancelAtPeriodEnd && (
          <div style={{
            padding: '12px',
            backgroundColor: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#92400e',
            marginBottom: '16px',
          }}>
            Your subscription will end on {formatDate(subscription.currentPeriodEnd)}.
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            style={secondaryButtonStyles}
            onClick={() => { onClose(); navigate('/pricing'); }}
          >
            Change Plan
          </button>
          {!subscription.cancelAtPeriodEnd && (
            <button
              onClick={() => setShowCancelModal(true)}
              style={{
                ...secondaryButtonStyles,
                color: '#dc2626',
                borderColor: '#dc2626',
              }}
            >
              Cancel Subscription
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={containerStyles}>
      <div style={headerStyles}>
        <div style={titleStyles}>Account Settings</div>
        <button
          style={closeButtonStyles}
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

      <div style={tabsStyles}>
        <button
          style={tabButtonStyles(activeTab === 'profile')}
          onClick={() => setActiveTab('profile')}
        >
          Profile
        </button>
        <button
          style={tabButtonStyles(activeTab === 'subscription')}
          onClick={() => setActiveTab('subscription')}
        >
          Plan
        </button>
        {isHostedEdition && (
          <button
            style={tabButtonStyles(activeTab === 'publicProfile')}
            onClick={() => setActiveTab('publicProfile')}
          >
            Public Profile
          </button>
        )}
      </div>

      <div style={contentStyles}>
        {/* R18: WHAT AM I TESTING? Dev builds only (production never renders
            this). Three axes, one line: the EDITION is the code in the bundle
            (VITE_NODESPEC_EDITION; absent means the OSS community tree), the
            TIER is the account (the seeded local subscription row, or the
            VITE_NODESPEC_TEST_TIER override), and the VARIANT is the
            presentation those resolve to. The seeded bench account is Team,
            which is why a local build shows Team workflow chrome. */}
        {import.meta.env.DEV && !gate.loading && (
          <div
            data-testid="build-identity-stamp"
            title={'Local build identity (dev builds only). Edition is the code axis (VITE_NODESPEC_EDITION); tier is the account axis: '
              + (testTierOverride() ? 'VITE_NODESPEC_TEST_TIER override.' : gate.subscription ? `subscription row "${gate.subscription.planName}" (supabase/seed.sql seeds the bench account at team).` : 'no subscription row, community default.')}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', padding: '7px 10px', borderRadius: '8px', border: `1px dashed ${c.border}`, color: c.textSecondary, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '11px', letterSpacing: '.03em' }}
          >
            <span style={{ fontWeight: 700, color: c.text }}>DEV</span>
            <span>edition {buildEdition}</span>
            <span>tier {tierDisplayName(gate.plan)}{testTierOverride() ? ' (test override)' : gate.subscription ? '' : ' (no row)'}</span>
            <span>{resolveVariant(gate.plan)} UI</span>
          </div>
        )}
        {activeTab === 'profile' && renderProfileTab()}
        {activeTab === 'subscription' && renderSubscriptionTab()}
        {isHostedEdition && activeTab === 'publicProfile' && <PublicProfileEditor userId={userId} />}
      </div>

      {showCancelModal && subscription && (
        <CancelSubscriptionModal
          subscription={subscription}
          onConfirm={handleCancelSubscription}
          onClose={handleCancelModalClose}
        />
      )}

      {showDeleteModal && (
        <DeleteAccountModal
          userEmail={userEmail || ''}
          onConfirm={handleDeleteAccount}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}

export const AccountPanel = memo(AccountPanelComponent);
