// Pure builders for "Publish to NodeSpec Marketplace" (hosted edition).
//
// Two jobs, both mirrored server-side in
// supabase/functions/_shared/publish-template-core.ts — the server copy is
// authoritative (a hand-rolled request must not leak), this one is defense
// in depth plus honest UI (the preview counts what will actually publish):
//  - sanitizeGraphForPublish strips the author's source code and import
//    provenance from the graph before it leaves the browser.
//  - foldSpecificationForTemplate is the inverse of
//    TemplateService.applyTemplateSpecification: it folds the project's live
//    specification back into the TemplateSpecification shape, keyed by the
//    human requirement ids so instantiation can rebuild the mapping chain.
import type { Graph } from '@nodespec/core/types.js';
import type {
  TemplateSpecification,
  TemplateSpecificationMapping,
  TemplateSpecificationRequirement,
} from '../../persistence/types.js';

const REQUIREMENT_CATEGORIES = new Set([
  'functional',
  'non-functional',
  'technical',
  'business',
]);
const MAPPING_TYPES = new Set(['implements', 'depends_on', 'validates', 'supports']);
const ARCHITECTURE_PATTERNS = new Set([
  'monolith',
  'microservices',
  'serverless',
  'unknown',
]);

/**
 * Strip artifact content/hashes/URLs/provenance/metadata and the graph's
 * repo-import sourceContext. Returns a new graph; input untouched.
 */
export function sanitizeGraphForPublish(graph: Graph): Graph {
  const artifacts: Graph['artifacts'] = {};
  for (const [key, artifact] of Object.entries(graph.artifacts ?? {})) {
    const {
      content: _content,
      contentHash: _contentHash,
      contentUrl: _contentUrl,
      uri: _uri,
      sourceProvenance: _sourceProvenance,
      metadata: _metadata,
      ...kept
    } = artifact;
    artifacts[key] = kept;
  }
  const { sourceContext: _sourceContext, ...rest } = graph as Graph & {
    sourceContext?: unknown;
  };
  return { ...rest, artifacts } as Graph;
}

/** Minimal structural view of a live requirement for the fold. */
export interface FoldRequirementInput {
  /** Database uuid — the key mappingsByRequirement uses. */
  id: string;
  /** Human key (REQ-001) — the key the template spec round-trips on. */
  requirementId: string;
  name: string;
  description: string;
  category: string;
  acceptanceCriteria: Array<{ text: string }>;
}

export interface FoldMappingInput {
  nodeId: string;
  mappingType: string;
  confidence: number;
  notes?: string | null;
}

export interface FoldSpecificationInput {
  vision?: string | null;
  preferences?: unknown;
}

/**
 * Fold live spec state into a TemplateSpecification, or null when there is
 * no vision (a spec-less publish is valid — the template just carries no
 * requirements). Deliberately lossy: status/confirmed/locked/sections and
 * requirement metadata do not travel; a template seeds a fresh project.
 */
export function foldSpecificationForTemplate(
  specification: FoldSpecificationInput | null,
  requirements: FoldRequirementInput[],
  mappingsByRequirement: Map<string, FoldMappingInput[]>
): TemplateSpecification | null {
  const vision = specification?.vision?.trim();
  if (!vision) return null;

  const prefsIn = (specification?.preferences ?? {}) as Record<string, unknown>;
  const preferences: TemplateSpecification['preferences'] = {};
  for (const key of ['languages', 'frameworks', 'databases'] as const) {
    const value = prefsIn[key];
    if (Array.isArray(value)) {
      const strings = value.filter((v): v is string => typeof v === 'string');
      if (strings.length > 0) preferences[key] = strings;
    }
  }
  if (typeof prefsIn.deploymentTarget === 'string') {
    preferences.deploymentTarget = prefsIn.deploymentTarget;
  }
  if (
    typeof prefsIn.architecturePattern === 'string' &&
    ARCHITECTURE_PATTERNS.has(prefsIn.architecturePattern)
  ) {
    preferences.architecturePattern =
      prefsIn.architecturePattern as TemplateSpecification['preferences']['architecturePattern'];
  }

  const foldedRequirements: TemplateSpecificationRequirement[] = [];
  const foldedMappings: TemplateSpecificationMapping[] = [];
  for (const req of requirements) {
    if (!req.requirementId || !req.name) continue;
    foldedRequirements.push({
      requirementId: req.requirementId,
      name: req.name,
      description: req.description ?? '',
      category: REQUIREMENT_CATEGORIES.has(req.category)
        ? (req.category as TemplateSpecificationRequirement['category'])
        : 'functional',
      acceptanceCriteria: (req.acceptanceCriteria ?? [])
        .filter((ac) => typeof ac?.text === 'string' && ac.text.trim().length > 0)
        .map((ac) => ({ text: ac.text })),
      metadata: {},
    });

    for (const mapping of mappingsByRequirement.get(req.id) ?? []) {
      if (!mapping.nodeId) continue;
      const entry: TemplateSpecificationMapping = {
        requirementId: req.requirementId,
        nodeId: mapping.nodeId,
        mappingType: MAPPING_TYPES.has(mapping.mappingType)
          ? (mapping.mappingType as TemplateSpecificationMapping['mappingType'])
          : 'implements',
        confidence:
          typeof mapping.confidence === 'number' &&
          mapping.confidence >= 0 &&
          mapping.confidence <= 1
            ? mapping.confidence
            : 1,
      };
      if (typeof mapping.notes === 'string' && mapping.notes.trim().length > 0) {
        entry.notes = mapping.notes.trim();
      }
      foldedMappings.push(entry);
    }
  }

  return { vision, preferences, requirements: foldedRequirements, mappings: foldedMappings };
}

/** Comma/newline-separated tag text → cleaned unique list (UI input helper). */
export function parseTagsInput(raw: string): string[] {
  const tags = raw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 40);
  return [...new Set(tags)].slice(0, 10);
}
