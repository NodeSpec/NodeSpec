// Public builder profile at /u/:handle (hosted edition).
//
// Deliberately simple per the product call: photo, name, bio, links,
// published templates, total upvotes received. No DMs, no follows. The
// page is public-shell styled (TemplateDetailPage pattern) so a shared
// link reads like the marketplace, signed in or not — App.tsx exempts
// /u/ from both boot redirects for exactly that reason.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { useTemplates } from '../../context/ServiceContext.js';
import { getProfileByHandle, type UserProfile } from '../../services/ProfileService.js';
import { TemplateCard } from '../templates/TemplateCard.js';
import type { ProjectTemplate } from '../../../persistence/types.js';
import type { User } from '@supabase/supabase-js';
import logoLight from '../../assets/lightmode_nodal.png';
import { isTechnologyVisualsPopulated } from '../../utils/technology-logo-map.js';
import { CatalogService } from '../../services/CatalogService.js';
import { usePageSeo, BASE_URL } from '../../hooks/usePageSeo.js';
import { SiteFooter } from '../common/SiteFooter.js';

const ACCENT = '#8B8FE6';

function initialsOf(profile: UserProfile): string {
  const source = profile.displayName || profile.handle;
  return source
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

const LINK_STYLE: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  fontSize: '13px', fontWeight: 500, color: '#4b5563',
  textDecoration: 'none', padding: '6px 12px', borderRadius: '8px',
  border: '1px solid rgba(139, 143, 230, 0.25)',
};

export function PublicProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const templateService = useTemplates();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogReady, setCatalogReady] = useState(isTechnologyVisualsPopulated());

  usePageSeo({
    title: profile
      ? `${profile.displayName || profile.handle} - Builder Profile | NodeSpec`
      : 'Builder Profile | NodeSpec',
    description: profile?.bio
      ? profile.bio.slice(0, 155)
      : 'Architectures published to the NodeSpec community marketplace.',
    path: `/u/${handle || ''}`,
    breadcrumbs: [
      { name: 'Home', url: BASE_URL },
      { name: 'Templates', url: `${BASE_URL}/templates` },
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
    if (!handle) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const loaded = await getProfileByHandle(handle);
        if (cancelled) return;
        setProfile(loaded);
        if (loaded) {
          // RLS trims to public templates when viewing someone else.
          const authored = await templateService.getMyTemplates(loaded.userId);
          if (!cancelled) setTemplates(authored);
        }
      } catch {
        if (!cancelled) setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [handle, templateService]);

  const totalUpvotes = useMemo(
    () => templates.reduce((sum, t) => sum + (t.upvoteCount ?? 0), 0),
    [templates]
  );
  const isOwn = user !== null && profile !== null && user.id === profile.userId;

  return (
    <div style={{
      width: '100%',
      minHeight: '100vh',
      overflowY: 'auto',
      background: 'linear-gradient(180deg, #f8f9fc 0%, #fafbfc 100%)',
    }}>
      <nav className="landing-nav" style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
            style={{
              fontSize: '14px', fontWeight: 500, color: '#6b7280', cursor: 'pointer',
              padding: '8px 16px', borderRadius: '8px', transition: 'all 0.15s ease',
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
          <span
            style={{
              fontSize: '14px', fontWeight: 500, color: '#1f2937', cursor: 'pointer',
              padding: '8px 20px', borderRadius: '8px',
              border: '1px solid rgba(139, 143, 230, 0.3)',
              transition: 'all 0.15s ease', backgroundColor: 'transparent', marginLeft: '8px',
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

      <div style={{ padding: '40px 24px 80px', maxWidth: '1100px', margin: '0 auto' }}>
        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '80px 0', gap: '16px',
          }}>
            <div style={{
              width: '32px', height: '32px',
              border: '3px solid rgba(139, 143, 230, 0.2)',
              borderTopColor: ACCENT, borderRadius: '50%',
              animation: 'pp-spin 0.8s linear infinite',
            }} />
            <span style={{ color: '#6b7280', fontSize: '14px' }}>Loading profile...</span>
            <style>{`@keyframes pp-spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : !profile ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: '#1f2937', marginBottom: '8px' }}>
              Profile not found
            </div>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
              This profile may be private or the URL is incorrect.
            </p>
            <button
              onClick={() => navigate('/templates')}
              style={{
                padding: '10px 24px', fontSize: '14px', fontWeight: 600,
                borderRadius: '8px', border: 'none', cursor: 'pointer',
                backgroundColor: ACCENT, color: '#fff',
              }}
            >
              Browse Templates
            </button>
          </div>
        ) : (
          <>
            <div style={{
              display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap',
              padding: '28px', borderRadius: '16px',
              backgroundColor: '#ffffff', border: '1px solid rgba(139, 143, 230, 0.15)',
              marginBottom: '32px',
            }}>
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName || profile.handle}
                  style={{
                    width: '88px', height: '88px', borderRadius: '50%',
                    objectFit: 'cover', border: '2px solid rgba(139, 143, 230, 0.3)',
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div style={{
                  width: '88px', height: '88px', borderRadius: '50%',
                  backgroundColor: 'rgba(139, 143, 230, 0.15)', color: ACCENT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '28px', fontWeight: 700, flexShrink: 0,
                }}>
                  {initialsOf(profile)}
                </div>
              )}
              <div style={{ flex: 1, minWidth: '260px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#1f2937', margin: 0 }}>
                    {profile.displayName || profile.handle}
                  </h1>
                  <span style={{ fontSize: '14px', color: '#6b7280' }}>@{profile.handle}</span>
                </div>
                {profile.bio && (
                  <p style={{ fontSize: '14px', color: '#4b5563', lineHeight: 1.55, margin: '10px 0 0', maxWidth: '640px' }}>
                    {profile.bio}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
                  {profile.websiteUrl && (
                    <a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
                      Website
                    </a>
                  )}
                  {profile.githubUrl && (
                    <a href={profile.githubUrl} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
                      GitHub
                    </a>
                  )}
                  {Object.entries(profile.socials).map(([label, url]) => (
                    typeof url === 'string' && url.startsWith('https://') ? (
                      <a key={label} href={url} target="_blank" rel="noopener noreferrer" style={LINK_STYLE}>
                        {label}
                      </a>
                    ) : null
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#1f2937' }}>{templates.length}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>template{templates.length === 1 ? '' : 's'}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#1f2937' }}>{totalUpvotes}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>upvotes</div>
                </div>
                {isOwn && (
                  <button
                    onClick={() => navigate('/app')}
                    title="Edit your profile from Account → Public profile"
                    style={{
                      padding: '8px 16px', fontSize: '13px', fontWeight: 600,
                      borderRadius: '8px', border: `1px solid rgba(139, 143, 230, 0.4)`,
                      backgroundColor: 'transparent', color: ACCENT, cursor: 'pointer',
                    }}
                  >
                    Edit profile
                  </button>
                )}
              </div>
            </div>

            <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#1f2937', margin: '0 0 16px' }}>
              Published architectures
            </h2>
            {templates.length === 0 ? (
              <p style={{ fontSize: '14px', color: '#6b7280' }}>
                Nothing published yet.
              </p>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '20px',
              }}>
                {templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isAuthenticated={user !== null}
                    catalogReady={catalogReady}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <SiteFooter />
    </div>
  );
}
