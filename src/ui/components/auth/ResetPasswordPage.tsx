import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { AnimatedBackground } from './AnimatedBackground.js';
import logoLight from '../../assets/lightmode_nodal.png';

const VERIFY_TIMEOUT_MS = 10_000;

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const navigate = useNavigate();
  const readyRef = useRef(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const markReady = () => {
      if (!readyRef.current) {
        readyRef.current = true;
        setSessionReady(true);
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        markReady();
      }
    });

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      window.history.replaceState({}, '', window.location.pathname);
      supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
        if (exchangeError) {
          setExpired(true);
        }
      });
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          markReady();
        }
      });
    }

    timeoutId = setTimeout(() => {
      if (!readyRef.current) {
        setExpired(true);
      }
    }, VERIFY_TIMEOUT_MS);

    return () => {
      subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      setTimeout(() => navigate('/app', { replace: true }), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  const containerStyles: React.CSSProperties = {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #f8f9fc 0%, #fafbfc 50%, #f5f6fa 100%)',
    position: 'relative',
    overflow: 'hidden',
    padding: '16px',
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
    position: 'relative',
    zIndex: 1,
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
    width: '100%',
    boxSizing: 'border-box',
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
    width: '100%',
  };

  if (expired) {
    return (
      <div className="reset-container" style={containerStyles}>
        <AnimatedBackground />
        <div className="reset-card" style={glassCardStyles}>
          <div style={{ textAlign: 'center' }}>
            <img src={logoLight} alt="NodeSpec" style={{ height: '60px', marginBottom: '24px' }} />
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#1f2937', marginBottom: '12px' }}>
              Link expired or invalid
            </div>
            <div style={{ fontSize: '15px', color: '#6b7280', marginBottom: '28px', lineHeight: 1.5 }}>
              This password reset link has expired or has already been used. Please request a new one.
            </div>
            <button
              onClick={() => navigate('/', { replace: true })}
              style={{
                padding: '14px 28px',
                fontSize: '15px',
                fontWeight: 600,
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                background: 'linear-gradient(135deg, #8B8FE6, #a78bfa)',
                color: '#ffffff',
                boxShadow: '0 4px 16px rgba(139, 143, 230, 0.3)',
                transition: 'all 0.3s ease',
              }}
            >
              Request a new reset link
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="reset-container" style={containerStyles}>
        <AnimatedBackground />
        <div className="reset-card" style={glassCardStyles}>
          <div style={{ textAlign: 'center' }}>
            <img src={logoLight} alt="NodeSpec" style={{ height: '60px', marginBottom: '24px' }} />
            <div style={{ fontSize: '18px', color: '#6b7280' }}>Verifying reset link...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="reset-container" style={containerStyles}>
      <AnimatedBackground />
      <div className="reset-card" style={glassCardStyles}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <img src={logoLight} alt="NodeSpec" style={{ height: '60px', marginBottom: '24px' }} />
          <div className="reset-title" style={{ fontSize: '32px', fontWeight: 700, color: '#1f2937', marginBottom: '8px' }}>
            {success ? 'Password updated' : 'Set new password'}
          </div>
          <div style={{ fontSize: '16px', color: '#6b7280' }}>
            {success ? 'Redirecting you to the app...' : 'Enter your new password below'}
          </div>
        </div>

        {error && (
          <div style={{
            padding: '14px 18px',
            backgroundColor: '#fee2e2',
            color: '#ef4444',
            borderRadius: '12px',
            fontSize: '14px',
            border: '1px solid #fecaca',
            marginBottom: '16px',
          }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{
            padding: '14px 18px',
            backgroundColor: '#dcfce7',
            color: '#16a34a',
            borderRadius: '12px',
            fontSize: '14px',
            border: '1px solid #bbf7d0',
          }}>
            Your password has been updated successfully.
          </div>
        )}

        {!success && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '15px', fontWeight: 600, color: '#1f2937' }}>New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyles}
                placeholder="••••••••"
                required
                minLength={6}
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '15px', fontWeight: 600, color: '#1f2937' }}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={inputStyles}
                placeholder="••••••••"
                required
                minLength={6}
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
              {loading ? 'Updating...' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
