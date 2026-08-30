import { useNavigate } from 'react-router-dom';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';
import logoLight from '../../assets/lightmode_nodal.png';

export function TermsOfService() {
  const navigate = useNavigate();

  usePageSeo({
    title: 'Terms of Service - NodeSpec',
    description: 'Read the NodeSpec terms of service. Understand your rights and responsibilities when using our software architecture platform.',
    path: '/terms',
    breadcrumbs: [
      { name: 'Home', url: BASE_URL },
      { name: 'Terms of Service', url: `${BASE_URL}/terms` },
    ],
  });

  const containerStyles: React.CSSProperties = {
    minHeight: '100vh',
    backgroundColor: '#f8f9fc',
  };

  const headerStyles: React.CSSProperties = {
    backgroundColor: '#ffffff',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    padding: '20px 40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const logoContainerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
  };

  const contentStyles: React.CSSProperties = {
    maxWidth: '800px',
    margin: '0 auto',
    padding: '60px 40px',
  };

  const titleStyles: React.CSSProperties = {
    fontSize: '36px',
    fontWeight: 700,
    color: '#111827',
    marginBottom: '12px',
    letterSpacing: '-0.02em',
  };

  const subtitleStyles: React.CSSProperties = {
    fontSize: '16px',
    color: '#6b7280',
    marginBottom: '48px',
  };

  const sectionStyles: React.CSSProperties = {
    marginBottom: '36px',
  };

  const headingStyles: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 700,
    color: '#1f2937',
    marginBottom: '16px',
    letterSpacing: '-0.01em',
  };

  const paragraphStyles: React.CSSProperties = {
    fontSize: '16px',
    color: '#4b5563',
    lineHeight: '1.7',
    marginBottom: '16px',
  };

  const listStyles: React.CSSProperties = {
    fontSize: '16px',
    color: '#4b5563',
    lineHeight: '1.7',
    marginLeft: '24px',
    marginBottom: '16px',
  };

  const backButtonStyles: React.CSSProperties = {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 600,
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    color: '#374151',
    cursor: 'pointer',
    transition: 'all 0.2s',
  };

  return (
    <div style={containerStyles}>
      <header style={headerStyles}>
        <div style={logoContainerStyles} onClick={() => navigate('/')}>
          <img src={logoLight} alt="NodeSpec" style={{ height: '36px' }} />
          <span style={{ fontSize: '20px', fontWeight: 700, color: '#1f2937' }}>NodeSpec</span>
        </div>
        <button
          style={backButtonStyles}
          onClick={() => navigate('/')}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f9fafb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#ffffff';
          }}
        >
          Back to Home
        </button>
      </header>

      <main style={contentStyles}>
        <h1 style={titleStyles}>Terms of Service</h1>
        <p style={subtitleStyles}>Last updated: March 14, 2026</p>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>1. Acceptance of Terms</h2>
          <p style={paragraphStyles}>
            By accessing and using NodeSpec, you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to these Terms of Service, please do not use our service.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>2. Description of Service</h2>
          <p style={paragraphStyles}>
            NodeSpec provides a software architecture platform that enables users to design, visualize, and manage system architectures with AI-assisted code generation capabilities. The service is provided on a subscription basis with various tiers.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>3. User Accounts</h2>
          <p style={paragraphStyles}>You are responsible for:</p>
          <ul style={listStyles}>
            <li>Maintaining the confidentiality of your account credentials</li>
            <li>All activities that occur under your account</li>
            <li>Notifying us immediately of any unauthorized use</li>
            <li>Ensuring your account information is accurate and up-to-date</li>
          </ul>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>4. Acceptable Use</h2>
          <p style={paragraphStyles}>You agree not to:</p>
          <ul style={listStyles}>
            <li>Use the service for any illegal purpose</li>
            <li>Attempt to gain unauthorized access to our systems</li>
            <li>Interfere with or disrupt the service</li>
            <li>Upload malicious code or viruses</li>
            <li>Violate any applicable laws or regulations</li>
            <li>Infringe on intellectual property rights</li>
          </ul>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>5. Intellectual Property</h2>
          <p style={paragraphStyles}>
            You retain all rights to the content and projects you create using NodeSpec. We retain all rights to the NodeSpec platform, including its design, functionality, and underlying technology.
          </p>
          <p style={paragraphStyles}>
            Code generated through our AI features is provided as-is for your use, but you are responsible for reviewing and testing all generated code before deployment.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>6. Payment Terms</h2>
          <ul style={listStyles}>
            <li>Subscription fees are billed in advance on a monthly or annual basis</li>
            <li>All payments are processed securely through Stripe</li>
            <li>Refunds are provided according to our refund policy</li>
            <li>We reserve the right to change pricing with 30 days notice</li>
          </ul>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>7. Service Availability</h2>
          <p style={paragraphStyles}>
            While we strive to provide uninterrupted service, we do not guarantee that the service will be available at all times. We may suspend or discontinue any part of the service with or without notice.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>8. Limitation of Liability</h2>
          <p style={paragraphStyles}>
            NodeSpec is provided "as is" without warranties of any kind. We are not liable for any damages arising from the use or inability to use our service, including but not limited to direct, indirect, incidental, or consequential damages.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>9. Termination</h2>
          <p style={paragraphStyles}>
            We reserve the right to terminate or suspend your account at any time for violation of these terms. You may cancel your subscription at any time through your account settings.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>10. Changes to Terms</h2>
          <p style={paragraphStyles}>
            We may modify these terms at any time. We will notify users of any material changes via email or through the platform. Continued use of the service after changes constitutes acceptance of the modified terms.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>11. Governing Law</h2>
          <p style={paragraphStyles}>
            These terms are governed by and construed in accordance with applicable laws. Any disputes shall be resolved through binding arbitration.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>12. Contact Information</h2>
          <p style={paragraphStyles}>
            For questions about these Terms of Service, please contact us at legal@nodespec.com
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
