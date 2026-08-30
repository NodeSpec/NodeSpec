import { BlueprintGrid } from './BlueprintGrid.js';

const BRAND = '#8B8FE6';
const BRAND_GLOW = 'rgba(139, 143, 230, 0.15)';
const DARK_BG = '#0f1117';
const DARK_SURFACE = '#1a1d26';
const TEXT_DIM = '#8a8f9e';
const TEXT_BODY = '#c9cdd8';

export function MarketingSection() {
  return (
    <section style={{
      width: '100%',
      background: DARK_BG,
      borderTop: '1px solid rgba(139, 143, 230, 0.06)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <BlueprintGrid variant="dark" density="normal" />
      <div style={{
        position: 'absolute',
        width: '500px',
        height: '500px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139, 143, 230, 0.06) 0%, transparent 70%)',
        top: '-10%',
        right: '-10%',
        pointerEvents: 'none',
        filter: 'blur(50px)',
      }} />
      <div style={{
        position: 'absolute',
        width: '400px',
        height: '400px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(78, 205, 196, 0.04) 0%, transparent 70%)',
        bottom: '10%',
        left: '-5%',
        pointerEvents: 'none',
        filter: 'blur(40px)',
      }} />
      <div className="marketing-content" style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '24px 40px 56px',
        position: 'relative',
        zIndex: 1,
      }}>
        <h2 className="marketing-heading" style={{
          fontSize: '42px',
          fontWeight: 800,
          color: '#E6E9EF',
          letterSpacing: '-0.035em',
          lineHeight: 1.15,
          marginBottom: '20px',
          maxWidth: '600px',
        }}>
          From spec to system.{' '}
          <span style={{ color: TEXT_DIM }}>Nothing lost in between.</span>
        </h2>
        <p className="marketing-subtitle" style={{
          fontSize: '17px',
          color: TEXT_DIM,
          maxWidth: '480px',
          lineHeight: 1.7,
          marginBottom: '56px',
        }}>
          Import a repo or write a spec. NodeSpec maps it into connected architecture, generates tasks, and exports structured context for any AI assistant.
        </p>

        <div className="marketing-feature-grid" style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
        }}>
          <FeatureCard
            icon={<SyncIcon />}
            headline="Bring code or start from a spec. Get architecture either way."
            body="Import an existing repo and NodeSpec classifies every directory into architectural roles. Or write requirements from scratch -- they decompose into traceable features mapped to canvas nodes, with contracts and dependencies wired automatically."
          />
          <FeatureCard
            icon={<ContextIcon />}
            headline="Every node carries context your AI agents can read."
            body="Each component on your canvas holds structured metadata -- technologies, contracts, best practices, and container hierarchy. Export it as a context document that Cursor, Claude, or any code agent consumes directly. No more re-explaining your system every session."
          />
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ icon, headline, body }: {
  icon: React.ReactNode;
  headline: string;
  body: string;
}) {
  return (
    <div
      className="marketing-feature-card"
      style={{
        padding: '40px',
        borderRadius: '16px',
        border: `1px solid rgba(139, 143, 230, 0.1)`,
        background: `linear-gradient(160deg, ${DARK_SURFACE} 0%, rgba(26, 29, 38, 0.5) 100%)`,
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.25)';
        e.currentTarget.style.boxShadow = `0 8px 40px ${BRAND_GLOW}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.1)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={{
        width: '40px',
        height: '40px',
        borderRadius: '10px',
        background: `linear-gradient(135deg, rgba(139, 143, 230, 0.15), rgba(139, 143, 230, 0.05))`,
        border: '1px solid rgba(139, 143, 230, 0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '24px',
      }}>
        {icon}
      </div>
      <h3 className="marketing-feature-headline" style={{
        fontSize: '22px',
        fontWeight: 700,
        color: '#E6E9EF',
        lineHeight: 1.3,
        marginBottom: '14px',
        letterSpacing: '-0.02em',
      }}>
        {headline}
      </h3>
      <p style={{
        fontSize: '15px',
        color: TEXT_BODY,
        lineHeight: 1.75,
      }}>
        {body}
      </p>
    </div>
  );
}

function SyncIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}

function ContextIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
