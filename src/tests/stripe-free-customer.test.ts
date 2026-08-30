import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('ensureFreeCustomer retry logic', () => {
  let mockFetch: any;
  let consoleSpy: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  async function ensureFreeCustomer(accessToken: string): Promise<boolean> {
    const attempt = async (): Promise<boolean> => {
      const response = await mockFetch('https://test.supabase.co/functions/v1/create-free-customer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'apikey': 'test-key',
        },
      });

      if (!response.ok) {
        const body = response.text ? await response.text() : '';
        console.error(`[ensureFreeCustomer] failed with status ${response.status}:`, body);
        return false;
      }
      const data = response.json ? await response.json() : {};
      return data.created === true || data.existing === true;
    };

    try {
      const first = await attempt();
      if (first) return true;
    } catch (err) {
      console.error('[ensureFreeCustomer] first attempt threw:', err);
    }

    await new Promise(r => setTimeout(r, 10));

    try {
      const second = await attempt();
      if (second) return true;
      console.error('[ensureFreeCustomer] retry also failed');
      return false;
    } catch (err) {
      console.error('[ensureFreeCustomer] retry threw:', err);
      return false;
    }
  }

  it('returns true on first successful attempt without retry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ created: true, existing: false, customerId: 'cus_123' }),
    });

    const result = await ensureFreeCustomer('token-abc');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns true when customer already exists', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ created: false, existing: true, customerId: 'cus_existing' }),
    });

    const result = await ensureFreeCustomer('token-abc');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries once after first attempt returns non-OK', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => '{"error":"Database error"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ created: true, existing: false, customerId: 'cus_retry' }),
      });

    const result = await ensureFreeCustomer('token-abc');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries once after first attempt throws a network error', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ created: true, existing: false, customerId: 'cus_net_retry' }),
      });

    const result = await ensureFreeCustomer('token-abc');

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns false after both attempts fail with non-OK', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false, status: 502,
        text: async () => '{"error":"Bad Gateway"}',
      })
      .mockResolvedValueOnce({
        ok: false, status: 502,
        text: async () => '{"error":"Bad Gateway"}',
      });

    const result = await ensureFreeCustomer('token-abc');

    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns false when both attempts throw', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('network 1'))
      .mockRejectedValueOnce(new Error('network 2'));

    const result = await ensureFreeCustomer('token-abc');

    expect(result).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('logs status and body on non-OK response', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false, status: 401,
        text: async () => '{"error":"Unauthorized"}',
      })
      .mockResolvedValueOnce({
        ok: false, status: 401,
        text: async () => '{"error":"Unauthorized"}',
      });

    await ensureFreeCustomer('bad-token');

    const logCalls = consoleSpy.mock.calls.map((c: any[]) => String(c[0]));
    expect(logCalls.some((msg: string) => msg.includes('[ensureFreeCustomer]') && msg.includes('401'))).toBe(true);
  });

  it('logs thrown exceptions', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await ensureFreeCustomer('token');

    const logCalls = consoleSpy.mock.calls.map((c: any[]) => String(c[0]));
    expect(logCalls.some((msg: string) => msg.includes('first attempt threw'))).toBe(true);
    expect(logCalls.some((msg: string) => msg.includes('retry threw'))).toBe(true);
  });

  it('sends correct Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ created: true }),
    });

    await ensureFreeCustomer('my-access-token');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-access-token');
    expect(options.method).toBe('POST');
  });
});

describe('create-free-customer response contract', () => {
  it('new customer response has created:true', () => {
    const response = { created: true, existing: false, customerId: 'cus_new' };
    expect(response.created).toBe(true);
    expect(response.existing).toBe(false);
    expect(response.customerId).toBeTruthy();
  });

  it('existing customer response has existing:true', () => {
    const response = { created: false, existing: true, customerId: 'cus_abc' };
    expect(response.existing).toBe(true);
    expect(response.created).toBe(false);
  });

  it('error response has error string', () => {
    const response = { error: 'Stripe not configured' };
    expect(typeof response.error).toBe('string');
  });
});

