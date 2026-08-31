import { useState } from 'react';
import { deploymentTiers } from './pricing-data.js';
import type { DeploymentTierId } from './pricing-data.js';

const BRAND = '#8B8FE6';
const DARK_BG = '#0f1117';
const DARK_SURFACE = '#1a1d26';
const BORDER_COLOR = 'rgba(139, 143, 230, 0.1)';

interface FeatureRow {
  label: string;
  category?: boolean;
  values: (string | boolean)[];
}

// Column order matches deploymentTiers (owner design 2026-08-26):
// Community (container) · Free (hosted) · Indie · Team · Enterprise · Government.
// The platform block ships in every tier; each step up is additive — Indie
// adds repo import, Team adds the teamwork lane, Enterprise is everything but
// Government-specific, Government is everything.
function getFeatureRows(): FeatureRow[] {
  return [
    { label: 'Scale', category: true, values: [] },
    { label: 'Where it runs', values: ['Your container', 'Hosted', 'Hosted', 'Hosted', 'Self-hosted', 'Gov enclave'] },
    { label: 'Projects', values: ['Unlimited (local)', '2', 'Unlimited', 'Unlimited', 'Unlimited', 'Unlimited'] },
    { label: 'Users', values: ['Self-managed', '1', '1', 'Per seat', 'Custom', 'Custom'] },
    { label: 'The platform — every tier', category: true, values: [] },
    { label: 'MCP-native connection for your AI', values: [true, true, true, true, true, true] },
    { label: 'Git connection & git provenance', values: [true, true, true, true, true, true] },
    { label: 'Full spec-driven development engine', values: [true, true, true, true, true, true] },
    { label: 'Architecture Canvas', values: [true, true, true, true, true, true] },
    { label: 'Node technology catalog', values: ['Open catalog', 'Full', 'Full', 'Full', 'Full + custom', 'Full + gov-only'] },
    { label: 'Repo intelligence — Indie and up', category: true, values: [] },
    { label: 'Repo import reverse visualization & deduction', values: [false, false, true, true, true, true] },
    { label: 'Teamwork — Team and up', category: true, values: [] },
    { label: 'Notion, Atlassian & Slack node tagging', values: [false, false, false, true, true, true] },
    { label: 'Workflow Designer — UX to Requirements', values: [false, false, false, true, true, true] },
    { label: 'Deployment & support', category: true, values: [] },
    { label: 'Licensed self-host deployment', values: [false, false, false, false, true, true] },
    { label: 'Internal customer authentication', values: [false, false, false, false, true, true] },
    { label: 'Custom catalog additions', values: [false, false, false, false, true, true] },
    { label: 'Dedicated onboarding & support', values: [false, false, false, false, true, true] },
    { label: 'Government', category: true, values: [] },
    { label: 'Compliant Government cloud enclaves', values: [false, false, false, false, false, true] },
    { label: 'Gov-only node additions & context', values: [false, false, false, false, false, true] },
    { label: 'Compliance package builder', values: [false, false, false, false, false, true] },
    { label: 'Any foundational or open-weight model', values: [false, false, false, false, false, true] },
  ];
}

const highlightIdx = deploymentTiers.findIndex((t) => t.highlighted);

interface PricingComparisonTableProps {
  /** Owner 2026-08-31: Indie sells monthly ($15/mo) or annual ($144/yr) — the
   *  interval arrives from the card's CTA pair; every other tier ignores it. */
  onSelect: (tierId: DeploymentTierId, interval?: 'month' | 'year') => void;
  loading?: boolean;
}

/** The annual secondary action under Indie's monthly CTA. */
function AnnualLink({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        marginTop: '8px',
        padding: 0,
        background: 'none',
        border: 'none',
        fontSize: '11.5px',
        fontWeight: 600,
        color: '#8a8f9e',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textDecoration: 'underline',
        textUnderlineOffset: '3px',
      }}
    >
      or $144 billed yearly — save 20%
    </button>
  );
}

