// Owner 2026-08-31: the Templates page splits into Templates | Builders —
// profiles were reachable only through per-card chips (buried). This view is
// the browsable index of the people behind the community templates: one card
// per author with their portfolio stats, leading to /u/:handle where
// everything they've shared lives. HOSTED ONLY — the page renders this view
// solely behind the isHostedEdition literal (enterprise shares the templates
// gallery but has no profiles; OSS compiles the social lane out entirely).
//
// Derivation is client-side on purpose (no migration, no view, no sprawl):
// one public template listing → aggregate per community author → one batch
// profile read. Authors without a public profile cannot be browsed and are
// left out — the same rule the attribution chips follow.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTemplates } from '../../context/ServiceContext.js';
import { getProfilesByUserIds, type UserProfile } from '../../services/ProfileService.js';

const ACCENT = '#8B8FE6';
const LIGHT_SURFACE = '#ffffff';

interface BuilderRow {
  profile: UserProfile;
  templateCount: number;
  upvoteTotal: number;
}

export function BuildersView({ searchQuery }: { searchQuery: string }) {
  const navigate = useNavigate();
  const templateService = useTemplates();
  const [builders, setBuilders] = useState<BuilderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const all = await templateService.listTemplates({});
        const byAuthor = new Map<string, { templateCount: number; upvoteTotal: number }>();
        for (const t of all) {
          if (t.authorType !== 'community' || !t.authorId) continue;
          const agg = byAuthor.get(t.authorId) ?? { templateCount: 0, upvoteTotal: 0 };
          agg.templateCount += 1;
          agg.upvoteTotal += t.upvoteCount ?? 0;
          byAuthor.set(t.authorId, agg);
        }
        const profiles = await getProfilesByUserIds([...byAuthor.keys()]);
        if (cancelled) return;
        const rows: BuilderRow[] = [];
        for (const [userId, agg] of byAuthor) {
          const profile = profiles.get(userId);
          if (profile) rows.push({ profile, ...agg });
        }
        rows.sort((a, b) =>
          b.upvoteTotal - a.upvoteTotal ||
          b.templateCount - a.templateCount ||
          (a.profile.displayName || a.profile.handle).localeCompare(b.profile.displayName || b.profile.handle));
        setBuilders(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load builders');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [templateService]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return builders;
    return builders.filter(({ profile }) =>
      (profile.displayName ?? '').toLowerCase().includes(q) ||
      profile.handle.toLowerCase().includes(q) ||
      (profile.bio ?? '').toLowerCase().includes(q));
  }, [builders, searchQuery]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280', fontSize: '14px' }}>Loading builders…</div>;
  }
  if (error) {
    return <div style={{ textAlign: 'center', padding: '60px 0', color: '#dc2626', fontSize: '14px' }}>{error}</div>;
  }
  if (filtered.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: '#6b7280', fontSize: '14px', lineHeight: 1.7 }}>
        {searchQuery.trim()
          ? 'No builders match your search.'
          : 'No builders yet — publish a template from your project\'s Export menu to appear here.'}
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      gap: '16px',
    }}>
      {filtered.map(({ profile, templateCount, upvoteTotal }) => (
        <div
          key={profile.handle}
          onClick={() => navigate(`/u/${profile.handle}`)}
          title={`See everything ${profile.displayName || `@${profile.handle}`} has shared`}
          style={{
            backgroundColor: LIGHT_SURFACE,
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            padding: '18px 20px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            gap: '14px',
            alignItems: 'flex-start',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(139, 143, 230, 0.45)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.08)';
            e.currentTarget.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#e5e7eb';
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt=""
              style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <span style={{
              width: '48px', height: '48px', borderRadius: '50%', flexShrink: 0,
              backgroundColor: 'rgba(139, 143, 230, 0.15)', color: ACCENT,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', fontWeight: 700,
            }}>
              {(profile.displayName || profile.handle).charAt(0).toUpperCase()}
            </span>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: '15px', fontWeight: 700, color: '#1f2937',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {profile.displayName || `@${profile.handle}`}
            </div>
            <div style={{ fontSize: '12px', color: ACCENT, fontWeight: 600, marginBottom: '6px' }}>
              @{profile.handle}
            </div>
            {profile.bio && (
              <p style={{
                fontSize: '12.5px', color: '#6b7280', lineHeight: 1.5, margin: '0 0 8px',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {profile.bio}
              </p>
            )}
            <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500 }}>
              {templateCount} template{templateCount === 1 ? '' : 's'} · {upvoteTotal} upvote{upvoteTotal === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
