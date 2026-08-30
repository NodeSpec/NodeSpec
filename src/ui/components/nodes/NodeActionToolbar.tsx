import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { NodeToolbar, Position } from '@xyflow/react';
import { Lock, LockOpen as Unlock, Share2, Trash2, LogOut, LogIn, ChevronDown } from 'lucide-react';
import type { RFNodeData } from '../../adapters/graph-to-reactflow.js';
import { useTheme } from '../../theme/ThemeContext.js';

// Owner merge ruling 2026-08-13: ONE professional pane under the clicked node
// carries every node action — lock/unlock (blocks AI-proposed patches against
// the node), export context, dock/undock from container, delete. The Scaffold
// button is GONE: it routed to the retired internal agent's chat pane and had
// been a silent no-op since.
// UX-1.3 (owner ruling 2026-08-21): the pane appears on HOVER as well as
// selection — "it should just appear upon node click or hover" — and the
// right-click menu is deprecated COMPLETELY, so Add-to-Container moved here
// as the Dock popover. The pane is React Flow-portaled with a 12px gap below
// the node, so hover visibility needs a BRIDGE: leaving the node starts a
// grace timer, entering the pane cancels it — otherwise the pointer could
// never reach the buttons it revealed.
//
// Rendered by every action-bearing node component; React Flow portals it
// below the node, so it never affects node measurement or edge anchoring.

/** Hover-visibility with a grace window bridging the node→toolbar gap.
 *  Spread nodeHoverProps on the node's root, bridgeProps rides the toolbar. */
export function useNodeToolbarHover(showDelayMs = 150, hideDelayMs = 300) {
  const [hoverVisible, setHoverVisible] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (ref: typeof showTimer) => {
    if (ref.current !== null) { clearTimeout(ref.current); ref.current = null; }
  };
  const nodeEnter = useCallback(() => {
    clear(hideTimer);
    if (showTimer.current === null) {
      showTimer.current = setTimeout(() => { showTimer.current = null; setHoverVisible(true); }, showDelayMs);
    }
  }, [showDelayMs]);
  const leave = useCallback(() => {
    clear(showTimer);
    clear(hideTimer);
    hideTimer.current = setTimeout(() => { hideTimer.current = null; setHoverVisible(false); }, hideDelayMs);
  }, [hideDelayMs]);
  const bridgeEnter = useCallback(() => {
    clear(hideTimer); clear(showTimer);
    setHoverVisible(true);
  }, []);
  useEffect(() => () => { clear(showTimer); clear(hideTimer); }, []);
  return {
    hoverVisible,
    nodeHoverProps: { onMouseEnter: nodeEnter, onMouseLeave: leave },
    bridgeProps: { onMouseEnter: bridgeEnter, onMouseLeave: leave },
  };
}

interface NodeActionToolbarProps {
  visible: boolean;
  data: RFNodeData;
  /** Hover-bridge handlers from useNodeToolbarHover — keeps the pane open
   *  while the pointer crosses the gap onto it. */
  bridgeProps?: { onMouseEnter: () => void; onMouseLeave: () => void };
}

