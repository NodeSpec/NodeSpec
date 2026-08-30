import type { EdgeTypes } from '@xyflow/react';
import { CustomEdge } from './CustomEdge.js';
import { ContainerSummaryEdge } from './ContainerSummaryEdge.js';

export const edgeTypes: EdgeTypes = {
  default: CustomEdge,
  containerSummary: ContainerSummaryEdge,
};

export { CustomEdge, ContainerSummaryEdge };
