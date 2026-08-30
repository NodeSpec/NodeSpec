import { useNavigate } from 'react-router-dom';
import { usePageSeo } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';
import { BlueprintGrid } from '../auth/BlueprintGrid.js';
import { GovFiresTourSection } from './GovFiresTour.js';
import logoLight from '../../assets/lightmode_nodal.png';

const BRAND = '#8B8FE6';
const BRAND_LIGHT = '#a8abf0';
const DARK_BG = '#0f1117';
const DARK_SURFACE = '#1a1d26';
const DARK_TEXT = '#E6E9EF';
const DARK_SECONDARY = '#8a8f9e';

const IL_LEVELS = [
  {
    level: 'IL-2',
    label: 'Initial Deployment',
    description: 'Non-CUI workloads on commercial cloud. Fastest path to operational capability.',
    status: 'Available Now',
  },
  {
    level: 'IL-4/5',
    label: 'CUI & Mission Systems',
    description: 'Controlled Unclassified Information and National Security Systems in isolated enclaves.',
    status: 'Roadmap',
  },
  {
    level: 'IL-6+ / FedRAMP Equivalent',
    label: 'Classified Environments',
    description: 'Secret-level classified enclave deployments with full air-gap and FedRAMP High equivalent controls.',
    status: 'Roadmap',
  },
];

const COMMERCIAL_CAPABILITIES = [
  {
    title: 'Full Architecture Canvas',
    description: 'All commercially available node types -- services, databases, APIs, queues, containers, serverless functions, load balancers, and more.',
  },
  {
    title: 'AI-Powered Generation',
    description: 'Specification-driven architecture generation, code scaffolding, and artifact production using connected AI models.',
  },
  {
    title: 'Repository Import & Analysis',
    description: 'Import existing codebases and automatically detect architecture patterns, dependencies, and system boundaries.',
  },
  {
    title: 'Multi-Cloud Templates',
    description: 'Pre-built architecture templates for AWS, GCP, Azure, and hybrid deployments with full Terraform and Helm outputs.',
  },
  {
    title: 'Specification Management',
    description: 'Requirements traceability, acceptance criteria, test case generation, and full specification lifecycle tracking.',
  },
  {
    title: 'Artifact Generation',
    description: 'Generate deployment manifests, infrastructure-as-code, API contracts, and documentation from your architecture.',
  },
];

const GOV_UNIQUE_INTERFACES = [
  {
    title: 'Fires & MIL-STD Integration',
    description: 'Dedicated interface contracts for fire control systems, MIL-STD-1553 bus, Link 16 data links, and sensor fusion pipelines.',
  },
  {
    title: 'DFAS APIs for Business Systems',
    description: 'Pre-configured node contexts for Defense Finance and Accounting Service integrations, pay systems, and financial data flows.',
  },
  {
    title: 'Managed CDS Context (Diode)',
    description: 'Cross-domain solution modeling with data diode constraints, one-way transfer rules, and classification boundary enforcement.',
  },
  {
    title: 'On-Premises CDS Configs (Forcepoint)',
    description: 'Integration templates for Forcepoint Trusted Gateway and high-assurance guard configurations between security domains.',
  },
  {
    title: 'MIL-STD Data Rates & Constraints',
    description: 'Node type contexts encoding bandwidth limitations, latency budgets, and protocol constraints for tactical data distribution.',
  },
  {
    title: 'Cyber-Unique Restricted Node Types',
    description: 'Specialized node contexts for SIGINT, EW, and cyber operations with classification handling, need-to-know boundaries, and compartmentalization.',
  },
];

const DEPLOYMENT_PLATFORMS = [
  { name: 'AWS GovCloud', description: 'Isolated cloud regions with US-based personnel and cleared infrastructure.' },
  { name: 'Azure Government', description: 'Dedicated government cloud with physically separated datacenters and screened personnel.' },
  { name: 'Google Public Sector', description: 'Assured Workloads environments with US sovereignty controls and compliance monitoring.' },
];

