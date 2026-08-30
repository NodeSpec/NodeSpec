import React, { createContext, useContext, useMemo } from 'react';
import { getSupabaseClient } from '../../persistence/supabase/client.js';
import {
  PersistenceService,
  AuthService,
  ProjectService,
  SpecificationService,
  CodeStructureService,
  AIRunService,
  ProposalService,
  PatchService,
  ArtifactService,
  TestCaseService,
  BranchService,
  MappingService,
  RequirementStatusService,
  SpecificationRealtimeService,
  SubscriptionService,
  TemplateService,
} from '../services/index.js';
import { TraceabilityService } from '../services/TraceabilityService.js';
import { AgentService } from '../services/AgentService.js';

export interface Services {
  persistence: PersistenceService;
  auth: AuthService;
  project: ProjectService;
  specification: SpecificationService;
  codeStructure: CodeStructureService;
  aiRun: AIRunService;
  proposal: ProposalService;
  patch: PatchService;
  artifact: ArtifactService;
  testCase: TestCaseService;
  branch: BranchService;
  mapping: MappingService;
  requirementStatus: RequirementStatusService;
  specificationRealtime: SpecificationRealtimeService;
  traceability: TraceabilityService;
  agent: AgentService;
  subscription: SubscriptionService;
  template: TemplateService;
}

const ServiceContext = createContext<Services | null>(null);

export interface ServiceProviderProps {
  children: React.ReactNode;
}

export function ServiceProvider({ children }: ServiceProviderProps) {
  const services = useMemo(() => {
    const supabase = getSupabaseClient();
    const persistence = new PersistenceService(supabase);
    const project = new ProjectService(persistence);
    const patch = new PatchService(persistence);
    const specification = new SpecificationService(persistence);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Missing required Supabase environment variables', {
        hasUrl: !!supabaseUrl,
        hasKey: !!supabaseAnonKey,
      });
      throw new Error('Supabase configuration is incomplete. Please check environment variables.');
    }

    const auth = new AuthService(supabase);
    const testCase = new TestCaseService(persistence.getTestCaseRepository(), supabase);

    return {
      persistence,
      auth,
      project,
      specification,
      codeStructure: new CodeStructureService(persistence),
      aiRun: new AIRunService(persistence),
      proposal: new ProposalService(persistence),
      patch,
      artifact: new ArtifactService(persistence),
      testCase,
      branch: new BranchService(project, patch),
      mapping: new MappingService(persistence),
      requirementStatus: new RequirementStatusService(persistence),
      specificationRealtime: new SpecificationRealtimeService(supabase),
      traceability: new TraceabilityService(supabase, persistence.getMappingsRepository()),
      agent: new AgentService(auth, supabaseUrl, supabaseAnonKey),
      subscription: new SubscriptionService(supabase),
      template: new TemplateService(persistence),
    };
  }, []);

  return <ServiceContext.Provider value={services}>{children}</ServiceContext.Provider>;
}

export function useServices(): Services {
  const context = useContext(ServiceContext);
  if (!context) {
    throw new Error('useServices must be used within ServiceProvider');
  }
  return context;
}

export function useAuth() {
  const services = useServices();
  return services.auth;
}

export function useProject() {
  const services = useServices();
  return services.project;
}

export function useSpecification() {
  const services = useServices();
  return services.specification;
}

export function useCodeStructure() {
  const services = useServices();
  return services.codeStructure;
}

export function usePersistence() {
  const services = useServices();
  return services.persistence;
}

export function useAIRun() {
  const services = useServices();
  return services.aiRun;
}

export function useProposal() {
  const services = useServices();
  return services.proposal;
}

export function usePatch() {
  const services = useServices();
  return services.patch;
}

export function useArtifact() {
  const services = useServices();
  return services.artifact;
}

export function useTestCase() {
  const services = useServices();
  return services.testCase;
}

export function useBranch() {
  const services = useServices();
  return services.branch;
}

export function useSubscription() {
  const services = useServices();
  return services.subscription;
}

export function useTemplates() {
  const services = useServices();
  return services.template;
}
