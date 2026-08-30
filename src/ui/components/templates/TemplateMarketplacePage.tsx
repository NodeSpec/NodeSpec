import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { useTemplates } from '../../context/ServiceContext.js';
import { useProjectSwitch } from '../../context/ProjectSwitchContext.js';
import { TemplateCard } from './TemplateCard.js';
import { TemplateApplyDialog } from './TemplateApplyDialog.js';
import type { TemplateApplyChoice } from './TemplateApplyDialog.js';
import type { ProjectTemplate, TemplateCategory } from '../../../persistence/types.js';
import type { User } from '@supabase/supabase-js';
import logoLight from '../../assets/lightmode_nodal.png';
import { CatalogService } from '../../services/CatalogService.js';
import { isTechnologyVisualsPopulated } from '../../utils/technology-logo-map.js';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';

const LIGHT_BG = '#f8f9fc';
const LIGHT_SURFACE = '#ffffff';
const ACCENT = '#8B8FE6';

const CATEGORIES: { value: TemplateCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'saas', label: 'SaaS' },
  { value: 'microservices', label: 'Microservices' },
  { value: 'e-commerce', label: 'E-Commerce' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'data-pipeline', label: 'Data Pipeline' },
  { value: 'real-time', label: 'Real-Time' },
  { value: 'ai-ml', label: 'AI / ML' },
  { value: 'iot', label: 'IoT' },
  { value: 'devops', label: 'DevOps' },
  { value: 'general', label: 'General' },
];

