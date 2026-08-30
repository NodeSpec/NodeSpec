// N5 chunk 2: node ports editor (in/out lists, add/remove with force-remove confirm,
// per-port contract-kind badges) — extracted VERBATIM from SimplifiedInspector; only
// the import header is new.
import { useState, useCallback, useMemo } from 'react';
import type { Graph, Node, Edge, PatchOperation, Port } from '@nodespec/core/types.js';
import { createAddPortPatch, createDeletePortPatch, createUpdateEdgePatch } from '@nodespec/core/patch-factory.js';
import { generateUUID } from '@nodespec/core/utils.js';
import { useTheme } from '../../../theme/ThemeContext.js';
import { getContractKindColor, getContractKindLabel, getPortContractKind } from './kind-maps.js';

function ContractKindBadge({ kind }: { kind: string }) {
  const { theme } = useTheme();
  const color = getContractKindColor(kind, theme.mode);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        fontSize: '10px',
        fontWeight: 600,
        color,
        backgroundColor: color + '18',
        border: `1px solid ${color}40`,
        borderRadius: '3px',
        lineHeight: '16px',
        marginLeft: '6px',
        verticalAlign: 'middle',
      }}
    >
      {getContractKindLabel(kind)}
    </span>
  );
}

function PortRemoveButton({
  portId,
  isConnected,
  colors,
  onRemove,
  onForceRemove,
}: {
  portId: string;
  isConnected: boolean;
  colors: any;
  onRemove: (portId: string) => void;
  onForceRemove: (portId: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isConnected && !confirmDelete) {
    return (
      <button
        style={{
          padding: '4px 8px',
          backgroundColor: 'transparent',
          color: colors.error,
          fontSize: '11px',
          border: `1px solid ${colors.error}`,
          borderRadius: '4px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
        onClick={() => setConfirmDelete(true)}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.errorBg; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        Remove
      </button>
    );
  }

  if (isConnected && confirmDelete) {
    return (
      <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
        <button
          style={{
            padding: '4px 8px',
            backgroundColor: colors.error,
            color: 'white',
            fontSize: '10px',
            fontWeight: 600,
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
          onClick={() => {
            onForceRemove(portId);
            setConfirmDelete(false);
          }}
        >
          Connected -- Remove anyway?
        </button>
        <button
          style={{
            padding: '4px 6px',
            backgroundColor: 'transparent',
            color: colors.textMuted,
            fontSize: '10px',
            border: `1px solid ${colors.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
          }}
          onClick={() => setConfirmDelete(false)}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      style={{
        padding: '4px 8px',
        backgroundColor: 'transparent',
        color: colors.error,
        fontSize: '11px',
        border: `1px solid ${colors.error}`,
        borderRadius: '4px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
      onClick={() => onRemove(portId)}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.errorBg; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      Remove
    </button>
  );
}

export function ConnectionPointsEditor({
  node,
  graph,
  onPatchGenerated,
  onPatchesGenerated,
}: {
  node: Node;
  graph: Graph;
  onPatchGenerated: (patch: PatchOperation) => void;
  onPatchesGenerated?: (patches: PatchOperation[]) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [showAddPoint, setShowAddPoint] = useState(false);
  const [newDirection, setNewDirection] = useState<'in' | 'out'>('in');
  const [newLabel, setNewLabel] = useState('');

  const ports: Port[] = useMemo(() => {
    return (node.ports as Port[]) || [];
  }, [node.ports]);

  const nodeEdges = useMemo(() => {
    return Object.values(graph.edges).filter(
      (e) => e.source === node.id || e.target === node.id
    );
  }, [graph.edges, node.id]);

  const getConnections = useCallback(
    (portId: string) => {
      return nodeEdges.filter((edge) => {
        return edge.sourcePortId === portId || edge.targetPortId === portId;
      });
    },
    [nodeEdges]
  );

  const handleAddPoint = useCallback(() => {
    // N8.6(B): the kind-select that used to prefix the default name is dead — it fed
    // NOTHING but this string (a port has no contract until an edge binds one). The
    // port's kind badge comes from the connected contract, the only truth.
    const newPort: Port = {
      id: generateUUID(),
      name: newLabel || (newDirection === 'in' ? 'Input' : 'Output'),
      direction: newDirection,
      required: false,
    };

    const patch = createAddPortPatch(
      node.id,
      newPort,
      {
        actorType: 'human',
        summary: `Add ${newDirection === 'in' ? 'input' : 'output'} connection point`,
      }
    );

    onPatchGenerated(patch);
    setShowAddPoint(false);
    setNewLabel('');
  }, [newDirection, newLabel, node.id, onPatchGenerated]);

  const handleRemovePoint = useCallback(
    (portId: string) => {
      const patch = createDeletePortPatch(
        node.id,
        portId,
        {
          actorType: 'human',
          summary: 'Remove connection point',
        }
      );

      onPatchGenerated(patch);
    },
    [node.id, onPatchGenerated]
  );

  const handleForceRemovePoint = useCallback(
    (portId: string) => {
      const connectedEdges = nodeEdges.filter(
        (e) => e.sourcePortId === portId || e.targetPortId === portId
      );

      const patches: PatchOperation[] = [];

      for (const edge of connectedEdges) {
        const changes: Partial<Omit<Edge, 'id'>> = {};
        if (edge.sourcePortId === portId) {
          changes.sourcePortId = undefined;
        }
        if (edge.targetPortId === portId) {
          changes.targetPortId = undefined;
        }
        patches.push(
          createUpdateEdgePatch(edge.id, changes, {
            actorType: 'human',
            summary: `Clear port reference before deletion`,
          })
        );
      }

      patches.push(
        createDeletePortPatch(node.id, portId, {
          actorType: 'human',
          summary: 'Remove connected connection point',
        })
      );

      if (onPatchesGenerated) {
        onPatchesGenerated(patches);
      } else {
        for (const patch of patches) {
          onPatchGenerated(patch);
        }
      }
    },
    [node.id, nodeEdges, onPatchGenerated, onPatchesGenerated]
  );

  const sectionStyles: React.CSSProperties = {
    padding: '16px',
    borderBottom: `1px solid ${c.border}`,
  };

  const labelStyles: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: c.textMuted,
    marginBottom: '8px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  const inputStyles: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    backgroundColor: c.background,
    border: `1px solid ${c.border}`,
    borderRadius: '6px',
    color: c.text,
    fontSize: '13px',
    outline: 'none',
  };

  const buttonStyles: React.CSSProperties = {
    padding: '8px 16px',
    backgroundColor: c.primary,
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500,
  };

  const inputPorts = ports.filter(p => p.direction === 'in');
  const outputPorts = ports.filter(p => p.direction === 'out');

  const renderPortItem = (port: Port, directionLabel: 'source' | 'target') => {
    const connections = getConnections(port.id);
    const isConnected = connections.length > 0;
    const contractKind = getPortContractKind(port.id, nodeEdges, graph);

    const edgeMeta = isConnected ? connections[0] : null;
    const edgeDirection = edgeMeta?.direction;
    const edgeCriticality = edgeMeta?.criticality;

    return (
      <div
        key={port.id}
        style={{
          padding: '10px 12px',
          backgroundColor: c.background,
          borderRadius: '6px',
          border: `2px solid ${isConnected ? c.success : c.border}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: c.text, marginBottom: '4px', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{port.name}</span>
              {contractKind && <ContractKindBadge kind={contractKind} />}
            </div>
            {isConnected ? (
              <>
                <div style={{ fontSize: '11px', color: c.success, marginTop: '6px' }}>
                  {connections.map((e) => {
                    const peerId = directionLabel === 'target' ? e.source : e.target;
                    return graph.nodes[peerId]?.label || 'Unknown';
                  }).join(', ')}
                </div>
                {(edgeDirection || edgeCriticality) && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    {edgeDirection && (
                      <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', backgroundColor: c.backgroundSecondary, color: c.textMuted, fontWeight: 500 }}>
                        {edgeDirection === 'bidirectional' ? '\u2194 bidi' : '\u2192 uni'}
                      </span>
                    )}
                    {edgeCriticality && (
                      <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', backgroundColor: edgeCriticality === 'required' ? c.errorBg : c.backgroundSecondary, color: edgeCriticality === 'required' ? c.error : c.textMuted, fontWeight: 500 }}>
                        {edgeCriticality}
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: '11px', color: c.textMuted, fontStyle: 'italic', marginTop: '6px' }}>
                (unconnected)
              </div>
            )}
          </div>
          <PortRemoveButton
            portId={port.id}
            isConnected={isConnected}
            colors={c}
            onRemove={handleRemovePoint}
            onForceRemove={handleForceRemovePoint}
          />
        </div>
      </div>
    );
  };

  return (
    <div style={sectionStyles}>
      <div style={labelStyles}>Connection Points</div>
      <div
        style={{
          padding: '10px 12px',
          backgroundColor: c.backgroundSecondary,
          borderRadius: '6px',
          marginBottom: '12px',
          fontSize: '12px',
          color: c.textSecondary,
          lineHeight: '1.6',
        }}
      >
        Connection points let you control what can connect to this component. Green dots (left) receive data, yellow dots (right) send data.
      </div>


      {ports.length === 0 && (
        <div
          style={{
            padding: '16px',
            backgroundColor: c.backgroundSecondary,
            borderRadius: '6px',
            textAlign: 'center',
            fontSize: '12px',
            color: c.textMuted,
            fontStyle: 'italic',
            marginBottom: '12px',
          }}
        >
          No connection points yet. Add them to enable connections.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
        {inputPorts.length > 0 && (
          <>
            <div style={{ fontSize: '11px', color: c.textMuted, marginTop: '8px', fontWeight: 600 }}>
              Receives Data From
            </div>
            {inputPorts.map((port) => renderPortItem(port, 'target'))}
          </>
        )}

        {outputPorts.length > 0 && (
          <>
            <div style={{ fontSize: '11px', color: c.textMuted, marginTop: '8px', fontWeight: 600 }}>
              Sends Data To
            </div>
            {outputPorts.map((port) => renderPortItem(port, 'source'))}
          </>
        )}
      </div>

      {!showAddPoint && (
        <button
          style={{ ...buttonStyles, width: '100%' }}
          onClick={() => setShowAddPoint(true)}
        >
          + Add Connection Point
        </button>
      )}

      {showAddPoint && (
        <div
          style={{
            padding: '12px',
            backgroundColor: c.backgroundSecondary,
            borderRadius: '6px',
            border: `1px solid ${c.border}`,
          }}
        >
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>
              Direction
            </div>
            <select
              style={inputStyles}
              value={newDirection}
              onChange={(e) => setNewDirection(e.target.value as 'in' | 'out')}
            >
              <option value="in">Receives data (input)</option>
              <option value="out">Sends data (output)</option>
            </select>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>
              Label (Optional)
            </div>
            <input
              type="text"
              style={inputStyles}
              placeholder="e.g., User API, Products Database"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddPoint();
                if (e.key === 'Escape') {
                  setShowAddPoint(false);
                  setNewLabel('');
                }
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...buttonStyles, flex: 1 }} onClick={handleAddPoint}>
              Add
            </button>
            <button
              style={{ ...buttonStyles, flex: 1, backgroundColor: c.textMuted }}
              onClick={() => {
                setShowAddPoint(false);
                setNewLabel('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