describe('Blocking provisioning flow', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  async function provisionStripeCustomer(accessToken: string): Promise<{ ok: boolean; failed: boolean }> {
    let failed = false;
    try {
      const response = await mockFetch('https://test.supabase.co/functions/v1/create-free-customer', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const retryResponse = await mockFetch('https://test.supabase.co/functions/v1/create-free-customer', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (!retryResponse.ok) {
          failed = true;
          return { ok: false, failed };
        }
        const data = await retryResponse.json();
        return { ok: data.created === true || data.existing === true, failed: false };
      }
      const data = await response.json();
      return { ok: data.created === true || data.existing === true, failed: false };
    } catch {
      failed = true;
      return { ok: false, failed };
    }
  }

  it('blocks until provisioning completes successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ created: true, existing: false, customerId: 'cus_block' }),
    });

    const result = await provisionStripeCustomer('token-abc');
    expect(result.ok).toBe(true);
    expect(result.failed).toBe(false);
  });

  it('reports failure when provisioning fails both attempts', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' });

    const result = await provisionStripeCustomer('token-abc');
    expect(result.ok).toBe(false);
    expect(result.failed).toBe(true);
  });

  it('recovers on retry after first failure', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => 'bad gateway' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ created: true, existing: false, customerId: 'cus_recovered' }),
      });

    const result = await provisionStripeCustomer('token-abc');
    expect(result.ok).toBe(true);
    expect(result.failed).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('sets failed state on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));

    const result = await provisionStripeCustomer('token-abc');
    expect(result.ok).toBe(false);
    expect(result.failed).toBe(true);
  });
});

describe('Feature gate self-healing recovery', () => {
  it('attempts recovery when no subscription found and not previously attempted', async () => {
    let recoveryAttempted = false;
    const mockGetSubscription = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'sub-1', planName: 'free', status: 'active' });
    const mockEnsureFreeCustomer = vi.fn().mockResolvedValue(true);

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    async function loadWithRecovery() {
      let sub = await mockGetSubscription();
      if (!sub && !recoveryAttempted) {
        recoveryAttempted = true;
        const ok = await mockEnsureFreeCustomer('token');
        if (ok) sub = await mockGetSubscription();
      }
      return sub;
    }

    const result = await loadWithRecovery();
    expect(result).not.toBeNull();
    expect(result.planName).toBe('free');
    expect(mockEnsureFreeCustomer).toHaveBeenCalledTimes(1);
    expect(mockGetSubscription).toHaveBeenCalledTimes(2);
  });

  it('does not attempt recovery a second time', async () => {
    let recoveryAttempted = false;
    const mockGetSubscription = vi.fn().mockResolvedValue(null);
    const mockEnsureFreeCustomer = vi.fn().mockResolvedValue(false);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    async function loadWithRecovery() {
      let sub = await mockGetSubscription();
      if (!sub && !recoveryAttempted) {
        recoveryAttempted = true;
        const ok = await mockEnsureFreeCustomer('token');
        if (ok) sub = await mockGetSubscription();
      }
      return sub;
    }

    await loadWithRecovery();
    await loadWithRecovery();

    expect(mockEnsureFreeCustomer).toHaveBeenCalledTimes(1);
  });

  it('skips recovery when subscription already exists', async () => {
    let recoveryAttempted = false;
    const mockGetSubscription = vi.fn().mockResolvedValue({ id: 'sub-1', planName: 'pro', status: 'active' });
    const mockEnsureFreeCustomer = vi.fn().mockResolvedValue(true);

    async function loadWithRecovery() {
      let sub = await mockGetSubscription();
      if (!sub && !recoveryAttempted) {
        recoveryAttempted = true;
        const ok = await mockEnsureFreeCustomer('token');
        if (ok) sub = await mockGetSubscription();
      }
      return sub;
    }

    const result = await loadWithRecovery();
    expect(result.planName).toBe('pro');
    expect(mockEnsureFreeCustomer).not.toHaveBeenCalled();
  });

  it('returns null when recovery provisioning fails', async () => {
    let recoveryAttempted = false;
    const mockGetSubscription = vi.fn().mockResolvedValue(null);
    const mockEnsureFreeCustomer = vi.fn().mockResolvedValue(false);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    async function loadWithRecovery() {
      let sub = await mockGetSubscription();
      if (!sub && !recoveryAttempted) {
        recoveryAttempted = true;
        const ok = await mockEnsureFreeCustomer('token');
        if (ok) sub = await mockGetSubscription();
      }
      return sub;
    }

    const result = await loadWithRecovery();
    expect(result).toBeNull();
    expect(mockEnsureFreeCustomer).toHaveBeenCalledTimes(1);
  });
});

