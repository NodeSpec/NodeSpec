import { useState, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Code2, ChevronDown, ChevronRight, FileCode, Package } from 'lucide-react';
import { useCodeStructure } from '../../context/ServiceContext.js';
import type { Graph } from '@nodespec/core/types.js';

interface CodeEntity {
  type: 'class' | 'function' | 'interface' | 'type' | 'variable' | 'import';
  name: string;
  line?: number;
  members?: Array<{ name: string; type: string; line?: number }>;
  params?: Array<{ name: string; type?: string }>;
  returnType?: string;
}

interface CodeStructure {
  id: string;
  node_id: string;
  artifact_id: string | null;
  entities: CodeEntity[];
  language: string;
  metrics?: { filename?: string; lines_of_code?: number };
  parsed_at: string;
}

interface ProjectCodeViewProps {
  graph: Graph;
  onNodeSelect?: (nodeId: string) => void;
}

export function ProjectCodeView({ graph }: ProjectCodeViewProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const codeStructureService = useCodeStructure();

  const [structures, setStructures] = useState<CodeStructure[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadAllCodeStructures();
  }, [graph.metadata?.projectId]);

  const loadAllCodeStructures = async () => {
    const projectId = graph.metadata?.projectId as string;
    if (!projectId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await codeStructureService.getByProjectId(projectId);

      if (data) {
        setStructures(data as any);
      }
    } catch (error) {
      console.error('[ProjectCodeView] Error loading structures:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const toggleEntity = (entityKey: string) => {
    setExpandedEntities(prev => {
      const next = new Set(prev);
      if (next.has(entityKey)) {
        next.delete(entityKey);
      } else {
        next.add(entityKey);
      }
      return next;
    });
  };

  const getNodeLabel = (nodeId: string) => {
    const node = graph.nodes[nodeId];
    return node ? node.label : 'Unknown Node';
  };

  // Group structures by node
  const structuresByNode = structures.reduce((acc, structure) => {
    if (!acc[structure.node_id]) {
      acc[structure.node_id] = [];
    }
    acc[structure.node_id].push(structure);
    return acc;
  }, {} as Record<string, CodeStructure[]>);

  const getEntityTypeIcon = (type: string) => {
    switch (type) {
      case 'class': return '🏛️';
      case 'function': return '⚡';
      case 'interface': return '🔌';
      case 'type': return '📐';
      case 'import': return '📦';
      case 'variable': return '📊';
      default: return '•';
    }
  };

  if (loading) {
    return (
      <div style={{
        padding: '24px',
        textAlign: 'center',
        color: c.textMuted,
        fontSize: '12px',
      }}>
        Loading parsed code...
      </div>
    );
  }

  if (structures.length === 0) {
    return (
      <div style={{
        padding: '24px',
        textAlign: 'center',
        color: c.textMuted,
        fontSize: '12px',
      }}>
        <Code2 size={48} opacity={0.3} style={{ marginBottom: '12px' }} />
        <div style={{ marginBottom: '8px', fontWeight: 500, color: c.text }}>
          No code parsed yet
        </div>
        <div style={{ fontSize: '11px', maxWidth: '280px', margin: '0 auto', lineHeight: '1.5' }}>
          Right-click any node in the canvas and select "Parse Code Structure" to analyze source files.
        </div>
      </div>
    );
  }

  const totalEntities = structures.reduce((sum, s) => sum + s.entities.length, 0);
  const languages = [...new Set(structures.map(s => s.language))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Summary Stats */}
      <div style={{
        padding: '12px',
        backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
        borderBottom: `1px solid ${c.border}`,
        display: 'flex',
        gap: '16px',
        fontSize: '11px',
        color: c.textMuted,
        flexShrink: 0,
      }}>
        <div>
          <strong style={{ color: c.text }}>{Object.keys(structuresByNode).length}</strong> nodes
        </div>
        <div>
          <strong style={{ color: c.text }}>{structures.length}</strong> files
        </div>
        <div>
          <strong style={{ color: c.text }}>{totalEntities}</strong> entities
        </div>
        <div>
          <strong style={{ color: c.text }}>{languages.join(', ')}</strong>
        </div>
      </div>

      {/* Code Structures by Node */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
      }}>
        {Object.entries(structuresByNode).map(([nodeId, nodeStructures]) => {
          const isExpanded = expandedNodes.has(nodeId);
          const nodeLabel = getNodeLabel(nodeId);
          const totalNodeEntities = nodeStructures.reduce((sum, s) => sum + s.entities.length, 0);

          return (
            <div key={nodeId} style={{
              marginBottom: '12px',
              border: `1px solid ${c.border}`,
              borderRadius: '8px',
              backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.9)',
              overflow: 'hidden',
            }}>
              {/* Node Header */}
              <div
                style={{
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  cursor: 'pointer',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
                  transition: 'background-color 0.2s',
                }}
                onClick={() => toggleNode(nodeId)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)';
                }}
              >
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <Package size={16} style={{ color: c.primary }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>
                    {nodeLabel}
                  </div>
                  <div style={{ fontSize: '10px', color: c.textMuted, marginTop: '2px' }}>
                    {nodeStructures.length} file{nodeStructures.length !== 1 ? 's' : ''} • {totalNodeEntities} entities
                  </div>
                </div>
              </div>

              {/* Node Structures */}
              {isExpanded && (
                <div style={{ padding: '12px' }}>
                  {nodeStructures.map((structure) => {
                    const classesAndFunctions = structure.entities.filter(
                      e => e.type === 'class' || e.type === 'function' || e.type === 'interface' || e.type === 'type'
                    );

                    return (
                      <div key={structure.id} style={{
                        marginBottom: '10px',
                        padding: '10px',
                        backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
                        borderRadius: '6px',
                        border: `1px solid ${c.border}`,
                      }}>
                        {/* File Header */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: classesAndFunctions.length > 0 ? '10px' : '0',
                          paddingBottom: classesAndFunctions.length > 0 ? '8px' : '0',
                          borderBottom: classesAndFunctions.length > 0 ? `1px solid ${c.border}` : 'none',
                        }}>
                          <FileCode size={14} style={{ color: c.primary }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: c.text }}>
                              {structure.metrics?.filename || 'Unknown file'}
                            </div>
                          </div>
                          <span style={{
                            fontSize: '9px',
                            padding: '2px 6px',
                            backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
                            borderRadius: '4px',
                            color: c.textMuted,
                            fontWeight: 600,
                          }}>
                            {structure.language}
                          </span>
                        </div>

                        {/* Entities */}
                        {classesAndFunctions.length === 0 ? (
                          <div style={{ fontSize: '10px', color: c.textMuted, fontStyle: 'italic', textAlign: 'center', padding: '8px' }}>
                            No classes or functions found
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {classesAndFunctions.map((entity, idx) => {
                              const entityKey = `${structure.id}-${entity.name}`;
                              const isEntityExpanded = expandedEntities.has(entityKey);
                              const hasMembers = entity.members && entity.members.length > 0;

                              return (
                                <div key={idx}>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      padding: '6px 8px',
                                      backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.5)',
                                      borderRadius: '4px',
                                      fontSize: '11px',
                                      cursor: hasMembers ? 'pointer' : 'default',
                                    }}
                                    onClick={() => hasMembers && toggleEntity(entityKey)}
                                  >
                                    {hasMembers && (
                                      <span style={{ fontSize: '10px', opacity: 0.7 }}>
                                        {isEntityExpanded ? '▼' : '▶'}
                                      </span>
                                    )}
                                    <span style={{ fontSize: '12px' }}>
                                      {getEntityTypeIcon(entity.type)}
                                    </span>
                                    <span style={{ fontFamily: 'monospace', color: c.text, fontWeight: 500, flex: 1 }}>
                                      {entity.name}
                                    </span>
                                    {entity.line && (
                                      <span style={{ fontSize: '9px', color: c.textMuted }}>
                                        L{entity.line}
                                      </span>
                                    )}
                                  </div>

                                  {/* Members */}
                                  {hasMembers && isEntityExpanded && (
                                    <div style={{ marginLeft: '32px', marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      {entity.members!.map((member, midx) => (
                                        <div key={midx} style={{
                                          fontSize: '10px',
                                          color: c.textSecondary,
                                          padding: '4px 8px',
                                          backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
                                          borderRadius: '3px',
                                          fontFamily: 'monospace',
                                        }}>
                                          <span style={{ opacity: 0.5 }}>└─</span> {member.name}
                                          <span style={{ opacity: 0.7, marginLeft: '6px' }}>: {member.type}</span>
                                          {member.line && (
                                            <span style={{ marginLeft: '8px', opacity: 0.5 }}>L{member.line}</span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
