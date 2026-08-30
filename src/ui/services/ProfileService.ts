// Public author profiles (hosted-edition social round).
//
// user_profiles is the ONLY client-readable source of author identity —
// auth.users never leaves the server — so template pages and comments
// resolve display names/avatars through here and fall back to a generic
// label when a row is absent or private. Module functions over a class:
// every caller already reaches Supabase through getSupabaseClient() (house
// style for public pages), and there is no state to hold.
import { getSupabaseClient } from '../../persistence/supabase/client.js';
import type { User } from '@supabase/supabase-js';

export interface UserProfile {
  userId: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  githubUrl: string | null;
  socials: Record<string, string>;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileUpdate {
  handle?: string;
  displayName?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  websiteUrl?: string | null;
  githubUrl?: string | null;
  socials?: Record<string, string>;
  isPublic?: boolean;
}

// Client mirror of the user_profiles CHECK constraints (valid_handle +
// reserved_handle in 20260815130000) so the form can validate before the
// database rejects.
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/;
export const RESERVED_HANDLES = new Set([
  'admin', 'nodespec', 'official', 'api', 'app', 'templates', 'blog',
  'pricing', 'settings', 'support', 'u', 'www', 'root', 'moderator',
  'help', 'about', 'terms', 'privacy', 'docs', 'government',
]);

export function validateHandle(handle: string): string | null {
  if (!HANDLE_PATTERN.test(handle)) {
    return 'Handles are 3-30 characters: lowercase letters, numbers, and hyphens, starting with a letter or number.';
  }
  if (RESERVED_HANDLES.has(handle)) {
    return 'That handle is reserved.';
  }
  return null;
}

interface ProfileRow {
  user_id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  website_url: string | null;
  github_url: string | null;
  socials: Record<string, string> | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    userId: row.user_id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    websiteUrl: row.website_url,
    githubUrl: row.github_url,
    socials: row.socials ?? {},
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProfileByHandle(handle: string): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProfile(data as ProfileRow);
}

/** Batch author-attribution lookup; missing/private rows are simply absent. */
export async function getProfilesByUserIds(
  userIds: string[]
): Promise<Map<string, UserProfile>> {
  const map = new Map<string, UserProfile>();
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return map;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .in('user_id', unique);
  if (error || !data) return map;
  for (const row of data as ProfileRow[]) {
    map.set(row.user_id, rowToProfile(row));
  }
  return map;
}

export async function getMyProfile(userId: string): Promise<UserProfile | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProfile(data as ProfileRow);
}

export async function updateMyProfile(
  userId: string,
  updates: ProfileUpdate
): Promise<UserProfile> {
  const supabase = getSupabaseClient();
  const payload: Record<string, unknown> = {};
  if (updates.handle !== undefined) payload.handle = updates.handle;
  if (updates.displayName !== undefined) payload.display_name = updates.displayName;
  if (updates.bio !== undefined) payload.bio = updates.bio;
  if (updates.avatarUrl !== undefined) payload.avatar_url = updates.avatarUrl;
  if (updates.websiteUrl !== undefined) payload.website_url = updates.websiteUrl;
  if (updates.githubUrl !== undefined) payload.github_url = updates.githubUrl;
  if (updates.socials !== undefined) payload.socials = updates.socials;
  if (updates.isPublic !== undefined) payload.is_public = updates.isPublic;
  const { data, error } = await supabase
    .from('user_profiles')
    .update(payload)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That handle is already taken.');
    if (error.code === '23514') throw new Error('That handle is not allowed.');
    throw new Error(error.message);
  }
  return rowToProfile(data as ProfileRow);
}

/** `Jane Doe` / `jane.doe@x.com` → `jane-doe`; conforms to HANDLE_PATTERN. */
export function deriveHandleBase(user: Pick<User, 'email' | 'user_metadata'>): string {
  const source =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
    user.email?.split('@')[0] ||
    'builder';
  let base = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
    .replace(/-$/, '');
  if (base.length < 3) base = `${base}xyz`.slice(0, 3);
  if (RESERVED_HANDLES.has(base)) base = `${base}-1`;
  return base;
}

/**
 * Get-or-create the caller's profile, seeding handle/display name/avatar
 * from OAuth metadata (Google populates avatar_url + full_name; email
 * signups get the email local part and no photo). Handle collisions try
 * -2..-20 before giving up.
 */
export async function ensureProfile(user: User): Promise<UserProfile | null> {
  const existing = await getMyProfile(user.id);
  if (existing) return existing;

  const supabase = getSupabaseClient();
  const base = deriveHandleBase(user);
  const displayName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
    null;
  const avatarUrl =
    (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
    (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
    null;

  for (let attempt = 1; attempt <= 20; attempt++) {
    const handle = attempt === 1 ? base : `${base}-${attempt}`;
    const { data, error } = await supabase
      .from('user_profiles')
      .insert({
        user_id: user.id,
        handle,
        display_name: displayName,
        avatar_url: avatarUrl,
      })
      .select('*')
      .single();
    if (!error && data) return rowToProfile(data as ProfileRow);
    if (error?.code === '23505') {
      // Another user holds this handle — try the next suffix. A concurrent
      // self-insert also lands here; re-read resolves it.
      const raced = await getMyProfile(user.id);
      if (raced) return raced;
      continue;
    }
    return null; // CHECK violation or RLS problem — surface as "no profile"
  }
  return null;
}

const AVATAR_SIZE = 256;

/**
 * Downscale to a 256px center-cropped PNG and upsert the user's single
 * canonical object (avatars/<uid>/avatar.png). Returns a cache-busted
 * public URL to store on the profile.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE
  );
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('Could not process the image');

  const supabase = getSupabaseClient();
  const path = `${userId}/avatar.png`;
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, blob, { upsert: true, contentType: 'image/png' });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
