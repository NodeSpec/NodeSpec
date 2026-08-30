import { useState } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { Search, X, TestTube, Network } from 'lucide-react';

export type CategoryFilter = 'functional' | 'non-functional' | 'technical' | 'business';
export type LockFilter = 'locked' | 'unlocked';
export type TestCoverageFilter = 'has_tests_passing' | 'has_tests_failing' | 'no_tests';
export type ArchNodeFilter = string;

export interface SpecFilters {
  search: string;
  categories: CategoryFilter[];
  lockStates: LockFilter[];
  testCoverage: TestCoverageFilter[];
  archNodeId: ArchNodeFilter | null;
  /** R6 scale surface: only requirements created inside the 7-day window. */
  recentlyAdded: boolean;
  /** R6 scale surface: only requirements whose authored 'expands' relation
   *  points at a COMPLETED requirement — the follow-on work lens. */
  expansionsOfCompleted: boolean;
}

export const EMPTY_SPEC_FILTERS: SpecFilters = {
  search: '',
  categories: [],
  lockStates: [],
  testCoverage: [],
  archNodeId: null,
  recentlyAdded: false,
  expansionsOfCompleted: false,
};

export interface ArchNodeOption {
  id: string;
  label: string;
}

interface SpecFilterBarProps {
  filters: SpecFilters;
  onChange: (filters: SpecFilters) => void;
  totalCount: number;
  filteredCount: number;
  archNodeOptions?: ArchNodeOption[];
}

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string; color: string }[] = [
  { value: 'functional', label: 'FR', color: '#3b82f6' },
  { value: 'non-functional', label: 'NFR', color: '#8b5cf6' },
  { value: 'technical', label: 'TR', color: '#f59e0b' },
  { value: 'business', label: 'BR', color: '#10b981' },
];

const LOCK_OPTIONS: { value: LockFilter; label: string; color: string }[] = [
  { value: 'locked', label: 'Locked', color: '#d97706' },
  { value: 'unlocked', label: 'Unlocked', color: '#6b7280' },
];

const TEST_COVERAGE_OPTIONS: { value: TestCoverageFilter; label: string; color: string }[] = [
  { value: 'has_tests_passing', label: 'Passing', color: '#10b981' },
  { value: 'has_tests_failing', label: 'Failing/Stale', color: '#ef4444' },
  { value: 'no_tests', label: 'No Tests', color: '#6b7280' },
];