export function TemplateMarketplacePage() {
  const navigate = useNavigate();
  const templateService = useTemplates();
  const [user, setUser] = useState<User | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(isTechnologyVisualsPopulated());
  const [usingTemplateId, setUsingTemplateId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [upvotedIds, setUpvotedIds] = useState<Set<string>>(new Set());

  const [applyTemplateId, setApplyTemplateId] = useState<string | null>(null);
  const projectSwitch = useProjectSwitch();

  usePageSeo({
    title: 'Architecture Templates - NodeSpec',
    description: 'Browse pre-built software architecture templates for SaaS, microservices, AI/ML, e-commerce, and more. Start your next project with a proven architecture blueprint.',
    path: '/templates',
    keywords: 'software architecture templates, system design templates, microservices template, SaaS architecture, AI ML architecture, cloud architecture blueprint',
    breadcrumbs: [
      { name: 'Home', url: BASE_URL },
      { name: 'Templates', url: `${BASE_URL}/templates` },
    ],
    jsonLd: [
      {
        id: 'template-collection-schema',
        data: {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Architecture Templates',
          description: 'Browse pre-built software architecture templates for SaaS, microservices, AI/ML, e-commerce, and more.',
          url: `${BASE_URL}/templates`,
          isPartOf: { '@type': 'WebSite', name: 'NodeSpec', url: BASE_URL },
        },
      },
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
    if (!user) return;
    const supabase = getSupabaseClient();
    supabase
      .from('template_upvotes')
      .select('template_id')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data) {
          setUpvotedIds(new Set(data.map((r: { template_id: string }) => r.template_id)));
        }
      });
  }, [user]);

  const handleToggleUpvote = async (templateId: string) => {
    if (!user) {
      navigate('/?signup=templates');
      return;
    }
    const supabase = getSupabaseClient();
    const wasUpvoted = upvotedIds.has(templateId);

    setUpvotedIds(prev => {
      const next = new Set(prev);
      if (wasUpvoted) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
    setTemplates(prev => prev.map(t =>
      t.id === templateId
        ? { ...t, upvoteCount: Math.max((t.upvoteCount ?? 0) + (wasUpvoted ? -1 : 1), 0) }
        : t
    ));

    if (wasUpvoted) {
      await supabase.from('template_upvotes').delete().eq('template_id', templateId).eq('user_id', user.id);
      await supabase.rpc('decrement_template_upvote_count', { tid: templateId });
    } else {
      await supabase.from('template_upvotes').insert({ template_id: templateId, user_id: user.id });
      await supabase.rpc('increment_template_upvote_count', { tid: templateId });
    }
  };

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: Record<string, unknown> = {};
      if (activeCategory !== 'all') {
        filters.category = activeCategory;
      }
      if (searchQuery.trim()) {
        filters.search = searchQuery.trim();
      }
      const result = await templateService.listTemplates(filters as Parameters<typeof templateService.listTemplates>[0]);
      setTemplates(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [templateService, activeCategory, searchQuery]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleUseTemplate = (templateId: string) => {
    if (!user) {
      navigate('/?signup=templates');
      return;
    }
    setApplyTemplateId(templateId);
  };

  const handleApplyConfirm = async (choice: TemplateApplyChoice) => {
    if (!applyTemplateId || !user) return;
    const templateId = applyTemplateId;
    setApplyTemplateId(null);
    setUsingTemplateId(templateId);
    try {
      if (choice.mode === 'new') {
        const template = templates.find(t => t.id === templateId);
        const projectName = choice.projectName || (template ? `${template.name} Project` : 'Template Project');
        const result = await templateService.useTemplate(templateId, projectName, user.id);
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
        await templateService.overwriteProjectWithTemplate(templateId, choice.projectId, branchId, user.id);
        if (projectSwitch) {
          await projectSwitch.switchToProject(choice.projectId);
        }
        navigate('/app');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply template');
    } finally {
      setUsingTemplateId(null);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadTemplates();
  };

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      overflowY: 'auto',
      background: `linear-gradient(180deg, ${LIGHT_BG} 0%, #fafbfc 100%)`,
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
          <div className="landing-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { label: 'Templates', action: () => navigate('/templates') },
              { label: 'Pricing', action: () => navigate('/pricing') },
            ].map(item => (
              <span
                key={item.label}
                style={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: item.label === 'Templates' ? '#1f2937' : '#6b7280',
                  cursor: 'pointer',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  transition: 'all 0.15s ease',
                  backgroundColor: item.label === 'Templates' ? 'rgba(139, 143, 230, 0.08)' : 'transparent',
                }}
                onClick={item.action}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#1f2937';
                  e.currentTarget.style.backgroundColor = 'rgba(139, 143, 230, 0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = item.label === 'Templates' ? '#1f2937' : '#6b7280';
                  e.currentTarget.style.backgroundColor = item.label === 'Templates' ? 'rgba(139, 143, 230, 0.08)' : 'transparent';
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
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

      <div className="marketplace-content" style={{ padding: '48px 24px 80px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <h1 className="marketplace-heading" style={{
            fontSize: '34px',
            fontWeight: 800,
            color: '#1f2937',
            letterSpacing: '-0.03em',
            marginBottom: '12px',
            lineHeight: 1.2,
          }}>
            Template Marketplace
          </h1>
          <p style={{
            fontSize: '16px',
            color: '#6b7280',
            lineHeight: 1.6,
            margin: 0,
            maxWidth: '540px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Start with a proven architecture. Browse pre-built templates and launch your project in seconds.
          </p>
        </div>

        <form
          onSubmit={handleSearchSubmit}
          style={{
            display: 'flex',
            maxWidth: '520px',
            margin: '0 auto 28px',
            position: 'relative',
          }}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            style={{
              width: '100%',
              padding: '12px 16px 12px 42px',
              fontSize: '14px',
              backgroundColor: LIGHT_SURFACE,
              border: '1px solid rgba(139, 143, 230, 0.2)',
              borderRadius: '10px',
              color: '#1f2937',
              outline: 'none',
              transition: 'border-color 0.15s ease',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.5)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.2)'; }}
          />
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b7280"
            strokeWidth="2"
            style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </form>

        <div className="marketplace-categories" style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          justifyContent: 'center',
          marginBottom: '36px',
        }}>
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              style={{
                padding: '6px 14px',
                fontSize: '13px',
                fontWeight: 500,
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                backgroundColor: activeCategory === cat.value ? 'rgba(139, 143, 230, 0.15)' : 'transparent',
                color: activeCategory === cat.value ? ACCENT : '#6b7280',
                transition: 'all 0.15s ease',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{
            maxWidth: '600px',
            margin: '0 auto 24px',
            padding: '14px 20px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '10px',
            fontSize: '14px',
            color: '#f87171',
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
                color: '#f87171',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0 4px',
                flexShrink: 0,
              }}
            >
              &#x2715;
            </button>
          </div>
        )}

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
              animation: 'mp-spin 0.8s linear infinite',
            }} />
            <span style={{ color: '#6b7280', fontSize: '14px' }}>Loading templates...</span>
            <style>{`@keyframes mp-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : templates.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '80px 0',
            color: '#6b7280',
            fontSize: '15px',
          }}>
            {searchQuery || activeCategory !== 'all'
              ? 'No templates match your filters. Try broadening your search.'
              : 'No templates available yet. Check back soon!'}
          </div>
        ) : (
          <div className="marketplace-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: '20px',
          }}>
            {templates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isAuthenticated={!!user}
                onUseTemplate={handleUseTemplate}
                loading={usingTemplateId === template.id}
                upvoted={upvotedIds.has(template.id)}
                onToggleUpvote={handleToggleUpvote}
                catalogReady={catalogReady}
              />
            ))}
          </div>
        )}
      </div>

      <SiteFooter />

      {applyTemplateId && user && (
        <TemplateApplyDialog
          templateName={templates.find(t => t.id === applyTemplateId)?.name ?? 'Template'}
          userId={user.id}
          onConfirm={handleApplyConfirm}
          onCancel={() => setApplyTemplateId(null)}
        />
      )}
    </div>
  );
}
