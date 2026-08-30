import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

// Production fallback for the deployed Netlify build only. Dev builds must never
// reach production silently — a staging bench with a missing .env.local would
// otherwise read and write the live customer database (task SB-0).
const PROD_FALLBACK: SupabaseConfig = {
  url: 'https://komnpkjlvgfworfbdrya.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvbW5wa2psdmdmd29yZmJkcnlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxNTQ1NzcsImV4cCI6MjA4MzczMDU3N30.JikiJZHHfWIOTsW9UcTY-mRLfXbv74bbyYOqRDVX_AY',
};

export function resolveSupabaseConfig(
  env: { url?: string; anonKey?: string } = {
    url: import.meta.env.VITE_SUPABASE_URL,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  },
  isDev: boolean = import.meta.env.DEV === true
): SupabaseConfig {
  if (env.url && env.anonKey) {
    return { url: env.url, anonKey: env.anonKey };
  }
  if (isDev) {
    throw new Error(
      'Missing VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY. Dev builds refuse to ' +
        'fall back to the production backend. Copy .env.example to .env.local and point it ' +
        'at your staging bench (see docs/STAGING_RUNBOOK.md), then restart `npm run dev`.'
    );
  }
  return PROD_FALLBACK;
}

export function initializeSupabase(config: SupabaseConfig): SupabaseClient {
  supabaseInstance = createClient(config.url, config.anonKey);
  return supabaseInstance;
}

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const { url, anonKey } = resolveSupabaseConfig();
    supabaseInstance = createClient(url, anonKey);
  }
  return supabaseInstance;
}

export function setSupabaseClient(client: SupabaseClient): void {
  supabaseInstance = client;
}

export function clearSupabaseClient(): void {
  supabaseInstance = null;
}

export async function callEdgeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown>,
  options?: { signal?: AbortSignal }
): Promise<T> {
  const supabase = getSupabaseClient();
  const { url: supabaseUrl, anonKey } = resolveSupabaseConfig();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Not authenticated. Please sign in again.');
  }

  const makeRequest = async (token: string) => {
    return fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey,
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  };

  let response = await makeRequest(session.access_token);

  if (response.status === 401) {
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    if (!refreshed) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Session expired. Please sign in again.');
      }
      const { data: { session: revalidated } } = await supabase.auth.getSession();
      if (!revalidated) {
        throw new Error('Session expired. Please sign in again.');
      }
      response = await makeRequest(revalidated.access_token);
    } else {
      response = await makeRequest(refreshed.access_token);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Edge function ${functionName} failed: ${errorText}`);
  }

  return response.json() as Promise<T>;
}
