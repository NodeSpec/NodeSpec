import { useState, useEffect } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';

const BRAND = '#8B8FE6';
const DARK_SURFACE = '#1a1d26';
const DARK_TERTIARY = '#24273a';

interface EnterpriseContactModalProps {
  onClose: () => void;
}

type DeploymentPreference = 'managed' | 'local';

export function EnterpriseContactModal({ onClose }: EnterpriseContactModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [deployment, setDeployment] = useState<DeploymentPreference>('managed');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
        if (session.user.email) setEmail(session.user.email);
      }
    });
  }, []);

  const canSubmit = name.trim() && email.trim() && company.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    try {
      const supabase = getSupabaseClient();
      const { error: insertError } = await supabase
        .from('enterprise_contact_requests')
        .insert({
          name: name.trim(),
          email: email.trim(),
          company: company.trim(),
          role: role.trim(),
          deployment_preference: deployment,
          message: message.trim(),
          user_id: userId,
        });

      if (insertError) {
        setError('Failed to submit your request. Please try again or email us directly.');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again or email contact@nodespec.io.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    fontSize: '14px',
    color: '#E6E9EF',
    backgroundColor: DARK_TERTIARY,
    border: '1px solid rgba(139, 143, 230, 0.12)',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.15s ease',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#c9cdd8',
    marginBottom: '6px',
  };

  if (submitted) {
    return (
      <div
        style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        }}
        onClick={onClose}
      >
        <div
          style={{
            width: '460px', maxWidth: '90vw',
            backgroundColor: DARK_SURFACE, borderRadius: '14px',
            border: '1px solid rgba(139, 143, 230, 0.12)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
            padding: '40px 32px', textAlign: 'center',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            width: '56px', height: '56px', borderRadius: '50%',
            backgroundColor: 'rgba(74, 222, 128, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <h3 style={{
            fontSize: '20px', fontWeight: 700, color: '#E6E9EF',
            margin: '0 0 10px',
          }}>
            Request Received
          </h3>
          <p style={{
            fontSize: '14px', color: '#8a8f9e', lineHeight: 1.6,
            margin: '0 0 28px',
          }}>
            We'll be in touch within 1-2 business days to discuss your enterprise requirements.
          </p>
          <button
            onClick={onClose}
            style={{
              padding: '10px 28px', fontSize: '14px', fontWeight: 600,
              border: 'none', borderRadius: '8px', cursor: 'pointer',
              backgroundColor: BRAND, color: '#ffffff',
              transition: 'opacity 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '500px', maxWidth: '90vw', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          backgroundColor: DARK_SURFACE, borderRadius: '14px',
          border: '1px solid rgba(139, 143, 230, 0.12)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          padding: '24px 28px 20px',
          borderBottom: '1px solid rgba(139, 143, 230, 0.08)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div>
            <h3 style={{
              fontSize: '18px', fontWeight: 700, color: '#E6E9EF',
              margin: '0 0 4px',
            }}>
              Enterprise Inquiry
            </h3>
            <p style={{
              fontSize: '13px', color: '#8a8f9e', margin: 0,
            }}>
              Tell us about your organization and deployment needs.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', fontSize: '20px',
              color: '#5a5f78', cursor: 'pointer', padding: '2px 6px',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        <div style={{
          padding: '24px 28px', overflowY: 'auto', flex: 1,
          display: 'flex', flexDirection: 'column', gap: '18px',
        }}>
          <div style={{ display: 'flex', gap: '14px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Smith"
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = BRAND; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.12)'; }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Role</label>
              <input
                type="text"
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder="CTO, VP Engineering..."
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = BRAND; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.12)'; }}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Work Email *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@company.com"
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = BRAND; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.12)'; }}
            />
          </div>

          <div>
            <label style={labelStyle}>Company *</label>
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="Acme Corp"
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = BRAND; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.12)'; }}
            />
          </div>

          <div>
            <label style={labelStyle}>Deployment Preference *</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              {([
                { value: 'managed' as const, label: 'Managed / Hosted', desc: 'We host and manage everything' },
                { value: 'local' as const, label: 'Local / On-Prem', desc: 'Deploy in your own environment' },
              ]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDeployment(opt.value)}
                  style={{
                    flex: 1, padding: '12px 14px',
                    backgroundColor: deployment === opt.value ? 'rgba(139, 143, 230, 0.1)' : DARK_TERTIARY,
                    border: deployment === opt.value
                      ? `1.5px solid ${BRAND}`
                      : '1.5px solid rgba(139, 143, 230, 0.08)',
                    borderRadius: '8px', cursor: 'pointer',
                    textAlign: 'left', transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{
                    fontSize: '13px', fontWeight: 600,
                    color: deployment === opt.value ? '#E6E9EF' : '#c9cdd8',
                    marginBottom: '2px',
                  }}>
                    {opt.label}
                  </div>
                  <div style={{
                    fontSize: '11px',
                    color: deployment === opt.value ? '#8a8f9e' : '#5a5f78',
                  }}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Additional Details</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Tell us about your team size, use case, compliance requirements, or anything else..."
              rows={3}
              style={{
                ...inputStyle,
                resize: 'vertical',
                minHeight: '72px',
                fontFamily: 'inherit',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = BRAND; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.12)'; }}
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              fontSize: '13px', color: '#f87171',
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          padding: '16px 28px',
          borderTop: '1px solid rgba(139, 143, 230, 0.08)',
          display: 'flex', justifyContent: 'flex-end', gap: '10px',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: 500,
              border: '1px solid rgba(139, 143, 230, 0.12)', borderRadius: '8px',
              cursor: 'pointer', backgroundColor: DARK_TERTIARY, color: '#c9cdd8',
              transition: 'all 0.15s ease',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: '10px 24px', fontSize: '14px', fontWeight: 600,
              border: 'none', borderRadius: '8px',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.5,
              backgroundColor: BRAND, color: '#ffffff',
              transition: 'all 0.15s ease',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = canSubmit ? '1' : '0.5'; }}
          >
            {submitting ? (
              <>
                <span style={{
                  width: '14px', height: '14px',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'ent-spin 0.6s linear infinite', display: 'inline-block',
                }} />
                Submitting...
              </>
            ) : 'Submit Request'}
          </button>
        </div>

        <style>{`@keyframes ent-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
