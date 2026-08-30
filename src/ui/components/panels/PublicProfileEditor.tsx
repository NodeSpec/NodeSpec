// Public-profile editor tab inside AccountPanel (hosted edition only).
//
// First open lazily provisions the profile row, seeding handle/name/photo
// from OAuth metadata (Google) — email/password users start with a derived
// handle and no photo. The avatar uploads to the user's single canonical
// storage object; everything else is a plain user_profiles update.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { getSupabaseClient } from '../../../persistence/supabase/client.js';
import {
  ensureProfile,
  updateMyProfile,
  uploadAvatar,
  validateHandle,
  type UserProfile,
} from '../../services/ProfileService.js';

export function PublicProfileEditor({ userId }: { userId?: string }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [xUrl, setXUrl] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user || (userId && user.id !== userId)) { setLoading(false); return; }
        const loaded = await ensureProfile(user);
        if (cancelled || !loaded) { setLoading(false); return; }
        setProfile(loaded);
        setHandle(loaded.handle);
        setDisplayName(loaded.displayName ?? '');
        setBio(loaded.bio ?? '');
        setWebsiteUrl(loaded.websiteUrl ?? '');
        setGithubUrl(loaded.githubUrl ?? '');
        setXUrl(loaded.socials.x ?? '');
        setLinkedinUrl(loaded.socials.linkedin ?? '');
        setIsPublic(loaded.isPublic);
      } catch {
        // Leave the "could not load" state below.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const handleSave = useCallback(async () => {
    if (!profile) return;
    setMessage(null);
    const trimmedHandle = handle.trim().toLowerCase();
    const handleError = validateHandle(trimmedHandle);
    if (handleError) { setMessage({ kind: 'error', text: handleError }); return; }
    setSaving(true);
    try {
      const socials: Record<string, string> = {};
      if (xUrl.trim()) socials.x = xUrl.trim();
      if (linkedinUrl.trim()) socials.linkedin = linkedinUrl.trim();
      const updated = await updateMyProfile(profile.userId, {
        handle: trimmedHandle,
        displayName: displayName.trim() || null,
        bio: bio.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        githubUrl: githubUrl.trim() || null,
        socials,
        isPublic,
      });
      setProfile(updated);
      setHandle(updated.handle);
      setMessage({ kind: 'ok', text: 'Profile saved.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setSaving(false);
    }
  }, [profile, handle, displayName, bio, websiteUrl, githubUrl, xUrl, linkedinUrl, isPublic]);

  const handleAvatarFile = useCallback(async (file: File | undefined) => {
    if (!file || !profile) return;
    setMessage(null);
    setUploading(true);
    try {
      const url = await uploadAvatar(profile.userId, file);
      const updated = await updateMyProfile(profile.userId, { avatarUrl: url });
      setProfile(updated);
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setUploading(false);
    }
  }, [profile]);

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: '13px',
    border: `1px solid ${c.border}`, borderRadius: '8px',
    backgroundColor: c.background, color: c.text, boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '12px', fontWeight: 600,
    color: c.textSecondary, marginBottom: '5px',
  };

  if (loading) {
    return <div style={{ padding: '20px 0', fontSize: '13px', color: c.textMuted }}>Loading profile…</div>;
  }
  if (!profile) {
    return (
      <div style={{ padding: '20px 0', fontSize: '13px', color: c.textMuted, lineHeight: 1.5 }}>
        Could not load your public profile. Try reopening this panel.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {profile.avatarUrl ? (
          <img
            src={profile.avatarUrl}
            alt="Avatar"
            style={{
              width: '64px', height: '64px', borderRadius: '50%', objectFit: 'cover',
              border: `2px solid ${c.border}`,
            }}
          />
        ) : (
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            backgroundColor: c.background, border: `2px solid ${c.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', fontWeight: 700, color: c.textMuted,
          }}>
            {(displayName || handle || '?').charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              padding: '6px 14px', fontSize: '12px', fontWeight: 600, borderRadius: '6px',
              border: `1px solid ${c.border}`, backgroundColor: c.surface,
              color: c.text, cursor: uploading ? 'wait' : 'pointer',
            }}
          >
            {uploading ? 'Uploading…' : 'Change photo'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => void handleAvatarFile(e.target.files?.[0])}
          />
          <div style={{ fontSize: '11px', color: c.textMuted, marginTop: '6px' }}>
            PNG, JPEG, or WebP. Cropped square, max 2 MB.
          </div>
        </div>
      </div>

      <div>
        <label style={labelStyle}>Handle</label>
        <input value={handle} onChange={e => setHandle(e.target.value)} style={inputStyle} maxLength={30} />
        <div style={{ fontSize: '11px', color: c.textMuted, marginTop: '4px' }}>
          Your public page lives at nodespec.io/u/{handle.trim().toLowerCase() || 'your-handle'}
        </div>
      </div>
      <div>
        <label style={labelStyle}>Display name</label>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputStyle} maxLength={80} />
      </div>
      <div>
        <label style={labelStyle}>Bio</label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          rows={3}
          maxLength={500}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div>
          <label style={labelStyle}>Website</label>
          <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>GitHub</label>
          <input value={githubUrl} onChange={e => setGithubUrl(e.target.value)} placeholder="https://github.com/you" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>X</label>
          <input value={xUrl} onChange={e => setXUrl(e.target.value)} placeholder="https://x.com/you" style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>LinkedIn</label>
          <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/you" style={inputStyle} />
        </div>
      </div>

      <label style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '12.5px', color: c.text, cursor: 'pointer',
      }}>
        <input
          type="checkbox"
          checked={isPublic}
          onChange={() => setIsPublic(v => !v)}
          style={{ accentColor: c.primary }}
        />
        Profile is public (your templates stay visible either way)
      </label>

      {message && (
        <div style={{
          fontSize: '12px', lineHeight: 1.45,
          color: message.kind === 'ok' ? '#16a34a' : '#dc2626',
        }}>
          {message.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: '8px 18px', fontSize: '13px', fontWeight: 600, borderRadius: '8px',
            border: 'none', backgroundColor: c.primary, color: '#ffffff',
            cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        <a
          href={`/u/${profile.handle}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '12.5px', fontWeight: 600, color: c.primary, textDecoration: 'none' }}
        >
          View public page →
        </a>
      </div>
    </div>
  );
}
