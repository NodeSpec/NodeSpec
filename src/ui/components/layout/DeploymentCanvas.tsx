import { memo, useMemo, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { ThemeColors } from '../../theme/index.js';
import type { Graph, Node } from '@nodespec/core/types.js';
import { getNodeTypeById, getNodeTypeDomains } from '@nodespec/core/node-types.js';
import { getCanContainRoleIds, getContainerTypeById } from '@nodespec/core/container-types.js';

interface DeploymentCanvasProps {
  graph: Graph;
  onNodeSelect?: (nodeId: string) => void;
}

interface ContainerTreeNode {
  node: Node;
  layer: 'infrastructure' | 'orchestration' | 'runtime' | 'logical';
  icon: string;
  typeLabel: string;
  childContainers: ContainerTreeNode[];
  childLeaves: Node[];
  depth: number;
}

interface DomainGroupData {
  domainId: string;
  domainLabel: string;
  domainIcon: string;
  nodes: Node[];
}

function isTrueContainer(nodeType: string): boolean {
  const def = getContainerTypeById(nodeType);
  return !!def && getCanContainRoleIds(def).length > 0;
}

const LAYER_COLORS: Record<string, string> = {
  infrastructure: '#3b82f6',
  orchestration: '#0ea5e9',
  runtime: '#10b981',
  logical: '#f59e0b',
};

const LAYER_LABELS: Record<string, string> = {
  infrastructure: 'Infrastructure',
  orchestration: 'Orchestration',
  runtime: 'Runtime',
  logical: 'Logical',
};

function buildContainerTree(graph: Graph): {
  roots: ContainerTreeNode[];
  orphans: Node[];
} {
  const allNodes = Object.values(graph.nodes);
  const containerMap = new Map<string, ContainerTreeNode>();
  const containerIds = new Set<string>();

  for (const node of allNodes) {
    if (!isTrueContainer(node.type)) continue;
    const containerDef = getContainerTypeById(node.type)!;
    containerIds.add(node.id);
    const nodeTypeInfo = getNodeTypeById(node.type);
    containerMap.set(node.id, {
      node,
      layer: containerDef.layer,
      icon: nodeTypeInfo?.icon || containerDef.icon,
      typeLabel: nodeTypeInfo?.label || containerDef.label,
      childContainers: [],
      childLeaves: [],
      depth: 0,
    });
  }

  for (const node of allNodes) {
    if (containerIds.has(node.id)) continue;
    if (node.parentId && containerMap.has(node.parentId)) {
      containerMap.get(node.parentId)!.childLeaves.push(node);
    }
  }

  const roots: ContainerTreeNode[] = [];
  for (const [, treeNode] of containerMap) {
    const parentId = treeNode.node.parentId;
    if (parentId && containerMap.has(parentId)) {
      containerMap.get(parentId)!.childContainers.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  function assignDepths(nodes: ContainerTreeNode[], depth: number) {
    for (const n of nodes) {
      n.depth = depth;
      assignDepths(n.childContainers, depth + 1);
    }
  }
  assignDepths(roots, 0);

  const layerOrder = { infrastructure: 0, orchestration: 1, runtime: 2, logical: 3 };
  roots.sort((a, b) => layerOrder[a.layer] - layerOrder[b.layer]);
  for (const container of containerMap.values()) {
    container.childContainers.sort((a, b) => layerOrder[a.layer] - layerOrder[b.layer]);
  }

  const orphans: Node[] = [];
  for (const node of allNodes) {
    if (containerIds.has(node.id)) continue;
    if (!node.parentId || !containerMap.has(node.parentId)) {
      if (!node.type.startsWith('requirements.')) {
        orphans.push(node);
      }
    }
  }

  return { roots, orphans };
}

function groupOrphansByDomain(orphans: Node[]): DomainGroupData[] {
  const domainMap = new Map<string, Node[]>();

  for (const node of orphans) {
    const prefix = node.type.split('.')[0] || 'other';
    if (!domainMap.has(prefix)) {
      domainMap.set(prefix, []);
    }
    domainMap.get(prefix)!.push(node);
  }

  const groups: DomainGroupData[] = [];
  for (const [prefix, nodes] of domainMap) {
    const domainDef = getNodeTypeDomains().find(d => d.id === prefix);
    groups.push({
      domainId: prefix,
      domainLabel: domainDef?.label || prefix.charAt(0).toUpperCase() + prefix.slice(1),
      domainIcon: domainDef?.icon || '📦',
      nodes,
    });
  }

  return groups.sort((a, b) => a.domainLabel.localeCompare(b.domainLabel));
}

function countAllLeaves(tree: ContainerTreeNode): number {
  let count = tree.childLeaves.length;
  for (const child of tree.childContainers) {
    count += countAllLeaves(child);
  }
  return count;
}

function ComponentChip({
  node,
  onClick,
  colors,
  isDark,
}: {
  node: Node;
  onClick?: () => void;
  colors: ThemeColors;
  isDark: boolean;
}) {
  const typeInfo = getNodeTypeById(node.type);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        backgroundColor: hovered
          ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)')
          : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
        borderRadius: '6px',
        fontSize: '13px',
        color: colors.text,
        cursor: 'pointer',
        transition: 'background-color 0.15s ease',
        border: `1px solid ${hovered ? colors.borderStrong : 'transparent'}`,
      }}
    >
      <span style={{ fontSize: '14px', flexShrink: 0 }}>{typeInfo?.icon || '📦'}</span>
      <span style={{ fontWeight: 500 }}>{node.label}</span>
      {node.status === 'draft' && (
        <span style={{
          fontSize: '10px',
          padding: '1px 5px',
          borderRadius: '3px',
          backgroundColor: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.2)',
          color: '#d97706',
          fontWeight: 600,
        }}>
          DRAFT
        </span>
      )}
    </div>
  );
}

