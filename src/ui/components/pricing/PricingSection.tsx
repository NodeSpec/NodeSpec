import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PricingComparisonTable } from './PricingComparisonTable.js';
import { EnterpriseContactModal } from './EnterpriseContactModal.js';
import { TeamWaitlistModal } from './TeamWaitlistModal.js';
import { COMMUNITY_REPO_URL } from './pricing-data.js';
import type { DeploymentTierId } from './pricing-data.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { SubscriptionService } from '../../services/SubscriptionService.js';
import { BlueprintGrid } from '../auth/BlueprintGrid.js';

const BRAND = '#8B8FE6';
const DARK_BG = '#0f1117';

interface PricingSectionProps {
  onRequestSignUp?: (planId?: string) => void;
}

// Six-card pricing (owner design 2026-08-26): Community links to the public
// repository (the downloadable container), Free signs up hosted, Indie goes
// to live Stripe checkout, Team is a coming-soon waitlist, Enterprise is a
// contact lane, Government has its own page. Existing V1 subscribers keep
// their plans via the account panel.
export function PricingSection({ onRequestSignUp }: PricingSectionProps) {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });
  }, []);

  const handleSelect = (tierId: DeploymentTierId) => {
    if (tierId === 'community') {
      // The downloadable container — the CTA is the public repository.
      window.open(COMMUNITY_REPO_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    if (tierId === 'free') {
      if (user) navigate('/app');
      else if (onRequestSignUp) onRequestSignUp();
      else navigate('/');
      return;
    }
    if (tierId === 'indie') {
      // Paid hosted plan with live Stripe prices: signed-in users go straight
      // to checkout; signed-out users create the account first (checkout is
      // one click away once inside).
      if (!user) {
        if (onRequestSignUp) onRequestSignUp();
        else navigate('/');
        return;
      }
      void (async () => {
        const supabase = getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const svc = new SubscriptionService(supabase);
        const result = await svc.createCheckoutSession('indie', 'month', session.access_token);
        if ('url' in result) window.location.href = result.url;
        else console.error('[PricingSection] Checkout error:', result.error);
      })();
      return;
    }
    if (tierId === 'government') {
      navigate('/government');
      return;
    }
    if (tierId === 'team') {
      // Team is a log-only waitlist lane until the per-seat checkout ships —
      // the light name/email/company form, never the enterprise intake.
      setShowWaitlistModal(true);
      return;
    }
    setShowContactModal(true);
  };

  return (
    <section style={{
      width: '100%',
      background: DARK_BG,
      borderTop: '1px solid rgba(139, 143, 230, 0.06)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <BlueprintGrid variant="dark" density="sparse" showGrid={false} />
      <div style={{
        position: 'absolute',
        width: '600px',
        height: '600px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139, 143, 230, 0.05) 0%, transparent 70%)',
        top: '20%',
        left: '-10%',
        pointerEvents: 'none',
        filter: 'blur(60px)',
      }} />
      <div className="pricing-section-inner" style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '80px 24px 96px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: '48px', maxWidth: '640px' }}>
          <h2 className="pricing-heading" style={{
            fontSize: '38px',
            fontWeight: 800,
            color: '#E6E9EF',
            letterSpacing: '-0.03em',
            marginBottom: '14px',
            lineHeight: 1.2,
          }}>
            Pricing Tiers
          </h2>
          <p style={{
            fontSize: '16px',
            color: '#8a8f9e',
            lineHeight: '1.6',
            margin: 0,
          }}>
            Start free on the web app. Scale to your own environment when you need it.
          </p>
        </div>

        <PricingComparisonTable onSelect={handleSelect} />

        {showContactModal && (
          <EnterpriseContactModal onClose={() => setShowContactModal(false)} />
        )}
        {showWaitlistModal && (
          <TeamWaitlistModal onClose={() => setShowWaitlistModal(false)} />
        )}

        <div style={{
          textAlign: 'center',
          marginTop: '40px',
          fontSize: '13px',
          color: '#5a5f78',
          lineHeight: '1.6',
        }}>
          All tiers include SSL encryption and secure data storage.
          <br />
          Questions? Reach out at <span style={{ color: BRAND }}>contact@nodespec.io</span>
        </div>
      </div>
    </section>
  );
}
