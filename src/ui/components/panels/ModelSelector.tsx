import { memo, useState, useRef, useEffect } from 'react';
import { ChevronDown, KeyRound } from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext.js';
import { useAIAvailability } from '../../hooks/useAIAvailability.js';
import type { PlanTier } from '../../hooks/useFeatureGate.js';

export type ProviderType = 'openai' | 'anthropic' | 'google' | 'platform';

export interface ModelOption {
  id: string;
  label: string;
  provider: ProviderType;
  description?: string;
}

const ALL_MODELS: ModelOption[] = [
  { id: 'platform', label: 'Platform AI', provider: 'platform' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai', description: 'Fastest & most affordable' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', description: 'Fast & affordable' },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', description: 'High capability' },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai', description: 'Flagship reasoning' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'anthropic', description: 'Fastest & most affordable' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', description: 'Fast & intelligent' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', description: 'High capability' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', description: 'Advanced reasoning' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic', description: 'Most capable' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', description: 'Fast & affordable' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', description: 'Advanced reasoning' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'google', description: 'Most intelligent' },
];

const STORAGE_KEY = 'nodal-selected-model';

interface ModelSelectorProps {
  availableProviders: Set<ProviderType>;
  onModelChange: (model: ModelOption) => void;
  disabled?: boolean;
  planTier?: PlanTier;
}

function getInitialModel(availableProviders: Set<ProviderType>, platformExhausted = false): ModelOption {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as ModelOption;
      const match = ALL_MODELS.find(m => m.id === parsed.id);
      if (match && availableProviders.has(match.provider)) {
        if (!(match.provider === 'platform' && platformExhausted)) {
          return match;
        }
      }
    } catch {}
  }
  if (platformExhausted) {
    const byokModel = ALL_MODELS.find(m => m.provider !== 'platform' && availableProviders.has(m.provider));
    if (byokModel) return byokModel;
  }
  return ALL_MODELS[0];
}

function ModelSelectorComponent({ availableProviders, onModelChange, disabled }: ModelSelectorProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<ModelOption>(() => getInitialModel(availableProviders));
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { isPlatformExhausted, showKeyPrompt } = useAIAvailability();

  const hasNonPlatformProvider = Array.from(availableProviders).some(p => p !== 'platform');

  const filteredModels = ALL_MODELS
    .filter(m => availableProviders.has(m.provider))
    .map(m => {
      if (m.provider === 'platform') {
        if (isPlatformExhausted) {
          return { ...m, description: 'Trial ended' };
        }
        return { ...m, description: 'Trial (600K tokens)' };
      }
      return m;
    });

  useEffect(() => {
    const isAvailable = filteredModels.some(m => m.id === selected.id);
    if (!isAvailable) {
      const fallback = filteredModels[0] || ALL_MODELS[0];
      setSelected(fallback);
      onModelChange(fallback);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
    }
  }, [availableProviders, selected.id, filteredModels, onModelChange]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (model: ModelOption) => {
    setSelected(model);
    onModelChange(model);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    setIsOpen(false);
  };

  const providerColor = (provider: ProviderType) => {
    switch (provider) {
      case 'openai': return '#10a37f';
      case 'anthropic': return '#d97706';
      case 'google': return '#4285f4';
      default: return c.primary;
    }
  };

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '8px 10px',
          border: `1px solid ${theme.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
          borderRadius: '8px',
          backgroundColor: c.background,
          color: c.text,
          fontSize: '12px',
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          whiteSpace: 'nowrap',
          transition: 'all 0.15s',
        }}
      >
        <span style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: providerColor(selected.provider),
          flexShrink: 0,
        }} />
        <span>{selected.label}</span>
        <ChevronDown size={12} style={{
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 0.15s',
        }} />
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          marginBottom: '4px',
          minWidth: '200px',
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: '8px',
          boxShadow: theme.mode === 'dark'
            ? '0 8px 24px rgba(0,0,0,0.5)'
            : '0 8px 24px rgba(0,0,0,0.15)',
          zIndex: 100,
          overflow: 'hidden',
        }}>
          {filteredModels.map((model, idx) => {
            const isSelected = model.id === selected.id;
            const prevProvider = idx > 0 ? filteredModels[idx - 1].provider : null;
            const showDivider = prevProvider !== null && prevProvider !== model.provider;
            const isPlatformDisabled = model.provider === 'platform' && isPlatformExhausted;

            return (
              <div key={model.id}>
                {showDivider && (
                  <div style={{
                    height: '1px',
                    backgroundColor: c.border,
                    margin: '2px 8px',
                  }} />
                )}
                <button
                  onClick={() => !isPlatformDisabled && handleSelect(model)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '8px 12px',
                    border: 'none',
                    backgroundColor: isSelected
                      ? (theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
                      : 'transparent',
                    color: isPlatformDisabled ? c.textMuted : c.text,
                    fontSize: '12px',
                    cursor: isPlatformDisabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    opacity: isPlatformDisabled ? 0.5 : 1,
                    transition: 'background-color 0.1s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isPlatformDisabled) {
                      e.currentTarget.style.backgroundColor = theme.mode === 'dark'
                        ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isPlatformDisabled) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: providerColor(model.provider),
                    flexShrink: 0,
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: isSelected ? 600 : 400 }}>
                      {model.label}
                    </div>
                    {model.description && (
                      <div style={{ fontSize: '10px', color: c.textMuted, marginTop: '1px' }}>
                        {model.description}
                      </div>
                    )}
                  </div>
                  {isSelected && (
                    <span style={{ fontSize: '10px', color: c.primary, fontWeight: 600 }}>
                      Active
                    </span>
                  )}
                </button>
              </div>
            );
          })}
          {!hasNonPlatformProvider && (
            <>
              <div style={{ height: '1px', backgroundColor: c.border, margin: '2px 8px' }} />
              <button
                onClick={() => { setIsOpen(false); showKeyPrompt(); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: c.primary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontWeight: 500,
                }}
              >
                <KeyRound size={12} />
                Add API key
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export const ModelSelector = memo(ModelSelectorComponent);
export { ALL_MODELS, STORAGE_KEY, getInitialModel };
