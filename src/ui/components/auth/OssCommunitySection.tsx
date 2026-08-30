import { BlueprintGrid } from './BlueprintGrid.js';

const PRIMARY = '#8B8FE6';
const PRIMARY_LIGHT = 'rgba(139, 143, 230, 0.1)';
const PRIMARY_BORDER = 'rgba(139, 143, 230, 0.2)';
const DARK_BG = '#0f1117';

const REPO_URL = 'https://github.com/NodeSpec/NodeSpec';
const REPO_LABEL = REPO_URL.replace(/^https?:\/\//, '');

/**
 * Landing section for the open-source community edition (owner design,
 * 2026-08-26): sits between the product tour and the technology catalog on
 * the hosted marketing page. One CTA — the public repository.
 */
export function OssCommunitySection() {
  return (
    <section className="oss-community" style={{
      width: '100%',
      backgroundColor: DARK_BG,
      borderTop: '1px solid rgba(139, 143, 230, 0.06)',
      borderBottom: '1px solid rgba(139, 143, 230, 0.06)',
      padding: '80px 0',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <BlueprintGrid variant="dark" density="sparse" showNodes={false} />
      <div style={{
        position: 'absolute',
        width: '500px',
        height: '500px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139, 143, 230, 0.06) 0%, transparent 70%)',
        top: '-15%',
        left: '-8%',
        pointerEvents: 'none',
        filter: 'blur(50px)',
      }} />

      <div className="oss-content" style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '0 40px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{ textAlign: 'center', marginBottom: '44px' }}>
          <div style={{
            display: 'inline-block',
            padding: '6px 16px',
            borderRadius: '20px',
            backgroundColor: PRIMARY_LIGHT,
            border: `1px solid ${PRIMARY_BORDER}`,
            fontSize: '12px',
            fontWeight: 600,
            color: PRIMARY,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: '20px',
          }}>
            Open source
          </div>
          <h2 className="oss-heading" style={{
            margin: '0 0 14px',
            fontSize: '32px',
            fontWeight: 700,
            color: '#E6E9EF',
            letterSpacing: '-0.02em',
            lineHeight: '1.2',
          }}>
            NodeSpec Community OSS
          </h2>
          <p className="oss-subtitle" style={{
            margin: '0 auto',
            maxWidth: '560px',
            fontSize: '17px',
            color: '#8a8f9e',
            lineHeight: '1.7',
          }}>
            Connect. Modify. Contribute.
            <br />
            The OSS container includes the spec engine, MCP server, node
            catalog, GitOps connection, and intuitive flow to allow builders
            to extend their ability to develop and deploy higher quality code
            from their AI.
            <br /><br />
            Read the source, file an issue, or open a pull request.
          </p>
        </div>

        <a
          className="oss-cta-plate"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '28px',
            maxWidth: '640px',
            margin: '0 auto',
            padding: '32px 36px',
            borderRadius: '16px',
            border: '1px solid rgba(139, 143, 230, 0.1)',
            background: 'linear-gradient(160deg, #1a1d26 0%, rgba(26, 29, 38, 0.5) 100%)',
            textDecoration: 'none',
            transition: 'border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.25)';
            e.currentTarget.style.boxShadow = '0 8px 40px rgba(139, 143, 230, 0.15)';
            e.currentTarget.style.transform = 'translateY(-4px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.1)';
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <svg className="oss-cta-mark" width="48" height="48" viewBox="0 0 16 16" fill="#E6E9EF" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.07-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
            <h3 className="oss-cta-title" style={{
              margin: 0,
              fontSize: '22px',
              fontWeight: 700,
              color: '#E6E9EF',
              letterSpacing: '-0.02em',
              lineHeight: '1.3',
            }}>
              Browse the repository on GitHub
            </h3>
            <span style={{
              fontSize: '13px',
              fontFamily: 'Monaco, Menlo, monospace',
              color: '#8a8f9e',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {REPO_LABEL}
            </span>
          </div>
          <span className="oss-cta-arrow" style={{
            marginLeft: 'auto',
            flexShrink: 0,
            fontSize: '22px',
            color: 'rgba(139, 143, 230, 0.7)',
            lineHeight: 1,
          }}>
            →
          </span>
        </a>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '10px 18px',
          marginTop: '26px',
        }}>
          <span style={{ fontSize: '13px', color: '#8a8f9e' }}>
            Licensed under the Apache License 2.0
          </span>
          <span style={{ width: '1px', height: '12px', background: 'rgba(255, 255, 255, 0.12)' }} />
          <span style={{ fontSize: '13px', color: '#8a8f9e' }}>
            Issues and pull requests welcome
          </span>
        </div>
      </div>
    </section>
  );
}
