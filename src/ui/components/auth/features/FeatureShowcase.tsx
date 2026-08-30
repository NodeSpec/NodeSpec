import { useState, useEffect, useRef, useCallback } from 'react';
import { ArchitectureDemo } from './ArchitectureDemo.js';
import { AIContextDemo } from './AIContextDemo.js';
import { SpecSyncDemo } from './SpecSyncDemo.js';
import { BuildLoopDemo } from './BuildLoopDemo.js';

const BRAND = '#8B8FE6';
const BRAND_GLOW = 'rgba(139, 143, 230, 0.15)';
const DARK_SURFACE = '#1a1d26';
const TEXT_DIM = '#8a8f9e';
const TEXT_BODY = '#c9cdd8';

interface Tab {
  id: string;
  label: string;
  tagline: string;
  description: string;
}

const TABS: Tab[] = [
  {
    id: 'build-loop',
    label: 'The Build Loop',
    tagline: 'Design once. Build verified.',
    description: 'Start from a repo or a blank canvas. Your AI — Claude, Cursor, any agent — builds from your governed design and nothing ships unverified. The architecture and the code live together in your repo.',
  },
  {
    id: 'spec-sync',
    label: 'Spec Decomposition',
    tagline: 'Requirements that stay wired.',
    description: 'Every requirement maps to features, every feature maps to nodes. When architecture changes, traceability updates automatically.',
  },
  {
    id: 'architecture',
    label: 'Visual Canvas',
    tagline: 'See your system take shape.',
    description: 'Drag, nest, and connect components on a canvas that understands containers, contracts, and dependencies -- not just boxes and arrows.',
  },
  {
    id: 'ai-context',
    label: 'AI Context',
    tagline: 'Give AI the full picture.',
    description: 'Your architecture graph becomes structured context that AI agents can reason over -- roles, technologies, contracts, and constraints included.',
  },
];

export function FeatureShowcase() {
  const [activeTab, setActiveTab] = useState('build-loop');
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const activeTabData = TABS.find(t => t.id === activeTab)!;

  const handleTabChange = useCallback((id: string) => {
    setActiveTab(id);
  }, []);

  return (
    <div
      ref={containerRef}
      className="feature-showcase"
      style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '0 40px 96px',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(40px)',
        transition: 'opacity 0.8s ease, transform 0.8s ease',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <div style={{
          display: 'inline-block',
          padding: '6px 16px',
          borderRadius: '20px',
          background: BRAND_GLOW,
          border: `1px solid rgba(139, 143, 230, 0.2)`,
          fontSize: '12px',
          fontWeight: 600,
          color: BRAND,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          marginBottom: '20px',
        }}>
          How it works
        </div>
        <h2 className="feature-showcase-heading" style={{
          fontSize: '38px',
          fontWeight: 800,
          color: '#E6E9EF',
          letterSpacing: '-0.035em',
          lineHeight: 1.15,
          marginBottom: '16px',
        }}>
          Intuitive visual architecture, with a{' '}
          <span style={{ color: BRAND }}>backend interface</span>{' '}
          to humans and agents
        </h2>
        <p className="feature-showcase-subtitle" style={{
          fontSize: '17px',
          color: TEXT_DIM,
          maxWidth: '520px',
          margin: '0 auto',
          lineHeight: 1.7,
        }}>
          Not static diagrams. A living canvas where your system stays in sync from spec to deployment.
        </p>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '6px',
        marginBottom: '32px',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className="feature-showcase-tab"
            onClick={() => handleTabChange(tab.id)}
            style={{
              padding: '10px 24px',
              fontSize: '13px',
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? '#fff' : TEXT_DIM,
              background: activeTab === tab.id
                ? `linear-gradient(135deg, ${BRAND}, rgba(167, 139, 250, 0.9))`
                : 'transparent',
              border: activeTab === tab.id
                ? 'none'
                : `1px solid rgba(139, 143, 230, 0.15)`,
              borderRadius: '10px',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
              boxShadow: activeTab === tab.id
                ? `0 4px 20px rgba(139, 143, 230, 0.3)`
                : 'none',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{
        borderRadius: '20px',
        border: '1px solid rgba(139, 143, 230, 0.12)',
        background: `linear-gradient(160deg, ${DARK_SURFACE} 0%, rgba(15, 17, 23, 0.95) 100%)`,
        overflow: 'hidden',
        boxShadow: `0 20px 60px rgba(0, 0, 0, 0.3), 0 0 80px ${BRAND_GLOW}`,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderBottom: '1px solid rgba(139, 143, 230, 0.08)',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f57' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#febc2e' }} />
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28c840' }} />
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: '11px', color: TEXT_DIM, fontWeight: 500 }}>
              NodeSpec - {activeTabData.label}
            </span>
          </div>
          <div style={{ width: '44px' }} />
        </div>

        <div style={{ height: '400px', position: 'relative' }}>
          <DemoPanel visible={activeTab === 'build-loop'}>
            <BuildLoopDemo active={activeTab === 'build-loop'} />
          </DemoPanel>
          <DemoPanel visible={activeTab === 'architecture'}>
            <ArchitectureDemo active={activeTab === 'architecture'} />
          </DemoPanel>
          <DemoPanel visible={activeTab === 'ai-context'}>
            <AIContextDemo active={activeTab === 'ai-context'} />
          </DemoPanel>
          <DemoPanel visible={activeTab === 'spec-sync'}>
            <SpecSyncDemo active={activeTab === 'spec-sync'} />
          </DemoPanel>
        </div>

        <div className="feature-showcase-info" style={{
          padding: '28px 32px',
          borderTop: '1px solid rgba(139, 143, 230, 0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '24px',
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: '280px' }}>
            <div className="feature-showcase-tagline" style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#E6E9EF',
              marginBottom: '8px',
              letterSpacing: '-0.02em',
            }}>
              {activeTabData.tagline}
            </div>
            <p style={{
              fontSize: '14px',
              color: TEXT_BODY,
              lineHeight: 1.7,
              maxWidth: '480px',
            }}>
              {activeTabData.description}
            </p>
          </div>
          <div style={{
            display: 'flex',
            gap: '16px',
          }}>
            {TABS.map((tab) => (
              <div
                key={tab.id}
                style={{
                  width: '32px',
                  height: '3px',
                  borderRadius: '2px',
                  background: activeTab === tab.id ? BRAND : 'rgba(139, 143, 230, 0.15)',
                  transition: 'background 0.3s ease',
                  cursor: 'pointer',
                }}
                onClick={() => handleTabChange(tab.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoPanel({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      opacity: visible ? 1 : 0,
      transform: visible ? 'scale(1)' : 'scale(0.98)',
      transition: 'opacity 0.4s ease, transform 0.4s ease',
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      {children}
    </div>
  );
}
