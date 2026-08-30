export { calculateAutoLayout } from './auto-layout.js';
export { computePreviewLayout } from './preview-layout.js';
export { layoutContainerChildren, computeAllContainerLayouts, calculateFlowAwareContainerSize } from './container-child-layout.js';
export type { ChildPosition, ContainerSizing } from './container-child-layout.js';
export { saveModePositions, loadModePositions, hasModePositions } from './mode-position-cache.js';
export type { PositionMode, CachedPosition } from './mode-position-cache.js';
export {
  planFlatToNested,
  planNestedToFlat,
  snapshotCurrentPositions,
  identifyContainerIds,
  ENTER_DURATION_MS,
  EXIT_DURATION_MS,
  SETTLE_DELAY_MS,
} from './layer-transition.js';
export type { TransitionPhase, TransitionPlan } from './layer-transition.js';
export { getTechnologyLogo, getTechnologyColors, TECHNOLOGY_LOGO_MAP } from './technology-logo-map.js';
export { buildPaletteCategories, getRoleIcon, resolveNodeCreationParams } from './palette-roles.js';
export type { PaletteCategory, PaletteRoleItem } from './palette-roles.js';
