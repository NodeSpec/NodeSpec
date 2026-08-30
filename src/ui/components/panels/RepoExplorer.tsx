import { memo, useMemo, useState, useCallback } from 'react';
import type { Graph } from '@nodespec/core/types.js';
import { useTheme } from '../../theme/ThemeContext.js';

interface RepoExplorerProps {
  graph: Graph;
  onFileSelect: (artifactId: string, nodeId: string) => void;
  selectedArtifactId: string | null;
}

const HIGHLIGHT_COLOR = '#22c55e';

interface FileNode {
  type: 'file';
  name: string;
  artifactId: string;
  nodeId: string;
  path: string;
}

interface FolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
  expanded: boolean;
}

type TreeNode = FileNode | FolderNode;

function buildFileTree(graph: Graph): FolderNode {
  const root: FolderNode = {
    type: 'folder',
    name: 'root',
    path: '',
    children: [],
    expanded: true,
  };

  const artifacts = Object.values(graph.artifacts).filter(
    artifact => artifact.status !== 'suggested'
  );

  artifacts.forEach(artifact => {
    if (!artifact.path) return;

    const parts = artifact.path.split('/').filter(p => p.length > 0);
    let currentFolder = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      const folderPath = parts.slice(0, i + 1).join('/');

      let childFolder = currentFolder.children.find(
        child => child.type === 'folder' && child.name === folderName
      ) as FolderNode | undefined;

      if (!childFolder) {
        childFolder = {
          type: 'folder',
          name: folderName,
          path: folderPath,
          children: [],
          expanded: false,
        };
        currentFolder.children.push(childFolder);
      }

      currentFolder = childFolder;
    }

    const fileName = parts[parts.length - 1];
    currentFolder.children.push({
      type: 'file',
      name: fileName,
      artifactId: artifact.id,
      nodeId: artifact.nodeId,
      path: artifact.path,
    });
  });

  const sortTree = (node: TreeNode) => {
    if (node.type === 'folder') {
      node.children.sort((a, b) => {
        if (a.type === 'folder' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortTree);
    }
  };

  sortTree(root);

  return root;
}

function RepoExplorerComponent({ graph, onFileSelect, selectedArtifactId }: RepoExplorerProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const initialTree = useMemo(() => buildFileTree(graph), [graph]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['']));

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const renderTree = (node: TreeNode, depth: number = 0): React.ReactNode => {
    if (node.type === 'file') {
      const isSelected = node.artifactId === selectedArtifactId;
      return (
        <div
          key={node.path}
          style={{
            paddingLeft: `${depth * 16 + 12}px`,
            paddingRight: '8px',
            paddingTop: '5px',
            paddingBottom: '5px',
            cursor: 'pointer',
            backgroundColor: isSelected ? `${HIGHLIGHT_COLOR}15` : 'transparent',
            color: isSelected ? HIGHLIGHT_COLOR : c.text,
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '4px',
            margin: '1px 4px',
          }}
          onClick={() => onFileSelect(node.artifactId, node.nodeId)}
          onMouseEnter={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = `${c.border}40`;
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <span style={{ fontSize: '11px', opacity: 0.6 }}>•</span>
          <span>{node.name}</span>
        </div>
      );
    }

    const isExpanded = expandedFolders.has(node.path);
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.path}>
        <div
          style={{
            paddingLeft: `${depth * 16 + 12}px`,
            paddingRight: '8px',
            paddingTop: '5px',
            paddingBottom: '5px',
            cursor: hasChildren ? 'pointer' : 'default',
            color: c.text,
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '4px',
            margin: '1px 4px',
          }}
          onClick={() => hasChildren && toggleFolder(node.path)}
          onMouseEnter={(e) => {
            if (hasChildren) {
              e.currentTarget.style.backgroundColor = `${c.border}40`;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <span style={{ fontSize: '10px', width: '12px', opacity: 0.6 }}>
            {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
          </span>
          <span style={{ fontWeight: 500 }}>{node.name}</span>
          <span style={{ fontSize: '11px', marginLeft: 'auto', opacity: 0.5 }}>
            {node.children.length}
          </span>
        </div>
        {isExpanded && (
          <div>
            {node.children.map(child => renderTree(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const containerStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyles: React.CSSProperties = {
    padding: '12px 16px',
    borderBottom: `1px solid ${c.border}`,
    fontWeight: 600,
    fontSize: '13px',
    color: c.text,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    userSelect: 'none',
  };

  const treeContainerStyles: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '8px 0',
  };

  const artifactCount = Object.keys(graph.artifacts).length;

  return (
    <div style={containerStyles}>
      <div style={headerStyles}>
        <span>Repository</span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: c.textMuted }}>
          {artifactCount}
        </span>
      </div>
      <div style={treeContainerStyles}>
        {initialTree.children.length > 0 ? (
          initialTree.children.map(child => renderTree(child, 0))
        ) : (
          <div style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: c.textMuted,
            fontSize: '13px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}>
            No artifacts yet
          </div>
        )}
      </div>
    </div>
  );
}

export const RepoExplorer = memo(RepoExplorerComponent);
