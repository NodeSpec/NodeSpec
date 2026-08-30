// Template comments (hosted edition). Mounted by TemplateDetailPage as a
// sibling BELOW TemplateDetail — that component carries heavy source-text
// contract tests, so the comments surface deliberately lives outside it.
//
// Flat, newest-first, paginated. Writes go straight through PostgREST —
// RLS is the gate (own-row insert/update, own-or-admin delete). Author
// display resolves through user_profiles (the only client-readable author
// source) with a generic fallback for absent/private profiles.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import { getProfilesByUserIds, type UserProfile } from '../../services/ProfileService.js';
import type { User } from '@supabase/supabase-js';

const ACCENT = '#8B8FE6';
const PAGE_SIZE = 20;
const MAX_BODY = 4000;

interface CommentRow {
  id: string;
  template_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function TemplateComments({ templateId, user }: { templateId: string; user: User | null }) {
  const navigate = useNavigate();
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, UserProfile>>(new Map());
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mergeProfiles = useCallback(async (rows: CommentRow[]) => {
    const missing = [...new Set(rows.map((r) => r.user_id))];
    if (missing.length === 0) return;
    const fetched = await getProfilesByUserIds(missing);
    setProfiles((prev) => {
      const next = new Map(prev);
      for (const [id, profile] of fetched) next.set(id, profile);
      return next;
    });
  }, []);

  const loadPage = useCallback(async (offset: number) => {
    const supabase = getSupabaseClient();
    const { data, count, error: loadError } = await supabase
      .from('template_comments')
      .select('*', { count: 'exact' })
      .eq('template_id', templateId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (loadError) throw new Error(loadError.message);
    const rows = (data ?? []) as CommentRow[];
    setTotal(count ?? 0);
    setComments((prev) => (offset === 0 ? rows : [...prev, ...rows]));
    void mergeProfiles(rows);
  }, [templateId, mergeProfiles]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadPage(0)
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadPage]);

  const handlePost = useCallback(async () => {
    if (!user) { navigate('/?signup=templates'); return; }
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error: insertError } = await supabase
        .from('template_comments')
        .insert({ template_id: templateId, user_id: user.id, body })
        .select('*')
        .single();
      if (insertError) throw new Error(insertError.message);
      const row = data as CommentRow;
      setComments((prev) => [row, ...prev]);
      setTotal((t) => t + 1);
      setDraft('');
      void mergeProfiles([row]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post the comment.');
    } finally {
      setPosting(false);
    }
  }, [user, draft, templateId, navigate, mergeProfiles]);

  const handleSaveEdit = useCallback(async (commentId: string) => {
    const body = editDraft.trim();
    if (!body) return;
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error: updateError } = await supabase
        .from('template_comments')
        .update({ body })
        .eq('id', commentId)
        .select('*')
        .single();
      if (updateError) throw new Error(updateError.message);
      setComments((prev) => prev.map((c) => (c.id === commentId ? (data as CommentRow) : c)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the edit.');
    }
  }, [editDraft]);

