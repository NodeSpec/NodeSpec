import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProjectTemplate } from '../../../persistence/types.js';
import type { User } from '@supabase/supabase-js';
import type { Node } from '@nodespec/core/types.js';
import { TemplatePreviewCanvas } from './TemplatePreviewCanvas.js';
import { TECHNOLOGY_LOGO_MAP, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';

const ACCENT = '#8B8FE6';

const ROLE_CATEGORY_MAP: Record<string, string> = {
  'frontend': 'Frontend',
  'mobile': 'Mobile',
  'backend': 'Backend',
  'database': 'Database',
  'cache': 'Cache',
  'messaging': 'Messaging',
  'auth': 'Auth',
  'ai': 'AI / ML',
  'infrastructure': 'Infrastructure',
  'orchestration': 'Orchestration',
  'runtime': 'Runtime',
  'observability': 'Observability',
  'external': 'External',
  'gateway': 'API Gateway',
  'web': 'API / Web',
  'data': 'Data',
  'cloud': 'Cloud',
  'cdn': 'CDN',
  'lb': 'Load Balancer',
  'serverless': 'Serverless',
  'distribution': 'Distribution',
  'logical': 'Logical',
};

function getNodeCategory(node: Node): string {
  const prefix = node.type.split('.')[0];
  return ROLE_CATEGORY_MAP[prefix] || prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

interface TemplateDetailProps {
  template: ProjectTemplate;
  user: User | null;
  onUseTemplate: () => void;
  usingTemplate: boolean;
  upvoted?: boolean;
  onToggleUpvote?: () => void;
  catalogReady?: boolean;
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

function buildArchitectureOverview(template: ProjectTemplate) {
  const nodes = template.graphData?.nodes ? Object.values(template.graphData.nodes) : [];
  const edges = template.graphData?.edges ? Object.values(template.graphData.edges) : [];

  const categoryCounts: Record<string, number> = {};
  for (const node of nodes) {
    const cat = getNodeCategory(node);
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);

  return {
    categories: sorted,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodeList: nodes,
  };
}

const ARCH_PATTERN_LABELS: Record<string, string> = {
  monolith: 'Monolith',
  microservices: 'Microservices',
  serverless: 'Serverless',
  unknown: 'Custom',
};

export function TemplateDetail({ template, user, onUseTemplate, usingTemplate, upvoted, onToggleUpvote, catalogReady }: TemplateDetailProps) {
  const [fullScreen, setFullScreen] = useState(false);

  const technologies = useMemo(() => extractTechnologies(template), [template, catalogReady]);
  const overview = useMemo(() => buildArchitectureOverview(template), [template]);

  const graphData = template.graphData;
  const hasGraph = graphData && Object.keys(graphData.nodes || {}).length > 0;
  const spec = template.templateSpecification;
  const upvoteCount = (template as ProjectTemplate & { upvoteCount?: number }).upvoteCount ?? 0;

  if (fullScreen && hasGraph && graphData) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: '#f8f9fc',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(12px)',
        }}>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#1f2937' }}>
            {template.name} - Architecture Preview
          </span>
          <button
            onClick={() => setFullScreen(false)}
            style={{
              padding: '6px 16px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '6px',
              border: '1px solid #e5e7eb',
              cursor: 'pointer',
              backgroundColor: '#fff',
              color: '#1f2937',
              transition: 'all 0.15s ease',
            }}
          >
            Exit Full Screen
          </button>
        </div>
        <div style={{ flex: 1 }}>
          <TemplatePreviewCanvas graphData={graphData} height="100%" variant="mini" fullscreen={true} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {hasGraph && graphData && (
        <div style={{
          borderRadius: '12px',
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
          backgroundColor: '#f8f9fc',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: '1px solid #f3f4f6',
          }}>
            <span style={{
              fontSize: '13px',
              fontWeight: 600,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Architecture Preview
            </span>
            <button
              onClick={() => setFullScreen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: '6px',
                border: '1px solid #e5e7eb',
                cursor: 'pointer',
                backgroundColor: '#fff',
                color: '#6b7280',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#1f2937';
                e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#6b7280';
                e.currentTarget.style.borderColor = '#e5e7eb';
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              Preview Full Screen
            </button>
          </div>
          <TemplatePreviewCanvas graphData={graphData} height="50vh" variant="mini" />
        </div>
      )}

      <div className="template-detail-grid" style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: '24px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
          <InfoSection
            template={template}
            user={user}
            onUseTemplate={onUseTemplate}
            usingTemplate={usingTemplate}
            upvoted={upvoted}
            upvoteCount={upvoteCount}
            onToggleUpvote={onToggleUpvote}
          />

          {template.description && (
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              padding: '20px',
            }}>
              <SectionHeader>Description</SectionHeader>
              <div style={{
                fontSize: '14px',
                color: '#4b5563',
                lineHeight: 1.75,
                whiteSpace: 'pre-wrap',
              }}>
                {template.description}
              </div>
            </div>
          )}

          {spec && (
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              padding: '20px',
            }}>
              <SectionHeader>Project Specification</SectionHeader>

              {spec.vision && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
                    Vision
                  </div>
                  <div style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.7 }}>
                    {spec.vision}
                  </div>
                </div>
              )}

              {spec.preferences && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                    Preferences
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {spec.preferences.architecturePattern && spec.preferences.architecturePattern !== 'unknown' && (
                      <MetadataTag label={ARCH_PATTERN_LABELS[spec.preferences.architecturePattern] ?? spec.preferences.architecturePattern} color="#8B8FE6" />
                    )}
                    {spec.preferences.deploymentTarget && (
                      <MetadataTag label={spec.preferences.deploymentTarget} color="#059669" />
                    )}
                    {(spec.preferences.languages ?? []).map(l => (
                      <MetadataTag key={l} label={l} color="#0284c7" />
                    ))}
                    {(spec.preferences.frameworks ?? []).map(f => (
                      <MetadataTag key={f} label={f} color="#7c3aed" />
                    ))}
                    {(spec.preferences.databases ?? []).map(d => (
                      <MetadataTag key={d} label={d} color="#d97706" />
                    ))}
                  </div>
                </div>
              )}

              {spec.requirements && spec.requirements.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
                    Requirements ({spec.requirements.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {spec.requirements.slice(0, 8).map(r => (
                      <div key={r.requirementId} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '8px 12px',
                        backgroundColor: '#f9fafb',
                        borderRadius: '6px',
                        border: '1px solid #f3f4f6',
                      }}>
                        <span style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          color: r.category === 'functional' ? '#059669' : r.category === 'technical' ? '#0284c7' : r.category === 'non-functional' ? '#d97706' : '#6b7280',
                          backgroundColor: r.category === 'functional' ? 'rgba(5, 150, 105, 0.08)' : r.category === 'technical' ? 'rgba(2, 132, 199, 0.08)' : r.category === 'non-functional' ? 'rgba(217, 119, 6, 0.08)' : '#f3f4f6',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          textTransform: 'uppercase',
                          flexShrink: 0,
                          marginTop: '1px',
                        }}>
                          {r.category}
                        </span>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 500, color: '#1f2937' }}>{r.name}</div>
                          {r.description && (
                            <div style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.4, marginTop: '2px' }}>
                              {r.description}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {spec.requirements.length > 8 && (
                      <div style={{ fontSize: '12px', color: '#9ca3af', padding: '4px 12px' }}>
                        + {spec.requirements.length - 8} more requirements included in template
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {technologies.length > 0 && (
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              padding: '20px',
            }}>
              <SectionHeader>Technologies Used</SectionHeader>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: '10px',
              }}>
                {technologies.map(tech => (
                  <div
                    key={tech.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '8px',
                      border: '1px solid #f3f4f6',
                    }}
                  >
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <img
                        src={tech.logo}
                        alt={tech.name}
                        style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                      />
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: '#1f2937' }}>
                      {tech.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {overview.nodeList.length > 0 && (
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              border: '1px solid #e5e7eb',
              padding: '20px',
            }}>
              <SectionHeader>Node List</SectionHeader>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '8px',
              }}>
                {overview.nodeList.map(node => (
                  <div
                    key={node.id}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '8px',
                      border: '1px solid #f3f4f6',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937', marginBottom: '3px' }}>
                      {node.label}
                    </div>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                      {node.type}
                      {node.technology && (
                        <span style={{ color: '#6b7280', marginLeft: '6px' }}>
                          {getTechnologyDisplayName(node.technology)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignSelf: 'flex-start', position: 'sticky', top: '80px' }}>
          <div style={{
            backgroundColor: '#fff',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            padding: '20px',
          }}>
            <SectionHeader>Architecture Overview</SectionHeader>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              {overview.categories.map(([cat, count]) => (
                <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#6b7280' }}>{cat}</span>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#1f2937',
                    backgroundColor: 'rgba(139, 143, 230, 0.08)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    minWidth: '28px',
                    textAlign: 'center',
                  }}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <StatRow label="Total Nodes" value={overview.totalNodes} />
              <StatRow label="Connections" value={overview.totalEdges} />
            </div>
          </div>

          <button
            onClick={onUseTemplate}
            disabled={usingTemplate}
            style={{
              width: '100%',
              padding: '14px 24px',
              fontSize: '15px',
              fontWeight: 600,
              borderRadius: '10px',
              border: 'none',
              cursor: usingTemplate ? 'not-allowed' : 'pointer',
              backgroundColor: user ? ACCENT : 'rgba(139, 143, 230, 0.1)',
              color: user ? '#fff' : ACCENT,
              transition: 'all 0.2s ease',
              opacity: usingTemplate ? 0.6 : 1,
            }}
          >
            {usingTemplate
              ? 'Creating project...'
              : user
                ? 'Use This Template'
                : 'Sign up to use this template'}
          </button>

          {hasGraph && (
            <button
              onClick={() => setFullScreen(true)}
              style={{
                width: '100%',
                padding: '10px 24px',
                fontSize: '13px',
                fontWeight: 500,
                borderRadius: '10px',
                border: '1px solid #e5e7eb',
                cursor: 'pointer',
                backgroundColor: '#fff',
                color: '#6b7280',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#1f2937';
                e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#6b7280';
                e.currentTarget.style.borderColor = '#e5e7eb';
              }}
            >
              Preview Full Screen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoSection({ template, user, onUseTemplate, usingTemplate, upvoted, upvoteCount, onToggleUpvote }: {
  template: ProjectTemplate;
  user: User | null;
  onUseTemplate: () => void;
  usingTemplate: boolean;
  upvoted?: boolean;
  upvoteCount: number;
  onToggleUpvote?: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 800,
            color: '#1f2937',
            letterSpacing: '-0.02em',
            margin: 0,
          }}>
            {template.name}
          </h1>
          <span style={{
            fontSize: '11px',
            fontWeight: 600,
            color: template.authorType === 'official' ? '#16a34a' : '#6b7280',
            backgroundColor: template.authorType === 'official'
              ? 'rgba(22, 163, 74, 0.08)'
              : '#f3f4f6',
            border: `1px solid ${template.authorType === 'official' ? 'rgba(22, 163, 74, 0.2)' : '#e5e7eb'}`,
            padding: '3px 8px',
            borderRadius: '5px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            {template.authorType === 'official' ? 'Official' : 'Community'}
          </span>
          {template.isFeatured && (
            <span style={{
              backgroundColor: 'rgba(139, 143, 230, 0.1)',
              border: '1px solid rgba(139, 143, 230, 0.25)',
              borderRadius: '5px',
              padding: '3px 8px',
              fontSize: '11px',
              fontWeight: 600,
              color: ACCENT,
            }}>
              Featured
            </span>
          )}
        </div>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          fontSize: '13px',
          color: '#9ca3af',
        }}>
          <span>v{template.version}</span>
          <span>{template.useCount.toLocaleString()} uses</span>
          {template.repoUrl && (
            <a
              href={template.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="View this template's source repository on GitHub"
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                color: '#6b7280', textDecoration: 'none', fontWeight: 500,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#111827'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = '#6b7280'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
              Source repo
            </a>
          )}
          <button
            onClick={() => {
              if (!user) {
                navigate('/?signup=templates');
                return;
              }
              onToggleUpvote?.();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: upvoted ? 'rgba(249, 115, 22, 0.08)' : 'transparent',
              border: `1px solid ${upvoted ? 'rgba(249, 115, 22, 0.25)' : '#e5e7eb'}`,
              borderRadius: '6px',
              cursor: 'pointer',
              padding: '4px 10px',
              fontSize: '13px',
              fontWeight: 500,
              color: upvoted ? '#f97316' : '#6b7280',
              transition: 'all 0.15s ease',
            }}
            title={user ? (upvoted ? 'Remove upvote' : 'Upvote this template') : 'Sign in to upvote'}
          >
            <span style={{ fontSize: '15px' }}>{'\uD83D\uDE80'}</span>
            <span>{upvoteCount}</span>
          </button>
          {template.tags.length > 0 && (
            <div style={{ display: 'flex', gap: '4px' }}>
              {template.tags.slice(0, 4).map(tag => (
                <span key={tag} style={{
                  fontSize: '11px',
                  color: '#6b7280',
                  backgroundColor: '#f3f4f6',
                  padding: '2px 8px',
                  borderRadius: '4px',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={onUseTemplate}
        disabled={usingTemplate}
        style={{
          padding: '10px 24px',
          fontSize: '14px',
          fontWeight: 600,
          borderRadius: '8px',
          border: 'none',
          cursor: usingTemplate ? 'not-allowed' : 'pointer',
          backgroundColor: user ? ACCENT : 'rgba(139, 143, 230, 0.1)',
          color: user ? '#fff' : ACCENT,
          transition: 'all 0.15s ease',
          opacity: usingTemplate ? 0.6 : 1,
          flexShrink: 0,
        }}
      >
        {usingTemplate
          ? 'Creating...'
          : user
            ? 'Use This Template'
            : 'Sign up to use'}
      </button>
    </div>
  );
}

function MetadataTag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: '11px',
      fontWeight: 600,
      color,
      backgroundColor: `${color}12`,
      border: `1px solid ${color}30`,
      padding: '3px 8px',
      borderRadius: '4px',
    }}>
      {label}
    </span>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: '13px',
      fontWeight: 600,
      color: '#6b7280',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      margin: '0 0 14px',
    }}>
      {children}
    </h3>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '13px', color: '#6b7280' }}>{label}</span>
      <span style={{ fontSize: '14px', fontWeight: 600, color: '#1f2937' }}>{value}</span>
    </div>
  );
}
