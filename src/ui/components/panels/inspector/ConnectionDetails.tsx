// N5 chunk 2: edge/contract inspector (label, connection-type/kind with enrichment,
// transport & spec-format overrides) — extracted VERBATIM from SimplifiedInspector;
// only the import header is new.
import { useState, useCallback } from 'react';
import type { Graph, Edge, PatchOperation, ContractKind } from '@nodespec/core/types.js';
import { createPatchMetadata } from '@nodespec/core/patch-factory.js';
import { KIND_TO_INTERACTION_FIELDS } from '@nodespec/core/shared/legacy-mappings.js';
import { CONTRACT_KIND_GROUPS } from './kind-maps.js';
import { useTheme } from '../../../theme/ThemeContext.js';

export function ConnectionDetails({
  edge,
  graph,
  onPatchGenerated,
}: {
  edge: Edge;
  graph: Graph;
  onPatchGenerated: (patch: PatchOperation) => void;
}) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(edge.label || '');

  const sourceNode = graph.nodes[edge.source];
  const targetNode = graph.nodes[edge.target];
  const contract = graph.contracts[edge.contractId];

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

  const handleSaveLabel = useCallback(() => {
    if (labelValue === edge.label) {
      setEditingLabel(false);
      return;
    }

    const patch: PatchOperation = {
      type: 'update_edge',
      metadata: createPatchMetadata({
        actorType: 'human',
        summary: labelValue ? `Set label to "${labelValue}"` : 'Remove label',
      }),
      payload: {
        id: edge.id,
        changes: {
          label: labelValue || undefined,
        },
      },
    };

    onPatchGenerated(patch);
    setEditingLabel(false);
  }, [edge, labelValue, onPatchGenerated]);

  // N8.6(A): the kind→interaction defaults were a line-for-line private copy of
  // core's KIND_TO_INTERACTION_FIELDS — one vocabulary now, imported.
  const handleChangeConnectionType = useCallback((newKind: string) => {
    if (!contract) return;

    const enriched = KIND_TO_INTERACTION_FIELDS[newKind as ContractKind];
    const changes: Record<string, unknown> = { kind: newKind };
    if (enriched) {
      changes.interactionKind = enriched.interactionKind;
      changes.transport = enriched.transport;
      changes.specFormat = enriched.specFormat;
    }

    const patch: PatchOperation = {
      type: 'update_contract',
      metadata: createPatchMetadata({
        actorType: 'human',
        summary: `Change to ${newKind}`,
      }),
      payload: {
        id: contract.id,
        changes: changes as any,
      },
    };

    onPatchGenerated(patch);
  }, [contract, onPatchGenerated]);

  const connectionTypeInfo: Record<string, { label: string; description: string; group: string }> = {
    rest: {
      label: 'REST API',
      description: 'Standard HTTP request/response - the most common integration pattern for frontends, mobile apps, and service-to-service calls',
      group: 'Synchronous',
    },
    graphql: {
      label: 'GraphQL',
      description: 'Flexible query language letting clients request exactly the data they need in a single round-trip',
      group: 'Synchronous',
    },
    grpc: {
      label: 'gRPC',
      description: 'High-performance binary protocol with streaming support, ideal for internal microservice communication',
      group: 'Synchronous',
    },
    websocket: {
      label: 'WebSocket',
      description: 'Persistent bidirectional connection for real-time features like chat, live updates, and collaborative editing',
      group: 'Realtime',
    },
    sse: {
      label: 'Server-Sent Events',
      description: 'Server-push unidirectional stream over HTTP - ideal for live feeds, notifications, and progress updates',
      group: 'Realtime',
    },
    kafka: {
      label: 'Kafka / Event Stream',
      description: 'Ordered, replayable event log (Kafka, Kinesis) where multiple consumers independently process published events',
      group: 'Messaging',
    },
    amqp: {
      label: 'AMQP / Message Queue',
      description: 'Point-to-point or pub/sub async delivery (RabbitMQ, SQS) with routing, exchanges, and reliable delivery',
      group: 'Messaging',
    },
    sql: {
      label: 'SQL Database',
      description: 'Relational database access via SQL queries - PostgreSQL, MySQL, or other RDBMS connections',
      group: 'Data',
    },
    nosql: {
      label: 'NoSQL / Document Store',
      description: 'Document, key-value, or wide-column database access - MongoDB, DynamoDB, Firestore',
      group: 'Data',
    },
    ipc: {
      label: 'IPC / Internal',
      description: 'Inter-process communication, shared memory, or hardware bus - for co-located processes and embedded systems',
      group: 'System',
    },
    dependency: {
      label: 'Library / Dependency',
      description: 'Build-time code import - a package or module consumed as a dependency, not a runtime network call',
      group: 'Build-time',
    },
    custom: {
      label: 'Custom',
      description: 'Custom or specialized integration pattern - file storage, auth flows, caches, telemetry, or domain-specific protocols',
      group: 'System',
    },
  };

  const currentInfo = contract ? connectionTypeInfo[contract.kind] : null;

  return (
    <>
      <div style={sectionStyles}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>From</div>
            <div style={{ fontSize: '14px', color: c.text, fontWeight: 500 }}>
              {sourceNode?.label || 'Unknown'}
            </div>
          </div>
          <div style={{ textAlign: 'center', color: c.textMuted }}>→</div>
          <div>
            <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>To</div>
            <div style={{ fontSize: '14px', color: c.text, fontWeight: 500 }}>
              {targetNode?.label || 'Unknown'}
            </div>
          </div>
        </div>
      </div>

      <div style={sectionStyles}>
        <div style={labelStyles}>Label</div>
        {editingLabel ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="text"
              style={inputStyles}
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveLabel();
                if (e.key === 'Escape') {
                  setLabelValue(edge.label || '');
                  setEditingLabel(false);
                }
              }}
              placeholder="Optional label"
              autoFocus
            />
            <button style={buttonStyles} onClick={handleSaveLabel}>
              Save
            </button>
          </div>
        ) : (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: c.background,
              borderRadius: '6px',
              cursor: 'pointer',
              color: labelValue ? c.text : c.textMuted,
              fontSize: '13px',
              fontStyle: labelValue ? 'normal' : 'italic',
            }}
            onClick={() => setEditingLabel(true)}
          >
            {labelValue || 'Click to add label'}
          </div>
        )}
      </div>

      {contract && (
        <div style={sectionStyles}>
          <div style={labelStyles}>Connection Type</div>
          <select
            style={inputStyles}
            value={contract.kind}
            onChange={(e) => handleChangeConnectionType(e.target.value)}
          >
            {CONTRACT_KIND_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {currentInfo && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px',
                backgroundColor: c.backgroundSecondary,
                borderRadius: '6px',
                fontSize: '12px',
                color: c.textSecondary,
                lineHeight: '1.6',
              }}
            >
              <div style={{ fontWeight: 600, color: c.text, marginBottom: '6px' }}>
                {currentInfo.label}
              </div>
              {currentInfo.description}
            </div>
          )}

          {(contract.interactionKind || contract.transport || contract.specFormat) && (
            <div style={{
              marginTop: '12px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '8px',
            }}>
              <div>
                <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px', fontWeight: 500 }}>Pattern</div>
                <span style={{
                  fontSize: '11px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  display: 'inline-block',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(14, 116, 144, 0.06)',
                  color: theme.mode === 'dark' ? '#7dd3fc' : '#0e7490',
                  fontWeight: 500,
                }}>
                  {(contract.interactionKind || 'auto').replace(/_/g, ' ')}
                </span>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px', fontWeight: 500 }}>Transport</div>
                <span style={{
                  fontSize: '11px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  display: 'inline-block',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(5, 150, 105, 0.06)',
                  color: theme.mode === 'dark' ? '#6ee7b7' : '#047857',
                  fontWeight: 500,
                }}>
                  {(contract.transport || 'auto')}
                </span>
              </div>
              {contract.specFormat && contract.specFormat !== 'none' && (
                <div>
                  <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px', fontWeight: 500 }}>Spec format</div>
                  <span style={{
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    display: 'inline-block',
                    backgroundColor: theme.mode === 'dark' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(217, 119, 6, 0.06)',
                    color: theme.mode === 'dark' ? '#fcd34d' : '#b45309',
                    fontWeight: 500,
                  }}>
                    {contract.specFormat.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* WS2: display-only schema status. The schema itself is drafted and
              attached by the AI over MCP (get_build_readiness names the gap);
              there is deliberately no editor here (N10 owns that decision). */}
          {(() => {
            const hasInline = !!contract.schema && Object.keys(contract.schema).length > 0;
            const refArtifact = contract.schemaRef ? graph.artifacts[contract.schemaRef] : undefined;

            let statusText: string;
            let isWarning = false;
            if (hasInline) {
              const chars = JSON.stringify(contract.schema).length;
              const format = contract.specFormat && contract.specFormat !== 'none'
                ? ` · ${contract.specFormat.replace(/_/g, ' ')}`
                : '';
              statusText = `Inline schema — ${chars.toLocaleString()} chars${format}`;
            } else if (contract.schemaRef && refArtifact) {
              const chars = refArtifact.content?.length;
              statusText = `Schema artifact — ${refArtifact.path}${typeof chars === 'number' ? ` (${chars.toLocaleString()} chars)` : ''}`;
            } else if (contract.schemaRef) {
              isWarning = true;
              statusText = '⚠ Schema reference broken — the linked artifact no longer exists';
            } else {
              isWarning = true;
              statusText = '⚠ No schema — your AI drafts it via get_build_readiness';
            }

            return (
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px', fontWeight: 500 }}>Schema</div>
                <div style={{
                  fontSize: '11px',
                  padding: '6px 8px',
                  borderRadius: '4px',
                  lineHeight: '1.5',
                  wordBreak: 'break-word',
                  backgroundColor: isWarning
                    ? (theme.mode === 'dark' ? 'rgba(251, 191, 36, 0.08)' : 'rgba(217, 119, 6, 0.05)')
                    : (theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                  color: isWarning
                    ? (theme.mode === 'dark' ? '#fcd34d' : '#b45309')
                    : c.textSecondary,
                }}>
                  {statusText}
                </div>
              </div>
            );
          })()}

          {/* Advanced overrides */}
          <details style={{ marginTop: '12px' }}>
            <summary style={{
              fontSize: '11px',
              color: c.textMuted,
              cursor: 'pointer',
              userSelect: 'none',
              fontWeight: 500,
            }}>
              Override transport &amp; schema format
            </summary>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px' }}>Transport</div>
                <select
                  style={{ ...inputStyles, fontSize: '12px', padding: '6px 10px' }}
                  value={contract.transport || ''}
                  onChange={(e) => {
                    const patch: PatchOperation = {
                      type: 'update_contract',
                      metadata: createPatchMetadata({ actorType: 'human', summary: `Set transport to ${e.target.value}` }),
                      payload: { id: contract.id, changes: { transport: e.target.value } as any },
                    };
                    onPatchGenerated(patch);
                  }}
                >
                  <optgroup label="Web">
                    <option value="http">HTTP</option>
                    <option value="graphql">GraphQL</option>
                    <option value="grpc">gRPC</option>
                    <option value="websocket">WebSocket</option>
                    <option value="sse">SSE</option>
                  </optgroup>
                  <optgroup label="Messaging">
                    <option value="amqp">AMQP</option>
                    <option value="mqtt">MQTT</option>
                    <option value="kafka">Kafka</option>
                    <option value="nats">NATS</option>
                    <option value="sqs">SQS</option>
                    <option value="eventbridge">EventBridge</option>
                  </optgroup>
                  <optgroup label="Data">
                    <option value="sql">SQL</option>
                    <option value="redis">Redis</option>
                  </optgroup>
                  <optgroup label="System">
                    <option value="ipc">IPC</option>
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                  </optgroup>
                  <optgroup label="Hardware">
                    <option value="i2c">I2C</option>
                    <option value="spi">SPI</option>
                    <option value="uart">UART</option>
                    <option value="can">CAN</option>
                    <option value="dds">DDS</option>
                    <option value="mavlink">MAVLink</option>
                  </optgroup>
                </select>
              </div>
              <div>
                <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px' }}>Schema Format</div>
                <select
                  style={{ ...inputStyles, fontSize: '12px', padding: '6px 10px' }}
                  value={contract.specFormat || 'none'}
                  onChange={(e) => {
                    const patch: PatchOperation = {
                      type: 'update_contract',
                      metadata: createPatchMetadata({ actorType: 'human', summary: `Set spec format to ${e.target.value}` }),
                      payload: { id: contract.id, changes: { specFormat: e.target.value } as any },
                    };
                    onPatchGenerated(patch);
                  }}
                >
                  <option value="none">None</option>
                  <option value="openapi">OpenAPI</option>
                  <option value="graphql_schema">GraphQL Schema</option>
                  <option value="protobuf">Protobuf</option>
                  <option value="asyncapi">AsyncAPI</option>
                  <option value="json_schema">JSON Schema</option>
                  <option value="sql_ddl">SQL DDL</option>
                  <option value="avro">Avro</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* N8.6(B): Behavior — the FIRST UI emitters for set_edge_direction /
          set_edge_criticality. The patches, enums, canvas encodings (arrowheads,
          stroke width) and packet readers all existed; only these controls were
          missing — a half-built surface completed, not new modeling. */}
      <div style={sectionStyles}>
        <div style={labelStyles}>Behavior</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px' }}>Direction</div>
            <select
              style={inputStyles}
              value={edge.direction || 'unidirectional'}
              onChange={(e) => {
                const patch: PatchOperation = {
                  type: 'set_edge_direction',
                  metadata: createPatchMetadata({
                    actorType: 'human',
                    summary: `Set direction to ${e.target.value}`,
                  }),
                  payload: { id: edge.id, direction: e.target.value as 'unidirectional' | 'bidirectional' },
                };
                onPatchGenerated(patch);
              }}
            >
              <option value="unidirectional">One-way (source → target)</option>
              <option value="bidirectional">Two-way (both directions)</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: c.textMuted, marginBottom: '4px' }}>Criticality</div>
            <select
              style={inputStyles}
              value={edge.criticality || 'required'}
              onChange={(e) => {
                const patch: PatchOperation = {
                  type: 'set_edge_criticality',
                  metadata: createPatchMetadata({
                    actorType: 'human',
                    summary: `Set criticality to ${e.target.value}`,
                  }),
                  payload: { id: edge.id, criticality: e.target.value as 'required' | 'optional' | 'fallback' },
                };
                onPatchGenerated(patch);
              }}
            >
              <option value="required">Required — the source cannot function without it</option>
              <option value="optional">Optional — degraded but functional if absent</option>
              <option value="fallback">Fallback — used only when the primary path fails</option>
            </select>
            <div style={{ marginTop: '4px', fontSize: '10px', color: c.textMuted }}>
              Drawn as stroke width on the canvas and read by the task packet's dependency guidance.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

