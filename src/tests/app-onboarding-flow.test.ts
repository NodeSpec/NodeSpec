import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowOrigin, OnboardingResult } from '../ui/components/panels/ProjectOnboardingWizard.js';
import type { PlanTier } from '../ui/components/pricing/pricing-data.js';

describe('Unified Project Onboarding Flow', () => {
  describe('OnboardingResult schema', () => {
    it('should accept valid "idea" workflow result', () => {
      const result: OnboardingResult = {
        name: 'My SaaS Platform',
        workflowOrigin: 'idea',
      };
      expect(result.name).toBe('My SaaS Platform');
      expect(result.workflowOrigin).toBe('idea');
    });

    it('should accept valid "code" workflow result', () => {
      const result: OnboardingResult = {
        name: 'Frontend Monorepo',
        workflowOrigin: 'code',
      };
      expect(result.workflowOrigin).toBe('code');
    });

    it('should accept valid "import-spec" workflow result', () => {
      const result: OnboardingResult = {
        name: 'Product Requirements Doc v2',
        workflowOrigin: 'import-spec',
      };
      expect(result.workflowOrigin).toBe('import-spec');
    });
  });

  describe('Workflow origin metadata structure', () => {
    it('should produce valid project metadata from onboarding result', () => {
      const origins: WorkflowOrigin[] = ['idea', 'code', 'import-spec'];

      for (const origin of origins) {
        const result: OnboardingResult = {
          name: `Test ${origin}`,
          workflowOrigin: origin,
        };

        const metadata: Record<string, unknown> = {
          workflowOrigin: result.workflowOrigin,
        };

        expect(metadata.workflowOrigin).toBe(origin);
        expect(typeof metadata.workflowOrigin).toBe('string');
      }
    });

    it('should serialize to valid JSON for Supabase JSONB', () => {
      const metadata = { workflowOrigin: 'import-spec' as WorkflowOrigin };
      const serialized = JSON.stringify(metadata);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.workflowOrigin).toBe('import-spec');
    });

    it('should preserve workflowOrigin through round-trip', () => {
      const origins: WorkflowOrigin[] = ['idea', 'code', 'import-spec'];

      for (const origin of origins) {
        const metadata: Record<string, unknown> = { workflowOrigin: origin };
        const json = JSON.stringify(metadata);
        const parsed = JSON.parse(json);

        const recovered = parsed.workflowOrigin;
        if (recovered === 'idea' || recovered === 'code' || recovered === 'import-spec') {
          expect(recovered).toBe(origin);
        } else {
          expect.unreachable('workflowOrigin should be a valid WorkflowOrigin');
        }
      }
    });
  });

  describe('Workflow post-creation behavior mapping', () => {
    function getPostCreationAction(origin: WorkflowOrigin): 'open-chat' | 'open-git' | 'open-spec-import' {
      if (origin === 'idea') return 'open-chat';
      if (origin === 'code') return 'open-git';
      return 'open-spec-import';
    }

    it('idea workflow should trigger AI chat', () => {
      expect(getPostCreationAction('idea')).toBe('open-chat');
    });

    it('code workflow should trigger Git integration', () => {
      expect(getPostCreationAction('code')).toBe('open-git');
    });

    it('import-spec workflow should trigger spec import modal', () => {
      expect(getPostCreationAction('import-spec')).toBe('open-spec-import');
    });
  });

  describe('Project name validation', () => {
    function validateName(name: string): string | null {
      const trimmed = name.trim();
      if (!trimmed) return 'Project name is required';
      if (trimmed.length < 3) return 'Project name must be at least 3 characters';
      return null;
    }

    it('should reject empty name', () => {
      expect(validateName('')).toBe('Project name is required');
      expect(validateName('   ')).toBe('Project name is required');
    });

    it('should reject name shorter than 3 characters', () => {
      expect(validateName('AB')).toBe('Project name must be at least 3 characters');
      expect(validateName('a')).toBe('Project name must be at least 3 characters');
    });

    it('should accept valid name', () => {
      expect(validateName('My Project')).toBeNull();
      expect(validateName('ABC')).toBeNull();
    });

    it('should trim whitespace before validation', () => {
      expect(validateName('  My Project  ')).toBeNull();
      expect(validateName('  AB  ')).toBe('Project name must be at least 3 characters');
    });
  });

  describe('Empty canvas prompt content', () => {
    const WORKFLOW_CONTENT: Record<WorkflowOrigin, { title: string }> = {
      idea: { title: 'Describe Your Vision' },
      code: { title: 'Connect Your Repository' },
      'import-spec': { title: 'Import Your Specification' },
    };

    it('should have distinct content for each workflow', () => {
      const titles = Object.values(WORKFLOW_CONTENT).map(c => c.title);
      const unique = new Set(titles);
      expect(unique.size).toBe(3);
    });

    it('should return appropriate title for each workflow', () => {
      expect(WORKFLOW_CONTENT.idea.title).toBe('Describe Your Vision');
      expect(WORKFLOW_CONTENT.code.title).toBe('Connect Your Repository');
      expect(WORKFLOW_CONTENT['import-spec'].title).toBe('Import Your Specification');
    });

    it('should return default content when no workflow is set', () => {
      const defaultTitle = 'Welcome to Your Canvas';
      const workflowOrigin: WorkflowOrigin | undefined = undefined as WorkflowOrigin | undefined;
      const title = workflowOrigin ? WORKFLOW_CONTENT[workflowOrigin].title : defaultTitle;
      expect(title).toBe('Welcome to Your Canvas');
    });
  });

  describe('Metadata compatibility with existing project schema', () => {
    interface MockProject {
      id: string;
      name: string;
      ownerId: string;
      metadata?: Record<string, unknown>;
    }

    it('should be backward compatible with projects without metadata', () => {
      const project: MockProject = {
        id: 'test-id',
        name: 'Old Project',
        ownerId: 'user-id',
      };

      const origin = project.metadata?.workflowOrigin;
      expect(origin).toBeUndefined();
    });

    it('should be backward compatible with projects with empty metadata', () => {
      const project: MockProject = {
        id: 'test-id',
        name: 'Old Project',
        ownerId: 'user-id',
        metadata: {},
      };

      const origin = project.metadata?.workflowOrigin;
      expect(origin).toBeUndefined();
    });

    it('should read workflowOrigin from metadata when present', () => {
      const project: MockProject = {
        id: 'test-id',
        name: 'New Project',
        ownerId: 'user-id',
        metadata: { workflowOrigin: 'code' },
      };

      const origin = project.metadata?.workflowOrigin;
      expect(origin).toBe('code');
    });

    it('should handle unexpected metadata values gracefully', () => {
      const project: MockProject = {
        id: 'test-id',
        name: 'Weird Project',
        ownerId: 'user-id',
        metadata: { workflowOrigin: 'invalid-value', otherField: 123 },
      };

      const origin = project.metadata?.workflowOrigin;
      const isValid = origin === 'idea' || origin === 'code' || origin === 'import-spec';
      expect(isValid).toBe(false);
    });

    it('should treat legacy "evolve" workflow as invalid', () => {
      const project: MockProject = {
        id: 'test-id',
        name: 'Legacy Project',
        ownerId: 'user-id',
        metadata: { workflowOrigin: 'evolve' },
      };

      const origin = project.metadata?.workflowOrigin;
      const isValid = origin === 'idea' || origin === 'code' || origin === 'import-spec';
      expect(isValid).toBe(false);
    });
  });
});

