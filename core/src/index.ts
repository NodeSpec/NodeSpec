export * from './schemas.js';
export * from './types.js';
export * from './utils.js';
export * from './patch-engine.js';
export * from './branch.js';
export * from './event-log.js';
export * from './patch-factory.js';
export * from './ai-proposal.js';
export * from './ai-orchestration.js';
export * from './migration.js';
export { resolveContractFields, resolveToContractKind, isInteractionKind, isContractKind } from './interaction-resolution.js';
export type { ResolvedContractFields } from './interaction-resolution.js';
export * from './ai-context.js';
export * from './graph-context.js';
export * from './obligations.js';
export * from './artifact-validation.js';
export * from './dependency-detection.js';
export * from './node-metadata.js';
export * from './language-support.js';
export * from './language-detection.js';
export * from './language-templates.js';
export * from './figma-integration.js';
export * from './figma-artifact-handler.js';
export * from './validation/index.js';
export * from './container-artifact-templates.js';
export * from './container-artifact-examples.js';
export * from './specification.js';
export * from './specification-format.js';
export * from './specification-drift-detector.js';
export * from './configuration-fingerprint.js';
export * from './task-context-fingerprint.js';

export { DOMAIN_NODE_TYPES, getNodeTypeById, getDomainById, getAllNodeTypes, getNodeTypeDomains, populateDomains, isCatalogPopulated } from './node-types.js';
export { NODE_TEMPLATES, getTemplateById, getTemplateByNodeType, getNodeCompletenessRequirements, isNodeComplete, getArtifactPlaceholdersForNode, invalidateTemplateCache } from './templates.js';
export { BUILTIN_CONTAINER_TYPES, getContainerTypeById, canContainerHoldNode, getCanContainRoleIds, hasCanContainRules, getContainersByLayer, populateContainerTypes, isContainerTypesPopulated, getContainerTypes, resolveContainerRoleId, setRoleResolver, setTechnologyTreatmentResolver } from './container-types.js';
export type { ContainerStyle, CanContainRule, RoleInfo, RoleResolver } from './container-types.js';
export { canMarkNodeComplete } from './draft-semantics.js';
export {
  getDatabaseEnrichment,
  getSupportedLanguages,
  getPrimaryLanguages,
  getClientLibraries,
  getConnectionPatterns,
  DATABASE_ENRICHMENTS,
} from './database-enrichment.js';
export type {
  DatabaseEnrichment,
  DatabaseFileType,
  DatabaseLanguageSupport,
  DatabaseConnectionPattern,
  DatabaseMigrationStrategy,
  DatabaseDeploymentContext,
} from './database-enrichment.js';
export {
  getInterfaceEnrichment,
  getInterfaceClientLibraries,
  getSupportedInterfaceLanguages,
  getAuthStrategies,
  getConfigPatterns,
  INTERFACE_ENRICHMENTS,
} from './interface-enrichment.js';
export type {
  InterfaceEnrichment,
  InterfaceFileType,
  InterfaceClientLibrary,
  AuthenticationStrategy,
  InterfaceConfigPattern,
  InterfaceDeploymentOption,
  SecurityFeature,
} from './interface-enrichment.js';
