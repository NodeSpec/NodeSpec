import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { AnimatedBackground } from './AnimatedBackground.js';
import { EnterpriseContactModal } from '../pricing/EnterpriseContactModal.js';
import { TeamWaitlistModal } from '../pricing/TeamWaitlistModal.js';
import { isHostedEdition, isEnterpriseEdition, editionLabel } from '../../config/edition.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { usePageSeo } from '../../hooks/usePageSeo.js';
import { HOME_SEO, homeJsonLd } from '../../../seo/site-meta.js';
// The landing draws the mark at 150px at most, so it loads a 450 by 300 copy
// (10KB) rather than the 1536 by 1024 original (195KB) that was its largest paint.
import logoLight from '../../assets/lightmode_nodal_450.webp';
import { HERO, NAV_LINKS, PRODUCT_VIEWS, type LandingAction, type LandingLink, type ProductView } from './landing/landing-content.js';
import { ProductFrameDesktop, ProductFramePhone } from './landing/ProductFrame.js';
import {
  Cta, ControlSection, FaqSection, FinalCtaSection, HowItWorksSection, LandingFooter, LandingPricingSection,
  OpenSourceSection, SlantEdge, SoftEdge, StartPointsSection, UseCasesSection, WaveUp,
} from './landing/LandingSections.js';
import './landing/landing.css';

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
  // ?signup and ?signin open those forms (AL.26): the Claude sign-in page sends
  // someone new to sign up and a just-made account to sign in, and the template
  // pages link to /?signup=templates.
  const defaultMode = pendingPlan || searchParams.has('signup')
    ? 'signup'
    : searchParams.has('signin') || !isHostedEdition ? 'signin' : 'hero';
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
  const [view, setView] = useState<ProductView>('flows');
  const [menuOpen, setMenuOpen] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaQrCode, setMfaQrCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const captchaRef = useRef<TurnstileInstance>(null);
  const heroRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The form lives at the top of the page, under the sticky nav.
  const toTop = () => scrollRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
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

  // One source with the prerendered homepage (src/seo/site-meta.ts), so a crawler
  // that runs no script and one that does read the same page (AJ.2). Only the
  // managed site presents itself to search engines.
  usePageSeo({
    ...HOME_SEO,
    path: '/',
    jsonLd: isHostedEdition ? homeJsonLd().map((data, i) => ({ id: `home-schema-${i}`, data })) : [],
  });

  // Every "Get Started" and "Sign In" on the page opens the form at the top of it.
  const openForm = useCallback((next: 'signup' | 'signin') => {
    if (next === 'signup') setSelectedPlanId(null);
    setMode(next);
    setError(null);
    setMenuOpen(false);
    toTop();
  }, []);

  const onAction = useCallback((action: LandingAction) => {
    setMenuOpen(false);
    if (action === 'signup' || action === 'signin') openForm(action);
    else if (action === 'talk') setTalkOpen(true);
    else setWaitlistOpen(true);
  }, [openForm]);

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

  // Plain clicks stay in the app; a modified or middle click opens the page as a link does.
  const followLink = (e: React.MouseEvent, path: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
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

  // The hero's words: the managed site's headline and description, or a self-hosted
  // build's wordmark and edition (it has no marketing). `compact` sits beside the form.
  const renderHeroCopy = (compact: boolean) => (
    <>
      <img src={logoLight} alt="" className="lp-hero-logo" width={225} height={150} />
      {!isHostedEdition ? (
        <>
          <div className="lp-hero-title">NodeSpec</div>
          <div className="lp-edition">{editionLabel}</div>
        </>
      ) : (
        <>
          <h1 className="lp-hero-title">{HERO.title}</h1>
          <p className="lp-hero-slogan">
            {HERO.slogan.map(([word, rest]) => <span key={word}><span>{word}</span>{rest}</span>)}
          </p>
          <p className="lp-hero-desc">{HERO.description}</p>
          {!compact && (
            <>
              <div className="lp-cta-row">
                <Cta link={HERO.primary} className="lp-btn lp-btn-primary" onAction={onAction} followLink={followLink} />
                <Cta link={HERO.secondary} className="lp-btn lp-btn-secondary" onAction={onAction} followLink={followLink} />
              </div>
              <p className="lp-hero-note">{HERO.note}</p>
              <span aria-hidden="true" className="lp-cue" />
            </>
          )}
        </>
      )}
    </>
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

  // A self-hosted build has no marketing: its nav keeps the docs (and the template
  // gallery on Enterprise), and nothing below the form renders.
  const navLinks: LandingLink[] = isHostedEdition
    ? NAV_LINKS
    : [...(isEnterpriseEdition ? [{ label: 'Browse Templates', href: '/templates' }] : []), { label: 'MCP Docs', href: '/docs/mcp' }];

  const form = mode === 'mfa' ? renderMfaVerification() : mode === 'mfa-enroll' ? renderMfaEnrollment() : signupSuccess ? renderConfirmation() : renderForm();

  return (
    <div ref={scrollRef} data-landing-scroll className="lp-root" style={{ width: '100vw', height: '100vh', overflowY: 'auto', overflowX: 'hidden' }}>
      <header className="lp-nav">
        <nav aria-label="Main" className="lp-nav-inner">
          <a
            href="/"
            className="lp-nav-home"
            aria-label="NodeSpec home"
            onClick={(e) => { e.preventDefault(); setMode(isHostedEdition ? 'hero' : 'signin'); setError(null); setMenuOpen(false); toTop(); }}
          >
            <img src={logoLight} alt="NodeSpec" width={54} height={36} />
          </a>
          <div className="lp-nav-links">
            {navLinks.map((link) => <Cta key={link.label} link={link} onAction={onAction} followLink={followLink} />)}
          </div>
          <div className="lp-nav-actions">
            <button type="button" className="lp-nav-signin" onClick={() => openForm('signin')}>Sign In</button>
            <button type="button" className="lp-nav-start" onClick={() => openForm('signup')}>Get Started</button>
            <button
              type="button"
              className="lp-nav-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="lp-nav-panel"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 1h16M1 7h16M1 13h16" stroke="#1f2937" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </nav>
        <div id="lp-nav-panel" className="lp-nav-panel" data-open={menuOpen}>
          {navLinks.map((link) => (
            <Cta key={link.label} link={link} onAction={onAction} followLink={(e, path) => { setMenuOpen(false); followLink(e, path); }} />
          ))}
          <button type="button" className="lp-nav-signin" onClick={() => openForm('signin')}>Sign In</button>
        </div>
      </header>

      <main>
        <section ref={heroRef} className="lp-hero" aria-label="NodeSpec">
          <div className="lp-hero-bg" aria-hidden="true">
            <div className="lp-hero-grid" />
            <div className="lp-hero-glow" />
            <AnimatedBackground />
          </div>
          {showForm ? (
            <div className="lp-hero-form">
              <div className="lp-hero-form-copy">{renderHeroCopy(true)}</div>
              <div className="lp-hero-form-panel">{form}</div>
            </div>
          ) : (
            <>
              <div className="lp-hero-inner">{renderHeroCopy(false)}</div>
              <div className="lp-frame-wrap">
                <div className="lp-chips" role="group" aria-label="Product view">
                  {PRODUCT_VIEWS.map((pv) => (
                    <button
                      key={pv.id}
                      type="button"
                      aria-pressed={view === pv.id}
                      className={pv.id === 'arch' ? 'lp-chip-wide' : undefined}
                      onClick={() => setView(pv.id)}
                    >
                      {pv.label}
                    </button>
                  ))}
                </div>
                <ProductFrameDesktop view={view} onView={setView} />
                <ProductFramePhone view={view} onView={setView} />
              </div>
            </>
          )}
        </section>

        {isHostedEdition && (
          <>
            <HowItWorksSection afterFrame={!showForm} />
            <SoftEdge />
            <UseCasesSection onAction={onAction} followLink={followLink} />
            <SlantEdge />
            <ControlSection />
            <WaveUp />
            <StartPointsSection onAction={onAction} followLink={followLink} />
            <LandingPricingSection onAction={onAction} followLink={followLink} />
            <FaqSection onAction={onAction} followLink={followLink} />
            <OpenSourceSection />
            <FinalCtaSection onAction={onAction} followLink={followLink} />
          </>
        )}
      </main>

      {isHostedEdition && <LandingFooter onAction={onAction} followLink={followLink} />}
      {talkOpen && <EnterpriseContactModal onClose={() => setTalkOpen(false)} />}
      {waitlistOpen && <TeamWaitlistModal onClose={() => setWaitlistOpen(false)} />}
    </div>
  );
}
