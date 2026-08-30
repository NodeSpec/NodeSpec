// N5: THE ONE schema-driven configuration form (assessment ruling 2026-07-22 — one
// identity system). Replaces the inspector's bespoke domainMetadata families
// (Language / Framework / Deployment Type / Protocol Config / Managed Service / AI
// Config selects); generalized from the AI-config block, which was already fully
// schema-driven. Renders any catalog `metadata_schema` (technology first, role as
// fallback) — enum / boolean / number / text — and emits one value per change; the
// caller decides where values live (node.metadata.config) and how patches are built.
import { memo } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import type { MetadataFieldSchema } from '@nodespec/core/node-types.js';

interface DynamicMetadataFormProps {
  schema: Record<string, MetadataFieldSchema>;
  values: Record<string, unknown>;
  onUpdate: (key: string, value: string | number | boolean | string[]) => void;
}

function DynamicMetadataFormComponent({ schema, values, onUpdate }: DynamicMetadataFormProps) {
  const { theme } = useTheme();
  const c = theme.colors;

  const inputStyles: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: '6px',
    border: `1px solid ${c.border}`,
    backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.05)' : '#ffffff',
    color: c.text,
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const entries = Object.entries(schema);
  if (entries.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {entries.map(([key, field]) => {
        const currentValue = values[key];

        // N8.4a-4c: options present = enum semantics, whatever the declared type says.
        // 64 catalog rows shipped fields as type "string" WITH options — the strict
        // enum check silently degraded every one of those dropdowns to a text input.
        // The reader is tolerant; N8.3's filing gate normalizes the data shape.
        if (field.options && field.options.length > 0 && field.type !== 'multiselect' && field.type !== 'boolean' && field.type !== 'number') {
          return (
            <div key={key}>
              <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>{field.label}</div>
              <select
                style={{ ...inputStyles, cursor: 'pointer' }}
                value={String(currentValue ?? field.default ?? '')}
                onChange={(e) => onUpdate(key, e.target.value)}
              >
                {(field.options as string[]).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              {field.description && (
                <div style={{ fontSize: '10px', color: c.textMuted, marginTop: '3px' }}>{field.description}</div>
              )}
            </div>
          );
        }

        // N8.1b: multiselect — "which parts of this service do you use" (Stripe API
        // areas et al.). Value is string[]; selections drive packet reference content.
        if (field.type === 'multiselect' && field.options) {
          const selected = Array.isArray(currentValue) ? (currentValue as string[]) : [];
          return (
            <div key={key}>
              <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>{field.label}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {(field.options as string[]).map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: c.text, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(opt)}
                      onChange={(e) => onUpdate(key, e.target.checked ? [...selected, opt] : selected.filter(s => s !== opt))}
                      style={{ accentColor: c.primary }}
                    />
                    {opt}
                  </label>
                ))}
              </div>
              {field.description && (
                <div style={{ fontSize: '10px', color: c.textMuted, marginTop: '3px' }}>{field.description}</div>
              )}
            </div>
          );
        }

        if (field.type === 'boolean') {
          return (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: c.text, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={(currentValue as boolean) ?? (field.default as boolean) ?? false}
                onChange={(e) => onUpdate(key, e.target.checked)}
                style={{ accentColor: c.primary }}
              />
              {field.label}
            </label>
          );
        }

        if (field.type === 'number') {
          const numValue = currentValue !== undefined && currentValue !== null
            ? Number(currentValue)
            : (field.default !== undefined ? Number(field.default) : '');
          return (
            <div key={key}>
              <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>{field.label}</div>
              <input
                type="number"
                style={inputStyles}
                value={numValue}
                step={field.max !== undefined && field.max <= 2 ? 0.1 : 1}
                min={field.min}
                max={field.max}
                placeholder={field.default !== undefined ? String(field.default) : ''}
                onChange={(e) => onUpdate(key, Number(e.target.value))}
              />
              {field.description && (
                <div style={{ fontSize: '10px', color: c.textMuted, marginTop: '3px' }}>{field.description}</div>
              )}
            </div>
          );
        }

        // text / array-as-text / anything else: plain string input
        return (
          <div key={key}>
            <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '4px' }}>{field.label}</div>
            <input
              type="text"
              style={inputStyles}
              value={String(currentValue ?? '')}
              placeholder={field.default !== undefined ? String(field.default) : ''}
              onChange={(e) => onUpdate(key, e.target.value)}
            />
            {field.description && (
              <div style={{ fontSize: '10px', color: c.textMuted, marginTop: '3px' }}>{field.description}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const DynamicMetadataForm = memo(DynamicMetadataFormComponent);
