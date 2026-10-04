export { PatchLogPanel } from './PatchLogPanel.js';
export { TopBar } from './TopBar.js';
export { ArtifactWorkbenchPanel } from './ArtifactWorkbenchPanel.js';
export { ValidationPanel } from './ValidationPanel.js';
export { AccountPanel } from './AccountPanel.js';
export { SimplifiedInspector } from './SimplifiedInspector.js';
export { ProjectExplorer } from './ProjectExplorer.js';
export { BranchChip } from './BranchChip.js';
export { GitIntegrationModal } from './GitIntegrationModal.js';
export { RepoExplorer } from './RepoExplorer.js';
export { FigmaIntegration } from './FigmaIntegration.js';
export { ManualRequirementForm } from './ManualRequirementForm.js';
// M6: the 2026-07-29 debt audit de-exported AIChatPanel so the deletion would be a pure
// rm; that deletion has now happened, along with 11 other components that were extracted
// and cut the same day and never removed (~3,900 lines). Do not re-add.
export { RequirementInspector } from './RequirementInspector.js';
export { TestInspector } from './TestInspector.js';
export { ProjectCreatePopup, validateProjectName } from './ProjectCreatePopup.js';
export type { ProjectCreateResult, WorkflowOrigin } from './ProjectCreatePopup.js';
export { NodeSidepane } from './NodeSidepane.js';
