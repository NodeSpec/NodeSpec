import { useState, useEffect, useMemo } from 'react';
import { useCodeStructure } from '../context/ServiceContext.js';
import type { CodeEntity, CodeEntityType } from '@nodespec/core/code-structure.js';

export interface ExportGroup {
  type: CodeEntityType;
  label: string;
  entities: CodeEntity[];
}

export interface LibraryExports {
  loading: boolean;
  totalExported: number;
  groups: ExportGroup[];
  allExported: CodeEntity[];
  metrics: {
    totalLines: number;
    totalFunctions: number;
    totalClasses: number;
    averageComplexity: number;
    couplingScore: number;
  } | null;
}

const GROUP_LABELS: Record<CodeEntityType, string> = {
  'function': 'Utility Functions',
  'class': 'Classes',
  'interface': 'Type Definitions',
  'module': 'Modules',
  'method': 'Methods',
  'struct': 'Structs',
  'trait': 'Traits',
};

const GROUP_ORDER: CodeEntityType[] = ['class', 'interface', 'function', 'module', 'struct', 'trait', 'method'];

export function useLibraryExports(nodeId: string | null): LibraryExports {
  const codeStructureService = useCodeStructure();
  const [exported, setExported] = useState<CodeEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<LibraryExports['metrics']>(null);

  useEffect(() => {
    if (!nodeId) {
      setExported([]);
      setMetrics(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    codeStructureService.getByNodeId(nodeId).then(structures => {
      if (cancelled) return;

      const allEntities: CodeEntity[] = [];
      let totalLines = 0;
      let totalFunctions = 0;
      let totalClasses = 0;
      let complexitySum = 0;
      let complexityCount = 0;
      let couplingSum = 0;
      let couplingCount = 0;

      for (const cs of structures) {
        for (const entity of cs.entities) {
          if (entity.isExported) {
            allEntities.push(entity);
          }
        }
        if (cs.metrics) {
          const m = cs.metrics as Record<string, unknown>;
          totalLines += (m.totalLines as number) || 0;
          totalFunctions += (m.totalFunctions as number) || 0;
          totalClasses += (m.totalClasses as number) || 0;
          if ((m.averageComplexity as number) > 0) {
            complexitySum += (m.averageComplexity as number);
            complexityCount++;
          }
          if ((m.couplingScore as number) >= 0) {
            couplingSum += (m.couplingScore as number);
            couplingCount++;
          }
        }
      }

      setExported(allEntities);
      setMetrics({
        totalLines,
        totalFunctions,
        totalClasses,
        averageComplexity: complexityCount > 0 ? complexitySum / complexityCount : 0,
        couplingScore: couplingCount > 0 ? couplingSum / couplingCount : 0,
      });
    }).catch(() => {
      if (!cancelled) {
        setExported([]);
        setMetrics(null);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [nodeId, codeStructureService]);

  const groups = useMemo(() => {
    const byType = new Map<CodeEntityType, CodeEntity[]>();
    for (const entity of exported) {
      const list = byType.get(entity.type) || [];
      list.push(entity);
      byType.set(entity.type, list);
    }

    const result: ExportGroup[] = [];
    for (const type of GROUP_ORDER) {
      const entities = byType.get(type);
      if (entities && entities.length > 0) {
        result.push({
          type,
          label: GROUP_LABELS[type] || type,
          entities,
        });
      }
    }
    return result;
  }, [exported]);

  return {
    loading,
    totalExported: exported.length,
    groups,
    allExported: exported,
    metrics,
  };
}
