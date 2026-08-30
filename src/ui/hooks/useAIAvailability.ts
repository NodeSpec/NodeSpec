import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { getSupabaseClient } from '../../persistence/supabase/client.js';
import { useTokenUsage } from './useTokenUsage.js';

export interface AIAvailability {
  isAIBlocked: boolean;
  isPlatformExhausted: boolean;
  hasByokKey: boolean;
  loading: boolean;
  showKeyPrompt: () => void;
  refresh: () => void;
}

interface AIAvailabilityContextValue extends AIAvailability {
  byokModalOpen: boolean;
  closeBYOKModal: () => void;
}

export const AIAvailabilityContext = createContext<AIAvailabilityContextValue>({
  isAIBlocked: false,
  isPlatformExhausted: false,
  hasByokKey: false,
  loading: true,
  showKeyPrompt: () => {},
  refresh: () => {},
  byokModalOpen: false,
  closeBYOKModal: () => {},
});

export function useAIAvailability(): AIAvailabilityContextValue {
  return useContext(AIAvailabilityContext);
}

export function useAIAvailabilityProvider(): AIAvailabilityContextValue {
  const tokenUsage = useTokenUsage();
  const [hasByokKey, setHasByokKey] = useState(false);
  const [keyLoading, setKeyLoading] = useState(true);
  const [byokModalOpen, setBYOKModalOpen] = useState(false);

  const fetchByokStatus = useCallback(async () => {
    try {
      const supabase = getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setKeyLoading(false);
        return;
      }

      const { data } = await supabase
        .from('user_api_keys')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .limit(1);

      setHasByokKey((data ?? []).length > 0);
      setKeyLoading(false);
    } catch {
      setKeyLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchByokStatus();
  }, [fetchByokStatus]);

  useEffect(() => {
    const handler = () => {
      fetchByokStatus();
      tokenUsage.refresh();
    };
    window.addEventListener('api-keys-changed', handler);
    return () => window.removeEventListener('api-keys-changed', handler);
  }, [fetchByokStatus, tokenUsage.refresh]);

  const isPlatformExhausted = tokenUsage.isExhausted;
  const isAIBlocked = isPlatformExhausted && !hasByokKey;
  const loading = tokenUsage.loading || keyLoading;

  const showKeyPrompt = useCallback(() => {
    setBYOKModalOpen(true);
  }, []);

  const closeBYOKModal = useCallback(() => {
    setBYOKModalOpen(false);
  }, []);

  const refresh = useCallback(() => {
    fetchByokStatus();
    tokenUsage.refresh();
  }, [fetchByokStatus, tokenUsage.refresh]);

  return {
    isAIBlocked,
    isPlatformExhausted,
    hasByokKey,
    loading,
    showKeyPrompt,
    refresh,
    byokModalOpen,
    closeBYOKModal,
  };
}
