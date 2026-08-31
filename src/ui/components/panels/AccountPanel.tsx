import { memo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../theme/ThemeContext.js';
import { useAuth, useSubscription } from '../../context/ServiceContext.js';
import { getPlanDisplayName, getTokenLimitDisplay } from '../pricing/pricing-data.js';
import type { SubscriptionInfo } from '../../services/SubscriptionService.js';
import { CancelSubscriptionModal } from './CancelSubscriptionModal.js';
import { DeleteAccountModal } from './DeleteAccountModal.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { useIsAdmin } from '../../hooks/useAdmin.js';
import { isHostedEdition } from '../../config/edition.js';
import { PublicProfileEditor } from './PublicProfileEditor.js';

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
  const [useV4, setUseV4] = useState(true);
  const [v4Loading, setV4Loading] = useState(true);
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    const loadV4Setting = async () => {
      try {
        const supabase = getSupabaseClient();
        let uid = userId;
        if (!uid) {
          const session = await auth.getSession();
          uid = session?.user?.id;
        }
        if (!uid) { setV4Loading(false); return; }

        const { data } = await supabase
          .from('user_settings')
          .select('use_v4_orchestrator')
          .eq('user_id', uid)
          .maybeSingle();

        if (data) setUseV4(data.use_v4_orchestrator !== false);
      } catch {}
      setV4Loading(false);
    };
    loadV4Setting();
  }, [userId, auth]);

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
    width: '460px',
    maxHeight: '640px',
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

  const handleToggleV4 = async (enabled: boolean) => {
    setUseV4(enabled);
    try {
      const supabase = getSupabaseClient();
      let uid = userId;
      if (!uid) {
        const session = await auth.getSession();
        uid = session?.user?.id;
      }
      if (!uid) return;

      await supabase
        .from('user_settings')
        .upsert({ user_id: uid, use_v4_orchestrator: enabled }, { onConflict: 'user_id' });
    } catch {
      setUseV4(!enabled);
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

      {isAdmin && (
      <div style={{
        borderTop: `1px solid ${c.border}`,
        paddingTop: '20px',
        marginTop: '4px',
        marginBottom: '20px',
      }}>
        <div style={labelStyles}>Developer Settings</div>
        <div style={{
          padding: '12px',
          backgroundColor: c.background,
          border: `1px solid ${c.border}`,
          borderRadius: '6px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: c.text }}>
                V4 AI Engine
              </div>
              <div style={{ fontSize: '11px', color: c.textMuted, marginTop: '2px' }}>
                Multi-provider AI engine (testing)
              </div>
            </div>
            <button
              onClick={() => handleToggleV4(!useV4)}
              disabled={v4Loading}
              style={{
                position: 'relative',
                width: '40px',
                height: '22px',
                borderRadius: '11px',
                border: 'none',
                backgroundColor: useV4 ? c.primary : (theme.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'),
                cursor: v4Loading ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.2s',
                padding: 0,
                opacity: v4Loading ? 0.5 : 1,
              }}
            >
              <div style={{
                position: 'absolute',
                top: '2px',
                left: useV4 ? '20px' : '2px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: '#fff',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>
        </div>
      </div>
      )}

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
            {subscription.tokenLimit > 0 && (
              <div style={{ fontSize: '12px', color: c.textMuted }}>
                {getTokenLimitDisplay(subscription.tokenLimit)} tokens/month
              </div>
            )}
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
