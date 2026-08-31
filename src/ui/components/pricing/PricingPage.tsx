import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PricingComparisonTable } from './PricingComparisonTable.js';
import { EnterpriseContactModal } from './EnterpriseContactModal.js';
import { COMMUNITY_REPO_URL } from './pricing-data.js';
import type { DeploymentTierId } from './pricing-data.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { SubscriptionService } from '../../services/SubscriptionService.js';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';
import logoLight from '../../assets/lightmode_nodal.png';

const BRAND = '#8B8FE6';
const DARK_BG = '#0f1117';
const DARK_SURFACE = '#1a1d26';

// Post-cutover pricing page (owner ruling 2026-08-10): four deployment tiers,
// no prices, no checkout — Community signs up free, Team/Enterprise go through
// the contact lane, Government has its own page. The V1 Stripe checkout rails
// stay server-side for existing subscribers; this surface no longer drives them.
export function PricingPage() {
  const navigate = useNavigate();

  usePageSeo({
    title: 'Pricing - NodeSpec',
    description:
      'NodeSpec tiers: Community is the free open-source container, Free is hosted with 2 projects, Indie ($15/mo or $144/yr) adds repo import reverse visualization, Team adds teamwork integrations, Enterprise and Government run self-hosted.',
    path: '/pricing',
    keywords:
      'NodeSpec pricing, AI architecture tool pricing, self-hosted architecture tool, software architecture governance, MCP architecture context, free architecture tool',
    breadcrumbs: [
      { name: 'Home', url: BASE_URL },
      { name: 'Pricing', url: `${BASE_URL}/pricing` },
    ],
  });

  const [user, setUser] = useState<{ id: string } | null>(null);
  const [showContactModal, setShowContactModal] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ? { id: session.user.id } : null);
    });
  }, []);

  const handleSelect = (tierId: DeploymentTierId, interval: 'month' | 'year' = 'month') => {
    if (tierId === 'community') {
      // The downloadable container — the CTA is the public repository.
      window.open(COMMUNITY_REPO_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    if (tierId === 'free') {
      navigate(user ? '/app' : '/');
      return;
    }
    if (tierId === 'indie') {
      if (!user) {
        navigate('/');
        return;
      }
      void (async () => {
        const supabase = getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const svc = new SubscriptionService(supabase);
        const result = await svc.createCheckoutSession('indie', interval, session.access_token);
        if ('url' in result) window.location.href = result.url;
        else console.error('[PricingPage] Checkout error:', result.error);
      })();
      return;
    }
    if (tierId === 'government') {
      navigate('/government');
      return;
    }
    setShowContactModal(true);
  };

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      overflowY: 'auto',
      background: `linear-gradient(180deg, ${DARK_BG} 0%, ${DARK_SURFACE} 100%)`,
    }}>
      <nav className="landing-nav" style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px',
        borderBottom: '1px solid rgba(139, 143, 230, 0.08)',
        backgroundColor: 'rgba(15, 17, 23, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          <img src={logoLight} alt="NodeSpec" style={{ height: '32px', width: 'auto', filter: 'brightness(10)' }} />
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#E6E9EF', letterSpacing: '-0.02em' }}>
            NodeSpec
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div className="landing-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { label: 'Features', action: () => navigate('/#features') },
              { label: 'Contact', action: () => navigate('/#contact') },
            ].map(item => (
              <span
                key={item.label}
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#8a8f9e',
                  cursor: 'pointer',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  transition: 'all 0.15s ease',
                }}
                onClick={item.action}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#E6E9EF';
                  e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#8a8f9e';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
          <span
            className="landing-nav-signin"
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: '#E6E9EF',
              cursor: 'pointer',
              padding: '8px 20px',
              borderRadius: '8px',
              border: `1px solid rgba(139, 143, 230, 0.2)`,
              transition: 'all 0.15s ease',
              backgroundColor: 'transparent',
              marginLeft: '8px',
            }}
            onClick={() => navigate(user ? '/app' : '/')}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.35)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.2)';
            }}
          >
            {user ? 'Back to App' : 'Sign In'}
          </span>
        </div>
      </nav>

      <div className="pricing-page-content" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '64px 24px 80px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '48px', maxWidth: '640px' }}>
          <h1 className="pricing-heading" style={{
            fontSize: '38px',
            fontWeight: 800,
            color: '#E6E9EF',
            letterSpacing: '-0.03em',
            marginBottom: '14px',
            lineHeight: 1.2,
          }}>
            Start free. Scale when you're ready.
          </h1>
          <p style={{
            fontSize: '16px',
            color: '#8a8f9e',
            lineHeight: '1.6',
            margin: 0,
          }}>
            Run the open-source container in your own environment, or start free on
            the hosted app. Indie adds repo import, Team adds the teamwork lane, and
            Enterprise and Government run self-hosted on your terms.
          </p>
        </div>

        <PricingComparisonTable onSelect={handleSelect} />

        {showContactModal && (
          <EnterpriseContactModal onClose={() => setShowContactModal(false)} />
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

      <SiteFooter />
    </div>
  );
}