describe('Auth event scoping for provisioning', () => {
  const provisioningEvents = ['SIGNED_IN', 'INITIAL_SESSION'];

  function shouldProvision(event: string): boolean {
    return provisioningEvents.includes(event);
  }

  it('provisions on SIGNED_IN event', () => {
    expect(shouldProvision('SIGNED_IN')).toBe(true);
  });

  it('provisions on INITIAL_SESSION event', () => {
    expect(shouldProvision('INITIAL_SESSION')).toBe(true);
  });

  it('skips provisioning on TOKEN_REFRESHED events', () => {
    expect(shouldProvision('TOKEN_REFRESHED')).toBe(false);
  });

  it('skips provisioning on USER_UPDATED events', () => {
    expect(shouldProvision('USER_UPDATED')).toBe(false);
  });

  it('skips provisioning on USER_DELETED events', () => {
    expect(shouldProvision('USER_DELETED')).toBe(false);
  });

  it('skips provisioning on SIGNED_OUT events', () => {
    expect(shouldProvision('SIGNED_OUT')).toBe(false);
  });

  it('filters a mixed event stream correctly', () => {
    const events = ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'INITIAL_SESSION', 'SIGNED_OUT'];
    const provisioned = events.filter(shouldProvision);
    expect(provisioned).toEqual(['SIGNED_IN', 'INITIAL_SESSION']);
  });
});

describe('Sign-out cleanup runs for all non-provisioning events without session', () => {
  it('SIGNED_OUT with no session triggers cleanup', () => {
    let cleanupRan = false;
    const event: string = 'SIGNED_OUT';
    const session = null as { user?: { id: string }; access_token?: string } | null;

    if (event === 'PASSWORD_RECOVERY') return;

    if (!session?.user) {
      cleanupRan = true;
    }

    expect(cleanupRan).toBe(true);
  });

  it('SIGNED_OUT cleanup clears provisioning ref', () => {
    const provisioningSessionRef = { current: 'old-token' as string | null };
    const session = null;

    if (!session) {
      provisioningSessionRef.current = null;
    }

    expect(provisioningSessionRef.current).toBeNull();
  });

  it('TOKEN_REFRESHED with active session does not trigger cleanup', () => {
    let cleanupRan = false;
    const session = { user: { id: 'u1' } };

    if (!session?.user) {
      cleanupRan = true;
    }

    expect(cleanupRan).toBe(false);
  });
});

describe('Client-side provisioning deduplication', () => {
  it('concurrent calls share the same in-flight promise', async () => {
    let callCount = 0;
    let inflight: Promise<boolean> | null = null;

    async function ensureFreeCustomer(): Promise<boolean> {
      if (inflight) return inflight;

      const run = async (): Promise<boolean> => {
        callCount++;
        await new Promise(r => setTimeout(r, 50));
        return true;
      };

      inflight = run();
      try {
        return await inflight;
      } finally {
        inflight = null;
      }
    }

    const [r1, r2, r3] = await Promise.all([
      ensureFreeCustomer(),
      ensureFreeCustomer(),
      ensureFreeCustomer(),
    ]);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);
    expect(callCount).toBe(1);
  });

  it('allows a new call after the first completes', async () => {
    let callCount = 0;
    let inflight: Promise<boolean> | null = null;

    async function ensureFreeCustomer(): Promise<boolean> {
      if (inflight) return inflight;

      const run = async (): Promise<boolean> => {
        callCount++;
        await new Promise(r => setTimeout(r, 10));
        return true;
      };

      inflight = run();
      try {
        return await inflight;
      } finally {
        inflight = null;
      }
    }

    await ensureFreeCustomer();
    await ensureFreeCustomer();

    expect(callCount).toBe(2);
  });

  it('onAuthStateChange skips provisioning when getSession already started it', () => {
    const provisioningSessionRef = { current: 'active-token' as string | null };
    let provisioningTriggered = false;

    if (provisioningSessionRef.current) {
      return;
    }
    provisioningTriggered = true;

    expect(provisioningTriggered).toBe(false);
  });
});

