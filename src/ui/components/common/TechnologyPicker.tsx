import { memo, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { TechnologyCatalogEntry } from '../../../persistence/supabase/catalog-repository.js';
import { getTechnologyLogo } from '../../utils/technology-logo-map.js';
import { getRoleIcon } from '../../utils/palette-roles.js';
import { rankCatalogMatches } from '../../utils/node-nature.js';

interface TechnologyPickerProps {
  position: { x: number; y: number };
  roleId: string;
  roleLabel: string;
  roleColor: string;
  roleIconName: string;
  technologies: TechnologyCatalogEntry[];
  onSelect: (technologyId: string | null) => void;
  onCancel: () => void;
  /** N3.5: role.defaultTechnology — ranked first in the unfiltered list. */
  defaultTechnologyId?: string | null;
  /** N3.5: "define custom" — creates a NODE-LOCAL custom technology (no catalog write). */
  onCustom?: (name: string) => void;
}

function TechnologyPickerComponent({
  position,
  roleLabel,
  roleColor,
  roleIconName,
  technologies,
  onSelect,
  onCancel,
  defaultTechnologyId,
  onCustom,
}: TechnologyPickerProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const ref = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) {
        onCancel();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onCancel]);

  // N3.5: direct-hit ranking + bounded render — this popover is the single place humans
  // meet individual technologies, and the catalog will grow to thousands of entries.
  const RENDER_CAP = 50;
  const ranked = filter
    ? rankCatalogMatches(
        filter,
        technologies.map(t => ({
          id: t.id,
          name: t.name,
          displayName: t.displayName,
          purpose: ((t.aiContext as Record<string, unknown>)?.purpose as string) ?? null,
        })),
        RENDER_CAP,
      ).map(m => technologies.find(t => t.id === m.id)!).filter(Boolean)
    : [...technologies].sort((a, b) => {
        if (a.id === defaultTechnologyId) return -1;
        if (b.id === defaultTechnologyId) return 1;
        return a.name.localeCompare(b.name);
      });
  const filtered = ranked.slice(0, RENDER_CAP);
  const hiddenCount = ranked.length - filtered.length;

  const adjustedX = Math.min(position.x, window.innerWidth - 320);
  const adjustedY = Math.min(position.y, window.innerHeight - 420);

  const RoleIcon = getRoleIcon(roleIconName);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 10000,
        backgroundColor: theme.mode === 'dark' ? 'rgba(30, 41, 59, 0.98)' : 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${c.border}`,
        borderRadius: '12px',
        boxShadow: theme.mode === 'dark'
          ? '0 12px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)'
          : '0 12px 48px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.03)',
        minWidth: '280px',
        maxWidth: '320px',
        maxHeight: '420px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'techPickerFadeIn 0.15s ease-out',
      }}
    >
      <style>{`
        @keyframes techPickerFadeIn {
          from { opacity: 0; transform: translateY(-4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div style={{
        padding: '14px 16px 10px',
        borderBottom: `1px solid ${c.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            backgroundColor: `${roleColor}18`,
            border: `1.5px solid ${roleColor}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: roleColor,
            flexShrink: 0,
          }}>
            <RoleIcon size={16} strokeWidth={2} />
          </div>
          <div>
            <div style={{
              fontSize: '13px',
              fontWeight: 600,
              color: c.text,
              lineHeight: 1.2,
            }}>
              Choose Technology
            </div>
            <div style={{
              fontSize: '11px',
              color: c.textMuted,
              marginTop: '1px',
            }}>
              for {roleLabel}
            </div>
          </div>
        </div>

        {(
          <input
            ref={inputRef}
            type="text"
            placeholder="Search technologies..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '6px',
              border: `1px solid ${c.border}`,
              backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.03)',
              color: c.text,
              fontSize: '12px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            onFocus={e => {
              e.target.style.borderColor = roleColor;
              e.target.style.boxShadow = `0 0 0 2px ${roleColor}25`;
            }}
            onBlur={e => {
              e.target.style.borderColor = c.border;
              e.target.style.boxShadow = 'none';
            }}
          />
        )}
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '6px',
      }}>
        <button
          onClick={() => onSelect(null)}
          onMouseEnter={() => setHoveredId('__generic__')}
          onMouseLeave={() => setHoveredId(null)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 10px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: hoveredId === '__generic__'
              ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)')
              : 'transparent',
            color: c.text,
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: '12px',
            transition: 'background-color 0.1s ease',
            marginBottom: '2px',
          }}
        >
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '6px',
            backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
            border: `1px dashed ${c.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <RoleIcon size={16} strokeWidth={1.5} style={{ color: c.textMuted }} />
          </div>
          <div>
            <div style={{ fontWeight: 500, color: c.textMuted }}>
              No specific technology
            </div>
            <div style={{ fontSize: '11px', color: c.textMuted, opacity: 0.7, marginTop: '1px' }}>
              Generic {roleLabel}
            </div>
          </div>
        </button>

        <div style={{
          height: '1px',
          backgroundColor: c.border,
          margin: '4px 10px',
          opacity: 0.5,
        }} />

        {filtered.map(tech => {
          const logoSrc = getTechnologyLogo(tech.id);
          const isHovered = hoveredId === tech.id;

          return (
            <button
              key={tech.id}
              onClick={() => onSelect(tech.id)}
              onMouseEnter={() => setHoveredId(tech.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isHovered
                  ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)')
                  : 'transparent',
                color: c.text,
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: '12px',
                transition: 'background-color 0.1s ease',
                marginTop: '2px',
              }}
            >
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                backgroundColor: `${tech.brandColor}12`,
                border: `1px solid ${tech.brandColor}30`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                {logoSrc ? (
                  <img
                    src={logoSrc}
                    alt={tech.name}
                    style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: tech.brandColor,
                  }}>
                    {tech.name.charAt(0)}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{tech.name}</div>
              </div>
            </button>
          );
        })}

        {filtered.length === 0 && filter && (
          <div style={{
            padding: '16px',
            textAlign: 'center',
            color: c.textMuted,
            fontSize: '12px',
          }}>
            No technologies match "{filter}"
          </div>
        )}

        {hiddenCount > 0 && (
          <div style={{ padding: '8px 12px', textAlign: 'center', color: c.textMuted, fontSize: '11px' }}>
            {hiddenCount} more — keep typing to narrow
          </div>
        )}

        {onCustom && (
          <button
            onClick={() => onCustom(filter.trim())}
            style={{
              width: '100%', marginTop: '4px', padding: '8px 10px', borderRadius: '8px',
              border: `1px dashed ${c.border}`, backgroundColor: 'transparent',
              color: c.textMuted, cursor: 'pointer', textAlign: 'center', fontSize: '12px',
            }}
          >
            {filter.trim() ? `Use "${filter.trim()}" as a custom technology` : 'Define a custom technology…'}
          </button>
        )}
      </div>
    </div>
  );
}

export const TechnologyPicker = memo(TechnologyPickerComponent);
