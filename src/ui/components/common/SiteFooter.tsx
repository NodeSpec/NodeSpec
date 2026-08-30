import { useNavigate } from 'react-router-dom';
import logoLight from '../../assets/lightmode_nodal.png';

const FOOTER_BG = '#0f1117';
const FOOTER_TEXT = '#8a8f9e';
const FOOTER_HEADING = '#E6E9EF';
const FOOTER_BORDER = 'rgba(255, 255, 255, 0.06)';
const LINK_HOVER = 'rgba(255, 255, 255, 0.25)';

export function SiteFooter() {
  const navigate = useNavigate();

  const linkStyle: React.CSSProperties = {
    cursor: 'pointer',
    transition: 'color 0.15s ease',
  };

  return (
    <footer style={{
      width: '100%',
      borderTop: `1px solid ${FOOTER_BORDER}`,
      backgroundColor: FOOTER_BG,
      color: FOOTER_TEXT,
    }}>
      <div className="site-footer-inner" style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '48px 40px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '32px',
      }}>
        <div>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', cursor: 'pointer' }}
            onClick={() => navigate('/')}
          >
            <img src={logoLight} alt="NodeSpec" style={{ height: '24px', width: 'auto', filter: 'brightness(10)' }} />
            <span style={{ fontSize: '16px', fontWeight: 700, color: FOOTER_HEADING }}>NodeSpec</span>
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
                color: FOOTER_TEXT,
                textDecoration: 'none',
                transition: 'color 0.2s, border-color 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = FOOTER_HEADING;
                (e.currentTarget as HTMLAnchorElement).style.borderColor = LINK_HOVER;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = FOOTER_TEXT;
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
                color: FOOTER_TEXT,
                textDecoration: 'none',
                transition: 'color 0.2s, border-color 0.2s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = FOOTER_HEADING;
                (e.currentTarget as HTMLAnchorElement).style.borderColor = LINK_HOVER;
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = FOOTER_TEXT;
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
          <div style={{ fontSize: '14px', fontWeight: 600, color: FOOTER_HEADING, marginBottom: '12px' }}>
            Contact
          </div>
          <div style={{ fontSize: '14px', lineHeight: 2 }}>
            <a href="mailto:contact@nodespec.io" style={{ color: FOOTER_TEXT, textDecoration: 'none', ...linkStyle }}>
              contact@nodespec.io
            </a>
          </div>
        </div>

        <nav aria-label="Product links">
          <div style={{ fontSize: '14px', fontWeight: 600, color: FOOTER_HEADING, marginBottom: '12px' }}>
            Product
          </div>
          <div style={{ fontSize: '14px', lineHeight: 2 }}>
            <div style={linkStyle} onClick={() => navigate('/templates')}>Templates</div>
            <div style={linkStyle} onClick={() => navigate('/pricing')}>Pricing</div>
            <div style={linkStyle} onClick={() => navigate('/blog')}>Blog</div>
          </div>
        </nav>

        <nav aria-label="Legal links">
          <div style={{ fontSize: '14px', fontWeight: 600, color: FOOTER_HEADING, marginBottom: '12px' }}>
            Legal
          </div>
          <div style={{ fontSize: '14px', lineHeight: 2 }}>
            <div style={linkStyle} onClick={() => navigate('/privacy')}>Privacy Policy</div>
            <div style={linkStyle} onClick={() => navigate('/terms')}>Terms of Service</div>
          </div>
        </nav>
      </div>

      <div className="site-footer-bottom" style={{
        borderTop: `1px solid ${FOOTER_BORDER}`,
        padding: '20px 40px',
        textAlign: 'center',
        fontSize: '13px',
        color: '#5a5f78',
      }}>
        &copy; 2025-2026 NodeSpec. All rights reserved.
      </div>
    </footer>
  );
}
