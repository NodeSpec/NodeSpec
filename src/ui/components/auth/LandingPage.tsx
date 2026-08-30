import { useState, useEffect } from 'react';
import { AnimatedBackground } from './AnimatedBackground.js';
import logoLight from '../../assets/lightmode_nodal.png';
import { usePersistence } from '../../context/ServiceContext.js';

interface LandingPageProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
  onOAuthSignIn: (provider: 'google') => Promise<void>;
}

export function LandingPage(_props: LandingPageProps) {
  const persistence = usePersistence();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  // Launch date - set to February 1, 2026
  const launchDate = new Date('2026-01-18T00:00:00Z');

  useEffect(() => {
    const calculateTimeLeft = () => {
      const difference = launchDate.getTime() - new Date().getTime();

      if (difference > 0) {
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
          minutes: Math.floor((difference / 1000 / 60) % 60),
          seconds: Math.floor((difference / 1000) % 60)
        });
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      const result = await persistence.registerForLaunch(email);

      if (!result.success) {
        setError(result.error || 'An error occurred');
      } else {
        setSuccess(true);
        setEmail('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const containerStyles: React.CSSProperties = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    background: 'linear-gradient(135deg, #f8f9fc 0%, #fafbfc 50%, #f5f6fa 100%)',
    position: 'relative',
    overflow: 'hidden',
  };

  const leftPanelStyles: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '80px 60px',
    position: 'relative',
    zIndex: 1,
  };

  const rightPanelStyles: React.CSSProperties = {
    width: '520px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '60px',
    position: 'relative',
    zIndex: 1,
  };

  const glassCardStyles: React.CSSProperties = {
    background: 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.8)',
    borderRadius: '24px',
    padding: '48px',
    boxShadow: '0 8px 32px rgba(139, 143, 230, 0.1), 0 2px 8px rgba(0, 0, 0, 0.05)',
    width: '100%',
    maxWidth: '420px',
  };

  const logoContainerStyles: React.CSSProperties = {
    marginBottom: '56px',
    textAlign: 'center',
  };

  const logoImageStyles: React.CSSProperties = {
    height: '140px',
    width: 'auto',
    marginBottom: '32px',
    filter: 'drop-shadow(0 8px 24px rgba(139, 143, 230, 0.25)) drop-shadow(0 4px 12px rgba(99, 102, 241, 0.15))',
    transform: 'scale(1)',
    transition: 'transform 0.3s ease',
  };

  const logoTextStyles: React.CSSProperties = {
    fontSize: '48px',
    fontWeight: 700,
    color: '#1f2937',
    marginBottom: '20px',
    letterSpacing: '-0.02em',
  };

  const taglineStyles: React.CSSProperties = {
    fontSize: '28px',
    fontWeight: 600,
    color: '#1f2937',
    letterSpacing: '-0.01em',
    lineHeight: '1.5',
    maxWidth: '560px',
  };

  const subtitleStyles: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 400,
    color: '#6b7280',
    letterSpacing: '-0.005em',
    lineHeight: '1.6',
    maxWidth: '540px',
    marginTop: '24px',
  };

  const authHeaderStyles: React.CSSProperties = {
    marginBottom: '36px',
    textAlign: 'center',
    width: '100%',
  };

  const authTitleStyles: React.CSSProperties = {
    fontSize: '32px',
    fontWeight: 700,
    color: '#1f2937',
    marginBottom: '8px',
  };

  const authSubtitleStyles: React.CSSProperties = {
    fontSize: '16px',
    color: '#6b7280',
  };

  const formStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    width: '100%',
  };

  const inputGroupStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  };

  const labelStyles: React.CSSProperties = {
    fontSize: '15px',
    fontWeight: 600,
    color: '#1f2937',
  };

  const inputStyles: React.CSSProperties = {
    padding: '14px 18px',
    fontSize: '15px',
    border: '2px solid rgba(139, 143, 230, 0.2)',
    borderRadius: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    color: '#1f2937',
    outline: 'none',
    transition: 'all 0.2s',
  };

  const buttonStyles: React.CSSProperties = {
    padding: '16px',
    fontSize: '16px',
    fontWeight: 600,
    border: 'none',
    borderRadius: '12px',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.7 : 1,
    background: 'linear-gradient(135deg, #8B8FE6, #a78bfa)',
    color: '#ffffff',
    marginTop: '8px',
    transition: 'all 0.3s ease',
    boxShadow: '0 4px 16px rgba(139, 143, 230, 0.3)',
  };

  const errorStyles: React.CSSProperties = {
    padding: '14px 18px',
    backgroundColor: '#fee2e2',
    color: '#ef4444',
    borderRadius: '12px',
    fontSize: '14px',
    border: '1px solid #fecaca',
  };

  const successStyles: React.CSSProperties = {
    padding: '14px 18px',
    backgroundColor: '#d1fae5',
    color: '#059669',
    borderRadius: '12px',
    fontSize: '14px',
    border: '1px solid #6ee7b7',
  };

  const countdownContainerStyles: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px',
    marginTop: '28px',
    marginBottom: '28px',
    width: '100%',
  };

  const countdownBoxStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '16px 8px',
    background: 'rgba(255, 255, 255, 0.9)',
    border: '2px solid rgba(139, 143, 230, 0.3)',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(139, 143, 230, 0.1)',
  };

  const countdownNumberStyles: React.CSSProperties = {
    fontSize: '32px',
    fontWeight: 700,
    color: '#8B8FE6',
    lineHeight: 1,
    marginBottom: '6px',
  };

  const countdownLabelStyles: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  return (
    <div style={containerStyles}>
      <AnimatedBackground />

      <div style={leftPanelStyles}>
        <div style={logoContainerStyles}>
          <img
            src={logoLight}
            alt="NodeSpec"
            style={logoImageStyles}
          />
          <div style={logoTextStyles}>NodeSpec</div>
          <div style={taglineStyles}>
            <span style={{ color: '#8B8FE6' }}>Design</span> Smarter. <span style={{ color: '#8B8FE6' }}>Build</span> Better. <span style={{ color: '#8B8FE6' }}>Ship</span> Faster.
          </div>
          <div style={subtitleStyles}>
            Your architectural context sidekick for AI code assistants. Give Cursor, Claude, and any agent a complete system blueprint -- so they understand what connects where before writing code.
          </div>
        </div>
      </div>

      <div style={rightPanelStyles}>
        <div style={glassCardStyles}>
          <div style={authHeaderStyles}>
            <div style={authTitleStyles}>
              Launching Soon
            </div>
            <div style={authSubtitleStyles}>
              We Want Your Feedback
            </div>
          </div>

          <div style={countdownContainerStyles}>
            <div style={countdownBoxStyles}>
              <div style={countdownNumberStyles}>{timeLeft.days}</div>
              <div style={countdownLabelStyles}>Days</div>
            </div>
            <div style={countdownBoxStyles}>
              <div style={countdownNumberStyles}>{timeLeft.hours}</div>
              <div style={countdownLabelStyles}>Hours</div>
            </div>
            <div style={countdownBoxStyles}>
              <div style={countdownNumberStyles}>{timeLeft.minutes}</div>
              <div style={countdownLabelStyles}>Minutes</div>
            </div>
            <div style={countdownBoxStyles}>
              <div style={countdownNumberStyles}>{timeLeft.seconds}</div>
              <div style={countdownLabelStyles}>Seconds</div>
            </div>
          </div>

          {error && <div style={errorStyles}>{error}</div>}
          {success && <div style={successStyles}>Thanks for registering! We'll notify you when we launch.</div>}

          <form onSubmit={handleSubmit} style={formStyles}>
            <div style={inputGroupStyles}>
              <label style={labelStyles}>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyles}
                placeholder="you@example.com"
                required
                disabled={loading}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#8B8FE6';
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 1)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.2)';
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
                }}
              />
            </div>

            <button
              type="submit"
              style={buttonStyles}
              disabled={loading}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(139, 143, 230, 0.4)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(139, 143, 230, 0.3)';
              }}
            >
              {loading ? 'Registering...' : 'Notify Me at Launch'}
            </button>
          </form>

          <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '13px', color: '#9ca3af' }}>
            Join the community of builders on our initial launch
          </div>
        </div>
      </div>
    </div>
  );
}
