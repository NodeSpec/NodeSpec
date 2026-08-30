import { memo, useState, useCallback } from 'react';
import { FallbackHandles } from './FallbackHandles.js';
import { NodeActionToolbar, useNodeToolbarHover } from './NodeActionToolbar.js';
import { Handle, Position } from '@xyflow/react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';
import { ContainerBadge } from './ContainerBadge.js';
import { getTechnologyLogo, getTechnologyDisplayName } from '../../utils/technology-logo-map.js';
import mongodbIcon from '../../assets/mongodb.png';
import redisIcon from '../../assets/redis.png';

interface SchemaColumn {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
}

interface TableEntry {
  name: string;
  fields?: string[];
  type?: string;
}

interface DatabaseNodeProps {
  data: RFNodeData;
  selected?: boolean;
}

const DB_ICONS: Record<string, string> = {
  mongodb: mongodbIcon,
  redis: redisIcon,
};

const DB_COLORS: Record<string, string> = {
  postgresql: '#336791',
  mysql: '#4479A1',
  mongodb: '#47A248',
  redis: '#DC382D',
  dynamodb: '#4053D6',
  cassandra: '#1287B1',
  neo4j: '#018BFF',
  elasticsearch: '#005571',
  rds: '#FF9900',
  aurora: '#FF9900',
  'supabase-db': '#3ECF8E',
};

const TYPE_COLORS: Record<string, string> = {
  string: '#10b981',
  varchar: '#10b981',
  text: '#10b981',
  int: '#3b82f6',
  integer: '#3b82f6',
  bigint: '#3b82f6',
  smallint: '#3b82f6',
  boolean: '#f59e0b',
  bool: '#f59e0b',
  timestamp: '#8b5cf6',
  datetime: '#8b5cf6',
  date: '#8b5cf6',
  json: '#ec4899',
  jsonb: '#ec4899',
  uuid: '#06b6d4',
  float: '#f97316',
  double: '#f97316',
  decimal: '#f97316',
  array: '#6366f1',
};