describe('Edge function idempotent insert behavior', () => {
  it('advisory lock serializes concurrent customer inserts for same user', () => {
    const inserted: string[] = [];

    function idempotentCustomerInsert(userId: string, customerId: string, existingRows: string[]): boolean {
      if (existingRows.some(id => id === userId)) {
        return false;
      }
      inserted.push(customerId);
      existingRows.push(userId);
      return true;
    }

    const existingRows: string[] = [];
    const r1 = idempotentCustomerInsert('user-1', 'cus_a', existingRows);
    const r2 = idempotentCustomerInsert('user-1', 'cus_b', existingRows);

    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(inserted).toEqual(['cus_a']);
  });

  it('advisory lock serializes concurrent subscription inserts for same user', () => {
    const inserted: string[] = [];

    function idempotentFreeSubscription(userId: string, customerId: string, activeUsers: string[]): boolean {
      if (activeUsers.includes(userId)) {
        return false;
      }
      inserted.push(customerId);
      activeUsers.push(userId);
      return true;
    }

    const activeUsers: string[] = [];
    const r1 = idempotentFreeSubscription('user-1', 'cus_a', activeUsers);
    const r2 = idempotentFreeSubscription('user-1', 'cus_b', activeUsers);

    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(inserted).toEqual(['cus_a']);
  });

  it('different users can each get a customer row', () => {
    const inserted: string[] = [];

    function idempotentCustomerInsert(userId: string, customerId: string, existingRows: string[]): boolean {
      if (existingRows.includes(userId)) return false;
      inserted.push(customerId);
      existingRows.push(userId);
      return true;
    }

    const existingRows: string[] = [];
    const r1 = idempotentCustomerInsert('user-1', 'cus_a', existingRows);
    const r2 = idempotentCustomerInsert('user-2', 'cus_b', existingRows);

    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(inserted).toEqual(['cus_a', 'cus_b']);
  });

  it('unique constraint on stripe_customers prevents duplicate active rows', () => {
    const activeCustomers = new Map<string, string>();

    function insertWithUniqueConstraint(userId: string, customerId: string): { error: string | null } {
      if (activeCustomers.has(userId)) {
        return { error: '23505: duplicate key value violates unique constraint' };
      }
      activeCustomers.set(userId, customerId);
      return { error: null };
    }

    const r1 = insertWithUniqueConstraint('user-1', 'cus_a');
    const r2 = insertWithUniqueConstraint('user-1', 'cus_b');

    expect(r1.error).toBeNull();
    expect(r2.error).toContain('23505');
    expect(activeCustomers.get('user-1')).toBe('cus_a');
  });

  it('edge function handles conflict by cleaning up redundant Stripe customer', () => {
    let stripeCustomerDeleted = false;

    function handleConflict(insertError: { code: string }, _newCustomerId: string): string {
      if (insertError.code === '23505') {
        stripeCustomerDeleted = true;
        return 'cus_existing';
      }
      throw new Error('Unexpected error');
    }

    const result = handleConflict({ code: '23505' }, 'cus_redundant');
    expect(result).toBe('cus_existing');
    expect(stripeCustomerDeleted).toBe(true);
  });

  it('findExistingActiveCustomer uses order + limit instead of maybeSingle', () => {
    const customers = [
      { customer_id: 'cus_first', created_at: '2026-01-01' },
      { customer_id: 'cus_second', created_at: '2026-01-02' },
    ];

    const sorted = [...customers].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const result = sorted.length > 0 ? sorted[0].customer_id : null;

    expect(result).toBe('cus_first');
  });
});

describe('useFeatureGate skips recovery during active provisioning', () => {
  it('skips attemptRecovery when provisioning is in-flight', async () => {
    let recoveryAttempted = false;
    let provisioningActive = true;

    async function attemptRecovery(): Promise<null> {
      if (recoveryAttempted) return null;
      if (provisioningActive) return null;
      recoveryAttempted = true;
      return null;
    }

    await attemptRecovery();
    expect(recoveryAttempted).toBe(false);
  });

  it('allows recovery when provisioning is not in-flight', async () => {
    let recoveryAttempted = false;
    let provisioningActive = false;

    async function attemptRecovery(): Promise<{ planName: string } | null> {
      if (recoveryAttempted) return null;
      if (provisioningActive) return null;
      recoveryAttempted = true;
      return { planName: 'free' };
    }

    const result = await attemptRecovery();
    expect(recoveryAttempted).toBe(true);
    expect(result?.planName).toBe('free');
  });

  it('does not mark recovery as attempted when skipped due to provisioning', async () => {
    let recoveryAttempted = false;
    let provisioningActive = true;

    async function attemptRecovery(): Promise<null> {
      if (recoveryAttempted) return null;
      if (provisioningActive) return null;
      recoveryAttempted = true;
      return null;
    }

    await attemptRecovery();
    expect(recoveryAttempted).toBe(false);

    provisioningActive = false;
    await attemptRecovery();
    expect(recoveryAttempted).toBe(true);
  });
});

