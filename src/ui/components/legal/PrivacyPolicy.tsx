import { useNavigate } from 'react-router-dom';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';
import logoLight from '../../assets/lightmode_nodal.png';

export function PrivacyPolicy() {
  const navigate = useNavigate();

  usePageSeo({
    title: 'Privacy Policy - NodeSpec',
    description: 'Learn how NodeSpec collects, uses, and protects your personal information. Read our privacy policy for details on data handling practices.',
    path: '/privacy',
    breadcrumbs: [
      { name: 'Home', url: BASE_URL },
      { name: 'Privacy Policy', url: `${BASE_URL}/privacy` },
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
        <h1 style={titleStyles}>Privacy Policy</h1>
        <p style={subtitleStyles}>Last updated: March 14, 2026</p>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>1. Introduction</h2>
          <p style={paragraphStyles}>
            NodeSpec ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our software architecture platform.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>2. Information We Collect</h2>
          <p style={paragraphStyles}>We collect information that you provide directly to us, including:</p>
          <ul style={listStyles}>
            <li>Account information (email address, password)</li>
            <li>Project data and architecture diagrams you create</li>
            <li>Usage data and analytics</li>
            <li>Communication preferences</li>
            <li>Payment information (processed securely through Stripe)</li>
          </ul>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>3. How We Use Your Information</h2>
          <p style={paragraphStyles}>We use the information we collect to:</p>
          <ul style={listStyles}>
            <li>Provide, maintain, and improve our services</li>
            <li>Process your transactions and send related information</li>
            <li>Send you technical notices and support messages</li>
            <li>Respond to your comments and questions</li>
            <li>Analyze usage patterns to improve user experience</li>
            <li>Detect, prevent, and address technical issues</li>
          </ul>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>4. Data Storage and Security</h2>
          <p style={paragraphStyles}>
            Your data is stored securely using Supabase infrastructure with industry-standard encryption. We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>5. Third-Party Services</h2>
          <p style={paragraphStyles}>We use the following third-party services:</p>
          <ul style={listStyles}>
            <li>Supabase for data storage and authentication</li>
            <li>Stripe for payment processing</li>
            <li>AI providers (OpenAI, Anthropic) for code generation features</li>
          </ul>
          <p style={paragraphStyles}>
            These services have their own privacy policies and we encourage you to review them.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>6. Your Rights</h2>
          <p style={paragraphStyles}>You have the right to:</p>
          <ul style={listStyles}>
            <li>Access your personal information</li>
            <li>Correct inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Export your data</li>
            <li>Opt-out of marketing communications</li>
          </ul>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>7. Children's Privacy</h2>
          <p style={paragraphStyles}>
            NodeSpec is not intended for users under the age of 13. We do not knowingly collect personal information from children under 13.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>8. Changes to This Policy</h2>
          <p style={paragraphStyles}>
            We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
          </p>
        </section>

        <section style={sectionStyles}>
          <h2 style={headingStyles}>9. Contact Us</h2>
          <p style={paragraphStyles}>
            If you have questions about this Privacy Policy, please contact us at privacy@nodespec.com
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