function EnhancedDatabaseNodeComponent({ data, selected }: DatabaseNodeProps) {
  // UX-1.3: the action pane shows on hover as well as selection.
  const toolbarHover = useNodeToolbarHover();
  const { theme } = useTheme();
  const c = theme.colors;
  const [isSchemaExpanded, setIsSchemaExpanded] = useState(false);

  const dbType = data.technology || (data.metadata?.dbType as string) || 'postgresql';
  const dbTypeDisplay = getTechnologyDisplayName(data.technology) || dbType;
  const accentColor = DB_COLORS[dbType.toLowerCase()] || '#336791';
  const schema = (data.metadata?.schema as SchemaColumn[]) || [];
  const tables = parseTables(data.metadata?.tables);
  const techLogo = getTechnologyLogo(data.technology);
  const hasCustomIcon = techLogo || DB_ICONS[dbType.toLowerCase()];

  const HIGHLIGHT_COLOR = '#22c55e';

  const toggleSchema = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSchemaExpanded(!isSchemaExpanded);
  }, [isSchemaExpanded]);

  const containerStyles: React.CSSProperties = {
    minWidth: '200px',
    maxWidth: '320px',
    backgroundColor: c.surface,
    borderRadius: '12px',
    border: `2px solid ${accentColor}`,
    boxShadow: selected
      ? `0 0 0 3px ${c.primary}40, 0 8px 24px rgba(0, 0, 0, 0.15)`
      : data.highlighted
        ? `0 0 0 3px ${HIGHLIGHT_COLOR}30, 0 8px 24px rgba(0, 0, 0, 0.15)`
        : '0 4px 12px rgba(0, 0, 0, 0.1)',
    overflow: 'hidden',
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
  };

  const headerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    backgroundColor: `${accentColor}15`,
    borderBottom: `1px solid ${accentColor}30`,
  };

  const iconContainerStyles: React.CSSProperties = {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: c.background,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    border: `1px solid ${accentColor}30`,
  };

  const schemaToggleStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 16px',
    backgroundColor: theme.mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)',
    cursor: schema.length > 0 ? 'pointer' : 'default',
    transition: 'background-color 0.15s ease',
    borderTop: `1px solid ${c.border}`,
  };

  const schemaListStyles: React.CSSProperties = {
    maxHeight: isSchemaExpanded ? '200px' : '0',
    overflow: 'hidden',
    transition: 'max-height 0.3s ease-out',
    backgroundColor: theme.mode === 'dark' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.02)',
  };

  const inputPorts = data.ports.filter(p => p.direction === 'in');
  const outputPorts = data.ports.filter(p => p.direction === 'out');

  return (
    <div style={containerStyles} className="database-node" {...toolbarHover.nodeHoverProps}>
      <NodeActionToolbar visible={!!selected || toolbarHover.hoverVisible} data={data} bridgeProps={toolbarHover.bridgeProps} />

      <FallbackHandles showTarget={inputPorts.length === 0} showSource={outputPorts.length === 0} />
      {inputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          style={{
            width: '12px',
            height: '12px',
            backgroundColor: accentColor,
            border: `3px solid ${c.surface}`,
            top: `${30 + index * 30}px`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
          }}
          title={port.name}
        />
      ))}

      {outputPorts.map((port, index) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          style={{
            width: '12px',
            height: '12px',
            backgroundColor: accentColor,
            border: `3px solid ${c.surface}`,
            top: `${30 + index * 30}px`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
          }}
          title={port.name}
        />
      ))}

      <div style={headerStyles}>
        <div style={iconContainerStyles}>
          {hasCustomIcon ? (
            <img
              src={typeof hasCustomIcon === 'string' ? hasCustomIcon : undefined}
              alt={dbType}
              style={{ width: '28px', height: '28px', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: '24px' }}>🗄️</span>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontWeight: 600,
            fontSize: '14px',
            color: c.text,
            marginBottom: '2px',
          }}>
            {data.label}
          </div>
          <div style={{
            fontSize: '11px',
            color: accentColor,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {dbTypeDisplay}
          </div>
        </div>
      </div>

      {data.containerParentLabel && (
        <div style={{ padding: '4px 16px 0' }}>
          <ContainerBadge label={data.containerParentLabel} placementKind={data.containerPlacementKind} />
        </div>
      )}

      {schema.length > 0 && (
        <>
          <div
            style={schemaToggleStyles}
            onClick={toggleSchema}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark'
                ? 'rgba(0,0,0,0.3)'
                : 'rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark'
                ? 'rgba(0,0,0,0.2)'
                : 'rgba(0,0,0,0.03)';
            }}
          >
            <span style={{ fontSize: '11px', color: c.textMuted, fontWeight: 500 }}>
              Schema ({schema.length} columns)
            </span>
            <span style={{
              fontSize: '10px',
              color: c.textMuted,
              transform: isSchemaExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}>
              ▼
            </span>
          </div>

          <div style={schemaListStyles}>
            {schema.map((col, i) => (
              <div
                key={i}
                className="schema-column"
                style={{
                  borderBottom: i < schema.length - 1 ? `1px solid ${c.border}` : 'none',
                }}
              >
                {col.primaryKey && (
                  <span style={{ fontSize: '10px', color: '#f59e0b' }}>🔑</span>
                )}
                <span style={{
                  flex: 1,
                  color: c.text,
                  fontWeight: col.primaryKey ? 600 : 400,
                }}>
                  {col.name}
                </span>
                <span
                  className="schema-column-type"
                  style={{
                    backgroundColor: `${TYPE_COLORS[col.type.toLowerCase()] || '#6b7280'}20`,
                    color: TYPE_COLORS[col.type.toLowerCase()] || '#6b7280',
                  }}
                >
                  {col.type}
                </span>
                {col.nullable && (
                  <span style={{ fontSize: '9px', color: c.textMuted }}>?</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {schema.length === 0 && tables.length > 0 && (
        <>
          <div
            style={schemaToggleStyles}
            onClick={toggleSchema}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark'
                ? 'rgba(0,0,0,0.3)'
                : 'rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark'
                ? 'rgba(0,0,0,0.2)'
                : 'rgba(0,0,0,0.03)';
            }}
          >
            <span style={{ fontSize: '11px', color: c.textMuted, fontWeight: 500 }}>
              {tables.length} {tables.length === 1 ? 'table' : 'tables'}
            </span>
            <span style={{
              fontSize: '10px',
              color: c.textMuted,
              transform: isSchemaExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}>
              ▼
            </span>
          </div>
          <div style={schemaListStyles}>
            {tables.map((table, i) => (
              <div
                key={i}
                style={{
                  padding: '6px 16px',
                  borderBottom: i < tables.length - 1 ? `1px solid ${c.border}` : 'none',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}>
                  <span style={{ fontSize: '10px', color: accentColor }}>
                    {table.type === 'collection' ? '📁' : '🗃️'}
                  </span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: c.text,
                    fontFamily: 'monospace',
                  }}>
                    {table.name}
                  </span>
                </div>
                {table.fields && table.fields.length > 0 && (
                  <div style={{
                    marginTop: '3px',
                    marginLeft: '16px',
                    fontSize: '10px',
                    color: c.textMuted,
                    lineHeight: '1.4',
                  }}>
                    {table.fields.slice(0, 4).join(', ')}
                    {table.fields.length > 4 && ` +${table.fields.length - 4}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {schema.length === 0 && tables.length === 0 && (
        <DatabaseConfigSummary metadata={data.metadata} accentColor={accentColor} colors={c} />
      )}
    </div>
  );
}

export const EnhancedDatabaseNode = memo(EnhancedDatabaseNodeComponent);

function parseTables(raw: unknown): TableEntry[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => {
        if (typeof entry === 'string') return { name: entry };
        if (typeof entry === 'object' && entry !== null && 'name' in entry) {
          const e = entry as Record<string, unknown>;
          return {
            name: String(e.name),
            fields: Array.isArray(e.fields) ? e.fields.map(String) : undefined,
            type: typeof e.type === 'string' ? e.type : undefined,
          };
        }
        return null;
      })
      .filter((t): t is TableEntry => t !== null);
  }
  return [];
}

const CONFIG_KEYS: Array<{ key: string; label: string }> = [
  { key: 'host', label: 'Host' },
  { key: 'port', label: 'Port' },
  { key: 'database', label: 'Database' },
  { key: 'region', label: 'Region' },
  { key: 'engine', label: 'Engine' },
  { key: 'replication', label: 'Replication' },
  { key: 'ssl', label: 'SSL' },
  { key: 'billingMode', label: 'Billing' },
  { key: 'consistencyLevel', label: 'Consistency' },
  { key: 'connectionPooling', label: 'Pool' },
];

function DatabaseConfigSummary({
  metadata,
  accentColor,
  colors: c,
}: {
  metadata: Record<string, unknown>;
  accentColor: string;
  colors: ReturnType<typeof useTheme>['theme']['colors'];
}) {
  const description = metadata?.description as string | undefined
    || (metadata as Record<string, unknown>)?.rationale as string | undefined;

  const configPairs = CONFIG_KEYS
    .filter(({ key }) => metadata?.[key] != null && metadata[key] !== '')
    .slice(0, 3);

  if (!description && configPairs.length === 0) {
    return (
      <div style={{
        padding: '10px 16px',
        fontSize: '11px',
        color: c.textMuted,
        textAlign: 'center',
        fontStyle: 'italic',
      }}>
        Describe in the inspector to configure
      </div>
    );
  }

  return (
    <div style={{ padding: '8px 16px 10px' }}>
      {description && (
        <div style={{
          fontSize: '11px',
          color: c.textSecondary,
          lineHeight: '1.4',
          marginBottom: configPairs.length > 0 ? '6px' : 0,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {description}
        </div>
      )}
      {configPairs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {configPairs.map(({ key, label }) => (
            <span
              key={key}
              style={{
                fontSize: '9px',
                fontWeight: 500,
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: `${accentColor}12`,
                color: accentColor,
                whiteSpace: 'nowrap',
              }}
            >
              {label}: {String(metadata[key])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