export function PricingComparisonTable({ onSelect, loading = false }: PricingComparisonTableProps) {
  const [expandedMobile, setExpandedMobile] = useState<number | null>(null);
  const featureRows = getFeatureRows();

  return (
    <>
      {/* Desktop table */}
      <div className="pricing-table-desktop" style={{
        width: '100%',
        maxWidth: '1100px',
        overflowX: 'auto',
        borderRadius: '12px',
        border: `1px solid ${BORDER_COLOR}`,
        backgroundColor: DARK_SURFACE,
      }}>
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr>
              <th style={{
                textAlign: 'left',
                padding: '20px 24px',
                backgroundColor: DARK_BG,
                borderBottom: `1px solid ${BORDER_COLOR}`,
                color: '#8a8f9e',
                fontWeight: 500,
                fontSize: '13px',
                width: '180px',
                position: 'sticky',
                left: 0,
                zIndex: 2,
              }}>
                Compare tiers
              </th>
              {deploymentTiers.map((tier, idx) => (
                <th key={tier.id} style={{
                  textAlign: 'center',
                  padding: '20px 10px',
                  backgroundColor: idx === highlightIdx ? 'rgba(139, 143, 230, 0.06)' : DARK_BG,
                  borderBottom: `1px solid ${BORDER_COLOR}`,
                  borderLeft: `1px solid ${BORDER_COLOR}`,
                  position: 'relative',
                }}>
                  {idx === highlightIdx && (
                    <div style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0,
                      height: '3px',
                      background: BRAND,
                      borderRadius: '0 0 2px 2px',
                    }} />
                  )}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px 8px',
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#E6E9EF',
                    marginBottom: '4px',
                  }}>
                    {tier.name}
                    {tier.badge && (
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
                        color: idx === highlightIdx ? '#fff' : BRAND,
                        backgroundColor: idx === highlightIdx ? BRAND : 'rgba(139, 143, 230, 0.12)',
                        border: idx === highlightIdx ? 'none' : `1px solid rgba(139, 143, 230, 0.3)`,
                        padding: '2px 7px',
                        borderRadius: '999px',
                        whiteSpace: 'nowrap',
                      }}>
                        {tier.badge}
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    color: idx === highlightIdx ? BRAND : '#c9cdd8',
                    marginBottom: '2px',
                  }}>
                    {tier.price}
                  </div>
                  {tier.priceNote && (
                    <div style={{ fontSize: '10.5px', fontWeight: 500, color: '#8a8f9e', marginBottom: '2px' }}>
                      {tier.priceNote}
                    </div>
                  )}
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: '#8a8f9e',
                  }}>
                    {tier.audience}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {featureRows.map((row, rIdx) => {
              if (row.category) {
                return (
                  <tr key={rIdx}>
                    <td colSpan={deploymentTiers.length + 1} style={{
                      padding: '14px 24px 8px',
                      fontSize: '12px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: BRAND,
                      backgroundColor: 'rgba(139, 143, 230, 0.03)',
                      borderBottom: `1px solid ${BORDER_COLOR}`,
                    }}>
                      {row.label}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={rIdx}>
                  <td style={{
                    padding: '12px 24px',
                    color: '#c9cdd8',
                    borderBottom: `1px solid ${BORDER_COLOR}`,
                    backgroundColor: DARK_SURFACE,
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    fontWeight: 500,
                  }}>
                    {row.label}
                  </td>
                  {row.values.map((val, vIdx) => (
                    <td key={vIdx} style={{
                      textAlign: 'center',
                      padding: '12px 10px',
                      borderBottom: `1px solid ${BORDER_COLOR}`,
                      borderLeft: `1px solid ${BORDER_COLOR}`,
                      backgroundColor: vIdx === highlightIdx ? 'rgba(139, 143, 230, 0.03)' : 'transparent',
                      color: '#c9cdd8',
                    }}>
                      {renderCellValue(val)}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr>
              <td style={{
                padding: '20px 24px',
                backgroundColor: DARK_BG,
                borderTop: `1px solid ${BORDER_COLOR}`,
                position: 'sticky',
                left: 0,
                zIndex: 1,
              }} />
              {deploymentTiers.map((tier, idx) => (
                <td key={tier.id} style={{
                  textAlign: 'center',
                  padding: '20px 12px',
                  borderLeft: `1px solid ${BORDER_COLOR}`,
                  borderTop: `1px solid ${BORDER_COLOR}`,
                  backgroundColor: idx === highlightIdx ? 'rgba(139, 143, 230, 0.06)' : DARK_BG,
                }}>
                  <button
                    onClick={() => onSelect(tier.id)}
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '10px 8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: idx === highlightIdx ? 'none' : `1.5px solid ${BRAND}`,
                      borderRadius: '8px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      opacity: loading ? 0.6 : 1,
                      backgroundColor: idx === highlightIdx ? BRAND : 'transparent',
                      color: idx === highlightIdx ? '#fff' : BRAND,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {tier.cta}
                  </button>
                  {tier.id === 'indie' && (
                    <AnnualLink onClick={() => onSelect('indie', 'year')} disabled={loading} />
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="pricing-table-mobile" style={{ width: '100%', maxWidth: '500px' }}>
        {deploymentTiers.map((tier, idx) => {
          const isExpanded = expandedMobile === idx;
          const isHighlighted = idx === highlightIdx;
          return (
            <div key={tier.id} style={{
              marginBottom: '12px',
              borderRadius: '10px',
              border: isHighlighted ? `2px solid ${BRAND}` : `1px solid ${BORDER_COLOR}`,
              backgroundColor: DARK_SURFACE,
              overflow: 'hidden',
              transition: 'all 0.2s ease',
            }}>
              <button
                onClick={() => setExpandedMobile(isExpanded ? null : idx)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#E6E9EF',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 700 }}>{tier.name}</span>
                  {tier.badge && (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: BRAND,
                      backgroundColor: 'rgba(139, 143, 230, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      whiteSpace: 'nowrap',
                    }}>
                      {tier.badge}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: isHighlighted ? BRAND : '#c9cdd8' }}>
                    {tier.price}
                  </span>
                  <span style={{
                    fontSize: '18px',
                    color: '#8a8f9e',
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease',
                  }}>
                    &#x25BE;
                  </span>
                </div>
              </button>

              {isExpanded && (
                <div style={{ padding: '0 20px 20px', borderTop: `1px solid ${BORDER_COLOR}` }}>
                  <div style={{ padding: '14px 0 0', fontSize: '12px', fontWeight: 600, color: BRAND }}>
                    {tier.audience}{tier.priceNote ? ` · ${tier.priceNote}` : ''}
                  </div>
                  <div style={{ padding: '8px 0 4px', fontSize: '13px', color: '#8a8f9e', lineHeight: 1.6 }}>
                    {tier.description}
                  </div>
                  <div style={{ padding: '12px 0' }}>
                    {tier.features.map((feature, fIdx) => (
                      <div key={fIdx} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        marginBottom: '10px',
                        fontSize: '13px',
                        color: '#c9cdd8',
                      }}>
                        <span style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          backgroundColor: 'rgba(74, 222, 128, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          color: '#4ade80',
                          flexShrink: 0,
                          fontWeight: 700,
                        }}>
                          {'✓'}
                        </span>
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => onSelect(tier.id)}
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '12px 20px',
                      fontSize: '14px',
                      fontWeight: 600,
                      border: isHighlighted ? 'none' : `1.5px solid ${BRAND}`,
                      borderRadius: '8px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      backgroundColor: isHighlighted ? BRAND : 'transparent',
                      color: isHighlighted ? '#fff' : BRAND,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {tier.cta}
                  </button>
                  {tier.id === 'indie' && (
                    <AnnualLink onClick={() => onSelect('indie', 'year')} disabled={loading} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function renderCellValue(val: string | boolean) {
  if (val === true) {
    return (
      <span style={{
        display: 'inline-flex',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        backgroundColor: 'rgba(74, 222, 128, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        color: '#4ade80',
        fontWeight: 700,
      }}>
        {'✓'}
      </span>
    );
  }
  if (val === false) {
    return <span style={{ color: '#3a3f52', fontSize: '16px' }}>&mdash;</span>;
  }
  return <span style={{ fontWeight: 500 }}>{val}</span>;
}
