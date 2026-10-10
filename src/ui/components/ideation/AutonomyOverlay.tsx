// V3 8.2: the Autonomy overlay — the design's per-lane segmented controls
// behind the header's Agents button. One row per tier lane: the three-way
// control (Ask first / Propose / Auto-apply), the scope the lane governs,
// and one sentence that states the effect of the CURRENT setting. Owner's
// ruling 2026-09-21: short copy, and every row wraps inside the panel. Code is NOT a row (M.3, owner 2026-09-22): it is policy, pinned at 0 by the resolver and the server (the database refuses
// to raise it) and says why. The two presets are the design's "Approve
// each" and "Auto". A save the seat may not make is surfaced, never
// swallowed.
import { memo } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { eyebrow } from './typography.js';
import type { AutonomySettings } from './useAutonomySettings.js';
import {
  AUTONOMY_LANES_SHOWN, LANE_LABEL, LANE_SCOPE, LEVEL_LABEL, laneEffect, policySummary,
  type AutonomyLevel,
} from '../../utils/autonomy.js';

const LEVELS: readonly AutonomyLevel[] = [0, 1, 2];

interface AutonomyOverlayProps {
  settings: AutonomySettings;
  onClose: () => void;
}

function AutonomyOverlayComponent({ settings, onClose }: AutonomyOverlayProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const summary = policySummary(settings.policy);

  const seg = (on: boolean, disabled: boolean): React.CSSProperties => ({
    border: 'none', borderRadius: '7px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled && !on ? 0.45 : 1,
    backgroundColor: on ? c.primary : 'transparent', color: on ? '#fff' : c.textSecondary,
  });
  const preset = (on: boolean): React.CSSProperties => ({
    fontSize: '11px', fontWeight: 600, borderRadius: '7px', padding: '5px 10px', cursor: 'pointer',
    border: `1px solid ${on ? c.primary : c.border}`, backgroundColor: on ? `${c.primary}1f` : 'transparent', color: on ? c.primary : c.textSecondary,
  });

  return (
    <div
      data-testid="autonomy-overlay"
      role="dialog"
      aria-label="Autonomy settings"
      style={{ borderRadius: '14px', border: `1px solid ${c.border}`, backgroundColor: c.surface, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={eyebrow(c.primary)}>Autonomy</div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', color: c.textSecondary, cursor: 'pointer', padding: '2px' }}><X size={14} /></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <div data-testid="autonomy-descriptor" style={{ fontSize: '12.5px', color: c.textSecondary, flex: '1 1 220px', minWidth: 0 }}>What agents may do on each tier without asking.</div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button data-testid="autonomy-preset-approve" onClick={() => void settings.applyPreset('approve')} style={preset(summary === 'Approve each')} title="Every agent change waits for you">Approve each</button>
          <button data-testid="autonomy-preset-auto" onClick={() => void settings.applyPreset('auto')} style={preset(summary === 'Auto')} title="Agents apply; you review in the log">Auto</button>
        </div>
      </div>

      {settings.sweepNote && (
        <div data-testid="autonomy-sweep" role="status" style={{ fontSize: '12px', color: c.textSecondary, padding: '6px 10px', borderRadius: '8px', border: `1px solid ${c.border}` }}>{settings.sweepNote}</div>
      )}
      {settings.error && (
        <div data-testid="autonomy-error" role="alert" style={{ fontSize: '12px', color: '#ee6b70', padding: '6px 10px', borderRadius: '8px', border: '1px solid #ee6b7055' }}>{settings.error}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {AUTONOMY_LANES_SHOWN.map((lane) => {
          const level = settings.policy[lane];
          return (
            <div key={lane} data-testid="autonomy-lane" data-lane={lane} data-level={level} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px 10px', borderRadius: '10px', border: `1px solid ${c.border}`, backgroundColor: c.background, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 650, color: c.text }}>{LANE_LABEL[lane]}</div>
                  <div style={{ fontSize: '11px', color: c.textSecondary, lineHeight: 1.4, marginTop: '2px', overflowWrap: 'anywhere' }}>{LANE_SCOPE[lane]}</div>
                </div>
                <div role="radiogroup" aria-label={`${LANE_LABEL[lane]} autonomy`} style={{ display: 'flex', gap: '3px', padding: '3px', borderRadius: '9px', border: `1px solid ${c.border}`, flexShrink: 0 }}>
                  {LEVELS.map((l) => (
                    <button
                      key={l}
                      role="radio"
                      aria-checked={level === l}
                      data-testid={`autonomy-level-${lane}-${l}`}
                      disabled={settings.saving}
                      onClick={() => { if (level !== l) void settings.setLane(lane, l); }}
                      style={seg(level === l, false)}
                      title={LEVEL_LABEL[l]}
                    >
                      {LEVEL_LABEL[l]}
                    </button>
                  ))}
                </div>
              </div>
              <div data-testid="autonomy-effect" style={{ fontSize: '12px', lineHeight: 1.5, color: c.textSecondary, overflowWrap: 'anywhere' }}>
                {laneEffect(lane, level)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const AutonomyOverlay = memo(AutonomyOverlayComponent);
