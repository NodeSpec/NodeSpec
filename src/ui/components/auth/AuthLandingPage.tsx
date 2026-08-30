import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { AnimatedBackground } from './AnimatedBackground.js';
import { BlueprintGrid } from './BlueprintGrid.js';
import { ProductTourSection } from './ProductTourSection.js';
import { TechEcosystemSection } from './TechEcosystemSection.js';
import { OssCommunitySection } from './OssCommunitySection.js';
import { PricingSection } from '../pricing/PricingSection.js';
import { isHostedEdition, isEnterpriseEdition, editionLabel } from '../../config/edition.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import logoLight from '../../assets/lightmode_nodal.png';

const PRIMARY = '#8B8FE6';
const PRIMARY_LIGHT = 'rgba(139, 143, 230, 0.15)';
const PRIMARY_BORDER = 'rgba(139, 143, 230, 0.2)';
const PRIMARY_SHADOW = 'rgba(139, 143, 230, 0.3)';

interface AuthLandingPageProps {
  onSignIn: (email: string, password: string, captchaToken?: string) => Promise<{ mfaRequired: boolean; factorId?: string } | void>;
  onSignUp: (email: string, password: string, captchaToken?: string) => Promise<{ mfaEnroll: true; factorId: string; qrCode: string; secret: string } | 'confirmation_needed' | void>;
  onVerifyMfa: (factorId: string, code: string) => Promise<void>;
  onOAuthSignIn: (provider: 'google') => Promise<void>;
  onPasswordReset?: (email: string) => Promise<void>;
  oauthMfaFactorId?: string | null;
  onOauthMfaComplete?: () => void;
}

