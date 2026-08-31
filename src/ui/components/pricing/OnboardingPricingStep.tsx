import { useState, useCallback } from 'react';
import { EnterpriseContactModal } from './EnterpriseContactModal.js';
import { deploymentTiers } from './pricing-data.js';

const DARK_BG = '#0f1117';
const DARK_SURFACE = '#1a1d26';
const BRAND = '#8B8FE6';
const BORDER_COLOR = 'rgba(139, 143, 230, 0.12)';

interface OnboardingPricingStepProps {
  onSelectFree: () => void;
  /** Legacy lane — no purchasable SaaS plans remain, so this is never invoked;
      kept so App's onboarding wiring stays source-compatible. */
  onSelectPaid?: (tierId: string, interval: 'month' | 'year') => void;
}

// Onboarding: every new hosted account starts on the Free card (the hosted
// free plan — 2 projects, no card). This step welcomes rather than
// sells — the only decision is "continue", with contact lanes for
// Team/Enterprise. NOT the 'community' card: that one is the downloadable
// container, whose CTA is the public repository.
export function OnboardingPricingStep({ onSelectFree }: OnboardingPricingStepProps) {
  const [loading, setLoading] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const community = deploymentTiers.find((t) => t.id === 'free') ?? deploymentTiers[0];

  const handleContinue = useCallback(() => {
    setLoading(true);
    onSelectFree();
  }, [onSelectFree]);

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: DARK_BG,
      zIndex: 11000,
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      animation: 'onb-pricing-fadeIn 0.3s ease-out',
    }}>
      <style>{`
        @keyframes onb-pricing-fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '64px 24px 80px',
        width: '100%',
        maxWidth: '640px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 800,
            color: '#E6E9EF',
            letterSpacing: '-0.02em',
            marginBottom: '12px',
            lineHeight: 1.2,
          }}>
            Welcome to NodeSpec
          </h1>
          <p style={{ fontSize: '16px', color: '#8a8f9e', lineHeight: 1.6, margin: 0 }}>
            Your free account is ready — no card, no trial clock.
          </p>
        </div>

        <div style={{
          width: '100%',
          backgroundColor: DARK_SURFACE,
          border: `2px solid ${BRAND}`,
          borderRadius: '16px',
          padding: '32px',
          marginBottom: '24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '8px' }}>
            <span style={{ fontSize: '20px', fontWeight: 700, color: '#E6E9EF' }}>{community.name}</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: BRAND }}>{community.audience}</span>
          </div>
          <p style={{ fontSize: '14px', color: '#8a8f9e', lineHeight: 1.6, marginTop: 0, marginBottom: '20px' }}>
            {community.description}
          </p>
          <div>
            {community.features.map((feature, idx) => (
              <div key={idx} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '10px',
                fontSize: '14px',
                color: '#c9cdd8',
              }}>
                <span style={{
                  width: '18px', height: '18px', borderRadius: '50%',
                  backgroundColor: 'rgba(74, 222, 128, 0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '11px', color: '#4ade80', flexShrink: 0, fontWeight: 700,
                }}>
                  {'✓'}
                </span>
                <span>{feature}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleContinue}
            disabled={loading}
            style={{
              width: '100%',
              marginTop: '20px',
              padding: '14px 20px',
              fontSize: '15px',
              fontWeight: 600,
              border: 'none',
              borderRadius: '10px',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              backgroundColor: BRAND,
              color: '#fff',
              transition: 'all 0.15s ease',
            }}
          >
            {loading ? 'Setting up your workspace…' : 'Start Building'}
          </button>
        </div>

        <div style={{
          width: '100%',
          border: `1px solid ${BORDER_COLOR}`,
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: '13px', color: '#8a8f9e', lineHeight: 1.6 }}>
            Need NodeSpec in your own environment?<br />
            <span style={{ color: '#c9cdd8' }}>Enterprise and Government run self-hosted.</span>
          </div>
          <button
            onClick={() => setShowContactModal(true)}
            style={{
              padding: '10px 18px',
              fontSize: '13px',
              fontWeight: 600,
              border: `1.5px solid ${BRAND}`,
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: 'transparent',
              color: BRAND,
              whiteSpace: 'nowrap',
            }}
          >
            Contact Us
          </button>
        </div>
      </div>

      {showContactModal && (
        <EnterpriseContactModal onClose={() => setShowContactModal(false)} />
      )}
    </div>
  );
}