export function SpecFilterBar({ filters, onChange, totalCount, filteredCount, archNodeOptions = [] }: SpecFilterBarProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [showFilters, setShowFilters] = useState(false);

  const hasActiveFilters = filters.categories.length > 0 || filters.lockStates.length > 0 || filters.search.length > 0 || filters.testCoverage.length > 0 || filters.archNodeId !== null || filters.recentlyAdded || filters.expansionsOfCompleted;

  const toggleCategory = (cat: CategoryFilter) => {
    const updated = filters.categories.includes(cat)
      ? filters.categories.filter(c => c !== cat)
      : [...filters.categories, cat];
    onChange({ ...filters, categories: updated });
  };

  const toggleLock = (lock: LockFilter) => {
    const updated = filters.lockStates.includes(lock)
      ? filters.lockStates.filter(l => l !== lock)
      : [...filters.lockStates, lock];
    onChange({ ...filters, lockStates: updated });
  };

  const toggleTestCoverage = (tc: TestCoverageFilter) => {
    const updated = filters.testCoverage.includes(tc)
      ? filters.testCoverage.filter(t => t !== tc)
      : [...filters.testCoverage, tc];
    onChange({ ...filters, testCoverage: updated });
  };

  const clearFilters = () => {
    onChange({ ...EMPTY_SPEC_FILTERS });
  };

  return (
    <div style={{ borderBottom: `1px solid ${c.border}` }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
      }}>
        <Search size={14} style={{ color: c.textMuted, flexShrink: 0 }} />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search requirements..."
          style={{
            flex: 1,
            border: 'none',
            backgroundColor: 'transparent',
            color: c.text,
            fontSize: '12px',
            outline: 'none',
            padding: '2px 0',
          }}
        />
        {hasActiveFilters && (
          <span style={{
            fontSize: '10px',
            color: c.textMuted,
            flexShrink: 0,
          }}>
            {filteredCount}/{totalCount}
          </span>
        )}
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            border: 'none',
            backgroundColor: showFilters || hasActiveFilters
              ? (theme.mode === 'dark' ? 'rgba(139,143,230,0.15)' : 'rgba(139,143,230,0.1)')
              : 'transparent',
            color: showFilters || hasActiveFilters ? c.primary : c.textMuted,
            cursor: 'pointer',
            padding: '3px 8px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 600,
            transition: 'all 0.15s ease',
            flexShrink: 0,
          }}
        >
          Filter
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            style={{
              border: 'none',
              backgroundColor: 'transparent',
              color: c.textMuted,
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
              flexShrink: 0,
            }}
            title="Clear filters"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showFilters && (
        <div style={{
          padding: '6px 12px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}>
          <div>
            <span style={{
              fontSize: '9px',
              fontWeight: 600,
              color: c.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>Category</span>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
              {CATEGORY_OPTIONS.map((opt) => {
                const active = filters.categories.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleCategory(opt.value)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '10px',
                      fontWeight: 600,
                      border: `1px solid ${active ? opt.color + '60' : c.border}`,
                      borderRadius: '12px',
                      backgroundColor: active ? opt.color + '18' : 'transparent',
                      color: active ? opt.color : c.textMuted,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span style={{
              fontSize: '9px',
              fontWeight: 600,
              color: c.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}>
              <TestTube size={9} />
              Test Coverage
            </span>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
              {TEST_COVERAGE_OPTIONS.map((opt) => {
                const active = filters.testCoverage.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleTestCoverage(opt.value)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '10px',
                      fontWeight: 600,
                      border: `1px solid ${active ? opt.color + '60' : c.border}`,
                      borderRadius: '12px',
                      backgroundColor: active ? opt.color + '18' : 'transparent',
                      color: active ? opt.color : c.textMuted,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {archNodeOptions.length > 0 && (
            <div>
              <span style={{
                fontSize: '9px',
                fontWeight: 600,
                color: c.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <Network size={9} />
                Architecture Node
              </span>
              <select
                value={filters.archNodeId || ''}
                onChange={(e) => onChange({ ...filters, archNodeId: e.target.value || null })}
                style={{
                  marginTop: '4px',
                  width: '100%',
                  padding: '4px 8px',
                  fontSize: '10px',
                  border: `1px solid ${filters.archNodeId ? c.primary + '60' : c.border}`,
                  borderRadius: '6px',
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : '#fff',
                  color: c.text,
                  cursor: 'pointer',
                }}
              >
                <option value="">All nodes</option>
                {archNodeOptions.map((node) => (
                  <option key={node.id} value={node.id}>{node.label}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <span style={{
              fontSize: '9px',
              fontWeight: 600,
              color: c.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>Spec Plane</span>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
              <button
                onClick={() => onChange({ ...filters, recentlyAdded: !filters.recentlyAdded })}
                title="Only requirements created in the last 7 days"
                style={{
                  padding: '3px 8px',
                  fontSize: '10px',
                  fontWeight: 600,
                  border: `1px solid ${filters.recentlyAdded ? '#0891b260' : c.border}`,
                  borderRadius: '12px',
                  backgroundColor: filters.recentlyAdded ? '#0891b218' : 'transparent',
                  color: filters.recentlyAdded ? '#0891b2' : c.textMuted,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Added &lt; 7d
              </button>
              <button
                onClick={() => onChange({ ...filters, expansionsOfCompleted: !filters.expansionsOfCompleted })}
                title="Only requirements recorded (via an 'expands' relation) as expanding a completed requirement"
                style={{
                  padding: '3px 8px',
                  fontSize: '10px',
                  fontWeight: 600,
                  border: `1px solid ${filters.expansionsOfCompleted ? '#7c3aed60' : c.border}`,
                  borderRadius: '12px',
                  backgroundColor: filters.expansionsOfCompleted ? '#7c3aed18' : 'transparent',
                  color: filters.expansionsOfCompleted ? '#7c3aed' : c.textMuted,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Expands Completed
              </button>
            </div>
          </div>

          <div>
            <span style={{
              fontSize: '9px',
              fontWeight: 600,
              color: c.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>Lock State</span>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
              {LOCK_OPTIONS.map((opt) => {
                const active = filters.lockStates.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleLock(opt.value)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '10px',
                      fontWeight: 600,
                      border: `1px solid ${active ? opt.color + '60' : c.border}`,
                      borderRadius: '12px',
                      backgroundColor: active ? opt.color + '18' : 'transparent',
                      color: active ? opt.color : c.textMuted,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
