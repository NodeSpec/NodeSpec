import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';

const BRAND = '#8B8FE6';
const DARK_SURFACE = '#1a1d26';
const DARK_TERTIARY = '#232734';

/*
  Team tier waitlist (owner direction 2026-08-12): Team is a log-only lane
  until it launches — "Join the Waitlist" captures name, email and company,
  nothing more. Rows land in enterprise_contact_requests tagged
  deployment_preference='team-waitlist' (the table already allows anon +
  authenticated inserts, so this needs no migration), which is the lead
  shape SALES-1 later formalizes.
*/

interface TeamWaitlistModalProps {
  onClose: () => void;
}

export function TeamWaitlistModal({ onClose }: TeamWaitlistModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          deployment_preference: 'team-waitlist',
          user_id: userId,
        });
      if (insertError) {
        setError('Failed to join the waitlist. Please try again or email contact@nodespec.io.');
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

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: '420px', backgroundColor: DARK_SURFACE,
          border: '1px solid rgba(139, 143, 230, 0.15)', borderRadius: '14px',
          padding: '28px', boxSizing: 'border-box',
        }}
        onClick={e => e.stopPropagation()}
      >
        {submitted ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '50%', margin: '0 auto 16px',
              backgroundColor: 'rgba(74, 222, 128, 0.1)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: '22px', color: '#4ade80',
            }}>
              ✓
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#E6E9EF', margin: '0 0 8px' }}>
              You're on the list
            </h3>
            <p style={{ fontSize: '14px', color: '#8a8f9e', lineHeight: 1.6, margin: '0 0 20px' }}>
              We'll email you the moment Team opens up.
            </p>
            <button
              onClick={onClose}
              style={{
                padding: '10px 24px', fontSize: '14px', fontWeight: 600, border: 'none',
                borderRadius: '8px', cursor: 'pointer', backgroundColor: BRAND, color: '#fff',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#E6E9EF', margin: '0 0 6px' }}>
              Join the Team waitlist
            </h3>
            <p style={{ fontSize: '13.5px', color: '#8a8f9e', lineHeight: 1.6, margin: '0 0 20px' }}>
              Team is coming soon — the web app for up to 5 users. Leave your details and
              you'll be first to know.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Name</label>
                <input
                  style={inputStyle}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  style={inputStyle}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label style={labelStyle}>Company</label>
                <input
                  style={inputStyle}
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="Company name"
                />
              </div>
              {error && (
                <div style={{ fontSize: '13px', color: '#f87171', lineHeight: 1.5 }}>{error}</div>
              )}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  style={{
                    flex: 1, padding: '11px 20px', fontSize: '14px', fontWeight: 600,
                    border: 'none', borderRadius: '8px',
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                    backgroundColor: BRAND, color: '#fff', opacity: canSubmit ? 1 : 0.5,
                  }}
                >
                  {submitting ? 'Joining…' : 'Join the Waitlist'}
                </button>
                <button
                  onClick={onClose}
                  style={{
                    padding: '11px 18px', fontSize: '14px', fontWeight: 500,
                    border: '1px solid rgba(139, 143, 230, 0.2)', borderRadius: '8px',
                    cursor: 'pointer', backgroundColor: 'transparent', color: '#c9cdd8',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