  const handleDelete = useCallback(async (commentId: string) => {
    if (!window.confirm('Delete this comment?')) return;
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { error: deleteError } = await supabase
        .from('template_comments')
        .delete()
        .eq('id', commentId);
      if (deleteError) throw new Error(deleteError.message);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setTotal((t) => Math.max(t - 1, 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the comment.');
    }
  }, []);

  return (
    <section style={{ marginTop: '40px' }}>
      <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#1f2937', margin: '0 0 16px' }}>
        Comments{total > 0 ? ` (${total})` : ''}
      </h2>

      <div style={{
        padding: '16px', borderRadius: '12px', backgroundColor: '#ffffff',
        border: '1px solid rgba(139, 143, 230, 0.15)', marginBottom: '20px',
      }}>
        {user ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={MAX_BODY}
              rows={3}
              placeholder="Share feedback or ask the author a question…"
              style={{
                width: '100%', padding: '10px 12px', fontSize: '13.5px',
                border: '1px solid rgba(139, 143, 230, 0.25)', borderRadius: '8px',
                resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                color: '#1f2937', backgroundColor: '#fafbfc',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                onClick={() => void handlePost()}
                disabled={posting || draft.trim().length === 0}
                style={{
                  padding: '8px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '8px',
                  border: 'none', backgroundColor: ACCENT, color: '#ffffff',
                  cursor: posting ? 'wait' : 'pointer',
                  opacity: posting || draft.trim().length === 0 ? 0.6 : 1,
                }}
              >
                {posting ? 'Posting…' : 'Post comment'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: '13.5px', color: '#6b7280' }}>
            <span
              onClick={() => navigate('/?signup=templates')}
              style={{ color: ACCENT, fontWeight: 600, cursor: 'pointer' }}
            >
              Sign in
            </span>{' '}
            to comment.
          </div>
        )}
      </div>

      {error && (
        <div style={{ fontSize: '12.5px', color: '#dc2626', marginBottom: '12px' }}>{error}</div>
      )}

      {loading ? (
        <div style={{ fontSize: '13px', color: '#6b7280' }}>Loading comments…</div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: '13.5px', color: '#6b7280' }}>
          No comments yet. Be the first to share feedback.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {comments.map((comment) => {
            const profile = profiles.get(comment.user_id) ?? null;
            const isOwn = user !== null && user.id === comment.user_id;
            const edited = comment.updated_at > comment.created_at;
            const authorLabel = profile
              ? profile.displayName || `@${profile.handle}`
              : 'Community member';
            return (
              <div
                key={comment.id}
                style={{
                  padding: '14px 16px', borderRadius: '12px', backgroundColor: '#ffffff',
                  border: '1px solid rgba(139, 143, 230, 0.12)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  {profile?.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt=""
                      style={{ width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{
                      width: '26px', height: '26px', borderRadius: '50%',
                      backgroundColor: 'rgba(139, 143, 230, 0.15)', color: ACCENT,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 700,
                    }}>
                      {authorLabel.replace('@', '').charAt(0).toUpperCase()}
                    </span>
                  )}
                  {profile ? (
                    <span
                      onClick={() => navigate(`/u/${profile.handle}`)}
                      style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937', cursor: 'pointer' }}
                    >
                      {authorLabel}
                    </span>
                  ) : (
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937' }}>
                      {authorLabel}
                    </span>
                  )}
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                    {formatWhen(comment.created_at)}{edited ? ' · edited' : ''}
                  </span>
                  {isOwn && editingId !== comment.id && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => { setEditingId(comment.id); setEditDraft(comment.body); }}
                        style={{
                          background: 'none', border: 'none', padding: 0,
                          fontSize: '12px', color: '#6b7280', cursor: 'pointer', fontWeight: 500,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(comment.id)}
                        style={{
                          background: 'none', border: 'none', padding: 0,
                          fontSize: '12px', color: '#dc2626', cursor: 'pointer', fontWeight: 500,
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
                {editingId === comment.id ? (
                  <div>
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      maxLength={MAX_BODY}
                      rows={3}
                      style={{
                        width: '100%', padding: '8px 10px', fontSize: '13.5px',
                        border: '1px solid rgba(139, 143, 230, 0.25)', borderRadius: '8px',
                        resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                        color: '#1f2937',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                      <button
                        onClick={() => setEditingId(null)}
                        style={{
                          padding: '5px 12px', fontSize: '12px', fontWeight: 500, borderRadius: '6px',
                          border: '1px solid rgba(139, 143, 230, 0.25)', backgroundColor: 'transparent',
                          color: '#6b7280', cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleSaveEdit(comment.id)}
                        disabled={editDraft.trim().length === 0}
                        style={{
                          padding: '5px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
                          border: 'none', backgroundColor: ACCENT, color: '#ffffff', cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{
                    fontSize: '13.5px', color: '#374151', lineHeight: 1.55,
                    margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
                  }}>
                    {comment.body}
                  </p>
                )}
              </div>
            );
          })}
          {comments.length < total && (
            <button
              onClick={() => void loadPage(comments.length)}
              style={{
                alignSelf: 'center', padding: '8px 20px', fontSize: '13px', fontWeight: 600,
                borderRadius: '8px', border: '1px solid rgba(139, 143, 230, 0.3)',
                backgroundColor: 'transparent', color: ACCENT, cursor: 'pointer',
              }}
            >
              Load more ({total - comments.length} remaining)
            </button>
          )}
        </div>
      )}
    </section>
  );
}