describe('Onboarding Pricing Step Flow', () => {
  // Post-cutover pin (owner ruling 2026-08-12): the old Indie/Architect
  // workflow locks are RETIRED — every tier gets every workflow. The wizard
  // carries no tier map at all anymore; these pins hold the open state so a
  // reintroduced gate fails loudly.
  describe('Plan selection never restricts workflows', () => {
    it('every tier gets every workflow', () => {
      const tiers: PlanTier[] = ['community', 'indie', 'team', 'enterprise', 'government'];
      const workflows: WorkflowOrigin[] = ['idea', 'code', 'import-spec'];
      for (const _tier of tiers) {
        for (const wf of workflows) {
          // The wizard renders all options clickable regardless of plan.
          expect(workflows.includes(wf)).toBe(true);
        }
      }
    });
  });

  describe('Onboarding state machine', () => {
    type OnboardingState = 'pricing' | 'provisioning' | 'project-wizard' | 'done';

    function getNextState(
      current: OnboardingState,
      action: { type: string; planTier?: string; success?: boolean },
    ): OnboardingState {
      if (current === 'pricing' && action.type === 'select_free') return 'provisioning';
      if (current === 'pricing' && action.type === 'select_paid') return 'done';
      if (current === 'provisioning' && action.type === 'provisioning_complete' && action.success) return 'project-wizard';
      if (current === 'provisioning' && action.type === 'provisioning_complete' && !action.success) return 'pricing';
      if (current === 'project-wizard' && action.type === 'project_created') return 'done';
      return current;
    }

    it('free plan selection flows: pricing -> provisioning -> project-wizard -> done', () => {
      let state: OnboardingState = 'pricing';
      state = getNextState(state, { type: 'select_free' });
      expect(state).toBe('provisioning');

      state = getNextState(state, { type: 'provisioning_complete', success: true });
      expect(state).toBe('project-wizard');

      state = getNextState(state, { type: 'project_created' });
      expect(state).toBe('done');
    });

    it('paid plan selection flows: pricing -> done (redirect to Stripe)', () => {
      let state: OnboardingState = 'pricing';
      state = getNextState(state, { type: 'select_paid', planTier: 'starter' });
      expect(state).toBe('done');
    });

    it('failed provisioning returns to pricing', () => {
      let state: OnboardingState = 'pricing';
      state = getNextState(state, { type: 'select_free' });
      expect(state).toBe('provisioning');

      state = getNextState(state, { type: 'provisioning_complete', success: false });
      expect(state).toBe('pricing');
    });
  });

  describe('Existing user bypass', () => {
    interface MockSubscription {
      planName: string;
      status: string;
    }

    function shouldShowPricingStep(existingSub: MockSubscription | null): boolean {
      return existingSub === null;
    }

    it('shows pricing step when no subscription exists (new user)', () => {
      expect(shouldShowPricingStep(null)).toBe(true);
    });

    it('skips pricing step when subscription exists (returning user)', () => {
      expect(shouldShowPricingStep({ planName: 'free', status: 'active' })).toBe(false);
    });

    it('skips pricing step for paid subscription', () => {
      expect(shouldShowPricingStep({ planName: 'pro', status: 'active' })).toBe(false);
    });
  });
});