function ContainerRegion({
  tree,
  onNodeSelect,
  colors,
  isDark,
}: {
  tree: ContainerTreeNode;
  onNodeSelect?: (id: string) => void;
  colors: ThemeColors;
  isDark: boolean;
}) {
  const layerColor = LAYER_COLORS[tree.layer] || '#6b7280';
  const totalLeaves = countAllLeaves(tree);
  const depthAlpha = Math.max(0.04, 0.08 - tree.depth * 0.015);

  return (
    <div
      style={{
        border: `2px solid ${layerColor}40`,
        borderLeft: `4px solid ${layerColor}`,
        borderRadius: '12px',
        backgroundColor: isDark
          ? `rgba(${hexToRgb(layerColor)}, ${depthAlpha})`
          : `rgba(${hexToRgb(layerColor)}, ${depthAlpha * 0.7})`,
        padding: '16px',
        marginBottom: tree.depth === 0 ? '16px' : '12px',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: (tree.childContainers.length > 0 || tree.childLeaves.length > 0) ? '12px' : 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: tree.depth === 0 ? '22px' : '18px' }}>{tree.icon}</span>
          <div>
            <div style={{
              fontSize: tree.depth === 0 ? '15px' : '14px',
              fontWeight: 600,
              color: colors.text,
              lineHeight: 1.3,
            }}>
              {tree.node.label}
            </div>
            <div style={{
              fontSize: '12px',
              color: colors.textMuted,
              lineHeight: 1.3,
            }}>
              {tree.typeLabel}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {totalLeaves > 0 && (
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              color: layerColor,
              backgroundColor: isDark
                ? `rgba(${hexToRgb(layerColor)}, 0.15)`
                : `rgba(${hexToRgb(layerColor)}, 0.1)`,
              padding: '2px 8px',
              borderRadius: '10px',
            }}>
              {totalLeaves} component{totalLeaves !== 1 ? 's' : ''}
            </span>
          )}
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            color: layerColor,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            {LAYER_LABELS[tree.layer]}
          </span>
        </div>
      </div>

      {tree.childContainers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
          {tree.childContainers.map(child => (
            <ContainerRegion
              key={child.node.id}
              tree={child}
              onNodeSelect={onNodeSelect}
              colors={colors}
              isDark={isDark}
            />
          ))}
        </div>
      )}

      {tree.childLeaves.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          marginTop: tree.childContainers.length > 0 ? '12px' : 0,
        }}>
          {tree.childLeaves.map(leaf => (
            <ComponentChip
              key={leaf.id}
              node={leaf}
              onClick={() => onNodeSelect?.(leaf.id)}
              colors={colors}
              isDark={isDark}
            />
          ))}
        </div>
      )}

      {tree.childContainers.length === 0 && tree.childLeaves.length === 0 && (
        <div style={{
          fontSize: '12px',
          color: colors.textMuted,
          fontStyle: 'italic',
          marginTop: '8px',
        }}>
          Empty container
        </div>
      )}
    </div>
  );
}

