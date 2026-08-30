import { useEffect, useState, useCallback } from 'react';
import { useServices } from '../context/ServiceContext.js';
import type {
  RequirementCoverage,
  UnmappedRequirement,
  RequirementStatus,
} from '../services/RequirementStatusService.js';

export interface RequirementStatusData {
  coverage: RequirementCoverage | null;
  unmapped: UnmappedRequirement[];
  statusMap: Map<string, RequirementStatus>;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export interface UseRequirementStatusOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useRequirementStatus(
  specificationId: string | null,
  options: UseRequirementStatusOptions = {}
): RequirementStatusData {
  const { autoRefresh = false, refreshInterval = 30000 } = options;
  const services = useServices();

  const [data, setData] = useState<RequirementStatusData>({
    coverage: null,
    unmapped: [],
    statusMap: new Map(),
    loading: true,
    error: null,
    refresh: async () => {},
  });

  const loadData = useCallback(async () => {
    if (!specificationId) {
      setData(prev => ({
        ...prev,
        coverage: null,
        unmapped: [],
        statusMap: new Map(),
        loading: false,
        error: null,
      }));
      return;
    }

    try {
      setData(prev => ({ ...prev, loading: true, error: null }));

      const [coverage, unmapped, statusMap] = await Promise.all([
        services.requirementStatus.calculateCoverage(specificationId, true),
        services.requirementStatus.getUnmappedRequirements(specificationId),
        services.requirementStatus.getRequirementStatusForSpecification(specificationId),
      ]);

      setData(prev => ({
        ...prev,
        coverage,
        unmapped,
        statusMap,
        loading: false,
        error: null,
      }));
    } catch (error) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error('Failed to load requirement status'),
      }));
    }
  }, [specificationId, services.requirementStatus]);

  const refresh = useCallback(async () => {
    await loadData();
  }, [loadData]);

  useEffect(() => {
    setData(prev => ({ ...prev, refresh }));
  }, [refresh]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!autoRefresh || !specificationId) {
      return;
    }

    const interval = setInterval(() => {
      loadData();
    }, refreshInterval);

    return () => {
      clearInterval(interval);
    };
  }, [autoRefresh, specificationId, refreshInterval, loadData]);

  return data;
}
