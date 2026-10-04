// AG.13 (owner 2026-09-28, "drop the ports and simplify"): a leaf draws one
// handle for edges in (left) and one for edges out (right), from the
// component, never from stored ports. What a connection means lives on its
// edge's contract; a handle is only where the line attaches. The handles carry
// no id, so every edge binds to them (an edge's stored port ids are ignored by
// the adapter), and a node can never swallow an edge whose handle it lacks.
// Containers do not use this: they draw only FallbackHandles, which nothing can
// be dragged from or to (AG.14: an edge ends on the node inside).
import { Handle, Position } from '@xyflow/react';

export function LeafHandles({ style, targetStyle, sourceStyle, target = true, source = true }: {
  style?: React.CSSProperties;
  targetStyle?: React.CSSProperties;
  sourceStyle?: React.CSSProperties;
  target?: boolean;
  source?: boolean;
}) {
  return (
    <>
      {target && <Handle type="target" position={Position.Left} style={{ ...style, ...targetStyle }} />}
      {source && <Handle type="source" position={Position.Right} style={{ ...style, ...sourceStyle }} />}
    </>
  );
}