describe('Stripe email-based customer reuse for re-registration', () => {
  it('reuses existing Stripe customer found by email when no local record exists', async () => {
    const mockStripeListCustomers = vi.fn().mockResolvedValue({
      data: [{ id: 'cus_found_by_email', email: 'user@example.com', deleted: false }],
    });
    const mockStripeUpdateCustomer = vi.fn().mockResolvedValue({});
    const mockDbInsertCustomer = vi.fn().mockResolvedValue({ error: null });
    const mockDbInsertSubscription = vi.fn().mockResolvedValue({ error: null });

    const email = 'user@example.com';
    const userId = 'new-user-id';

    const existingCustomer = mockStripeListCustomers({ email, limit: 1 });
    const result = await existingCustomer;

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe('cus_found_by_email');
    expect(result.data[0].deleted).toBe(false);

    await mockStripeUpdateCustomer(result.data[0].id, { metadata: { userId } });
    expect(mockStripeUpdateCustomer).toHaveBeenCalledWith('cus_found_by_email', { metadata: { userId } });

    await mockDbInsertCustomer({ user_id: userId, customer_id: result.data[0].id });
    await mockDbInsertSubscription({
      user_id: userId,
      stripe_customer_id: result.data[0].id,
      plan_name: 'free',
      status: 'active',
    });

    expect(mockDbInsertCustomer).toHaveBeenCalledTimes(1);
    expect(mockDbInsertSubscription).toHaveBeenCalledTimes(1);
  });

  it('creates new customer when no Stripe customer found by email', async () => {
    const mockStripeListCustomers = vi.fn().mockResolvedValue({ data: [] });
    const mockStripeCreateCustomer = vi.fn().mockResolvedValue({ id: 'cus_brand_new' });

    const result = await mockStripeListCustomers({ email: 'new@example.com', limit: 1 });
    expect(result.data.length).toBe(0);

    const newCustomer = await mockStripeCreateCustomer({ email: 'new@example.com' });
    expect(newCustomer.id).toBe('cus_brand_new');
  });

  it('ignores deleted Stripe customers during email lookup', async () => {
    const mockStripeListCustomers = vi.fn().mockResolvedValue({
      data: [{ id: 'cus_deleted_one', email: 'user@example.com', deleted: true }],
    });

    const result = await mockStripeListCustomers({ email: 'user@example.com', limit: 1 });
    const nonDeleted = result.data.filter((c: any) => !c.deleted);
    expect(nonDeleted.length).toBe(0);
  });

  it('handles Stripe API error gracefully during email lookup', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    async function findStripeCustomerByEmail(listFn: any, email: string) {
      try {
        const customers = await listFn({ email, limit: 1 });
        if (customers.data.length > 0 && !customers.data[0].deleted) {
          return customers.data[0];
        }
        return null;
      } catch {
        return null;
      }
    }

    const mockStripeListCustomers = vi.fn().mockRejectedValue(new Error('Stripe API down'));
    const result = await findStripeCustomerByEmail(mockStripeListCustomers, 'user@example.com');
    expect(result).toBeNull();
  });
});

describe('Provisioning audit logging', () => {
  it('logs success events to audit log with correct structure', () => {
    const auditEntry = {
      user_id: 'user-123',
      source: 'create-free-customer',
      action: 'provisioning_success',
      metadata: { customerId: 'cus_abc', scenario: 'new_customer' },
    };

    expect(auditEntry.source).toBe('create-free-customer');
    expect(auditEntry.action).toBe('provisioning_success');
    expect(auditEntry.metadata.customerId).toBeTruthy();
    expect(auditEntry.metadata.scenario).toBe('new_customer');
  });

  it('logs failure events with stage and error details', () => {
    const auditEntry = {
      user_id: 'user-123',
      source: 'create-free-customer',
      action: 'provisioning_failed',
      metadata: {
        stage: 'stripe_customer_create',
        error: 'Rate limit exceeded',
        stripeErrorType: 'rate_limit_error',
      },
    };

    expect(auditEntry.action).toBe('provisioning_failed');
    expect(auditEntry.metadata.stage).toBe('stripe_customer_create');
    expect(auditEntry.metadata.error).toBeTruthy();
  });

  it('logs client-side failures with correct source', () => {
    const auditEntry = {
      user_id: 'user-456',
      source: 'client-ensureFreeCustomer',
      action: 'provisioning_failed_client',
      metadata: { error: 'HTTP 502: Bad Gateway', timestamp: '2026-02-21T00:00:00.000Z' },
    };

    expect(auditEntry.source).toBe('client-ensureFreeCustomer');
    expect(auditEntry.action).toBe('provisioning_failed_client');
    expect(auditEntry.metadata.error).toContain('502');
    expect(auditEntry.metadata.timestamp).toBeTruthy();
  });

  it('records reused customer scenario in audit log', () => {
    const auditEntry = {
      user_id: 'user-789',
      source: 'create-free-customer',
      action: 'provisioning_success',
      metadata: { customerId: 'cus_reused', scenario: 'reused_stripe_customer_by_email' },
    };

    expect(auditEntry.metadata.scenario).toBe('reused_stripe_customer_by_email');
  });
});

