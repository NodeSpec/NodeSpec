import { useEffect, useState, useCallback } from 'react';
import { useServices } from '../context/ServiceContext.js';
import type { RequirementMapping } from '../services/MappingService.js';
import type { RealtimeEvent } from '../services/SpecificationRealtimeService.js';

function mapRealtimeToMapping(row: any): RequirementMapping {
  return {
    id: row.id,
    specificationId: row.specification_id ?? row.specificationId,
    requirementId: row.requirement_id ?? row.requirementId ?? null,
    nodeId: row.node_id ?? row.nodeId,
    mappingType: row.mapping_type ?? row.mappingType,
    confidence: row.confidence ?? 0,
    notes: row.notes,
    createdAt: row.created_at ?? row.createdAt,
    createdBy: row.created_by ?? row.createdBy ?? null,
    isOrphan: row.is_orphan ?? row.isOrphan,
    lastValidatedAt: row.last_validated_at ?? row.lastValidatedAt,
    validationStatus: row.validation_status ?? row.validationStatus,
    validationProvenance: row.validation_provenance ?? row.validationProvenance ?? null,
  };
}

export interface MappingsData {
  mappings: RequirementMapping[];
  mappingsByRequirement: Map<string, RequirementMapping[]>;
  mappingsByNode: Map<string, RequirementMapping[]>;
  loading: boolean;
  error: Error | null;
  connected: boolean;
}

export function useRealtimeMappings(specificationId: string | null): MappingsData {
  const services = useServices();
  const [data, setData] = useState<MappingsData>({
    mappings: [],
    mappingsByRequirement: new Map(),
    mappingsByNode: new Map(),
    loading: true,
    error: null,
    connected: false,
  });

  const buildIndexes = useCallback((mappings: RequirementMapping[]) => {
    const byRequirement = new Map<string, RequirementMapping[]>();
    const byNode = new Map<string, RequirementMapping[]>();

    for (const mapping of mappings) {
      if (mapping.requirementId) {
        const existing = byRequirement.get(mapping.requirementId) || [];
        existing.push(mapping);
        byRequirement.set(mapping.requirementId, existing);
      }

      const nodeExisting = byNode.get(mapping.nodeId) || [];
      nodeExisting.push(mapping);
      byNode.set(mapping.nodeId, nodeExisting);
    }

    return { byRequirement, byNode };
  }, []);

  const loadInitialData = useCallback(async () => {
    if (!specificationId) {
      setData({
        mappings: [],
        mappingsByRequirement: new Map(),
        mappingsByNode: new Map(),
        loading: false,
        error: null,
        connected: false,
      });
      return;
    }

    try {
      setData(prev => ({ ...prev, loading: true, error: null }));

      const mappings = await services.mapping.getMappingsBySpecification(specificationId);
      const { byRequirement, byNode } = buildIndexes(mappings);

      setData({
        mappings,
        mappingsByRequirement: byRequirement,
        mappingsByNode: byNode,
        loading: false,
        error: null,
        connected: false,
      });
    } catch (error) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error('Failed to load mappings'),
      }));
    }
  }, [specificationId, services.mapping, buildIndexes]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!specificationId) {
      return;
    }

    const subscription = services.specificationRealtime.subscribeToSpecification(
      specificationId,
      {
        onMappingChange: (event: RealtimeEvent) => {
          setData(prev => {
            let mappings = [...prev.mappings];

            if (event.eventType === 'INSERT' && event.new) {
              const mapped = mapRealtimeToMapping(event.new);
              if (!mappings.some(m => m.id === mapped.id)) {
                mappings.push(mapped);
              }
            } else if (event.eventType === 'UPDATE' && event.new) {
              const mapped = mapRealtimeToMapping(event.new);
              const index = mappings.findIndex(m => m.id === mapped.id);
              if (index !== -1) {
                mappings[index] = mapped;
              }
            } else if (event.eventType === 'DELETE' && event.old) {
              mappings = mappings.filter(m => m.id !== event.old!.id);
            }

            const { byRequirement, byNode } = buildIndexes(mappings);

            return {
              ...prev,
              mappings,
              mappingsByRequirement: byRequirement,
              mappingsByNode: byNode,
            };
          });
        },
        onConnectionChange: (connected: boolean) => {
          setData(prev => ({ ...prev, connected }));
        },
        onError: (error: Error) => {
          console.error('Realtime mappings error:', error);
          setData(prev => ({ ...prev, error }));
        },
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [specificationId, services.specificationRealtime, buildIndexes]);

  return data;
}
