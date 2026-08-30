// Owner bench 2026-07-29 (model carried 4 edges on a node, canvas drew 1):
// React Flow SILENTLY drops any edge whose endpoint node lacks a handle of the
// required type — and every node component rendered handles ONLY from direction-
// filtered ports. An MCP-proposed node with no 'in' ports therefore swallowed every
// incoming edge, no 'out' ports every outgoing one, and containers (no ports at
// all) swallowed the cross-container summary edges too. These invisible, id-less
// fallback handles guarantee every node can terminate an edge: an edge without a
// handle id binds to the first handle of the right type, while port-bound edges
// keep anchoring to their id'd port handles. isConnectable=false keeps users from
// dragging new connections out of an invisible dot.
import { Handle, Position } from '@xyflow/react';

const baseStyle: React.CSSProperties = {
  width: '1px',
  height: '1px',
  minWidth: '1px',
  minHeight: '1px',
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

export function FallbackHandles({ showTarget, showSource }: { showTarget: boolean; showSource: boolean }) {
  return (
    <>
      {showTarget && (
        <Handle
          type="target"
          position={Position.Left}
          isConnectable={false}
          style={{ ...baseStyle, left: 0, top: '50%' }}
        />
      )}
      {showSource && (
        <Handle
          type="source"
          position={Position.Right}
          isConnectable={false}
          style={{ ...baseStyle, right: 0, top: '50%' }}
        />
      )}
    </>
  );
}