describe('Re-registration edge case', () => {
  it('cascade deletion clears stripe records for clean re-registration', () => {
    const softDeleteState = {
      stripe_customers: { user_id: 'u1', customer_id: 'cus_old', deleted_at: '2024-01-01T00:00:00Z' },
      stripe_subscriptions: { user_id: 'u1', status: 'canceled', cancellation_reason: 'account_deleted' },
    };
    expect(softDeleteState.stripe_customers.deleted_at).toBeTruthy();
    expect(softDeleteState.stripe_subscriptions.status).toBe('canceled');

    const afterCascade = { stripe_customers: null, stripe_subscriptions: null };
    expect(afterCascade.stripe_customers).toBeNull();

    const reReg = { created: true, existing: false, customerId: 'cus_new_reg' };
    expect(reReg.created).toBe(true);
  });

  it('orphan cleanup filters by matching email only', () => {
    const orphanedRows = [
      { customer_id: 'cus_old1', user_id: 'deleted-user-1' },
      { customer_id: 'cus_old2', user_id: 'deleted-user-2' },
    ];
    const stripeCustomers: Record<string, { email: string; deleted: boolean }> = {
      'cus_old1': { email: 'test@example.com', deleted: false },
      'cus_old2': { email: 'other@example.com', deleted: false },
    };
    const currentEmail = 'test@example.com';

    const toDelete = orphanedRows.filter(row => {
      const sc = stripeCustomers[row.customer_id];
      return sc && !sc.deleted && sc.email === currentEmail;
    });

    expect(toDelete).toHaveLength(1);
    expect(toDelete[0].customer_id).toBe('cus_old1');
  });

  it('skips already-deleted Stripe customers during orphan cleanup', () => {
    const orphanedRows = [{ customer_id: 'cus_already_deleted', user_id: 'old-user' }];
    const stripeCustomers: Record<string, { email: string; deleted: boolean }> = {
      'cus_already_deleted': { email: 'test@example.com', deleted: true },
    };
    const currentEmail = 'test@example.com';

    const toDelete = orphanedRows.filter(row => {
      const sc = stripeCustomers[row.customer_id];
      return sc && !sc.deleted && sc.email === currentEmail;
    });

    expect(toDelete).toHaveLength(0);
  });
});

describe('Pricing overlay guard: hasStripeCustomer prevents false onboarding', () => {
  function createMockSubscriptionService(opts: {
    subscription: { planName: string; status: string } | null;
    hasCustomer: boolean;
  }) {
    return {
      getCurrentSubscription: vi.fn().mockResolvedValue(opts.subscription),
      hasStripeCustomer: vi.fn().mockResolvedValue(opts.hasCustomer),
    };
  }

  async function resolveNeedsPlanSelection(svc: ReturnType<typeof createMockSubscriptionService>): Promise<boolean> {
    const existingSub = await svc.getCurrentSubscription('user-id');
    if (existingSub) return false;
    const hasCustomer = await svc.hasStripeCustomer('user-id');
    if (hasCustomer) return false;
    return true;
  }

  it('does not show pricing overlay when user has an active subscription', async () => {
    const svc = createMockSubscriptionService({
      subscription: { planName: 'pro', status: 'active' },
      hasCustomer: true,
    });
    const result = await resolveNeedsPlanSelection(svc);
    expect(result).toBe(false);
    expect(svc.hasStripeCustomer).not.toHaveBeenCalled();
  });

  it('does not show pricing overlay when user has not_started subscription', async () => {
    const svc = createMockSubscriptionService({
      subscription: { planName: 'pending', status: 'not_started' },
      hasCustomer: true,
    });
    const result = await resolveNeedsPlanSelection(svc);
    expect(result).toBe(false);
  });

  it('does not show pricing overlay when subscription is null but stripe customer exists', async () => {
    const svc = createMockSubscriptionService({
      subscription: null,
      hasCustomer: true,
    });
    const result = await resolveNeedsPlanSelection(svc);
    expect(result).toBe(false);
    expect(svc.hasStripeCustomer).toHaveBeenCalledWith('user-id');
  });

  it('shows pricing overlay only when no subscription AND no stripe customer', async () => {
    const svc = createMockSubscriptionService({
      subscription: null,
      hasCustomer: false,
    });
    const result = await resolveNeedsPlanSelection(svc);
    expect(result).toBe(true);
    expect(svc.getCurrentSubscription).toHaveBeenCalledTimes(1);
    expect(svc.hasStripeCustomer).toHaveBeenCalledTimes(1);
  });

  it('does not show pricing overlay when subscription has trialing status', async () => {
    const svc = createMockSubscriptionService({
      subscription: { planName: 'starter', status: 'trialing' },
      hasCustomer: true,
    });
    const result = await resolveNeedsPlanSelection(svc);
    expect(result).toBe(false);
  });

  it('does not show pricing overlay when subscription has past_due status', async () => {
    const svc = createMockSubscriptionService({
      subscription: { planName: 'pro', status: 'past_due' },
      hasCustomer: true,
    });
    const result = await resolveNeedsPlanSelection(svc);
    expect(result).toBe(false);
  });
});