export function GovernmentPage() {
  const navigate = useNavigate();

  usePageSeo({
    title: 'NodeSpec for Government - AI-Native Architecture for Defense & Federal',
    description: 'Self-deployed AI architecture platform for government enclaves. Supercharge engineering teams to build scalable systems with approved AI tools or on-premises open-weight models.',
    path: '/government',
  });

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      width: '100%',
      minHeight: '100vh',
      overflowY: 'auto',
      background: `linear-gradient(180deg, ${DARK_BG} 0%, ${DARK_SURFACE} 100%)`,
      color: DARK_TEXT,
      position: 'relative',
    }}>
      <BlueprintGrid variant="dark" density="dense" showNodes showConnections showGrid />
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px',
        borderBottom: '1px solid rgba(139, 143, 230, 0.08)',
        backgroundColor: 'rgba(15, 17, 23, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          <img src={logoLight} alt="NodeSpec" style={{ height: '32px', width: 'auto', filter: 'brightness(10)' }} />
          <span style={{ fontSize: '18px', fontWeight: 700, color: DARK_TEXT, letterSpacing: '-0.02em' }}>
            NodeSpec
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div className="landing-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { label: 'Features', action: () => navigate('/#features') },
              { label: 'Browse Templates', action: () => navigate('/templates') },
              { label: 'Blog', action: () => navigate('/blog') },
              { label: 'MCP Docs', action: () => navigate('/docs/mcp') },
              { label: 'Pricing', action: () => navigate('/pricing') },
              { label: 'Contact', action: () => navigate('/#contact') },
            ].map(item => (
              <span
                key={item.label}
                style={{
                  fontSize: '14px', fontWeight: 500, color: DARK_SECONDARY,
                  cursor: 'pointer', padding: '8px 16px', borderRadius: '8px',
                  transition: 'all 0.15s ease', whiteSpace: 'nowrap',
                }}
                onClick={item.action}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = DARK_TEXT;
                  e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = DARK_SECONDARY;
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px', paddingLeft: '8px', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
            <a
              href="https://x.com/NodeSpec"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="NodeSpec on X"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', borderRadius: '7px', color: '#8a8f9e',
                textDecoration: 'none', transition: 'color 0.15s, background-color 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = '#E6E9EF';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = '#8a8f9e';
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
                width: '32px', height: '32px', borderRadius: '7px', color: '#8a8f9e',
                textDecoration: 'none', transition: 'color 0.15s, background-color 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = '#E6E9EF';
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLAnchorElement).style.color = '#8a8f9e';
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
              fontSize: '14px', fontWeight: 600, color: BRAND,
              cursor: 'pointer', padding: '8px 20px', borderRadius: '8px',
              border: '1px solid rgba(139, 143, 230, 0.2)',
              transition: 'all 0.15s ease', marginLeft: '8px', backgroundColor: 'transparent',
            }}
            onClick={() => navigate('/')}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
              e.currentTarget.style.borderColor = BRAND;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.2)';
            }}
          >
            Sign In
          </span>
        </div>
      </nav>

      <HeroSection />
      <BarrierSection />
      <CapabilitiesSection />
      <GovFiresTourSection />
      <DeploymentSection />
      <ImpactLevelsSection />
      <CTASection />
      <SiteFooter />
    </div>
  );
}

