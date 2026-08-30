import type { SupabaseClient, User, Session, AuthChangeEvent } from '@supabase/supabase-js';

export interface AuthSession {
  user: User;
  session: Session;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignUpCredentials {
  email: string;
  password: string;
}

export type OAuthProvider = 'google';

export class AuthService {
  constructor(private supabase: SupabaseClient) {}

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) {
      console.error('[AuthService] Failed to get session:', error);
      return null;
    }
    if (!data.session) {
      console.warn('[AuthService] No session found in storage');
      return null;
    }

    const expiresAt = data.session.expires_at;
    const now = Math.floor(Date.now() / 1000);
    const isExpired = expiresAt ? expiresAt < now : false;
    const isExpiringSoon = expiresAt ? (expiresAt - now) < 300 : false;

    console.log('[AuthService] Session retrieved:', {
      userId: data.session.user.id,
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : 'N/A',
      isExpired,
      isExpiringSoon,
      secondsUntilExpiry: expiresAt ? expiresAt - now : 0,
    });

    if (isExpired || isExpiringSoon) {
      console.warn('[AuthService] Token expired or expiring soon, refreshing...');
      return await this.refreshSession();
    }

    return {
      user: data.session.user,
      session: data.session,
    };
  }

  async refreshSession(): Promise<AuthSession | null> {
    console.log('[AuthService] Refreshing session...');
    const { data, error } = await this.supabase.auth.refreshSession();

    if (error) {
      console.error('[AuthService] Failed to refresh session:', error);
      return null;
    }

    if (!data.session) {
      console.warn('[AuthService] No session after refresh');
      return null;
    }

    console.log('[AuthService] Session refreshed successfully:', {
      userId: data.session.user.id,
      expiresAt: data.session.expires_at
        ? new Date(data.session.expires_at * 1000).toISOString()
        : 'N/A',
    });

    return {
      user: data.session.user,
      session: data.session,
    };
  }

  async getUser(): Promise<{ user: User; session: Session } | null> {
    console.log('[AuthService] Validating user token...');
    const { data, error } = await this.supabase.auth.getUser();

    if (error) {
      console.error('[AuthService] Failed to validate user:', error);
      return null;
    }

    if (!data.user) {
      console.warn('[AuthService] No user found');
      return null;
    }

    const sessionData = await this.supabase.auth.getSession();
    if (!sessionData.data.session) {
      console.error('[AuthService] User valid but no session');
      return null;
    }

    console.log('[AuthService] User validated:', {
      userId: data.user.id,
      email: data.user.email,
    });

    return {
      user: data.user,
      session: sessionData.data.session,
    };
  }

  async signIn(credentials: SignInCredentials): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.signInWithPassword(credentials);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  async signUp(credentials: SignUpCredentials): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.signUp(credentials);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  async getMfaStatus(): Promise<{ currentLevel: string; nextLevel: string } | null> {
    const { data, error } = await this.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return null;
    return { currentLevel: data.currentLevel ?? 'aal1', nextLevel: data.nextLevel ?? 'aal1' };
  }

  async listMfaFactors(): Promise<{ id: string; type: string; status: string }[]> {
    const { data, error } = await this.supabase.auth.mfa.listFactors();
    if (error || !data) return [];
    return data.totp.map(f => ({ id: f.id, type: f.factor_type, status: f.status }));
  }

  async enrollMfa(friendlyName?: string): Promise<{ factorId: string; qrCode: string; secret: string } | { error: string }> {
    const { data, error } = await this.supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName,
    });
    if (error) return { error: error.message };
    return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  }

  async createMfaChallenge(factorId: string): Promise<{ challengeId: string } | { error: string }> {
    const { data, error } = await this.supabase.auth.mfa.challenge({ factorId });
    if (error) return { error: error.message };
    return { challengeId: data.id };
  }

  async verifyMfaChallenge(factorId: string, challengeId: string, code: string): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.mfa.verify({ factorId, challengeId, code });
    if (error) return { success: false, error: error.message };
    return { success: true };
  }

  async signInWithOAuth(
    provider: OAuthProvider,
    redirectTo?: string
  ): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectTo || `${window.location.origin}/app`,
      },
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  async signOut(): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.signOut();
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  async sendPasswordReset(email: string, redirectTo?: string): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || `${window.location.origin}/reset-password`,
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  }

  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void
  ): { unsubscribe: () => void } {
    const { data: { subscription } } = this.supabase.auth.onAuthStateChange(callback);
    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  }
}