function CoverageBar({
  assigned,
  total,
  isDark,
}: {
  assigned: number;
  total: number;
  isDark: boolean;
}) {
  if (total === 0) return null;
  const pct = Math.round((assigned / total) * 100);
  const barBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const fillColor = pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
      <div style={{
        flex: 1,
        height: '6px',
        borderRadius: '3px',
        backgroundColor: barBg,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          borderRadius: '3px',
          backgroundColor: fillColor,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{
        fontSize: '12px',
        fontWeight: 600,
        color: fillColor,
        minWidth: '64px',
        textAlign: 'right',
      }}>
        {assigned}/{total} assigned
      </span>
    </div>
  );
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '128,128,128';
  return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}

function DeploymentCanvasComponent({ graph, onNodeSelect }: DeploymentCanvasProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';

  const { roots, orphans, domainGroups, stats } = useMemo(() => {
    const { roots, orphans } = buildContainerTree(graph);
    const domainGroups = groupOrphansByDomain(orphans);

    const allNodes = Object.values(graph.nodes).filter(
      n => !n.type.startsWith('requirements.') && !isTrueContainer(n.type)
    );
    const assignedCount = allNodes.filter(n => n.parentId).length;

    return {
      roots,
      orphans,
      domainGroups,
      stats: { assigned: assignedCount, total: allNodes.length },
    };
  }, [graph]);

  const hasContainers = roots.length > 0;
  const hasOrphans = orphans.length > 0;
  const hasNodes = stats.total > 0;

  if (!hasContainers && !hasNodes) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: c.backgroundTertiary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center', padding: '40px', maxWidth: '420px' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '28px',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={c.textMuted} strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="9" x2="9" y2="21" />
            </svg>
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: c.text, marginBottom: '8px' }}>
            No Architecture Yet
          </div>
          <div style={{ fontSize: '13px', color: c.textMuted, lineHeight: 1.5 }}>
            Generate an architecture to see how your components are organized and deployed.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      overflow: 'auto',
      backgroundColor: c.backgroundTertiary,
      padding: '32px',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            fontSize: '20px',
            fontWeight: 700,
            color: c.text,
            marginBottom: '4px',
          }}>
            Environment Map
          </div>
          <div style={{ fontSize: '13px', color: c.textMuted }}>
            {hasContainers
              ? `${roots.length} deployment target${roots.length !== 1 ? 's' : ''} organizing ${stats.total} component${stats.total !== 1 ? 's' : ''}`
              : `${stats.total} component${stats.total !== 1 ? 's' : ''} grouped by domain`
            }
          </div>
          {hasContainers && <CoverageBar assigned={stats.assigned} total={stats.total} isDark={isDark} />}
        </div>

        {hasContainers && (
          <div style={{ marginBottom: hasOrphans ? '32px' : 0 }}>
            {roots.map(root => (
              <ContainerRegion
                key={root.node.id}
                tree={root}
                onNodeSelect={onNodeSelect}
                colors={c}
                isDark={isDark}
              />
            ))}
          </div>
        )}

        {hasOrphans && (
          <div>
            {hasContainers && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '16px',
                paddingTop: '8px',
              }}>
                <div style={{
                  flex: 1,
                  height: '1px',
                  backgroundColor: c.border,
                }} />
                <span style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: c.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                }}>
                  Not assigned to a deployment target
                </span>
                <div style={{
                  flex: 1,
                  height: '1px',
                  backgroundColor: c.border,
                }} />
              </div>
            )}

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '12px',
            }}>
              {domainGroups.map(group => (
                <div
                  key={group.domainId}
                  style={{
                    border: `2px dashed ${c.border}`,
                    borderRadius: '12px',
                    padding: '16px',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.015)',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '12px',
                  }}>
                    <span style={{ fontSize: '16px' }}>{group.domainIcon}</span>
                    <span style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: c.text,
                    }}>
                      {group.domainLabel}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: c.textMuted,
                      marginLeft: 'auto',
                    }}>
                      {group.nodes.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {group.nodes.map(node => (
                      <ComponentChip
                        key={node.id}
                        node={node}
                        onClick={() => onNodeSelect?.(node.id)}
                        colors={c}
                        isDark={isDark}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const DeploymentCanvas = memo(DeploymentCanvasComponent);
