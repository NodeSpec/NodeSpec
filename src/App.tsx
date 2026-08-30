import { useState, useEffect, useRef, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GraphEditor } from './ui/index.js';
import { createBranchStore } from './ui/store/index.js';
import { getSupabaseClient } from './persistence/supabase/client.js';
import { AuthLandingPage, ResetPasswordPage } from './ui/components/auth/index.js';
import { PricingPage, OnboardingPricingStep } from './ui/components/pricing/index.js';
type BillingInterval = 'month' | 'year'; // legacy checkout lane for existing V1 subscribers
import { AdminDashboard } from './ui/components/admin/index.js';
import { TemplateMarketplacePage, TemplateDetailPage } from './ui/components/templates/index.js';
import { PublicProfilePage } from './ui/components/profile/PublicProfilePage.js';
import { isHostedEdition, hasTemplatesGallery, hasAdminPortal } from './ui/config/edition.js';
import { PrivacyPolicy, TermsOfService } from './ui/components/legal/index.js';
import { BlogPage, BlogPostPage } from './ui/components/blog/index.js';
import { MCPDocsPage } from './ui/components/docs/MCPDocsPage.js';
import { GovernmentPage } from './ui/components/government/index.js';
import { ServiceProvider } from './ui/context/index.js';
import { ProjectSwitchProvider } from './ui/context/ProjectSwitchContext.js';
import type { ProjectSwitchActions } from './ui/context/ProjectSwitchContext.js';
import { ErrorBoundary } from './ui/components/common/index.js';
import { StagingBanner } from './ui/components/common/StagingBanner.js';
import { DegradedCatalogBanner } from './ui/components/common/DegradedCatalogBanner.js';
import { ProjectOnboardingWizard } from './ui/components/panels/ProjectOnboardingWizard.js';
import { ThemeProvider } from './ui/theme/ThemeContext.js';
import { SubscriptionService } from './ui/services/SubscriptionService.js';
import { useAIAvailabilityProvider, AIAvailabilityContext } from './ui/hooks/useAIAvailability.js';
import { BYOKRequiredModal } from './ui/components/common/BYOKRequiredModal.js';
import type { User, Session } from '@supabase/supabase-js';
import type { AuthChangeEvent } from '@supabase/supabase-js';

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<ReturnType<typeof createBranchStore> | null>(null);
  const loadingDataRef = useRef(false);
  const [dataReady, setDataReady] = useState(false);
  const [isSwitchingProject, setIsSwitchingProject] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string | null>(null);
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [currentBranchName, setCurrentBranchName] = useState<string | null>(null);
  const [stripeProvisioningFailed, setStripeProvisioningFailed] = useState(false);
  const [stripeProvisioning, setStripeProvisioning] = useState(false);
  const [needsPlanSelection, setNeedsPlanSelection] = useState(false);
  const [oauthMfaFactorId, setOauthMfaFactorId] = useState<string | null>(null);
  const [mfaPending, setMfaPending] = useState(false);
  const provisioningSessionRef = useRef<string | null>(null);
  const navigate = useNavigate();

  const provisionStripeCustomer = async (accessToken: string): Promise<boolean> => {
    setStripeProvisioning(true);
    setStripeProvisioningFailed(false);
    provisioningSessionRef.current = accessToken;
    try {
      const svc = new SubscriptionService(getSupabaseClient());
      const ok = await svc.ensureFreeCustomer(accessToken);
      if (!ok) {
        console.error('[App] Stripe provisioning failed after retries');
        setStripeProvisioningFailed(true);
        return false;
      }
      setStripeProvisioningFailed(false);
      return true;
    } catch (err) {
      console.error('[App] Stripe provisioning threw:', err);
      setStripeProvisioningFailed(true);
      return false;
    } finally {
      setStripeProvisioning(false);
    }
  };

  const handleRetryProvisioning = async () => {
    const token = provisioningSessionRef.current;
    if (!token) return;
    const ok = await provisionStripeCustomer(token);
    if (ok) {
      navigate('/app', { replace: true });
    }
  };

  const handleOnboardingFreeSelect = async () => {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const ok = await provisionStripeCustomer(session.access_token);
    if (ok) {
      setNeedsPlanSelection(false);
    }
  };

  const handleOnboardingPaidSelect = async (tierId: string, billingInterval: BillingInterval) => {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const svc = new SubscriptionService(supabase);
    const result = await svc.createCheckoutSession(
      tierId,
      billingInterval as 'month' | 'year',
      session.access_token,
    );
    if ('error' in result) {
      console.error('[App] Checkout error:', result.error);
      return;
    }
    window.location.href = result.url;
  };

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase.auth.getSession().then(async ({ data: { session } }: { data: { session: Session | null } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        const currentPath = window.location.pathname;
        if (currentPath === '/reset-password') {
          setLoading(false);
          return;
        }

        const currentUserId = localStorage.getItem('specgraph_current_user');
        if (currentUserId && currentUserId !== session.user.id) {
              localStorage.removeItem('specgraph_current_project');
          localStorage.removeItem('specgraph_current_branch');
        }
        localStorage.setItem('specgraph_current_user', session.user.id);

        const savedProjectId = localStorage.getItem('specgraph_current_project');
        const savedBranchName = localStorage.getItem('specgraph_current_branch');
        loadUserData(session.user.id, savedProjectId || undefined, savedBranchName || undefined);
        if (currentPath === '/admin' || currentPath === '/pricing' || currentPath.startsWith('/templates') || currentPath.startsWith('/u/')) {
          // Leave these routes alone
        } else if (currentPath === '/app') {
          // The billing lane is HOSTED-only (owner ruling 2026-09-01: a fresh
          // community container doom-looped sign-in on "Account setup
          // encountered an issue" whenever the provisioning function's env was
          // imperfect). Self-hosted/community builds have no Stripe, no plan
          // selection, no provisioning — tiers come from the license
          // server-side, and Vite drops this whole branch from their bundles.
          if (isHostedEdition) {
            const svc = new SubscriptionService(getSupabaseClient());
            const existingSub = await svc.getCurrentSubscription(session.user.id);
            if (!existingSub) {
              const hasCustomer = await svc.hasStripeCustomer(session.user.id);
              if (!hasCustomer) {
                const ok = await provisionStripeCustomer(session.access_token);
                if (!ok) {
                  setNeedsPlanSelection(true);
                }
              }
            }
          }
        } else if (!isHostedEdition) {
          // Signed in on a self-hosted build: straight into the app — no
          // pending-plan handoff, no customer provisioning.
          navigate('/app', { replace: true });
        } else {
          let pendingPlan = localStorage.getItem('nodespec_pending_plan');
          let pendingInterval = localStorage.getItem('nodespec_pending_interval') || 'month';
          if (!pendingPlan) {
            const meta = session.user.user_metadata;
            if (meta?.pending_plan) {
              pendingPlan = meta.pending_plan;
              pendingInterval = meta.pending_interval || 'month';
              const sb = getSupabaseClient();
              sb.auth.updateUser({ data: { pending_plan: null, pending_interval: null } });
            }
          }
          if (pendingPlan) {
            localStorage.removeItem('nodespec_pending_plan');
            localStorage.removeItem('nodespec_pending_interval');
            navigate(`/pricing?plan=${pendingPlan}&interval=${pendingInterval}&auto=true`, { replace: true });
          } else {
            const svc = new SubscriptionService(getSupabaseClient());
            const existingSub = await svc.getCurrentSubscription(session.user.id);
            if (existingSub) {
              navigate('/app', { replace: true });
            } else {
              const hasCustomer = await svc.hasStripeCustomer(session.user.id);
              if (hasCustomer) {
                navigate('/app', { replace: true });
              } else {
                console.log('[App] No Stripe customer found on initial load, attempting client-side provisioning');
                const ok = await provisionStripeCustomer(session.access_token);
                if (ok) {
                  console.log('[App] Client-side provisioning succeeded on initial load');
                  navigate('/app', { replace: true });
                } else {
                  console.warn('[App] Client-side provisioning failed on initial load, showing plan selection');
                  setNeedsPlanSelection(true);
                  navigate('/app', { replace: true });
                }
              }
            }
          }
        }
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null);

      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', { replace: true });
        return;
      }

      if (!session?.user) {
        setStore(null);
        setDataReady(false);
        setCurrentProjectId(null);
        setCurrentProjectName(null);
        setCurrentBranchId(null);
        setCurrentBranchName(null);
        setStripeProvisioningFailed(false);
        setStripeProvisioning(false);
        setNeedsPlanSelection(false);
        provisioningSessionRef.current = null;
        localStorage.removeItem('specgraph_current_project');
        localStorage.removeItem('specgraph_current_branch');
        localStorage.removeItem('specgraph_current_user');

        const currentPath = window.location.pathname;
        if (currentPath === '/app') {
          navigate('/', { replace: true });
        }
        return;
      }

      const provisioningEvents: AuthChangeEvent[] = ['SIGNED_IN', 'INITIAL_SESSION'];
      if (!provisioningEvents.includes(event)) return;

      if (pendingMfaRef.current) return;
      if (provisioningSessionRef.current) return;

      const currentPath = window.location.pathname;
      if (currentPath === '/reset-password' || currentPath === '/admin' || currentPath === '/pricing' || currentPath.startsWith('/templates') || currentPath.startsWith('/u/')) return;

      (async () => {
        // AAL guard: check if MFA verification is needed (e.g., after OAuth redirect)
        const aalCheck = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (!aalCheck.error && aalCheck.data.nextLevel === 'aal2' && aalCheck.data.currentLevel === 'aal1') {
          const factorsCheck = await supabase.auth.mfa.listFactors();
          if (!factorsCheck.error && factorsCheck.data.totp.length > 0) {
            const verifiedFactor = factorsCheck.data.totp.find(f => f.status === 'verified');
            if (verifiedFactor) {
              setOauthMfaFactorId(verifiedFactor.id);
              return;
            }
          }
        }

        const currentUserId = localStorage.getItem('specgraph_current_user');
        if (currentUserId && currentUserId !== session.user.id) {
          localStorage.removeItem('specgraph_current_project');
          localStorage.removeItem('specgraph_current_branch');
        }
        localStorage.setItem('specgraph_current_user', session.user.id);

        const savedProjectId = localStorage.getItem('specgraph_current_project');
        const savedBranchName = localStorage.getItem('specgraph_current_branch');
        loadUserData(session.user.id, savedProjectId || undefined, savedBranchName || undefined);

        // Self-hosted builds skip the entire billing lane (see the mirror
        // gate in the getSession handler above).
        if (!isHostedEdition) {
          navigate('/app', { replace: true });
          return;
        }

        let pendingPlan = localStorage.getItem('nodespec_pending_plan');
        let pendingInterval = localStorage.getItem('nodespec_pending_interval') || 'month';
        if (!pendingPlan) {
          const meta = session.user.user_metadata;
          if (meta?.pending_plan) {
            pendingPlan = meta.pending_plan;
            pendingInterval = meta.pending_interval || 'month';
            const sb = getSupabaseClient();
            sb.auth.updateUser({ data: { pending_plan: null, pending_interval: null } });
          }
        }
        if (pendingPlan) {
          localStorage.removeItem('nodespec_pending_plan');
          localStorage.removeItem('nodespec_pending_interval');
          navigate(`/pricing?plan=${pendingPlan}&interval=${pendingInterval}&auto=true`, { replace: true });
        } else {
          const svc = new SubscriptionService(getSupabaseClient());
          const existingSub = await svc.getCurrentSubscription(session.user.id);
          if (existingSub) {
            navigate('/app', { replace: true });
          } else {
            const hasCustomer = await svc.hasStripeCustomer(session.user.id);
            if (hasCustomer) {
              navigate('/app', { replace: true });
            } else {
              console.log('[App] No Stripe customer found, attempting client-side provisioning');
              const ok = await provisionStripeCustomer(session.access_token);
              if (ok) {
                console.log('[App] Client-side provisioning succeeded');
                navigate('/app', { replace: true });
              } else {
                console.warn('[App] Client-side provisioning failed, showing plan selection');
                setNeedsPlanSelection(true);
                navigate('/app', { replace: true });
              }
            }
          }
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadUserData = async (userId: string, projectId?: string, branchName?: string) => {
    if (loadingDataRef.current) {
      return;
    }

    loadingDataRef.current = true;
    try {
      const supabase = getSupabaseClient();

      const { createSupabaseProjectRepository } = await import('./persistence/supabase/project-repository.js');
      const { createSupabaseBranchRepository } = await import('./persistence/supabase/branch-repository.js');
      const { createSupabaseGraphRepository } = await import('./persistence/supabase/graph-repository.js');

      const projectRepo = createSupabaseProjectRepository(supabase);
      const branchRepo = createSupabaseBranchRepository(supabase);
      const graphRepo = createSupabaseGraphRepository(supabase);

      let project;

      if (projectId) {
        const result = await projectRepo.getById(projectId);
        if (!result.success) {
          throw new Error(result.error.message);
        }
        project = result.data;

        if (!project) {
          localStorage.removeItem('specgraph_current_project');
          const listResult = await projectRepo.listByOwner(userId);
          if (!listResult.success) {
            throw new Error(listResult.error.message);
          }
          project = listResult.data[0] || null;
        }
      } else {
        const listResult = await projectRepo.listByOwner(userId);
        if (!listResult.success) {
          throw new Error(listResult.error.message);
        }
        project = listResult.data[0] || null;
      }

      if (!project) {
        setStore(null);
        setCurrentProjectId(null);
        setCurrentProjectName(null);
        setCurrentBranchId(null);
        setCurrentBranchName(null);
        localStorage.removeItem('specgraph_current_project');
        localStorage.removeItem('specgraph_current_branch');
        return;
      }

      setCurrentProjectId(project.id);
      setCurrentProjectName(project.name);
      localStorage.setItem('specgraph_current_project', project.id);

      const targetBranchName = branchName || 'main';

      const branchResult = await branchRepo.getByName(project.id, targetBranchName);
      if (!branchResult.success) {
        throw new Error(branchResult.error.message);
      }

      let branch = branchResult.data;

      if (!branch) {
        const allBranches = await branchRepo.listByProject(project.id);
        if (allBranches.success && allBranches.data.length > 0) {
          branch = allBranches.data[0];
        } else {
          await projectRepo.delete(project.id);
          localStorage.removeItem('specgraph_current_project');

          const listResult = await projectRepo.listByOwner(userId);
          if (listResult.success && listResult.data.length > 0) {
            return loadUserData(userId, listResult.data[0].id);
          }

          setStore(null);
          setCurrentProjectId(null);
          setCurrentProjectName(null);
          setCurrentBranchId(null);
          setCurrentBranchName(null);
          return;
        }
      }

      const snapshotResult = await graphRepo.loadSnapshot(branch.id);
      if (!snapshotResult.success) {
        throw new Error(snapshotResult.error.message);
      }

      if (!snapshotResult.data) {
        throw new Error('No snapshot found');
      }

      const graph = snapshotResult.data.graphData;
      setStore(createBranchStore(graph));
      setCurrentBranchId(branch.id);
      setCurrentBranchName(branch.name);
      localStorage.setItem('specgraph_current_branch', branch.name);
    } catch (error) {
      console.error('Failed to load user data:', error);
    } finally {
      loadingDataRef.current = false;
      setDataReady(true);
    }
  };

  const pendingMfaRef = useRef(false);

  const handleSignIn = async (email: string, password: string, captchaToken?: string): Promise<{ mfaRequired: boolean; factorId?: string } | void> => {
    const supabase = getSupabaseClient();
    pendingMfaRef.current = true;
    setMfaPending(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captchaToken ? { captchaToken } : undefined,
      });
      if (error) throw error;

      const { data: aalData, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) {
        pendingMfaRef.current = false;
        setMfaPending(false);
        throw aalError;
      }

      if (aalData.nextLevel === 'aal2' && aalData.currentLevel === 'aal1') {
        const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) {
          pendingMfaRef.current = false;
          setMfaPending(false);
          throw factorsError;
        }
        const verifiedFactor = factorsData.totp.find(f => f.status === 'verified');
        if (verifiedFactor) {
          return { mfaRequired: true, factorId: verifiedFactor.id };
        }
      }

      pendingMfaRef.current = false;
      setMfaPending(false);
    } catch (err) {
      pendingMfaRef.current = false;
      setMfaPending(false);
      throw err;
    }
  };

  const handleSignUp = async (email: string, password: string, captchaToken?: string): Promise<{ mfaEnroll: true; factorId: string; qrCode: string; secret: string } | 'confirmation_needed' | void> => {
    const supabase = getSupabaseClient();
    const pendingPlan = localStorage.getItem('nodespec_pending_plan');
    const pendingInterval = localStorage.getItem('nodespec_pending_interval') || 'month';
    const options: Record<string, unknown> = {};
    if (pendingPlan) {
      options.data = {
        pending_plan: pendingPlan,
        pending_interval: pendingInterval,
      };
    }
    if (captchaToken) {
      options.captchaToken = captchaToken;
    }
    pendingMfaRef.current = true;
    setMfaPending(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options,
      });
      if (error) {
        pendingMfaRef.current = false;
        setMfaPending(false);
        throw error;
      }
      if (data.user && !data.session) {
        pendingMfaRef.current = false;
        setMfaPending(false);
        return 'confirmation_needed';
      }

      const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
      });
      if (enrollError) {
        pendingMfaRef.current = false;
        setMfaPending(false);
        throw enrollError;
      }

      return {
        mfaEnroll: true,
        factorId: enrollData.id,
        qrCode: enrollData.totp.qr_code,
        secret: enrollData.totp.secret,
      };
    } catch (err) {
      pendingMfaRef.current = false;
      setMfaPending(false);
      throw err;
    }
  };

  const handleVerifyMfa = async (factorId: string, code: string) => {
    const supabase = getSupabaseClient();
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });
    if (verifyError) throw verifyError;

    pendingMfaRef.current = false;
    setMfaPending(false);
  };

  const handleOAuthSignIn = async (provider: 'google') => {
    const supabase = getSupabaseClient();
    const pendingPlan = localStorage.getItem('nodespec_pending_plan');
    const pendingInterval = localStorage.getItem('nodespec_pending_interval') || 'month';
    let redirectUrl = `${window.location.origin}/app`;
    if (pendingPlan) {
      redirectUrl = `${window.location.origin}/pricing?plan=${pendingPlan}&interval=${pendingInterval}&auto=true`;
      localStorage.removeItem('nodespec_pending_plan');
      localStorage.removeItem('nodespec_pending_interval');
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: redirectUrl,
      },
    });
    if (error) throw error;
  };

  const handlePasswordReset = async (email: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  };

  const handleSwitchProject = async (projectId: string) => {
    if (!user) return;
    setIsSwitchingProject(true);
    setStore(null);
    setCurrentProjectId(null);
    setCurrentProjectName(null);
    setCurrentBranchId(null);
    setCurrentBranchName(null);
    localStorage.setItem('specgraph_current_project', projectId);
    localStorage.setItem('specgraph_current_branch', 'main');
    await loadUserData(user.id, projectId, 'main');
    setIsSwitchingProject(false);
  };

  const handleSwitchBranch = async (branchName: string) => {
    if (!user || !currentProjectId) return;
    setStore(null);
    await loadUserData(user.id, currentProjectId, branchName);
  };

  const handleDeleteCurrentProject = async () => {
    setStore(null);
    setCurrentProjectId(null);
    setCurrentProjectName(null);
    setCurrentBranchId(null);
    setCurrentBranchName(null);
    localStorage.removeItem('specgraph_current_project');
    localStorage.removeItem('specgraph_current_branch');

    if (user) {
      await loadUserData(user.id);
    } else {
      setDataReady(true);
    }
  };

  const handleRenameProject = async (newName: string) => {
    if (!user || !currentProjectId) return;
    try {
      const supabase = getSupabaseClient();
      const { createSupabaseProjectRepository } = await import('./persistence/supabase/project-repository.js');
      const projectRepo = createSupabaseProjectRepository(supabase);
      const result = await projectRepo.update(currentProjectId, { name: newName });
      if (result.success) {
        setCurrentProjectName(newName);
      }
    } catch (error) {
      console.error('Failed to rename project:', error);
    }
  };

  const handleCreateProject = async (name: string, metadata?: Record<string, unknown>) => {
    if (!user) return;

    try {
      const supabase = getSupabaseClient();
      const { createSupabaseProjectRepository } = await import('./persistence/supabase/project-repository.js');
      const { createSupabaseBranchRepository } = await import('./persistence/supabase/branch-repository.js');
      const { createSupabaseGraphRepository } = await import('./persistence/supabase/graph-repository.js');
      const { createEmptyGraph } = await import('@nodespec/core/utils.js');

      const projectRepo = createSupabaseProjectRepository(supabase);
      const branchRepo = createSupabaseBranchRepository(supabase);
      const graphRepo = createSupabaseGraphRepository(supabase);

      const projectResult = await projectRepo.create(name, user.id, metadata);
      if (!projectResult.success) {
        throw new Error(projectResult.error.message);
      }

      const project = projectResult.data;

      const branchResult = await branchRepo.create(
        project.id,
        'main',
        user.id,
        undefined
      );

      if (!branchResult.success) {
        throw new Error(branchResult.error.message);
      }

      const branch = branchResult.data;
      const emptyGraph = createEmptyGraph();

      const snapshotResult = await graphRepo.saveSnapshot(project.id, branch.id, emptyGraph, 0);
      if (!snapshotResult.success) {
        throw new Error(snapshotResult.error.message);
      }

      const { error: linkError } = await supabase
        .from('branches')
        .update({ base_snapshot_id: snapshotResult.data.id })
        .eq('id', branch.id);

      if (linkError) {
        throw new Error(`Failed to link snapshot to branch: ${linkError.message}`);
      }

      await handleSwitchProject(project.id);
    } catch (error) {
      console.error('Failed to create project:', error);
      alert('Failed to create project: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const projectSwitchActions = useMemo<ProjectSwitchActions>(() => ({
    switchToProject: async (projectId: string) => {
      await handleSwitchProject(projectId);
    },
    getCurrentProjectId: () => currentProjectId,
    getCurrentBranchId: () => currentBranchId,
  }), [currentProjectId, currentBranchId]);

  if (loading) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a1a',
        color: '#ffffff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        Loading...
      </div>
    );
  }

  return (
    <ProjectSwitchProvider actions={projectSwitchActions}>
    <Routes>
      <Route
        path="/"
        element={
          user && !oauthMfaFactorId && !mfaPending ? (
            <Navigate to="/app" replace />
          ) : (
            <AuthLandingPage onSignIn={handleSignIn} onSignUp={handleSignUp} onVerifyMfa={handleVerifyMfa} onOAuthSignIn={handleOAuthSignIn} onPasswordReset={handlePasswordReset} oauthMfaFactorId={oauthMfaFactorId} onOauthMfaComplete={() => setOauthMfaFactorId(null)} />
          )
        }
      />
      <Route
        path="/reset-password"
        element={<ResetPasswordPage />}
      />
      {isHostedEdition && (
        <Route
          path="/pricing"
          element={<PricingPage />}
        />
      )}
      {hasAdminPortal && (
        <Route
          path="/admin"
          element={
            user ? (
              <AdminDashboard />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
      )}
      <Route
        path="/app"
        element={
          !user ? (
            <Navigate to="/" replace />
          ) : stripeProvisioning ? (
            <div style={{
              width: '100vw',
              height: '100vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#1a1a1a',
              color: '#ffffff',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              gap: '12px',
            }}>
              <div style={{
                width: '24px',
                height: '24px',
                border: '3px solid rgba(255,255,255,0.2)',
                borderTopColor: '#ffffff',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              Setting up your account...
            </div>
          ) : stripeProvisioningFailed ? (
            <div style={{
              width: '100vw',
              height: '100vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#1a1a1a',
              color: '#ffffff',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              gap: '16px',
            }}>
              <div style={{ color: '#f87171', fontSize: '14px' }}>
                Account setup encountered an issue. Please try again.
              </div>
              <button
                onClick={handleRetryProvisioning}
                style={{
                  padding: '10px 24px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          ) : needsPlanSelection ? (
            <OnboardingPricingStep
              onSelectFree={handleOnboardingFreeSelect}
              onSelectPaid={handleOnboardingPaidSelect}
            />
          ) : !store && (!dataReady || isSwitchingProject) ? (
            <div style={{
              width: '100vw',
              height: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#1a1a1a',
              color: '#ffffff',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            }}>
              Loading project...
            </div>
          ) : !store && dataReady ? (
            <ThemeProvider>
              <div style={{
                width: '100vw',
                height: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#1a1a1a',
              }}>
                <ProjectOnboardingWizard
                  onConfirm={({ name, workflowOrigin }) => {
                    handleCreateProject(name, { workflowOrigin });
                  }}
                  onClose={() => {}}
                />
              </div>
            </ThemeProvider>
          ) : (
            <GraphEditor
              store={store!}
              actorType="human"
              userId={user.id}
              userEmail={user.email}
              projectId={currentProjectId}
              projectName={currentProjectName}
              branchId={currentBranchId}
              branchName={currentBranchName}
              onSwitchProject={handleSwitchProject}
              onCreateProject={handleCreateProject}
              onSwitchBranch={handleSwitchBranch}
              onRenameProject={handleRenameProject}
              onDeleteCurrentProject={handleDeleteCurrentProject}
            />
          )
        }
      />
      {hasTemplatesGallery && (
        <>
          <Route
            path="/templates"
            element={<TemplateMarketplacePage />}
          />
          <Route
            path="/templates/:slug"
            element={<TemplateDetailPage />}
          />
        </>
      )}
      {isHostedEdition && (
        <Route
          path="/u/:handle"
          element={<PublicProfilePage />}
        />
      )}
      {isHostedEdition && (
        <Route
          path="/pricing"
          element={
            user ? (
              <ThemeProvider>
                <PricingPage />
              </ThemeProvider>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
      )}
      <Route
        path="/privacy"
        element={<PrivacyPolicy />}
      />
      <Route
        path="/terms"
        element={<TermsOfService />}
      />
      {isHostedEdition && (
        <>
          <Route
            path="/blog"
            element={<BlogPage />}
          />
          <Route
            path="/blog/:slug"
            element={<BlogPostPage />}
          />
        </>
      )}
      <Route
        path="/docs/mcp"
        element={<MCPDocsPage />}
      />
      {isHostedEdition && (
        <Route
          path="/government"
          element={<GovernmentPage />}
        />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ProjectSwitchProvider>
  );
}

function AIAvailabilityProvider({ children }: { children: React.ReactNode }) {
  const value = useAIAvailabilityProvider();
  return (
    <AIAvailabilityContext.Provider value={value}>
      {children}
      {value.byokModalOpen && <BYOKRequiredModal onClose={value.closeBYOKModal} onKeyConfigured={value.refresh} />}
    </AIAvailabilityContext.Provider>
  );
}

export default function App() {
  return (
    <>
      <StagingBanner />
      <DegradedCatalogBanner />
      <ErrorBoundary>
        <BrowserRouter>
          <ServiceProvider>
            <AIAvailabilityProvider>
              <AppContent />
            </AIAvailabilityProvider>
          </ServiceProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </>
  );
}