export function AuthLandingPage({ onSignIn, onSignUp, onVerifyMfa, onOAuthSignIn, onPasswordReset, oauthMfaFactorId, onOauthMfaComplete }: AuthLandingPageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pendingPlan = searchParams.get('plan');
  // Self-hosted builds have no marketing hero — they boot straight to sign-in.
  const defaultMode = pendingPlan ? 'signup' : isHostedEdition ? 'hero' : 'signin';
  const [mode, setMode] = useState<'hero' | 'signin' | 'signup' | 'forgot' | 'mfa' | 'mfa-enroll'>(defaultMode);
  // Post-2026-08-10 pricing: no purchasable SaaS plans, so a ?plan= deep link no
  // longer selects a tier — it just lands the visitor on the signup form.
  const [, setSelectedPlanId] = useState<string | null>(pendingPlan);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [signupEmail, setSignupEmail] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [captchaStatus, setCaptchaStatus] = useState<'loading' | 'ready' | 'solved' | 'error' | 'skipped'>('loading');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [, setCaptchaFailCount] = useState(0);
  const [navDark, setNavDark] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaQrCode, setMfaQrCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const captchaRef = useRef<TurnstileInstance>(null);
  const heroRef = useRef<HTMLElement>(null);
  const featuresRef = useRef<HTMLDivElement>(null);
  const pricingRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  // The hardcoded fallback key is domain-locked to nodespec.io — on a
  // self-hosted origin it can only fail. There, captcha runs solely when the
  // deployment sets its own key (selfhost.env), matching config.toml where
  // [auth.captcha] ships disabled.
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || (isHostedEdition ? '0x4AAAAAAC35x_nOg9ZE0X0Z' : '');

  useEffect(() => {
    if (oauthMfaFactorId) {
      setMfaFactorId(oauthMfaFactorId);
      setMfaCode('');
      setMode('mfa');
    }
  }, [oauthMfaFactorId]);

  usePageSeo({
    title: 'NodeSpec - AI Architecture Context for Cursor, Claude & Agents',
    description: 'Visually map your software architecture, export it as structured AI context, and stop hallucinations. Give Cursor, Claude, and any AI agent a complete system blueprint.',
    path: '/',
    keywords: 'AI coding context, Cursor architecture, Claude code context, AI agent architecture, spec-driven development, software specification, acceptance criteria, agent task generation, agentic workflow, MCP Model Context Protocol, Cursor rules, coding agent context, architecture documentation, architecture to code, vibe coding tool, system design for AI, architecture diagram, software architecture tool, visual system map, prevent AI hallucination',
    jsonLd: [
      {
        id: 'org-schema',
        data: {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'NodeSpec',
          url: BASE_URL,
          logo: `${BASE_URL}/lightmode_nodal.png`,
          sameAs: [
            'https://x.com/NodeSpec',
            'https://www.linkedin.com/company/nodespec/',
          ],
        },
      },
      {
        id: 'webapp-schema',
        data: {
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: 'NodeSpec',
          url: BASE_URL,
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Web',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          description: 'NodeSpec is a visual architecture tool for spec-driven development. Map your system components on an interactive canvas, generate software specifications with requirements and acceptance criteria, produce agent task context, and export structured blueprints for Cursor, Claude, and any AI coding agent. Stop AI hallucinations by giving your agent a complete system blueprint — not just a prompt.',
          featureList: [
            'Visual architecture canvas',
            'Spec-driven development workflow',
            'Software specification generation',
            'Acceptance criteria generation',
            'Agent task context export',
            'MCP Model Context Protocol integration',
            'Cursor rules export',
            'Agentic workflow support',
            'AI coding context for Cursor and Claude',
            'Architecture-to-code generation',
          ],
          author: { '@type': 'Organization', name: 'NodeSpec' },
        },
      },
    ],
  });

  useEffect(() => {
    const root = document.querySelector('[data-landing-scroll]');
    if (!root) return;
    const onScroll = () => {
      setNavDark(root.scrollTop > window.innerHeight * 0.7);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, []);

  const handleRequestSignUp = useCallback((planId?: string) => {
    setSelectedPlanId(planId ?? null);
    setMode('signup');
    setError(null);
    heroRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!signupSuccess) return;
    const interval = setInterval(async () => {
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [signupSuccess]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleResendConfirmation = async () => {
    if (resendCooldown > 0) return;
    try {
      const supabase = getSupabaseClient();
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: signupEmail,
      });
      if (resendError) throw resendError;
      setResendStatus('sent');
      setResendCooldown(30);
      setTimeout(() => setResendStatus('idle'), 3000);
    } catch {
      setResendStatus('error');
      setTimeout(() => setResendStatus('idle'), 3000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode !== 'forgot' && mode !== 'mfa' && mode !== 'mfa-enroll' && turnstileSiteKey && !captchaToken && captchaStatus !== 'skipped') {
      setError('Please complete the CAPTCHA verification');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'forgot') {
        if (onPasswordReset) await onPasswordReset(email);
        setResetSent(true);
      } else if (mode === 'mfa' || mode === 'mfa-enroll') {
        await onVerifyMfa(mfaFactorId, mfaCode);
        if (oauthMfaFactorId && onOauthMfaComplete) {
          onOauthMfaComplete();
        }
      } else if (mode === 'signin') {
        const result = await onSignIn(email, password, captchaToken);
        if (result && result.mfaRequired && result.factorId) {
          setMfaFactorId(result.factorId);
          setMfaCode('');
          setMode('mfa');
          setError(null);
          setLoading(false);
          return;
        }
      } else {
        const result = await onSignUp(email, password, captchaToken);
        if (result === 'confirmation_needed') {
          setSignupSuccess(true);
          setSignupEmail(email);
          setLoading(false);
          return;
        }
        if (result && typeof result === 'object' && 'mfaEnroll' in result) {
          setMfaFactorId(result.factorId);
          setMfaQrCode(result.qrCode);
          setMfaSecret(result.secret);
          setMfaCode('');
          setMode('mfa-enroll');
          setError(null);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      if (msg.toLowerCase().includes('captcha')) {
        setError('CAPTCHA verification failed. Please complete the check above and try again.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
      if (mode !== 'mfa' && mode !== 'mfa-enroll') {
        setCaptchaToken(undefined);
        setCaptchaStatus('loading');
        setCaptchaKey(k => k + 1);
      }
    }
  };

  const handleOAuthSignIn = async (provider: 'google') => {
    setError(null);
    setLoading(true);
    try {
      await onOAuthSignIn(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const showForm = mode !== 'hero' || signupSuccess;

  const input: React.CSSProperties = {
    padding: '14px 18px',
    fontSize: '15px',
    border: `2px solid ${PRIMARY_BORDER}`,
    borderRadius: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    color: '#1f2937',
    outline: 'none',
    transition: 'all 0.2s',
  };

  const link: React.CSSProperties = {
    color: PRIMARY,
    cursor: 'pointer',
    textDecoration: 'none',
    fontWeight: 600,
  };

  const renderHeroContent = () => (
    <div className="landing-hero-content" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: showForm ? 'flex-start' : 'center',
      justifyContent: 'center',
      textAlign: showForm ? 'left' : 'center',
      maxWidth: '560px',
    }}>
      <img
        src={logoLight}
        alt="NodeSpec"
        className="landing-hero-logo"
        style={{
          height: showForm ? '120px' : '160px',
          width: 'auto',
          marginBottom: '28px',
          filter: `drop-shadow(0 8px 24px ${PRIMARY_SHADOW}) drop-shadow(0 4px 12px rgba(99, 102, 241, 0.15))`,
        }}
      />
      {!isHostedEdition ? (
        // Self-hosted editions: an elegant wordmark + edition label — no
        // marketing copy, no tour, just the brand over the same hero backdrop.
        <>
          <div className="landing-hero-headline" style={{
            fontSize: '44px',
            fontWeight: 700,
            color: '#1f2937',
            letterSpacing: '-0.02em',
            lineHeight: '1.2',
            marginBottom: '14px',
          }}>
            NodeSpec
          </div>
          <div style={{
            fontSize: '15px',
            fontWeight: 600,
            color: PRIMARY,
            letterSpacing: '0.34em',
            textTransform: 'uppercase',
            paddingLeft: '0.34em',
          }}>
            {editionLabel}
          </div>
        </>
      ) : (
      <div className="landing-hero-headline" style={{
        fontSize: showForm ? '28px' : '36px',
        fontWeight: 600,
        color: '#1f2937',
        letterSpacing: '-0.01em',
        lineHeight: '1.4',
        marginBottom: '20px',
      }}>
        <span style={{ color: PRIMARY }}>Design</span> Smarter.{' '}
        <span style={{ color: PRIMARY }}>Build</span> Better.{' '}
        <span style={{ color: PRIMARY }}>Ship</span> Faster.
      </div>
      )}
      {isHostedEdition && (
      <div className="landing-hero-subtitle" style={{
        fontSize: showForm ? '16px' : '19px',
        fontWeight: 400,
        color: '#5c6474',
        lineHeight: '1.6',
        maxWidth: '600px',
        marginBottom: showForm ? '0' : '40px',
        animation: showForm ? undefined : 'ns-rise .9s cubic-bezier(.16,1,.3,1) .32s both',
      }}>
        One living model of your system. Requirements, architecture, deployment and tests stay connected, so your team and your AI agents build from the same source of truth.
      </div>
      )}
      {isHostedEdition && !showForm && (
        <>
          <div className="landing-hero-cta-row" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              onClick={() => { setSelectedPlanId(null); setMode('signup'); setError(null); }}
              style={{
                padding: '16px 32px',
                fontSize: '16px',
                fontWeight: 700,
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                background: `linear-gradient(135deg, ${PRIMARY}, #a78bfa)`,
                color: '#ffffff',
                transition: 'all 0.2s',
                boxShadow: `0 4px 16px ${PRIMARY_SHADOW}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 8px 24px rgba(139, 143, 230, 0.4)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = `0 4px 16px ${PRIMARY_SHADOW}`;
              }}
            >
              Get Started Free
            </button>
            <button
              onClick={() => scrollTo(pricingRef)}
              style={{
                padding: '16px 32px',
                fontSize: '16px',
                fontWeight: 600,
                border: `1px solid ${PRIMARY_BORDER}`,
                borderRadius: '12px',
                cursor: 'pointer',
                background: 'transparent',
                color: '#374151',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = PRIMARY_LIGHT;
                e.currentTarget.style.borderColor = PRIMARY;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = PRIMARY_BORDER;
              }}
            >
              View Plans
            </button>
          </div>
          <div style={{ marginTop: '16px', fontSize: '13px', color: '#9ca3af' }}>
            No credit card required
          </div>
        </>
      )}
    </div>
  );

  const renderMfaVerification = () => (
    <div className="landing-form-card" style={{
      background: 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      borderRadius: '24px',
      padding: '40px',
      boxShadow: '0 8px 32px rgba(139, 143, 230, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
      width: '100%',
      maxWidth: '420px',
      textAlign: 'center',
    }}>
      <div style={{
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${PRIMARY_LIGHT}, rgba(139, 143, 230, 0.25))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 24px',
        border: `1px solid ${PRIMARY_BORDER}`,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={PRIMARY} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <h2 style={{
        fontSize: '24px',
        fontWeight: 700,
        color: '#1f2937',
        marginBottom: '12px',
      }}>
        Two-factor authentication
      </h2>

      <p style={{
        fontSize: '15px',
        color: '#4b5563',
        lineHeight: 1.6,
        marginBottom: '24px',
      }}>
        Enter the 6-digit code from your authenticator app
      </p>

      {error && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          borderRadius: '10px',
          fontSize: '14px',
          border: '1px solid #fecaca',
          marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={mfaCode}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, '').slice(0, 6);
            setMfaCode(val);
          }}
          style={{
            ...input,
            textAlign: 'center',
            fontSize: '24px',
            fontWeight: 700,
            letterSpacing: '0.5em',
            fontFamily: 'monospace',
          }}
          placeholder="000000"
          required
          disabled={loading}
          autoFocus
          onFocus={(e) => {
            e.currentTarget.style.borderColor = PRIMARY;
            e.currentTarget.style.backgroundColor = '#ffffff';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = PRIMARY_BORDER;
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
          }}
        />

        <button
          type="submit"
          disabled={loading || mfaCode.length !== 6}
          style={{
            padding: '14px',
            fontSize: '15px',
            fontWeight: 600,
            border: 'none',
            borderRadius: '12px',
            cursor: (loading || mfaCode.length !== 6) ? 'not-allowed' : 'pointer',
            opacity: (loading || mfaCode.length !== 6) ? 0.6 : 1,
            background: `linear-gradient(135deg, ${PRIMARY}, #a78bfa)`,
            color: '#ffffff',
            transition: 'all 0.3s ease',
            boxShadow: `0 4px 16px ${PRIMARY_SHADOW}`,
          }}
          onMouseEnter={(e) => {
            if (!loading && mfaCode.length === 6) {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = `0 8px 24px rgba(139, 143, 230, 0.4)`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = `0 4px 16px ${PRIMARY_SHADOW}`;
          }}
        >
          {loading ? 'Verifying...' : 'Verify Code'}
        </button>
      </form>

      <div style={{ marginTop: '16px', fontSize: '14px', color: '#6b7280' }}>
        <span
          style={{
            color: PRIMARY,
            cursor: 'pointer',
            fontWeight: 600,
          }}
          onClick={() => {
            setMode('signin');
            setMfaCode('');
            setMfaFactorId('');
            setError(null);
          }}
        >
          Back to sign in
        </span>
      </div>
    </div>
  );

  const renderMfaEnrollment = () => (
    <div className="landing-form-card" style={{
      background: 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      borderRadius: '24px',
      padding: '40px',
      boxShadow: '0 8px 32px rgba(139, 143, 230, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
      width: '100%',
      maxWidth: '420px',
      textAlign: 'center',
    }}>
      <div style={{
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        background: `linear-gradient(135deg, ${PRIMARY_LIGHT}, rgba(139, 143, 230, 0.25))`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 24px',
        border: `1px solid ${PRIMARY_BORDER}`,
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={PRIMARY} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
          <line x1="12" y1="18" x2="12.01" y2="18" />
        </svg>
      </div>

      <h2 style={{
        fontSize: '24px',
        fontWeight: 700,
        color: '#1f2937',
        marginBottom: '12px',
      }}>
        Set up two-factor authentication
      </h2>

      <p style={{
        fontSize: '15px',
        color: '#4b5563',
        lineHeight: 1.6,
        marginBottom: '20px',
      }}>
        Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
      </p>

      {mfaQrCode && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: '16px',
        }}>
          <img
            src={mfaQrCode}
            alt="QR Code for authenticator app"
            style={{
              width: '180px',
              height: '180px',
              borderRadius: '12px',
              border: `2px solid ${PRIMARY_BORDER}`,
              padding: '8px',
              backgroundColor: '#ffffff',
            }}
          />
        </div>
      )}

      {mfaSecret && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: 'rgba(249, 250, 251, 0.9)',
          border: '1px solid rgba(209, 213, 219, 0.5)',
          borderRadius: '10px',
          marginBottom: '20px',
        }}>
          <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
            Or enter this key manually:
          </div>
          <div style={{
            fontSize: '13px',
            fontWeight: 600,
            color: '#1f2937',
            fontFamily: 'monospace',
            letterSpacing: '0.05em',
            wordBreak: 'break-all',
          }}>
            {mfaSecret}
          </div>
        </div>
      )}

      {error && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          borderRadius: '10px',
          fontSize: '14px',
          border: '1px solid #fecaca',
          marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      <p style={{
        fontSize: '14px',
        color: '#4b5563',
        marginBottom: '12px',
      }}>
        Then enter the 6-digit code to verify:
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={mfaCode}
          onChange={(e) => {
            const val = e.target.value.replace(/\D/g, '').slice(0, 6);
            setMfaCode(val);
          }}
          style={{
            ...input,
            textAlign: 'center',
            fontSize: '24px',
            fontWeight: 700,
            letterSpacing: '0.5em',
            fontFamily: 'monospace',
          }}
          placeholder="000000"
          required
          disabled={loading}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = PRIMARY;
            e.currentTarget.style.backgroundColor = '#ffffff';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = PRIMARY_BORDER;
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
          }}
        />

        <button
          type="submit"
          disabled={loading || mfaCode.length !== 6}
          style={{
            padding: '14px',
            fontSize: '15px',
            fontWeight: 600,
            border: 'none',
            borderRadius: '12px',
            cursor: (loading || mfaCode.length !== 6) ? 'not-allowed' : 'pointer',
            opacity: (loading || mfaCode.length !== 6) ? 0.6 : 1,
            background: `linear-gradient(135deg, ${PRIMARY}, #a78bfa)`,
            color: '#ffffff',
            transition: 'all 0.3s ease',
            boxShadow: `0 4px 16px ${PRIMARY_SHADOW}`,
          }}
          onMouseEnter={(e) => {
            if (!loading && mfaCode.length === 6) {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = `0 8px 24px rgba(139, 143, 230, 0.4)`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = `0 4px 16px ${PRIMARY_SHADOW}`;
          }}
        >
          {loading ? 'Verifying...' : 'Verify & Complete Setup'}
        </button>
      </form>
    </div>
  );

  const renderConfirmation = () => (
    <div className="landing-form-card" style={{
      background: 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      borderRadius: '24px',
      padding: '40px',
      boxShadow: '0 8px 32px rgba(139, 143, 230, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
      width: '100%',
      maxWidth: '420px',
      textAlign: 'center',
    }}>
      <div style={{
        width: '64px',
        height: '64px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 24px',
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      </div>

      <h2 style={{
        fontSize: '24px',
        fontWeight: 700,
        color: '#1f2937',
        marginBottom: '12px',
      }}>
        Check your inbox
      </h2>

      <p style={{
        fontSize: '15px',
        color: '#4b5563',
        lineHeight: 1.6,
        marginBottom: '8px',
      }}>
        We sent a confirmation link to
      </p>
      <p style={{
        fontSize: '15px',
        fontWeight: 600,
        color: '#1f2937',
        marginBottom: '24px',
      }}>
        {signupEmail}
      </p>
      <p style={{
        fontSize: '14px',
        color: '#6b7280',
        lineHeight: 1.6,
        marginBottom: '28px',
      }}>
        Click the link in the email to activate your account. If you don't see it, check your spam folder.
      </p>

      {resendStatus === 'sent' && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#f0fdf4',
          color: '#16a34a',
          borderRadius: '10px',
          fontSize: '14px',
          border: '1px solid #bbf7d0',
          marginBottom: '16px',
        }}>
          Confirmation email resent
        </div>
      )}

      {resendStatus === 'error' && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          borderRadius: '10px',
          fontSize: '14px',
          border: '1px solid #fecaca',
          marginBottom: '16px',
        }}>
          Failed to resend. Please try again.
        </div>
      )}

      <button
        onClick={handleResendConfirmation}
        disabled={resendCooldown > 0}
        style={{
          width: '100%',
          padding: '14px',
          fontSize: '15px',
          fontWeight: 600,
          border: `2px solid ${resendCooldown > 0 ? 'rgba(209, 213, 219, 0.5)' : PRIMARY_BORDER}`,
          borderRadius: '12px',
          cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
          backgroundColor: resendCooldown > 0 ? 'rgba(249, 250, 251, 0.8)' : 'rgba(255, 255, 255, 0.9)',
          color: resendCooldown > 0 ? '#9ca3af' : '#1f2937',
          transition: 'all 0.2s',
          marginBottom: '16px',
        }}
      >
        {resendCooldown > 0
          ? `Resend in ${resendCooldown}s`
          : 'Resend confirmation email'}
      </button>

      <div style={{ fontSize: '14px', color: '#6b7280' }}>
        <span
          style={{
            color: PRIMARY,
            cursor: 'pointer',
            fontWeight: 600,
          }}
          onClick={() => {
            setSignupSuccess(false);
            setSignupEmail('');
            setResendCooldown(0);
            setResendStatus('idle');
            setMode('signin');
            setError(null);
          }}
        >
          Back to sign in
        </span>
      </div>
    </div>
  );

  const renderForm = () => (
    <div className="landing-form-card" style={{
      background: 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      borderRadius: '24px',
      padding: '40px',
      boxShadow: `0 8px 32px rgba(139, 143, 230, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)`,
      width: '100%',
      maxWidth: '420px',
    }}>
      <div style={{ marginBottom: '28px', textAlign: 'center' }}>
        <div className="landing-form-title" style={{ fontSize: '28px', fontWeight: 700, color: '#1f2937', marginBottom: '8px' }}>
          {mode === 'forgot'
            ? 'Reset password'
            : mode === 'signin'
              ? 'Welcome back'
              : 'Create your account'}
        </div>
        {mode !== 'signup' && (
          <div style={{ fontSize: '15px', color: '#6b7280' }}>
            {mode === 'forgot'
              ? "Enter your email and we'll send a reset link"
              : 'Sign in to continue to NodeSpec'}
          </div>
        )}
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          borderRadius: '10px',
          fontSize: '14px',
          border: '1px solid #fecaca',
          marginBottom: '16px',
        }}>
          {error}
        </div>
      )}

      {resetSent && mode === 'forgot' && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: '#f0fdf4',
          color: '#16a34a',
          borderRadius: '10px',
          fontSize: '14px',
          border: '1px solid #bbf7d0',
          marginBottom: '16px',
        }}>
          Check your email for a password reset link.
        </div>
      )}

      {mode !== 'forgot' && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                padding: '14px 18px',
                fontSize: '15px',
                fontWeight: 600,
                border: `2px solid ${PRIMARY_BORDER}`,
                borderRadius: '12px',
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                color: '#1f2937',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                transition: 'all 0.2s',
              }}
              disabled={loading}
              onClick={() => handleOAuthSignIn('google')}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.borderColor = PRIMARY;
                  e.currentTarget.style.backgroundColor = '#ffffff';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = PRIMARY_BORDER;
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            margin: '20px 0',
          }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: PRIMARY_BORDER }} />
            <div style={{ fontSize: '13px', color: '#9ca3af', fontWeight: 500 }}>or</div>
            <div style={{ flex: 1, height: '1px', backgroundColor: PRIMARY_BORDER }} />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={input}
            placeholder="you@example.com"
            required
            disabled={loading}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = PRIMARY;
              e.currentTarget.style.backgroundColor = '#ffffff';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = PRIMARY_BORDER;
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            }}
          />
        </div>

        {mode !== 'forgot' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={input}
              placeholder="Min 6 characters"
              required
              minLength={6}
              disabled={loading}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = PRIMARY;
                e.currentTarget.style.backgroundColor = '#ffffff';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = PRIMARY_BORDER;
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
              }}
            />
          </div>
        )}

        {mode === 'signin' && (
          <div style={{ textAlign: 'right', marginTop: '-8px' }}>
            <span
              style={{ ...link, fontSize: '13px' }}
              onClick={() => { setMode('forgot'); setError(null); setResetSent(false); }}
            >
              Forgot password?
            </span>
          </div>
        )}

        {turnstileSiteKey && mode !== 'forgot' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            minHeight: 65,
          }}>
            {captchaStatus !== 'error' && captchaStatus !== 'skipped' && (
              <Turnstile
                key={`${mode}-${captchaKey}`}
                ref={captchaRef}
                siteKey={turnstileSiteKey}
                onSuccess={(token) => {
                  setCaptchaToken(token);
                  setCaptchaStatus('solved');
                }}
                onExpire={() => {
                  setCaptchaToken(undefined);
                  setCaptchaStatus('loading');
                  setCaptchaKey(k => k + 1);
                }}
                onError={() => {
                  setCaptchaToken(undefined);
                  setCaptchaFailCount(c => {
                    const next = c + 1;
                    if (next >= 2) {
                      setCaptchaStatus('skipped');
                    } else {
                      setCaptchaStatus('error');
                    }
                    return next;
                  });
                }}
                onWidgetLoad={() => setCaptchaStatus('ready')}
                options={{
                  theme: 'light',
                  size: 'normal',
                  retry: 'auto',
                  execution: 'render',
                  appearance: 'always',
                }}
              />
            )}
            {captchaStatus === 'error' && (
              <button
                type="button"
                onClick={() => {
                  setCaptchaStatus('loading');
                  setCaptchaKey(k => k + 1);
                }}
                style={{
                  fontSize: '13px',
                  color: '#dc2626',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  padding: '8px 16px',
                }}
              >
                Verification failed -- click to retry
              </button>
            )}
            {captchaStatus === 'skipped' && (
              <span style={{
                fontSize: '12px',
                color: '#6b7280',
              }}>
                CAPTCHA unavailable — proceeding without verification
              </span>
            )}
          </div>
        )}

        <button
          type="submit"
          style={{
            padding: '14px',
            fontSize: '15px',
            fontWeight: 600,
            border: 'none',
            borderRadius: '12px',
            cursor: (loading || (turnstileSiteKey && mode !== 'forgot' && !captchaToken && captchaStatus !== 'skipped')) ? 'not-allowed' : 'pointer',
            opacity: (loading || (turnstileSiteKey && mode !== 'forgot' && !captchaToken && captchaStatus !== 'skipped')) ? 0.6 : 1,
            background: `linear-gradient(135deg, ${PRIMARY}, #a78bfa)`,
            color: '#ffffff',
            marginTop: '4px',
            transition: 'all 0.3s ease',
            boxShadow: `0 4px 16px ${PRIMARY_SHADOW}`,
          }}
          disabled={loading || (mode === 'forgot' && resetSent) || (!!turnstileSiteKey && mode !== 'forgot' && !captchaToken && captchaStatus !== 'skipped')}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = `0 8px 24px rgba(139, 143, 230, 0.4)`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = `0 4px 16px ${PRIMARY_SHADOW}`;
          }}
        >
          {loading
            ? 'Loading...'
            : mode === 'forgot'
              ? (resetSent ? 'Email sent' : 'Send reset link')
              : mode === 'signin'
                ? 'Sign In'
                : 'Create Account'}
        </button>
      </form>

      <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '14px', color: '#6b7280' }}>
        {mode === 'forgot' ? (
          <span style={link} onClick={() => { setMode('signin'); setError(null); setResetSent(false); }}>
            Back to sign in
          </span>
        ) : (
          <>
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <span style={link} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}>
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div data-landing-scroll style={{
      width: '100vw',
      height: '100vh',
      overflowY: 'auto',
      overflowX: 'hidden',
      background: 'linear-gradient(135deg, #f8f9fc 0%, #fafbfc 50%, #f5f6fa 100%)',
    }}>
      <nav className="landing-nav" style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 32px',
        zIndex: 50,
        backgroundColor: navDark ? 'rgba(15, 17, 23, 0.92)' : 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: navDark ? '1px solid rgba(139, 143, 230, 0.08)' : '1px solid rgba(229, 231, 235, 0.6)',
        transition: 'background-color 0.3s ease, border-color 0.3s ease',
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => { setMode(isHostedEdition ? 'hero' : 'signin'); setError(null); }}
        >
          <img src={logoLight} alt="NodeSpec" style={{ height: '36px', width: 'auto', filter: navDark ? 'brightness(10)' : 'none', transition: 'filter 0.3s ease' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div className="landing-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {(isHostedEdition ? [
              { label: 'Features', action: () => scrollTo(featuresRef) },
              { label: 'Browse Templates', action: () => navigate('/templates') },
              { label: 'Blog', action: () => navigate('/blog') },
              { label: 'MCP Docs', action: () => navigate('/docs/mcp') },
              { label: 'Pricing', action: () => scrollTo(pricingRef) },
              { label: 'Government', action: () => navigate('/government') },
              { label: 'Contact', action: () => scrollTo(contactRef) },
            ] : [
              // Self-hosted: no marketing pages. Enterprise keeps the gallery.
              ...(isEnterpriseEdition ? [{ label: 'Browse Templates', action: () => navigate('/templates') }] : []),
              { label: 'MCP Docs', action: () => navigate('/docs/mcp') },
            ]).map(item => (
              <span
                key={item.label}
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: navDark ? '#8a8f9e' : '#4b5563',
                  cursor: 'pointer',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                onClick={item.action}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = navDark ? '#E6E9EF' : '#111827';
                  e.currentTarget.style.backgroundColor = PRIMARY_LIGHT;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = navDark ? '#8a8f9e' : '#4b5563';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px', paddingLeft: '8px', borderLeft: navDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)' }}>
            <a
              href="https://github.com/NodeSpec/NodeSpec"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="NodeSpec on GitHub"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', borderRadius: '7px', color: navDark ? '#8a8f9e' : '#6b7280',
                textDecoration: 'none', transition: 'color 0.15s, background-color 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = navDark ? '#E6E9EF' : '#111827';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = PRIMARY_LIGHT;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = navDark ? '#8a8f9e' : '#6b7280';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
            <a
              href="https://x.com/NodeSpec"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="NodeSpec on X"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', borderRadius: '7px', color: navDark ? '#8a8f9e' : '#6b7280',
                textDecoration: 'none', transition: 'color 0.15s, background-color 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = navDark ? '#E6E9EF' : '#111827';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = PRIMARY_LIGHT;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = navDark ? '#8a8f9e' : '#6b7280';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent';
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            <a
              href="https://www.linkedin.com/company/nodespec/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="NodeSpec on LinkedIn"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', borderRadius: '7px', color: navDark ? '#8a8f9e' : '#6b7280',
                textDecoration: 'none', transition: 'color 0.15s, background-color 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = navDark ? '#E6E9EF' : '#111827';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = PRIMARY_LIGHT;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = navDark ? '#8a8f9e' : '#6b7280';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent';
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
            </a>
          </div>
          <span
            className="landing-nav-signin"
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: PRIMARY,
              cursor: 'pointer',
              padding: '8px 20px',
              borderRadius: '8px',
              border: `1px solid ${PRIMARY_BORDER}`,
              transition: 'all 0.15s ease',
              marginLeft: '8px',
              backgroundColor: 'transparent',
            }}
            onClick={() => { setMode('signin'); setError(null); heroRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = PRIMARY_LIGHT;
              e.currentTarget.style.borderColor = PRIMARY;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = PRIMARY_BORDER;
            }}
          >
            Sign In
          </span>
          <span
            className="landing-nav-signin"
            style={{
              fontSize: '14px',
              fontWeight: 700,
              color: '#ffffff',
              cursor: 'pointer',
              padding: '9px 20px',
              borderRadius: '8px',
              marginLeft: '8px',
              background: `linear-gradient(135deg, ${PRIMARY}, #a78bfa)`,
              boxShadow: `0 4px 14px ${PRIMARY_SHADOW}`,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              whiteSpace: 'nowrap',
            }}
            onClick={() => { setSelectedPlanId(null); setMode('signup'); setError(null); heroRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 8px 22px rgba(139, 143, 230, 0.45)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = `0 4px 14px ${PRIMARY_SHADOW}`;
            }}
          >
            Get Started
          </span>
        </div>
      </nav>

      <section ref={heroRef} className="landing-hero hero-mesh" style={{
        position: 'relative',
        width: '100%',
        minHeight: '100vh',
        display: 'flex',
        overflow: 'hidden',
        paddingTop: '56px',
        // Explicit light gradient so the hero's bottom edge lands exactly on
        // #f4f5fb — the tone the curved divider below picks up.
        background: 'linear-gradient(168deg, #f8f9fc 0%, #fafbfc 50%, #f4f5fb 100%)',
      }}>
        {/* faint blueprint grid, masked to a soft ellipse behind the headline */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(rgba(139,143,230,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,143,230,.07) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
          maskImage: 'radial-gradient(ellipse 80% 55% at 50% 30%, #000 22%, transparent 76%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 30%, #000 22%, transparent 76%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          top: '-12%',
          left: '50%',
          width: '880px',
          height: '580px',
          transform: 'translateX(-50%)',
          background: 'radial-gradient(ellipse at center, rgba(139,143,230,.16) 0%, transparent 68%)',
          filter: 'blur(30px)',
          pointerEvents: 'none',
        }} />
        <AnimatedBackground />
        {!showForm && (
          <div style={{ position: 'absolute', bottom: '28px', left: '50%', transform: 'translateX(-50%)', zIndex: 1 }}>
            <span style={{
              display: 'block',
              width: '1px',
              height: '26px',
              background: 'linear-gradient(180deg, transparent, rgba(139,143,230,.7))',
              animation: 'ns-cue 2.2s ease-in-out infinite',
            }} />
          </div>
        )}

        {!showForm ? (
          <div className="landing-hero-content-wrapper" style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '80px 40px',
            position: 'relative',
            zIndex: 1,
          }}>
            {renderHeroContent()}
          </div>
        ) : (
          <>
            <div className="landing-hero-content-wrapper" style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '80px 60px',
              position: 'relative',
              zIndex: 1,
            }}>
              {renderHeroContent()}
            </div>
            <div className="landing-hero-form-panel" style={{
              width: '520px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '60px',
              position: 'relative',
              zIndex: 1,
            }}>
              {mode === 'mfa' ? renderMfaVerification() : mode === 'mfa-enroll' ? renderMfaEnrollment() : signupSuccess ? renderConfirmation() : renderForm()}
            </div>
          </>
        )}
      </section>

      {isHostedEdition && (
      <>
      <div ref={featuresRef}>
        <ProductTourSection />
      </div>

      <OssCommunitySection />

      <TechEcosystemSection />

      <div ref={pricingRef}>
        <PricingSection onRequestSignUp={handleRequestSignUp} />
      </div>

      <footer ref={contactRef} style={{
        width: '100%',
        borderTop: '1px solid rgba(139, 143, 230, 0.06)',
        backgroundColor: '#0f1117',
        color: '#8a8f9e',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <BlueprintGrid variant="dark" density="sparse" showGrid={false} showConnections={false} />
        <div className="landing-footer-inner" style={{
          maxWidth: '1100px',
          margin: '0 auto',
          padding: '48px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '32px',
          position: 'relative',
          zIndex: 1,
        }}>
          <div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              marginBottom: '12px',
            }}>
              <img src={logoLight} alt="NodeSpec" style={{ height: '24px', width: 'auto', filter: 'brightness(10)' }} />
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#E6E9EF' }}>NodeSpec</span>
            </div>
            <p style={{ fontSize: '14px', lineHeight: 1.6, maxWidth: '300px' }}>
              Visual architecture for modern software teams. Design, plan, and ship -- all from one canvas.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <a
                href="https://x.com/NodeSpec"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#8a8f9e',
                  textDecoration: 'none',
                  transition: 'color 0.2s, border-color 0.2s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLAnchorElement).style.color = '#E6E9EF';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.25)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLAnchorElement).style.color = '#8a8f9e';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.1)';
                }}
                aria-label="NodeSpec on X"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
              </a>
              <a
                href="https://www.linkedin.com/company/nodespec/"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#8a8f9e',
                  textDecoration: 'none',
                  transition: 'color 0.2s, border-color 0.2s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLAnchorElement).style.color = '#E6E9EF';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.25)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLAnchorElement).style.color = '#8a8f9e';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,255,255,0.1)';
                }}
                aria-label="NodeSpec on LinkedIn"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                </svg>
              </a>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#E6E9EF', marginBottom: '12px' }}>
              Contact
            </div>
            <div style={{ fontSize: '14px', lineHeight: 2 }}>
              <div>contact@nodespec.io</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#E6E9EF', marginBottom: '12px' }}>
              Product
            </div>
            <div style={{ fontSize: '14px', lineHeight: 2 }}>
              <div style={{ cursor: 'pointer' }} onClick={() => scrollTo(featuresRef)}>Features</div>
              <div style={{ cursor: 'pointer' }} onClick={() => scrollTo(pricingRef)}>Pricing</div>
              <div style={{ cursor: 'pointer' }} onClick={() => navigate('/templates')}>Templates</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#E6E9EF', marginBottom: '12px' }}>
              Resources
            </div>
            <div style={{ fontSize: '14px', lineHeight: 2 }}>
              <div style={{ cursor: 'pointer' }} onClick={() => navigate('/blog')}>Blog</div>
              <div style={{ cursor: 'pointer' }} onClick={() => navigate('/docs/mcp')}>MCP Documentation</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#E6E9EF', marginBottom: '12px' }}>
              Legal
            </div>
            <div style={{ fontSize: '14px', lineHeight: 2 }}>
              <div style={{ cursor: 'pointer' }} onClick={() => navigate('/privacy')}>Privacy Policy</div>
              <div style={{ cursor: 'pointer' }} onClick={() => navigate('/terms')}>Terms of Service</div>
            </div>
          </div>
        </div>

        <div className="landing-footer-bottom" style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          padding: '20px 40px',
          textAlign: 'center',
          fontSize: '13px',
          color: '#5a5f78',
        }}>
          © 2025-2026 NodeSpec. All rights reserved.
        </div>
      </footer>
      </>
      )}
    </div>
  );
}
