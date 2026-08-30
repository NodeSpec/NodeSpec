import { useEffect, useState, useCallback, useRef } from 'react';
import { useServices } from '../context/ServiceContext.js';
import type { ProjectSpecification } from '../services/SpecificationService.js';
import type { SpecificationSection } from '../../persistence/supabase/sections-repository.js';
import type { Requirement } from '../../persistence/supabase/requirements-repository.js';
import type { RequirementRelation } from '../../persistence/supabase/requirement-relations-repository.js';
import { mapDbToRequirementRelation } from '../../persistence/supabase/requirement-relations-repository.js';
import type { RealtimeEvent } from '../services/SpecificationRealtimeService.js';

// R6 (Discovered #7): exported for a direct pin. This mapper used to DROP
// architectureTrace and confirmed — any realtime UPDATE stripped them from
// in-memory state until the next full refresh (the Decomposition trace lane
// and the confirmation badge silently emptied). Aligned with the correct
// sibling mapper in DecompositionCanvas.
export function mapRealtimeToRequirement(row: any): Requirement {
  return {
    id: row.id,
    specificationId: row.specification_id ?? row.specificationId,
    requirementId: row.requirement_id ?? row.requirementId,
    name: row.name,
    description: row.description || '',
    category: row.category,
    status: row.status,
    sectionId: row.section_id ?? row.sectionId ?? null,
    source: row.source || 'manual',
    locked: row.locked ?? false,
    confirmed: row.confirmed ?? false,
    architectureTrace: row.architecture_trace ?? row.architectureTrace ?? [],
    acceptanceCriteria: row.acceptance_criteria ?? row.acceptanceCriteria ?? [],
    metadata: row.metadata || {},
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

function mapRealtimeToSection(row: any): SpecificationSection {
  return {
    id: row.id,
    specificationId: row.specification_id ?? row.specificationId,
    name: row.name,
    description: row.description || null,
    orderIndex: row.order_index ?? row.orderIndex ?? 0,
    aiGenerated: row.ai_generated ?? row.aiGenerated ?? false,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt,
  };
}

export interface SpecificationData {
  specification: ProjectSpecification | null;
  sections: SpecificationSection[];
  requirements: Requirement[];
  /** R6: authored requirement↔requirement relations (expands/depends_on/relates_to). */
  relations: RequirementRelation[];
  loading: boolean;
  error: Error | null;
  realtimeError: Error | null;
  connected: boolean;
  refresh: () => Promise<void>;
}

export function useRealtimeSpecification(specificationId: string | null): SpecificationData {
  const services = useServices();
  const hasLoadedOnce = useRef(false);
  const [data, setData] = useState<Omit<SpecificationData, 'refresh'>>({
    specification: null,
    sections: [],
    requirements: [],
    relations: [],
    loading: true,
    error: null,
    realtimeError: null,
    connected: false,
  });

  const loadInitialData = useCallback(async () => {
    if (!specificationId) {
      hasLoadedOnce.current = false;
      setData({
        specification: null,
        sections: [],
        requirements: [],
        relations: [],
        loading: false,
        error: null,
        realtimeError: null,
        connected: false,
      });
      return;
    }

    try {
      setData(prev => ({ ...prev, loading: true, error: null }));

      const [spec, sections, requirements, relations] = await Promise.all([
        services.specification.getSpecification(specificationId),
        services.specification.getSectionsBySpecification(specificationId),
        services.specification.getRequirementsBySpecification(specificationId),
        services.specification.getRelationsBySpecification(specificationId),
      ]);

      hasLoadedOnce.current = true;
      setData(prev => ({
        ...prev,
        specification: spec,
        sections,
        requirements,
        relations,
        loading: false,
        error: null,
        realtimeError: null,
      }));
    } catch (error) {
      setData(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error : new Error('Failed to load specification'),
      }));
    }
  }, [specificationId, services.specification]);

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
        onSectionChange: (event: RealtimeEvent) => {
          setData(prev => {
            const sections = [...prev.sections];

            if (event.eventType === 'INSERT' && event.new) {
              sections.push(mapRealtimeToSection(event.new));
            } else if (event.eventType === 'UPDATE' && event.new) {
              const mapped = mapRealtimeToSection(event.new);
              const index = sections.findIndex(s => s.id === mapped.id);
              if (index !== -1) {
                sections[index] = mapped;
              }
            } else if (event.eventType === 'DELETE' && event.old) {
              const index = sections.findIndex(s => s.id === event.old!.id);
              if (index !== -1) {
                sections.splice(index, 1);
              }
            }

            return { ...prev, sections: sections.sort((a, b) => a.orderIndex - b.orderIndex) };
          });
        },
        onRequirementChange: (event: RealtimeEvent) => {
          setData(prev => {
            const requirements = [...prev.requirements];

            if (event.eventType === 'INSERT' && event.new) {
              requirements.push(mapRealtimeToRequirement(event.new));
            } else if (event.eventType === 'UPDATE' && event.new) {
              const mapped = mapRealtimeToRequirement(event.new);
              const index = requirements.findIndex(r => r.id === mapped.id);
              if (index !== -1) {
                requirements[index] = mapped;
              }
            } else if (event.eventType === 'DELETE' && event.old) {
              const index = requirements.findIndex(r => r.id === event.old!.id);
              if (index !== -1) {
                requirements.splice(index, 1);
              }
            }

            return { ...prev, requirements };
          });
        },
        onRelationChange: (event: RealtimeEvent) => {
          // Relations are add/remove facts — INSERT and DELETE are the only lanes.
          setData(prev => {
            let relations = [...prev.relations];
            if (event.eventType === 'INSERT' && event.new) {
              const mapped = mapDbToRequirementRelation(event.new);
              if (!relations.some(r => r.id === mapped.id)) {
                relations.push(mapped);
              }
            } else if (event.eventType === 'DELETE' && event.old) {
              relations = relations.filter(r => r.id !== event.old!.id);
            }
            return { ...prev, relations };
          });
        },
        onConnectionChange: (connected: boolean) => {
          setData(prev => {
            const next = { ...prev, connected };
            if (connected) {
              next.realtimeError = null;
            }
            return next;
          });
          if (connected && hasLoadedOnce.current) {
            loadInitialData();
          }
        },
        onError: (error: Error) => {
          console.warn('Realtime specification connection issue:', error.message);
          setData(prev => ({ ...prev, realtimeError: error, connected: false }));
        },
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [specificationId, services.specificationRealtime, loadInitialData]);

  return { ...data, refresh: loadInitialData };
}
