import { memo } from 'react';
import { BaseNode } from './BaseNode.js';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { NodeGroup } from './NodeGroup.js';
import { ContainerNode } from './ContainerNode.js';
import { EnhancedDatabaseNode } from './EnhancedDatabaseNode.js';
import { EventBusNode } from './EventBusNode.js';
import { IconNode } from './IconNode.js';
import { CompactIconNode } from './CompactIconNode.js';
import { ClassNode, FunctionNode, MethodNode, InterfaceNode, ModuleNode } from './CodeEntityNodes.js';
import { RequirementNode } from './RequirementNode.js';
import { AddSectionButtonNode } from './AddSectionButtonNode.js';
import { LogicalBoundaryNode } from './LogicalBoundaryNode.js';
import { LibraryNode } from './LibraryNode.js';
import { ArchitectureExplanationNode } from './ArchitectureExplanationNode.js';
import { TestNode } from './TestNode.js';
import { DeploymentWrapperNode } from './DeploymentWrapperNode.js';

interface SpecializedNodeProps {
  id?: string;
  data: RFNodeData;
  selected?: boolean;
}

function ServiceNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <BaseNode data={data} selected={selected} accentColor={(data.color as string) || '#22c55e'} highlighted={data.highlighted} />;
}

function DatabaseNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <EnhancedDatabaseNode data={data} selected={selected} />;
}

function ApiNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <BaseNode data={data} selected={selected} accentColor={(data.color as string) || '#3b82f6'} highlighted={data.highlighted} />;
}

function QueueNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <EventBusNode data={data} selected={selected} />;
}

function CacheNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <BaseNode data={data} selected={selected} accentColor={(data.color as string) || '#eab308'} highlighted={data.highlighted} />;
}

function ExternalNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <BaseNode data={data} selected={selected} accentColor={(data.color as string) || '#64748b'} highlighted={data.highlighted} />;
}

function UnknownNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <BaseNode data={data} selected={selected} accentColor="#ef4444" highlighted={data.highlighted} />;
}

function IconNodeComponent({ data, selected }: SpecializedNodeProps) {
  return <IconNode data={data} selected={selected} />;
}

function ContainerNodeWrapper({ id, data, selected }: SpecializedNodeProps) {
  return <ContainerNode id={id || ''} data={data} selected={selected} />;
}

function LogicalBoundaryNodeWrapper({ id, data, selected }: SpecializedNodeProps) {
  return <LogicalBoundaryNode id={id || ''} data={data} selected={selected} />;
}

export const ServiceNode = memo(ServiceNodeComponent);
export const DatabaseNode = memo(DatabaseNodeComponent);
export const ApiNode = memo(ApiNodeComponent);
export const QueueNode = memo(QueueNodeComponent);
export const CacheNode = memo(CacheNodeComponent);
export const ExternalNode = memo(ExternalNodeComponent);
export const UnknownNode = memo(UnknownNodeComponent);
export const SpecializedIconNode = memo(IconNodeComponent);

export { NodeGroup };

export const nodeTypes = {
  base: BaseNode,
  service: ServiceNode,
  database: DatabaseNode,
  api: ApiNode,
  queue: QueueNode,
  cache: CacheNode,
  external: ExternalNode,
  unknown: UnknownNode,
  group: NodeGroup,
  container: memo(ContainerNodeWrapper),
  logicalBoundary: memo(LogicalBoundaryNodeWrapper),
  library: LibraryNode,
  icon: SpecializedIconNode,
  compactIcon: CompactIconNode,
  classNode: ClassNode,
  functionNode: FunctionNode,
  methodNode: MethodNode,
  interfaceNode: InterfaceNode,
  moduleNode: ModuleNode,
  requirement: RequirementNode,
  'requirements.functional': RequirementNode,
  'requirements.non-functional': RequirementNode,
  'requirements.technical': RequirementNode,
  'requirements.business': RequirementNode,
  'requirements.section': RequirementNode,
  addSectionButton: AddSectionButtonNode,
  architectureExplanation: ArchitectureExplanationNode,
  deploymentWrapper: DeploymentWrapperNode,
  testCase: TestNode,
} as const;
