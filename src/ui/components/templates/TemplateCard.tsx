import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectTemplate } from '../../../persistence/types.js';
import { TemplatePreviewCanvas } from './TemplatePreviewCanvas.js';
import { TECHNOLOGY_LOGO_MAP, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';
import { isHostedEdition } from '../../config/edition.js';
import type { UserProfile } from '../../services/ProfileService.js';

const ACCENT = '#8B8FE6';
const MAX_VISIBLE_TECH = 6;

interface TemplateCardProps {
  template: ProjectTemplate;
  isAuthenticated: boolean;
  onUseTemplate?: (templateId: string) => void;
  loading?: boolean;
  upvoted?: boolean;
  onToggleUpvote?: (templateId: string) => void;
  catalogReady?: boolean;
  /** Owner 2026-08-31 (managed editions only): the community author's public
   *  profile, batch-fetched by the gallery. When present, the card's badge
   *  becomes a clickable author chip → /u/:handle — the profile page lists
   *  everything that builder has shared. Absent/private profiles (and every
   *  non-hosted edition) keep the plain Community badge. */
  authorProfile?: UserProfile | null;
}

function extractTechnologies(template: ProjectTemplate): Array<{ id: string; logo: string; name: string }> {
  const seen = new Set<string>();
  const results: Array<{ id: string; logo: string; name: string }> = [];

  const nodes = template.graphData?.nodes ? Object.values(template.graphData.nodes) : [];
  for (const node of nodes) {
    const tech = node.technology;
    if (tech && !seen.has(tech) && TECHNOLOGY_LOGO_MAP[tech]) {
      seen.add(tech);
      results.push({
        id: tech,
        logo: TECHNOLOGY_LOGO_MAP[tech],
        name: getTechnologyDisplayName(tech) || tech,
      });
    }
  }

  for (const tech of template.technologies ?? []) {
    if (!seen.has(tech) && TECHNOLOGY_LOGO_MAP[tech]) {
      seen.add(tech);
      results.push({
        id: tech,
        logo: TECHNOLOGY_LOGO_MAP[tech],
        name: getTechnologyDisplayName(tech) || tech,
      });
    }
  }

  return results;
}

export function TemplateCard({ template, isAuthenticated, onUseTemplate, loading, upvoted, onToggleUpvote, catalogReady, authorProfile }: TemplateCardProps) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const showAuthorChip = isHostedEdition && template.authorType === 'community' && !!authorProfile;

  const technologies = useMemo(() => extractTechnologies(template), [template, catalogReady]);
  const visibleTech = technologies.slice(0, MAX_VISIBLE_TECH);
  const overflowCount = technologies.length - MAX_VISIBLE_TECH;

  const hasGraph = template.graphData &&
    Object.keys(template.graphData.nodes || {}).length > 0;

  const upvoteCount = (template as ProjectTemplate & { upvoteCount?: number }).upvoteCount ?? 0;

  return (
    <div
      style={{
        width: '100%',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: `1px solid ${hovered ? 'rgba(139, 143, 230, 0.35)' : '#e5e7eb'}`,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: hovered ? '0 12px 32px rgba(0, 0, 0, 0.1)' : '0 1px 3px rgba(0, 0, 0, 0.06)',
      }}
      onClick={() => navigate(`/templates/${template.slug}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        height: '200px',
        background: 'linear-gradient(135deg, #f8f9fc 0%, #f1f3f9 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {hasGraph ? (
          <TemplatePreviewCanvas graphData={template.graphData} height={200} variant="mini" />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9ca3af',
            fontSize: '13px',
            gap: '8px',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span>{template.nodeCount} nodes</span>
          </div>
        )}

        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255, 255, 255, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s ease',
            backdropFilter: 'blur(2px)',
          }}
        >
          <span style={{
            fontSize: '14px',
            fontWeight: 600,
            color: ACCENT,
            padding: '8px 20px',
            borderRadius: '8px',
            border: '1px solid rgba(139, 143, 230, 0.3)',
            backgroundColor: 'rgba(139, 143, 230, 0.08)',
          }}>
            View Template
          </span>
        </div>

        {template.isFeatured && (
          <div style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            backgroundColor: 'rgba(139, 143, 230, 0.1)',
            border: '1px solid rgba(139, 143, 230, 0.25)',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 600,
            color: ACCENT,
            zIndex: 2,
          }}>
            Featured
          </div>
        )}
      </div>

      <div style={{ padding: '14px 16px 16px' }}>
        {visibleTech.length > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '10px',
          }}>
            {visibleTech.map(tech => (
              <div
                key={tech.id}
                title={tech.name}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#f3f4f6',
                  border: '1px solid #e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <img
                  src={tech.logo}
                  alt={tech.name}
                  style={{
                    width: '18px',
                    height: '18px',
                    objectFit: 'contain',
                  }}
                />
              </div>
            ))}
            {overflowCount > 0 && (
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: '#f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 600,
                color: '#6b7280',
                flexShrink: 0,
              }}>
                +{overflowCount}
              </div>
            )}
          </div>
        )}

        <h3 style={{
          fontSize: '15px',
          fontWeight: 700,
          color: '#1f2937',
          margin: '0 0 4px',
          lineHeight: 1.3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {template.name}
        </h3>

        <p style={{
          fontSize: '13px',
          color: '#6b7280',
          lineHeight: 1.5,
          margin: '0 0 12px',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: '39px',
        }}>
          {template.description}
        </p>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: '#9ca3af',
          borderTop: '1px solid #f3f4f6',
          paddingTop: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
              </svg>
              {template.nodeCount}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
              {template.edgeCount}
            </span>
            {template.repoUrl && (
              <a
                href={template.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="View this template's source repository on GitHub"
                onClick={(e) => e.stopPropagation()}
                style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#9ca3af', textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#374151'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9ca3af'; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                </svg>
                Source
              </a>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isAuthenticated) {
                  navigate('/?signup=templates');
                  return;
                }
                onToggleUpvote?.(template.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '12px',
                color: upvoted ? '#f97316' : '#9ca3af',
                transition: 'all 0.15s ease',
              }}
              title={isAuthenticated ? (upvoted ? 'Remove upvote' : 'Upvote this template') : 'Sign in to upvote'}
            >
              <span style={{ fontSize: '14px' }}>{'\uD83D\uDE80'}</span>
              {upvoteCount > 0 && <span>{upvoteCount}</span>}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {showAuthorChip && authorProfile ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/u/${authorProfile.handle}`);
                }}
                title={`See everything ${authorProfile.displayName || `@${authorProfile.handle}`} has shared`}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  maxWidth: '132px', padding: '2px 7px 2px 2px',
                  fontSize: '11px', fontWeight: 600, color: '#6b7280',
                  backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb',
                  borderRadius: '999px', cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = ACCENT;
                  e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#6b7280';
                  e.currentTarget.style.borderColor = '#e5e7eb';
                }}
              >
                {authorProfile.avatarUrl ? (
                  <img
                    src={authorProfile.avatarUrl}
                    alt=""
                    style={{ width: '18px', height: '18px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <span style={{
                    width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: 'rgba(139, 143, 230, 0.15)', color: ACCENT,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '10px', fontWeight: 700,
                  }}>
                    {(authorProfile.displayName || authorProfile.handle).charAt(0).toUpperCase()}
                  </span>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {authorProfile.displayName || `@${authorProfile.handle}`}
                </span>
              </button>
            ) : (
            <span style={{
              fontSize: '10px',
              fontWeight: 600,
              color: template.authorType === 'official' ? '#16a34a' : '#6b7280',
              backgroundColor: template.authorType === 'official'
                ? 'rgba(22, 163, 74, 0.08)'
                : '#f3f4f6',
              border: `1px solid ${template.authorType === 'official' ? 'rgba(22, 163, 74, 0.2)' : '#e5e7eb'}`,
              padding: '2px 6px',
              borderRadius: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
            {template.authorType === 'official' ? 'Official' : 'Community'}
            </span>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isAuthenticated && onUseTemplate) {
                  onUseTemplate(template.id);
                } else {
                  navigate('/?signup=templates');
                }
              }}
              disabled={loading}
              style={{
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: loading ? 'not-allowed' : 'pointer',
                backgroundColor: isAuthenticated ? ACCENT : 'rgba(139, 143, 230, 0.1)',
                color: isAuthenticated ? '#fff' : ACCENT,
                transition: 'all 0.15s ease',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {isAuthenticated ? 'Use Template' : 'Sign up to use'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
