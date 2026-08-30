import { memo, useState, useCallback } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { useAuth } from '../../context/ServiceContext.js';

type Provider = 'openai' | 'anthropic' | 'google';

const PROVIDERS: { id: Provider; name: string; placeholder: string }[] = [
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'google', name: 'Google AI', placeholder: 'AIza...' },
];

interface BYOKKeyInputProps {
  onKeyConfigured?: () => void;
  compact?: boolean;
}

function BYOKKeyInputComponent({ onKeyConfigured, compact }: BYOKKeyInputProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const auth = useAuth();

  const [selectedProvider, setSelectedProvider] = useState<Provider>('openai');
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = useCallback(async () => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const session = await auth.getSession();
      const token = session?.session?.access_token;
      if (!token) {
        setError('Not authenticated. Please sign in again.');
        setSaving(false);
        return;
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-ai-keys`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: 'save', provider: selectedProvider, key: keyInput.trim() }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to save key');
        setSaving(false);
        return;
      }

      setSuccess(`${PROVIDERS.find(p => p.id === selectedProvider)?.name} key configured successfully`);
      setKeyInput('');
      window.dispatchEvent(new CustomEvent('api-keys-changed'));
      onKeyConfigured?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save key');
    } finally {
      setSaving(false);
    }
  }, [keyInput, selectedProvider, auth, onKeyConfigured]);

  const provider = PROVIDERS.find(p => p.id === selectedProvider)!;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '10px' : '14px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => { setSelectedProvider(p.id); setError(''); setSuccess(''); }}
            style={{
              flex: 1,
              padding: compact ? '6px 8px' : '8px 12px',
              borderRadius: '8px',
              border: `1.5px solid ${selectedProvider === p.id ? c.primary : c.border}`,
              backgroundColor: selectedProvider === p.id
                ? (theme.mode === 'dark' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(59, 130, 246, 0.08)')
                : c.surface,
              color: selectedProvider === p.id ? c.primary : c.textMuted,
              fontWeight: selectedProvider === p.id ? 600 : 400,
              fontSize: compact ? '12px' : '13px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={provider.placeholder}
          style={{
            flex: 1,
            padding: compact ? '8px 10px' : '10px 14px',
            borderRadius: '8px',
            border: `1.5px solid ${c.border}`,
            backgroundColor: theme.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
            color: c.text,
            fontSize: compact ? '12px' : '13px',
            outline: 'none',
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !keyInput.trim()}
          style={{
            padding: compact ? '8px 14px' : '10px 18px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: saving || !keyInput.trim() ? c.border : c.primary,
            color: '#fff',
            fontWeight: 600,
            fontSize: compact ? '12px' : '13px',
            cursor: saving || !keyInput.trim() ? 'not-allowed' : 'pointer',
            opacity: saving || !keyInput.trim() ? 0.6 : 1,
            transition: 'all 0.15s ease',
          }}
        >
          {saving ? 'Validating...' : 'Save'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: '12px', color: c.error, padding: '4px 0' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ fontSize: '12px', color: theme.mode === 'dark' ? '#86efac' : '#16a34a', padding: '4px 0' }}>
          {success}
        </div>
      )}
    </div>
  );
}

export const BYOKKeyInput = memo(BYOKKeyInputComponent);
