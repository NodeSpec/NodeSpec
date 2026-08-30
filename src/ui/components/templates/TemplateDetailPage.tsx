import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { useTemplates } from '../../context/ServiceContext.js';
import { useProjectSwitch } from '../../context/ProjectSwitchContext.js';
import { TemplateDetail } from './TemplateDetail.js';
import { TemplateApplyDialog } from './TemplateApplyDialog.js';
import type { TemplateApplyChoice } from './TemplateApplyDialog.js';
import type { ProjectTemplate } from '../../../persistence/types.js';
import type { User } from '@supabase/supabase-js';
import logoLight from '../../assets/lightmode_nodal.png';
import { CatalogService } from '../../services/CatalogService.js';
import { isTechnologyVisualsPopulated } from '../../utils/technology-logo-map.js';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';
import { isHostedEdition } from '../../config/edition.js';
import { getProfilesByUserIds, type UserProfile } from '../../services/ProfileService.js';
import { TemplateComments } from './TemplateComments.js';
import { ShareButtons } from '../common/ShareButtons.js';

const ACCENT = '#8B8FE6';

export function TemplateDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const templateService = useTemplates();
  const [user, setUser] = useState<User | null>(null);
  const [template, setTemplate] = useState<ProjectTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingTemplate, setUsingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upvoted, setUpvoted] = useState(false);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [catalogReady, setCatalogReady] = useState(isTechnologyVisualsPopulated());
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const projectSwitch = useProjectSwitch();

  usePageSeo({
    title: template
      ? `${template.name} - Architecture Template | NodeSpec`
      : 'Architecture Template | NodeSpec',
    description: template
      ? `${template.description.slice(0, 155)}${template.description.length > 155 ? '...' : ''}`
      : 'View this software architecture template on NodeSpec. Pre-built blueprints for modern applications.',
    path: `/templates/${slug || ''}`,
    // Client-side head parity with the prerendered pages: the live og-image
    // architecture card instead of the generic brand image.
    image: slug
      ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/og-image?template=${encodeURIComponent(slug)}`
      : undefined,
    keywords: template
      ? `${template.name}, architecture template, ${template.technologies?.join(', ') || ''}, system design`
      : 'architecture template, system design, NodeSpec',
    breadcrumbs: [
      { name: 'Home', url: BASE_URL },
      { name: 'Templates', url: `${BASE_URL}/templates` },
      ...(template ? [{ name: template.name, url: `${BASE_URL}/templates/${slug}` }] : []),
    ],
  });

  useEffect(() => {
    if (catalogReady) return;
    let cancelled = false;
    CatalogService.getResolver().then(() => {
      if (!cancelled) setCatalogReady(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [catalogReady]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
  }, []);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    templateService.getTemplateBySlug(slug).then(result => {
      setTemplate(result);
      if (!result) {
        setError('Template not found');
      }
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    }).finally(() => {
      setLoading(false);
    });
  }, [slug, templateService]);

  // Community attribution: user_profiles is the only client-readable author
  // source; absent/private rows fall back to the anonymous label.
  useEffect(() => {
    if (!isHostedEdition || !template || template.authorType !== 'community' || !template.authorId) {
      setAuthorProfile(null);
      return;
    }
    let cancelled = false;
    getProfilesByUserIds([template.authorId]).then((profiles) => {
      if (!cancelled) setAuthorProfile(profiles.get(template.authorId!) ?? null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [template]);

  useEffect(() => {
    if (!user || !template) return;
    const supabase = getSupabaseClient();
    supabase
      .from('template_upvotes')
      .select('id')
      .eq('template_id', template.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setUpvoted(!!data);
      });
  }, [user, template]);

  const handleToggleUpvote = async () => {
    if (!user) {
      navigate('/?signup=templates');
      return;
    }
    if (!template) return;

    const supabase = getSupabaseClient();
    if (upvoted) {
      await supabase
        .from('template_upvotes')
        .delete()
        .eq('template_id', template.id)
        .eq('user_id', user.id);
      await supabase.rpc('decrement_template_upvote_count', { tid: template.id });
      setUpvoted(false);
      setTemplate(prev => prev ? { ...prev, upvoteCount: Math.max(((prev as ProjectTemplate & { upvoteCount?: number }).upvoteCount ?? 0) - 1, 0) } as ProjectTemplate : prev);
    } else {
      await supabase
        .from('template_upvotes')
        .insert({ template_id: template.id, user_id: user.id });
      await supabase.rpc('increment_template_upvote_count', { tid: template.id });
      setUpvoted(true);
      setTemplate(prev => prev ? { ...prev, upvoteCount: ((prev as ProjectTemplate & { upvoteCount?: number }).upvoteCount ?? 0) + 1 } as ProjectTemplate : prev);
    }
  };

  const handleUseTemplate = () => {
    if (!user) {
      localStorage.setItem('nodespec_pending_template', template?.id ?? '');
      navigate('/?signup=templates');
      return;
    }
    if (!template) return;
    setShowApplyDialog(true);
  };

  const handleApplyConfirm = async (choice: TemplateApplyChoice) => {
    if (!template || !user) return;
    setShowApplyDialog(false);
    setUsingTemplate(true);
    try {
      if (choice.mode === 'new') {
        const projectName = choice.projectName || `${template.name} Project`;
        const result = await templateService.useTemplate(template.id, projectName, user.id);
        const newProjectId = result.project.project.id;
        if (projectSwitch) {
          await projectSwitch.switchToProject(newProjectId);
        }
        navigate('/app');
      } else if (choice.mode === 'overwrite' && choice.projectId) {
        const currentBranchId = projectSwitch?.getCurrentBranchId();
        const supabase = getSupabaseClient();
        const { data: branch } = await supabase
          .from('branches')
          .select('id')
          .eq('project_id', choice.projectId)
          .eq('name', 'main')
          .maybeSingle();
        const branchId = (choice.projectId === projectSwitch?.getCurrentProjectId() && currentBranchId)
          ? currentBranchId
          : branch?.id;
        if (!branchId) {
          throw new Error('Could not find main branch for the selected project');
        }
        await templateService.overwriteProjectWithTemplate(template.id, choice.projectId, branchId, user.id);
        if (projectSwitch) {
          await projectSwitch.switchToProject(choice.projectId);
        }
        navigate('/app');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply template');
    } finally {
      setUsingTemplate(false);
    }
  };

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      overflowY: 'auto',
      background: 'linear-gradient(180deg, #f8f9fc 0%, #fafbfc 100%)',
    }}>
      <nav className="landing-nav" style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 32px',
        borderBottom: '1px solid rgba(139, 143, 230, 0.12)',
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          <img src={logoLight} alt="NodeSpec" style={{ height: '32px', width: 'auto' }} />
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#1f2937', letterSpacing: '-0.02em' }}>
            NodeSpec
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            className="landing-nav-links"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#6b7280',
                cursor: 'pointer',
                padding: '8px 16px',
                borderRadius: '8px',
                transition: 'all 0.15s ease',
              }}
              onClick={() => navigate('/templates')}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#1f2937';
                e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#6b7280';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              Templates
            </span>
          </span>
          <span
            className="landing-nav-signin"
            style={{
              fontSize: '14px',
              fontWeight: 500,
              color: '#1f2937',
              cursor: 'pointer',
              padding: '8px 20px',
              borderRadius: '8px',
              border: '1px solid rgba(139, 143, 230, 0.3)',
              transition: 'all 0.15s ease',
              backgroundColor: 'transparent',
              marginLeft: '8px',
            }}
            onClick={() => navigate(user ? '/app' : '/')}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.3)';
            }}
          >
            {user ? 'Back to App' : 'Sign In'}
          </span>
        </div>
      </nav>

      <div className="template-detail-content" style={{ padding: '40px 24px 80px', maxWidth: '1100px', margin: '0 auto' }}>
        <button
          onClick={() => navigate('/templates')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'none',
            border: 'none',
            color: '#6b7280',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '4px 0',
            marginBottom: '24px',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#1f2937'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#6b7280'; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Templates
        </button>

        {loading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 0',
            gap: '16px',
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              border: '3px solid rgba(139, 143, 230, 0.2)',
              borderTopColor: ACCENT,
              borderRadius: '50%',
              animation: 'td-spin 0.8s linear infinite',
            }} />
            <span style={{ color: '#6b7280', fontSize: '14px' }}>Loading template...</span>
            <style>{`@keyframes td-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : error && !template ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: '#1f2937', marginBottom: '8px' }}>
              Template not found
            </div>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
              This template may have been removed or the URL is incorrect.
            </p>
            <button
              onClick={() => navigate('/templates')}
              style={{
                padding: '10px 24px',
                fontSize: '14px',
                fontWeight: 600,
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                backgroundColor: ACCENT,
                color: '#fff',
              }}
            >
              Browse Templates
            </button>
          </div>
        ) : template ? (
          <>
            {error && (
              <div style={{
                marginBottom: '20px',
                padding: '14px 20px',
                backgroundColor: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                borderRadius: '10px',
                fontSize: '14px',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  style={{
                    marginLeft: 'auto',
                    background: 'none',
                    border: 'none',
                    color: '#dc2626',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: '0 4px',
                  }}
                >
                  &#x2715;
                </button>
              </div>
            )}

            {isHostedEdition && template.authorType === 'community' && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px',
                fontSize: '13px', color: '#6b7280',
              }}>
                {authorProfile?.avatarUrl ? (
                  <img
                    src={authorProfile.avatarUrl}
                    alt=""
                    style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <span style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    backgroundColor: 'rgba(139, 143, 230, 0.15)', color: ACCENT,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: 700,
                  }}>
                    {(authorProfile?.displayName || authorProfile?.handle || 'C').charAt(0).toUpperCase()}
                  </span>
                )}
                <span>
                  Published by{' '}
                  {authorProfile ? (
                    <span
                      onClick={() => navigate(`/u/${authorProfile.handle}`)}
                      style={{ color: ACCENT, fontWeight: 600, cursor: 'pointer' }}
                    >
                      {authorProfile.displayName || `@${authorProfile.handle}`}
                    </span>
                  ) : (
                    <span style={{ fontWeight: 600 }}>a community member</span>
                  )}
                </span>
              </div>
            )}

            <TemplateDetail
              template={template}
              user={user}
              onUseTemplate={handleUseTemplate}
              usingTemplate={usingTemplate}
              upvoted={upvoted}
              onToggleUpvote={handleToggleUpvote}
              catalogReady={catalogReady}
            />

            {isHostedEdition && (
              <div style={{ marginTop: '24px' }}>
                <ShareButtons
                  url={`${BASE_URL}/templates/${template.slug}`}
                  text={`Check out the "${template.name}" architecture on NodeSpec`}
                />
              </div>
            )}

            {isHostedEdition && (
              <TemplateComments templateId={template.id} user={user} />
            )}
          </>
        ) : null}
      </div>

      <SiteFooter />

      {showApplyDialog && user && template && (
        <TemplateApplyDialog
          templateName={template.name}
          userId={user.id}
          onConfirm={handleApplyConfirm}
          onCancel={() => setShowApplyDialog(false)}
        />
      )}
    </div>
  );
}