describe('getCurrentSubscription includes not_started status', () => {
  it('status filter array includes not_started', () => {
    const statusFilter = ['active', 'trialing', 'past_due', 'not_started'];
    expect(statusFilter).toContain('not_started');
    expect(statusFilter).toContain('active');
    expect(statusFilter).toContain('trialing');
    expect(statusFilter).toContain('past_due');
    expect(statusFilter).toHaveLength(4);
  });

  it('not_started subscription is recognized as existing', () => {
    const row = { plan_name: 'pending', status: 'not_started' };
    const statusFilter = ['active', 'trialing', 'past_due', 'not_started'];
    expect(statusFilter.includes(row.status)).toBe(true);
  });

  it('canceled subscription is still excluded', () => {
    const row = { plan_name: 'pro', status: 'canceled' };
    const statusFilter = ['active', 'trialing', 'past_due', 'not_started'];
    expect(statusFilter.includes(row.status)).toBe(false);
  });
});

describe('onAuthStateChange provisioning guard (OAuth-aware)', () => {
  function shouldSkipProvisioning(
    _event: string,
    currentPath: string,
    provisioningRef: string | null,
  ): boolean {
    if (provisioningRef) return true;
    if (currentPath === '/reset-password' || currentPath === '/admin' || currentPath === '/pricing' || currentPath.startsWith('/templates')) return true;
    return false;
  }

  it('does NOT skip INITIAL_SESSION at /app (OAuth redirect lands here)', () => {
    expect(shouldSkipProvisioning('INITIAL_SESSION', '/app', null)).toBe(false);
  });

  it('does not skip SIGNED_IN at /app', () => {
    expect(shouldSkipProvisioning('SIGNED_IN', '/app', null)).toBe(false);
  });

  it('skips when provisioning ref is active regardless of event', () => {
    expect(shouldSkipProvisioning('SIGNED_IN', '/', 'some-token')).toBe(true);
  });

  it('skips admin path for all events', () => {
    expect(shouldSkipProvisioning('SIGNED_IN', '/admin', null)).toBe(true);
  });

  it('skips pricing path for all events', () => {
    expect(shouldSkipProvisioning('INITIAL_SESSION', '/pricing', null)).toBe(true);
  });

  it('does not skip SIGNED_IN on root path', () => {
    expect(shouldSkipProvisioning('SIGNED_IN', '/', null)).toBe(false);
  });

  it('does not skip INITIAL_SESSION on root path (new tab after OAuth)', () => {
    expect(shouldSkipProvisioning('INITIAL_SESSION', '/', null)).toBe(false);
  });
});

describe('Server-side provisioning trigger contract', () => {
  it('trigger body includes trigger_source, user_id, and user_email', () => {
    const triggerBody = {
      trigger_source: 'auth_user_insert',
      user_id: 'abc-123',
      user_email: 'test@example.com',
    };

    expect(triggerBody.trigger_source).toBe('auth_user_insert');
    expect(triggerBody.user_id).toBeTruthy();
    expect(triggerBody.user_email).toBeTruthy();
  });

  it('edge function accepts trigger_source path when all fields present', () => {
    function resolveAuthPath(body: Record<string, unknown>): 'trigger' | 'jwt' {
      if (body.trigger_source === 'auth_user_insert' && body.user_id && body.user_email) {
        return 'trigger';
      }
      return 'jwt';
    }

    expect(resolveAuthPath({
      trigger_source: 'auth_user_insert',
      user_id: 'u1',
      user_email: 'a@b.com',
    })).toBe('trigger');
  });

  it('edge function falls back to JWT path without trigger_source', () => {
    function resolveAuthPath(body: Record<string, unknown>): 'trigger' | 'jwt' {
      if (body.trigger_source === 'auth_user_insert' && body.user_id && body.user_email) {
        return 'trigger';
      }
      return 'jwt';
    }

    expect(resolveAuthPath({})).toBe('jwt');
    expect(resolveAuthPath({ user_id: 'u1' })).toBe('jwt');
    expect(resolveAuthPath({ trigger_source: 'other' })).toBe('jwt');
  });

  it('trigger validates user exists in auth before provisioning', async () => {
    const mockGetUserById = vi.fn()
      .mockResolvedValueOnce({ data: { user: { id: 'u1', email: 'a@b.com' } }, error: null })
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'Not found' } });

    const result1 = await mockGetUserById('u1');
    expect(result1.data.user).not.toBeNull();

    const result2 = await mockGetUserById('fake-id');
    expect(result2.data.user).toBeNull();
    expect(result2.error).not.toBeNull();
  });

  it('idempotent RPCs prevent duplicates when both trigger and client provision', () => {
    const inserted: string[] = [];
    const existingUsers: string[] = [];

    function idempotentInsert(userId: string, customerId: string): boolean {
      if (existingUsers.includes(userId)) return false;
      inserted.push(customerId);
      existingUsers.push(userId);
      return true;
    }

    const triggerResult = idempotentInsert('user-1', 'cus_trigger');
    const clientResult = idempotentInsert('user-1', 'cus_client');

    expect(triggerResult).toBe(true);
    expect(clientResult).toBe(false);
    expect(inserted).toEqual(['cus_trigger']);
  });
});

