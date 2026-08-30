import type { ParsedSpecification } from './parse-specification-markdown.js';
import type { SpecificationData } from '../hooks/useRealtimeSpecification.js';
import type { SpecificationService } from '../services/SpecificationService.js';

export interface EditSummary {
  visionUpdated: boolean;
  requirementsUpdated: number;
  acceptanceCriteriaUpdated: number;
}

export async function applySpecificationEdits(
  parsed: ParsedSpecification,
  specData: SpecificationData,
  specService: SpecificationService,
): Promise<EditSummary> {
  const summary: EditSummary = {
    visionUpdated: false,
    requirementsUpdated: 0,
    acceptanceCriteriaUpdated: 0,
  };

  const spec = specData.specification;
  if (!spec) return summary;

  const promises: Promise<void>[] = [];

  if (parsed.vision !== (spec.vision || '')) {
    summary.visionUpdated = true;
    promises.push(
      specService.updateSpecification(spec.id, { vision: parsed.vision }).then(() => {}),
    );
  }

  const existingReqMap = new Map(
    specData.requirements.map(r => [r.requirementId, r]),
  );

  for (const parsedReq of parsed.requirements) {
    if (!parsedReq.requirementId) continue;
    const existing = existingReqMap.get(parsedReq.requirementId);
    if (!existing) continue;

    let changed = false;
    const updates: Record<string, unknown> = {};

    if (parsedReq.name !== existing.name) {
      updates.name = parsedReq.name;
      changed = true;
    }
    if (parsedReq.description !== (existing.description || '')) {
      updates.description = parsedReq.description;
      changed = true;
    }

    const existingAc = existing.acceptanceCriteria || [];
    const parsedAc = parsedReq.acceptanceCriteria || [];
    const acChanged =
      existingAc.length !== parsedAc.length ||
      existingAc.some((ac, idx) => {
        const p = parsedAc[idx];
        return !p || ac.text !== p.text || (ac.met ?? false) !== (p.met ?? false);
      });

    if (acChanged) {
      const mergedAc = parsedAc.map(pac => {
        const match = existingAc.find(eac => eac.text === pac.text);
        return {
          text: pac.text,
          met: pac.met,
          testId: match?.testId,
        };
      });
      updates.acceptanceCriteria = mergedAc;
      changed = true;
      for (let idx = 0; idx < parsedAc.length; idx++) {
        const eac = existingAc[idx];
        const pac = parsedAc[idx];
        if (eac && pac && (eac.met ?? false) !== (pac.met ?? false)) {
          summary.acceptanceCriteriaUpdated++;
        }
      }
    }

    if (changed) {
      summary.requirementsUpdated++;
      promises.push(
        specService.updateRequirement(existing.id, updates).then(() => {}),
      );
    }
  }

  await Promise.all(promises);
  return summary;
}
