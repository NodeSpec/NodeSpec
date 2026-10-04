// AJ.6 (owner 2026-09-30): the account's example project shows every feature
// the build ships. What the owner's plan does not carry shows there with the
// example's data and does not change: this is the line that says so, on the
// surface that holds it.
import type { CSSProperties } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { Feature } from '../../config/feature-rules.js';
import { viewOnlyLine } from '../../utils/example-project.js';

export function ViewOnlyNote({ feature, style }: { feature: Feature; style?: CSSProperties }) {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <p
      role="note"
      data-testid="view-only-note"
      data-feature={feature}
      style={{
        margin: 0,
        padding: '6px 10px',
        borderRadius: 6,
        border: `1px solid ${c.border}`,
        background: c.surface,
        color: c.textSecondary,
        fontSize: 12,
        lineHeight: 1.45,
        ...style,
      }}
    >
      {viewOnlyLine(feature)}
    </p>
  );
}