function NodeActionToolbarComponent({ visible, data, bridgeProps }: NodeActionToolbarProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';

  const isLocked = data.isLocked || false;
  const artifactCount = data.artifactCount || 0;
  const [dockOpen, setDockOpen] = useState(false);
  // A hidden toolbar must not keep a stale popover for its next appearance.
  useEffect(() => { if (!visible) setDockOpen(false); }, [visible]);
  const containerOptions = data.containerOptions ?? [];

  const stop = (e: React.MouseEvent, action?: () => void) => {
    e.stopPropagation();
    action?.();
  };

  const actionButton = (opts: {
    label: string;
    icon: React.ReactNode;
    onClick?: () => void;
    title: string;
    tone?: 'default' | 'active' | 'danger';
    trailing?: React.ReactNode;
  }) => {
    const tone = opts.tone ?? 'default';
    const color = tone === 'danger' ? '#dc2626' : tone === 'active' ? '#16a34a' : c.text;
    return (
      <button
        type="button"
        onClick={(e) => stop(e, opts.onClick)}
        title={opts.title}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          padding: '5px 10px',
          borderRadius: '6px',
          border: 'none',
          backgroundColor: tone === 'active' ? 'rgba(22,163,74,0.12)' : 'transparent',
          color,
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = tone === 'danger'
            ? 'rgba(220,38,38,0.12)'
            : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = tone === 'active' ? 'rgba(22,163,74,0.12)' : 'transparent';
        }}
      >
        {opts.icon}
        {opts.label}
        {opts.trailing}
      </button>
    );
  };

  const divider = (
    <div style={{
      width: '1px', height: '18px', margin: '0 2px',
      backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)',
    }} />
  );

  return (
    <NodeToolbar
      isVisible={visible}
      position={Position.Bottom}
      offset={12}
      className="nodrag nopan"
    >
      <div
        {...(bridgeProps ?? {})}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: '9px',
          padding: '4px',
          boxShadow: isDark ? '0 8px 22px rgba(0,0,0,0.4)' : '0 8px 22px rgba(0,0,0,0.14)',
        }}
      >
        {actionButton({
          label: isLocked ? 'Locked' : 'Lock',
          icon: isLocked ? <Lock size={12} /> : <Unlock size={12} />,
          onClick: data.onToggleLock,
          title: isLocked
            ? 'Locked — AI proposals cannot modify this node. Click to unlock.'
            : 'Unlocked — click to lock and block AI proposals against this node.',
          tone: isLocked ? 'active' : 'default',
        })}

        {data.onExport && actionButton({
          label: 'Export',
          icon: <Share2 size={12} />,
          onClick: data.onExport,
          title: 'Export this node’s context (JSON)',
        })}

        {(data.onUndock || data.onDelete || (containerOptions.length > 0 && data.onAssignToContainer)) && divider}

        {data.onUndock && actionButton({
          label: 'Undock',
          icon: <LogOut size={12} />,
          onClick: data.onUndock,
          title: 'Undock this node from its container',
        })}

        {/* UX-1.3: Add-to-Container lived only in the deprecated right-click
            menu — it is the Dock popover now. */}
        {containerOptions.length > 0 && data.onAssignToContainer && actionButton({
          label: 'Dock',
          icon: <LogIn size={12} />,
          onClick: () => setDockOpen(o => !o),
          title: 'Place this node inside a container',
          tone: dockOpen ? 'active' : 'default',
          trailing: <ChevronDown size={10} style={{ transform: dockOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />,
        })}

        {dockOpen && containerOptions.length > 0 && data.onAssignToContainer && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            minWidth: '180px', maxHeight: '220px', overflowY: 'auto',
            backgroundColor: c.surface, border: `1px solid ${c.border}`,
            borderRadius: '8px', padding: '4px',
            boxShadow: isDark ? '0 10px 26px rgba(0,0,0,0.45)' : '0 10px 26px rgba(0,0,0,0.16)',
            zIndex: 10,
          }}>
            {containerOptions.map(option => (
              <button
                key={option.id}
                type="button"
                onClick={(e) => stop(e, () => { setDockOpen(false); data.onAssignToContainer?.(option.id); })}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '6px 10px', borderRadius: '5px', border: 'none',
                  backgroundColor: 'transparent', color: c.text,
                  fontSize: '11.5px', fontWeight: 500,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {data.onDelete && actionButton({
          label: 'Delete',
          icon: <Trash2 size={12} />,
          onClick: data.onDelete,
          title: 'Delete this node (its edges must be removed first)',
          tone: 'danger',
        })}

        {artifactCount > 0 && (
          <>
            {divider}
            <span style={{
              padding: '0 8px',
              fontSize: '10px',
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: '#16a34a',
              whiteSpace: 'nowrap',
            }}>
              {artifactCount} {artifactCount === 1 ? 'file' : 'files'}
            </span>
          </>
        )}
      </div>
    </NodeToolbar>
  );
}

export const NodeActionToolbar = memo(NodeActionToolbarComponent);