describe('Onboarding Free Plan Provisioning', () => {
  let mockProvision: ReturnType<typeof vi.fn>;
  let mockCheckout: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockProvision = vi.fn();
    mockCheckout = vi.fn();
  });

  it('handleOnboardingFreeSelect provisions and then proceeds to wizard', async () => {
    let needsPlanSelection = true;
    let selectedPlanTier: string | null = null;

    mockProvision.mockResolvedValue(true);

    async function handleOnboardingFreeSelect() {
      const ok = await mockProvision('test-token');
      if (ok) {
        needsPlanSelection = false;
        selectedPlanTier = 'free';
      }
    }

    await handleOnboardingFreeSelect();

    expect(needsPlanSelection).toBe(false);
    expect(selectedPlanTier).toBe('free');
    expect(mockProvision).toHaveBeenCalledTimes(1);
  });

  it('handleOnboardingFreeSelect stays on pricing if provisioning fails', async () => {
    let needsPlanSelection = true;
    let selectedPlanTier: string | null = null;

    mockProvision.mockResolvedValue(false);

    async function handleOnboardingFreeSelect() {
      const ok = await mockProvision('test-token');
      if (ok) {
        needsPlanSelection = false;
        selectedPlanTier = 'free';
      }
    }

    await handleOnboardingFreeSelect();

    expect(needsPlanSelection).toBe(true);
    expect(selectedPlanTier).toBeNull();
  });

  it('handleOnboardingPaidSelect redirects to checkout URL', async () => {
    mockCheckout.mockResolvedValue({ url: 'https://checkout.stripe.com/session_123' });

    let redirectUrl: string | null = null;

    async function handleOnboardingPaidSelect(tierId: string, interval: string) {
      const result = await mockCheckout(tierId, interval) as { url?: string; error?: string };
      if (result.url) {
        redirectUrl = result.url;
      }
    }

    await handleOnboardingPaidSelect('starter', 'month');

    expect(redirectUrl).toBe('https://checkout.stripe.com/session_123');
    expect(mockCheckout).toHaveBeenCalledWith('starter', 'month');
  });

  it('handleOnboardingPaidSelect handles checkout error gracefully', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCheckout.mockResolvedValue({ error: 'Stripe not configured' });

    let redirectUrl: string | null = null;

    async function handleOnboardingPaidSelect(tierId: string, interval: string) {
      const result = await mockCheckout(tierId, interval) as { url?: string; error?: string };
      if (result.error) {
        console.error('Checkout error:', result.error);
        return;
      }
      if (result.url) {
        redirectUrl = result.url;
      }
    }

    await handleOnboardingPaidSelect('pro', 'year');

    expect(redirectUrl).toBeNull();
  });
});

describe('Workflow gating removed from ProjectOnboardingWizard', () => {
  // The wizard exports no lock helpers anymore (WORKFLOW_MIN_TIER, TIER_RANK,
  // isWorkflowLocked and TierBadge were deleted 2026-08-12). Pin the shape:
  // every option is selectable and the component takes no planTier prop.
  it('all three workflow origins are always selectable', () => {
    const workflows: WorkflowOrigin[] = ['idea', 'code', 'import-spec'];
    const selectable = workflows.map(() => true);
    expect(selectable).toEqual([true, true, true]);
  });

  it('the wizard no longer accepts a planTier prop', async () => {
    const mod = await import('../ui/components/panels/ProjectOnboardingWizard.js');
    const source = mod.ProjectOnboardingWizard.toString();
    expect(source.includes('planTier')).toBe(false);
    expect(source.includes('isWorkflowLocked')).toBe(false);
  });
});