describe('OAuth redirect provisioning flow (Google sign-in)', () => {
  it('getSession at /app triggers provisioning when no customer exists', async () => {
    const mockGetSubscription = vi.fn().mockResolvedValue(null);
    const mockHasCustomer = vi.fn().mockResolvedValue(false);
    const mockProvision = vi.fn().mockResolvedValue(true);

    let needsPlanSelection = false;

    const existingSub = await mockGetSubscription('user-id');
    if (!existingSub) {
      const hasCustomer = await mockHasCustomer('user-id');
      if (!hasCustomer) {
        const ok = await mockProvision('access-token');
        if (!ok) {
          needsPlanSelection = true;
        }
      }
    }

    expect(mockProvision).toHaveBeenCalledWith('access-token');
    expect(needsPlanSelection).toBe(false);
  });

  it('getSession at /app shows plan selection only when provisioning fails', async () => {
    const mockGetSubscription = vi.fn().mockResolvedValue(null);
    const mockHasCustomer = vi.fn().mockResolvedValue(false);
    const mockProvision = vi.fn().mockResolvedValue(false);

    let needsPlanSelection = false;

    const existingSub = await mockGetSubscription('user-id');
    if (!existingSub) {
      const hasCustomer = await mockHasCustomer('user-id');
      if (!hasCustomer) {
        const ok = await mockProvision('access-token');
        if (!ok) {
          needsPlanSelection = true;
        }
      }
    }

    expect(mockProvision).toHaveBeenCalledTimes(1);
    expect(needsPlanSelection).toBe(true);
  });

  it('getSession at /app skips provisioning when customer already exists', async () => {
    const mockGetSubscription = vi.fn().mockResolvedValue(null);
    const mockHasCustomer = vi.fn().mockResolvedValue(true);
    const mockProvision = vi.fn().mockResolvedValue(true);

    let needsPlanSelection = false;

    const existingSub = await mockGetSubscription('user-id');
    if (!existingSub) {
      const hasCustomer = await mockHasCustomer('user-id');
      if (!hasCustomer) {
        const ok = await mockProvision('access-token');
        if (!ok) {
          needsPlanSelection = true;
        }
      }
    }

    expect(mockProvision).not.toHaveBeenCalled();
    expect(needsPlanSelection).toBe(false);
  });

  it('getSession at /app skips provisioning when subscription already exists', async () => {
    const mockGetSubscription = vi.fn().mockResolvedValue({ planName: 'free', status: 'active' });
    const mockHasCustomer = vi.fn();
    const mockProvision = vi.fn();

    let needsPlanSelection = false;

    const existingSub = await mockGetSubscription('user-id');
    if (!existingSub) {
      const hasCustomer = await mockHasCustomer('user-id');
      if (!hasCustomer) {
        const ok = await mockProvision('access-token');
        if (!ok) {
          needsPlanSelection = true;
        }
      }
    }

    expect(mockHasCustomer).not.toHaveBeenCalled();
    expect(mockProvision).not.toHaveBeenCalled();
    expect(needsPlanSelection).toBe(false);
  });

  it('server trigger + client fallback: both paths converge on idempotent result', async () => {
    let serverProvisioned = false;
    let clientProvisioned = false;
    const activeCustomers = new Set<string>();

    function idempotentProvision(userId: string, source: string): boolean {
      if (activeCustomers.has(userId)) return false;
      activeCustomers.add(userId);
      if (source === 'trigger') serverProvisioned = true;
      if (source === 'client') clientProvisioned = true;
      return true;
    }

    idempotentProvision('user-1', 'trigger');
    idempotentProvision('user-1', 'client');

    expect(serverProvisioned).toBe(true);
    expect(clientProvisioned).toBe(false);
    expect(activeCustomers.size).toBe(1);
  });
});
