import { BlueprintGrid } from './BlueprintGrid.js';

const BRAND = '#8B8FE6';
const DARK_BG = '#0f1117';
const DARK_SURFACE = '#1a1d26';
const TEXT_DIM = '#8a8f9e';
const TEXT_BODY = '#c9cdd8';

const PERSONAS = [
  {
    title: 'Solo Builders & Vibe Coders',
    tagline: 'From idea to architecture in minutes',
    description: 'Describe what you want to build. NodeSpec decomposes your spec into features, generates a connected architecture canvas, and exports structured task files your AI coding assistant can execute.',
    capabilities: [
      'Write a spec, get architecture and task output instantly',
      'Export context documents for Cursor, Claude, or Copilot',
      'Ship faster by giving AI agents a complete system map',
    ],
    icon: 'rocket',
    accentColor: '#6CB4EE',
    accentBg: 'rgba(108, 180, 238, 0.1)',
    accentBorder: 'rgba(108, 180, 238, 0.2)',
  },
  {
    title: 'Engineering Teams',
    tagline: 'Trace every requirement to running code',
    description: 'Import your repo and NodeSpec classifies every directory into architectural roles. Map requirements to nodes, track coverage across features, and export context so every engineer and agent builds from the same source of truth.',
    capabilities: [
      'Repo import with automatic directory classification',
      'Requirement-to-node traceability across features',
      'Structured context export for code agents at scale',
    ],
    icon: 'code',
    accentColor: '#4ECDC4',
    accentBg: 'rgba(78, 205, 196, 0.1)',
    accentBorder: 'rgba(78, 205, 196, 0.2)',
  },
  {
    title: 'Architects & Technical Leaders',
    tagline: 'Model systems with contracts, ports, and dependencies',
    description: 'Visually compose systems across 12+ architectural roles with typed contracts, interaction kinds, and container hierarchies. Define the structure once -- your team and your agents inherit it automatically.',
    capabilities: [
      'Visual canvas with typed contracts and port definitions',
      'Container hierarchies across cloud providers and platforms',
      'Spec-driven governance that keeps architecture aligned',
    ],
    icon: 'blueprint',
    accentColor: '#E8A87C',
    accentBg: 'rgba(232, 168, 124, 0.1)',
    accentBorder: 'rgba(232, 168, 124, 0.2)',
  },
] as const;

export function WhoThisIsForSection() {
  return (
    <section className="dark-section-grid" style={{
      width: '100%',
      background: DARK_BG,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        width: '100%',
        height: '140px',
        background: `linear-gradient(180deg, #f8f9fc 0%, ${DARK_BG} 100%)`,
        position: 'relative',
        zIndex: 1,
      }} />

      <BlueprintGrid variant="dark" density="dense" showGrid={false} />

      <AmbientGlow
        color="rgba(108, 180, 238, 0.07)"
        size={600}
        top="-10%"
        left="-15%"
      />
      <AmbientGlow
        color="rgba(139, 143, 230, 0.06)"
        size={500}
        top="30%"
        right="-10%"
      />
      <AmbientGlow
        color="rgba(78, 205, 196, 0.05)"
        size={400}
        bottom="10%"
        left="20%"
      />

      <div className="who-this-is-for-content" style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '0 40px 80px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <div style={{
            display: 'inline-block',
            padding: '6px 16px',
            borderRadius: '20px',
            backgroundColor: 'rgba(139, 143, 230, 0.1)',
            border: '1px solid rgba(139, 143, 230, 0.2)',
            fontSize: '12px',
            fontWeight: 600,
            color: BRAND,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            marginBottom: '20px',
          }}>
            Who this is for
          </div>
          <h2 className="who-heading" style={{
            fontSize: '40px',
            fontWeight: 800,
            color: '#E6E9EF',
            letterSpacing: '-0.035em',
            lineHeight: 1.15,
            marginBottom: '16px',
          }}>
            Built for humans.{' '}
            <span style={{ color: BRAND }}>Ready for agents.</span>
          </h2>
          <p className="who-subtitle" style={{
            fontSize: '17px',
            color: TEXT_DIM,
            maxWidth: '560px',
            margin: '0 auto',
            lineHeight: 1.7,
          }}>
            Whether you are shipping your first product or governing enterprise systems, NodeSpec gives you and your AI agents the same structured foundation.
          </p>
        </div>

        <div className="who-cards-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '24px',
        }}>
          {PERSONAS.map((persona) => (
            <PersonaCard key={persona.title} {...persona} />
          ))}
        </div>
      </div>
    </section>
  );
}

function AmbientGlow({ color, size, top, left, right, bottom }: {
  color: string;
  size: number;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
}) {
  return (
    <div style={{
      position: 'absolute',
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      top,
      left,
      right,
      bottom,
      pointerEvents: 'none',
      filter: 'blur(40px)',
    }} />
  );
}

function PersonaCard({
  title,
  tagline,
  description,
  capabilities,
  icon,
  accentColor,
  accentBg,
  accentBorder,
}: typeof PERSONAS[number]) {
  return (
    <div
      className="who-card"
      style={{
        padding: '36px 32px',
        borderRadius: '16px',
        border: `1px solid rgba(139, 143, 230, 0.08)`,
        background: `linear-gradient(170deg, ${DARK_SURFACE} 0%, rgba(26, 29, 38, 0.4) 100%)`,
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease',
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = accentBorder;
        e.currentTarget.style.boxShadow = `0 12px 48px rgba(0, 0, 0, 0.3)`;
        e.currentTarget.style.transform = 'translateY(-4px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.08)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{
        width: '44px',
        height: '44px',
        borderRadius: '12px',
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '24px',
      }}>
        <PersonaIcon type={icon} color={accentColor} />
      </div>

      <div style={{
        fontSize: '11px',
        fontWeight: 700,
        color: accentColor,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        marginBottom: '8px',
      }}>
        {tagline}
      </div>

      <h3 className="who-card-title" style={{
        fontSize: '22px',
        fontWeight: 700,
        color: '#E6E9EF',
        letterSpacing: '-0.02em',
        lineHeight: 1.3,
        marginBottom: '14px',
      }}>
        {title}
      </h3>

      <p style={{
        fontSize: '14px',
        color: TEXT_BODY,
        lineHeight: 1.75,
        marginBottom: '24px',
        flex: 1,
      }}>
        {description}
      </p>

      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        borderTop: `1px solid rgba(255, 255, 255, 0.06)`,
        paddingTop: '20px',
      }}>
        {capabilities.map((cap) => (
          <li key={cap} style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
            fontSize: '13px',
            color: TEXT_DIM,
            lineHeight: 1.5,
          }}>
            <span style={{
              marginTop: '3px',
              flexShrink: 0,
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              backgroundColor: accentBg,
              border: `1px solid ${accentBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2 2 4-4" stroke={accentColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            {cap}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonaIcon({ type, color }: { type: string; color: string }) {
  switch (type) {
    case 'rocket':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      );
    case 'code':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
          <line x1="14" y1="4" x2="10" y2="20" />
        </svg>
      );
    case 'blueprint':
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M9 21V9" />
        </svg>
      );
    default:
      return null;
  }
}