function HeroSection() {
  return (
    <section style={{
      padding: '100px 24px 80px',
      textAlign: 'center',
      maxWidth: '900px',
      margin: '0 auto',
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '6px 16px', borderRadius: '20px',
        border: `1px solid rgba(139, 143, 230, 0.3)`,
        backgroundColor: 'rgba(139, 143, 230, 0.06)',
        marginBottom: '32px',
      }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: BRAND }} />
        <span style={{ fontSize: '13px', fontWeight: 600, color: BRAND_LIGHT, letterSpacing: '0.03em' }}>
          SELF-DEPLOYED | AIR-GAPPED CAPABLE
        </span>
      </div>

      <h1 style={{
        fontSize: '52px', fontWeight: 800, lineHeight: 1.1, marginBottom: '24px',
        letterSpacing: '-0.03em', color: DARK_TEXT,
      }}>
        AI-Native Architecture for{' '}
        <span style={{ color: BRAND_LIGHT }}>
          Defense & Federal
        </span>
      </h1>

      <p style={{
        fontSize: '18px', lineHeight: 1.7, color: DARK_SECONDARY,
        maxWidth: '740px', margin: '0 auto 16px',
      }}>
        Do more with less. Supercharge your engineering team to build scalable systems
        in a more rapid way with their favorite AI tools.
      </p>
      <p style={{
        fontSize: '16px', lineHeight: 1.7, color: DARK_SECONDARY,
        maxWidth: '700px', margin: '0 auto 40px',
      }}>
        Connect to your primary models of choice via approved systems or your own on-premises open-weight models.
      </p>

      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <a
          href="mailto:contact@nodespec.io"
          style={{
            padding: '14px 32px', borderRadius: '10px', fontSize: '15px', fontWeight: 600,
            background: `linear-gradient(135deg, ${BRAND}, #a78bfa)`,
            color: '#fff', border: 'none', cursor: 'pointer', textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(139, 143, 230, 0.3)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(139, 143, 230, 0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(139, 143, 230, 0.3)'; }}
        >
          Request a Briefing
        </a>
        <a
          href="#capabilities"
          style={{
            padding: '14px 32px', borderRadius: '10px', fontSize: '15px', fontWeight: 600,
            background: 'transparent', color: DARK_TEXT,
            border: '1px solid rgba(139, 143, 230, 0.25)', cursor: 'pointer', textDecoration: 'none',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.5)'; e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.06)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.25)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          View Capabilities
        </a>
      </div>
    </section>
  );
}

function ImpactLevelsSection() {
  return (
    <section style={{
      padding: '60px 24px',
      maxWidth: '1000px',
      margin: '0 auto',
    }}>
      <h2 style={{
        textAlign: 'center', fontSize: '14px', fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: BRAND_LIGHT, marginBottom: '12px',
      }}>
        Roadmap to Impact Levels
      </h2>
      <p style={{
        textAlign: 'center', fontSize: '15px', color: DARK_SECONDARY,
        maxWidth: '500px', margin: '0 auto 40px', lineHeight: 1.6,
      }}>
        Progressive deployment path from commercial cloud to classified enclaves.
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '20px',
      }}>
        {IL_LEVELS.map((il, idx) => (
          <div key={il.level} style={{
            padding: '28px', borderRadius: '14px',
            border: `1px solid rgba(139, 143, 230, ${idx === 0 ? '0.3' : '0.12'})`,
            backgroundColor: `rgba(139, 143, 230, ${idx === 0 ? '0.06' : '0.02'})`,
            transition: 'all 0.2s ease',
            position: 'relative',
          }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.4)';
              e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = `rgba(139, 143, 230, ${idx === 0 ? '0.3' : '0.12'})`;
              e.currentTarget.style.backgroundColor = `rgba(139, 143, 230, ${idx === 0 ? '0.06' : '0.02'})`;
            }}
          >
            <div style={{
              position: 'absolute', top: '12px', right: '12px',
              fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase',
              padding: '3px 8px', borderRadius: '4px',
              backgroundColor: idx === 0 ? 'rgba(139, 143, 230, 0.15)' : 'rgba(138, 143, 158, 0.1)',
              color: idx === 0 ? BRAND_LIGHT : DARK_SECONDARY,
            }}>
              {il.status}
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: BRAND_LIGHT, marginBottom: '4px' }}>
              {il.level}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: DARK_TEXT, marginBottom: '8px' }}>
              {il.label}
            </div>
            <div style={{ fontSize: '13px', color: DARK_SECONDARY, lineHeight: 1.5 }}>
              {il.description}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CapabilitiesSection() {
  return (
    <section id="capabilities" style={{
      padding: '80px 24px',
      maxWidth: '1100px',
      margin: '0 auto',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '56px' }}>
        <h2 style={{
          fontSize: '36px', fontWeight: 700, lineHeight: 1.2,
          letterSpacing: '-0.02em', marginBottom: '16px',
        }}>
          Purpose-Built Modifications & Additions for Government Systems
        </h2>
        <p style={{ fontSize: '16px', color: DARK_SECONDARY, maxWidth: '650px', margin: '0 auto', lineHeight: 1.6 }}>
          All commercially available NodeSpec capabilities plus government-unique interfaces and constraints.
        </p>
      </div>

      <div style={{ marginBottom: '48px' }}>
        <h3 style={{
          fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: BRAND_LIGHT, marginBottom: '20px',
        }}>
          All Commercial Node Types & Capabilities
        </h3>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '16px',
        }}>
          {COMMERCIAL_CAPABILITIES.map(cap => (
            <div key={cap.title} style={{
              padding: '22px', borderRadius: '12px',
              border: '1px solid rgba(139, 143, 230, 0.1)',
              backgroundColor: 'rgba(26, 29, 38, 0.5)',
              transition: 'all 0.2s ease',
            }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.25)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.1)';
              }}
            >
              <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px', color: DARK_TEXT, margin: '0 0 6px' }}>
                {cap.title}
              </h4>
              <p style={{ fontSize: '13px', color: DARK_SECONDARY, lineHeight: 1.5, margin: 0 }}>
                {cap.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 style={{
          fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: BRAND_LIGHT, marginBottom: '20px',
        }}>
          Government-Only Unique Interfaces
        </h3>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '20px',
        }}>
          {GOV_UNIQUE_INTERFACES.map(cap => (
            <div key={cap.title} style={{
              padding: '24px', borderRadius: '14px',
              border: '1px solid rgba(139, 143, 230, 0.15)',
              backgroundColor: 'rgba(26, 29, 38, 0.7)',
              transition: 'all 0.2s ease',
            }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.35)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.15)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px', color: DARK_TEXT, margin: '0 0 8px' }}>
                {cap.title}
              </h4>
              <p style={{ fontSize: '13px', color: DARK_SECONDARY, lineHeight: 1.6, margin: 0 }}>
                {cap.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BarrierSection() {
  return (
    <section style={{
      padding: '60px 24px',
      maxWidth: '900px',
      margin: '0 auto',
    }}>
      <div style={{
        padding: '48px', borderRadius: '20px',
        border: '1px solid rgba(139, 143, 230, 0.12)',
        backgroundColor: 'rgba(26, 29, 38, 0.6)',
        textAlign: 'center',
      }}>
        <h2 style={{
          fontSize: '28px', fontWeight: 700, lineHeight: 1.3,
          marginBottom: '20px', letterSpacing: '-0.01em',
        }}>
          Lower the Barrier to Complex Integration
        </h2>
        <p style={{
          fontSize: '15px', color: DARK_SECONDARY, lineHeight: 1.7,
          maxWidth: '650px', margin: '0 auto',
        }}>
          NodeSpec lowers the barrier to entry for teams to engineer their solutions to complex interfaces
          in the Department of Defense. Visualize, model, and generate architecture for systems that span
          classification boundaries, tactical networks, and enterprise integration points -- without requiring
          every engineer to be an expert in every MIL-STD and data format involved.
        </p>
      </div>
    </section>
  );
}

function DeploymentSection() {
  return (
    <section style={{
      padding: '80px 24px',
      maxWidth: '900px',
      margin: '0 auto',
    }}>
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <h2 style={{
          fontSize: '32px', fontWeight: 700, lineHeight: 1.2,
          letterSpacing: '-0.02em', marginBottom: '16px',
        }}>
          Deploy in Your Enclave
        </h2>
        <p style={{ fontSize: '16px', color: DARK_SECONDARY, maxWidth: '550px', margin: '0 auto', lineHeight: 1.6 }}>
          Self-deployed container image designed for air-gapped environments. No data leaves your boundary.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {DEPLOYMENT_PLATFORMS.map(platform => (
          <div key={platform.name} style={{
            display: 'flex', alignItems: 'center', gap: '24px',
            padding: '24px 28px', borderRadius: '12px',
            border: '1px solid rgba(139, 143, 230, 0.12)',
            backgroundColor: 'rgba(139, 143, 230, 0.03)',
            transition: 'all 0.2s ease',
          }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.3)';
              e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.12)';
              e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.03)';
            }}
          >
            <div style={{ fontSize: '15px', fontWeight: 700, color: BRAND_LIGHT, minWidth: '180px' }}>
              {platform.name}
            </div>
            <div style={{ fontSize: '13px', color: DARK_SECONDARY, lineHeight: 1.5 }}>
              {platform.description}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section style={{
      padding: '80px 24px 100px',
      textAlign: 'center',
    }}>
      <h2 style={{
        fontSize: '32px', fontWeight: 700, marginBottom: '16px',
        letterSpacing: '-0.02em',
      }}>
        Ready to accelerate your mission?
      </h2>
      <p style={{
        fontSize: '16px', color: DARK_SECONDARY, marginBottom: '36px',
        maxWidth: '500px', margin: '0 auto 36px', lineHeight: 1.6,
      }}>
        Get a tailored deployment plan for your enclave and infrastructure requirements.
      </p>
      <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
        <a
          href="mailto:contact@nodespec.io"
          style={{
            padding: '14px 32px', borderRadius: '10px', fontSize: '15px', fontWeight: 600,
            background: `linear-gradient(135deg, ${BRAND}, #a78bfa)`,
            color: '#fff', border: 'none', cursor: 'pointer', textDecoration: 'none',
            boxShadow: '0 4px 20px rgba(139, 143, 230, 0.3)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          Contact Government Sales
        </a>
      </div>
    </section>
  );
}
