import { resolveCategoryId } from "./palette-categories.ts";
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { CatalogData, TechnologyRow } from "./catalog-loader.ts";
import { formatCommonConnection, normalizeCommonConnections } from "./role-registry.ts";

export type RelevanceTier = 'must-include' | 'strongly-relevant' | 'contextually-relevant';

export interface ScoredTechnology {
  techId: string;
  tier: RelevanceTier;
  score: number;
  signals: string[];
}

export interface RelevanceResult {
  scored: ScoredTechnology[];
  mustInclude: string[];
  stronglyRelevant: string[];
  contextuallyRelevant: string[];
}

export interface RelevanceInput {
  graphNodes: Record<string, { type: string; technology?: string }>;
  specPreferences: Record<string, unknown> | null;
  userMessage: string;
  requirements: Array<{ name: string; description: string | null }>;
  archetypes: string[];
}

const SIGNAL_WEIGHTS = {
  graphNode: 100,
  specPreference: 80,
  userMessage: 60,
  roleAffinity: 40,
  requirementKeyword: 20,
  archetypeCategory: 10,
};

function resolveTechIdFromCandidate(
  catalogs: CatalogData,
  candidate: string,
): string | null {
  const lower = candidate.toLowerCase().replace(/\s+/g, '-');
  if (catalogs.technologies[lower]) return lower;
  if (catalogs.technologies[candidate]) return candidate;
  for (const tech of Object.values(catalogs.technologies)) {
    if (tech.name.toLowerCase() === candidate.toLowerCase() ||
        tech.id.toLowerCase() === lower) {
      return tech.id;
    }
  }
  return null;
}

function collectFromGraphNodes(
  catalogs: CatalogData,
  graphNodes: Record<string, { type: string; technology?: string }>,
  scores: Map<string, { score: number; signals: Set<string> }>,
): void {
  for (const node of Object.values(graphNodes)) {
    if (node.technology && catalogs.technologies[node.technology]) {
      const entry = scores.get(node.technology) || { score: 0, signals: new Set() };
      entry.score += SIGNAL_WEIGHTS.graphNode;
      entry.signals.add('graph-node');
      scores.set(node.technology, entry);
    }
  }
}

function collectFromSpecPreferences(
  catalogs: CatalogData,
  preferences: Record<string, unknown> | null,
  scores: Map<string, { score: number; signals: Set<string> }>,
): void {
  if (!preferences) return;

  const arrayFields = [
    'languages', 'frameworks', 'databases',
    'services', 'integrations',
  ];

  for (const field of arrayFields) {
    const values = preferences[field];
    if (!Array.isArray(values)) continue;
    for (const val of values) {
      if (typeof val !== 'string') continue;
      const techId = resolveTechIdFromCandidate(catalogs, val);
      if (techId) {
        const entry = scores.get(techId) || { score: 0, signals: new Set() };
        entry.score += SIGNAL_WEIGHTS.specPreference;
        entry.signals.add(`spec-pref:${field}`);
        scores.set(techId, entry);
      }
    }
  }

  const deploymentTarget = preferences.deploymentTarget;
  if (typeof deploymentTarget === 'string') {
    const techId = resolveTechIdFromCandidate(catalogs, deploymentTarget);
    if (techId) {
      const entry = scores.get(techId) || { score: 0, signals: new Set() };
      entry.score += SIGNAL_WEIGHTS.specPreference;
      entry.signals.add('spec-pref:deploymentTarget');
      scores.set(techId, entry);
    }
  }
}

async function collectFromTextSearch(
  supabase: SupabaseClient,
  queryText: string,
  signalName: string,
  weight: number,
  scores: Map<string, { score: number; signals: Set<string> }>,
  maxResults: number = 10,
): Promise<void> {
  if (!queryText || queryText.trim().length < 3) return;

  const { data, error } = await supabase.rpc('search_relevant_technologies', {
    query_text: queryText,
    max_results: maxResults,
  });

  if (error || !data) return;

  for (const row of data) {
    const entry = scores.get(row.tech_id) || { score: 0, signals: new Set() };
    entry.score += weight * row.rank;
    entry.signals.add(signalName);
    scores.set(row.tech_id, entry);
  }
}

function collectFromRoleAffinity(
  catalogs: CatalogData,
  graphNodes: Record<string, { type: string; technology?: string }>,
  scores: Map<string, { score: number; signals: Set<string> }>,
): void {
  const activeRoles = new Set<string>();
  for (const node of Object.values(graphNodes)) {
    activeRoles.add(node.type);
  }

  if (activeRoles.size === 0) return;

  for (const tech of Object.values(catalogs.technologies)) {
    if (scores.has(tech.id)) continue;
    if (!Array.isArray(tech.role_affinities)) continue;

    const matchingRoles = tech.role_affinities.filter(r => activeRoles.has(r));
    if (matchingRoles.length > 0) {
      const entry = scores.get(tech.id) || { score: 0, signals: new Set() };
      entry.score += SIGNAL_WEIGHTS.roleAffinity * Math.min(matchingRoles.length, 3);
      entry.signals.add('role-affinity');
      scores.set(tech.id, entry);
    }
  }
}

function collectFromArchetypeCategories(
  catalogs: CatalogData,
  archetypes: string[],
  scores: Map<string, { score: number; signals: Set<string> }>,
): void {
  if (archetypes.length === 0) return;

  const relevantCategories = new Set<string>();
  for (const archId of archetypes) {
    const arch = catalogs.scopeArchetypes[archId];
    if (arch && Array.isArray(arch.relevant_categories)) {
      for (const cat of arch.relevant_categories) {
        relevantCategories.add(cat);
      }
    }
  }

  if (relevantCategories.size === 0) return;

  // M2: archetypes store palette_category values directly now — no alias hop. The hop
  // resolved 'build' to the pre-v3 id 'Frontend' and then matched zero roles, so every
  // Services technology was silently scored irrelevant.
  const categoryDisplayKeys = new Set<string>();
  for (const token of relevantCategories) {
    categoryDisplayKeys.add(resolveCategoryId(token) ?? token);
  }

  const relevantRoleIds = new Set<string>();
  for (const role of Object.values(catalogs.nodeRoles)) {
    if (categoryDisplayKeys.has(role.palette_category)) {
      relevantRoleIds.add(role.id);
    }
  }

  for (const tech of Object.values(catalogs.technologies)) {
    if (scores.has(tech.id)) continue;
    if (!Array.isArray(tech.role_affinities)) continue;

    const matches = tech.role_affinities.some(r => relevantRoleIds.has(r));
    if (matches) {
      const entry = scores.get(tech.id) || { score: 0, signals: new Set() };
      entry.score += SIGNAL_WEIGHTS.archetypeCategory;
      entry.signals.add('archetype-category');
      scores.set(tech.id, entry);
    }
  }
}

function assignTiers(
  scores: Map<string, { score: number; signals: Set<string> }>,
): ScoredTechnology[] {
  const result: ScoredTechnology[] = [];

  for (const [techId, entry] of scores) {
    let tier: RelevanceTier;
    if (entry.signals.has('graph-node') || entry.signals.has('spec-pref:languages') ||
        entry.signals.has('spec-pref:frameworks') || entry.signals.has('spec-pref:databases') ||
        entry.signals.has('spec-pref:services') || entry.signals.has('spec-pref:integrations') ||
        entry.signals.has('spec-pref:deploymentTarget')) {
      tier = 'must-include';
    } else if (entry.signals.has('user-message') || entry.signals.has('role-affinity')) {
      tier = 'strongly-relevant';
    } else {
      tier = 'contextually-relevant';
    }

    result.push({
      techId,
      tier,
      score: entry.score,
      signals: [...entry.signals],
    });
  }

  result.sort((a, b) => {
    const tierOrder: Record<RelevanceTier, number> = {
      'must-include': 0,
      'strongly-relevant': 1,
      'contextually-relevant': 2,
    };
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.score - a.score;
  });

  return result;
}

export async function resolveRelevantTechnologies(
  supabase: SupabaseClient,
  catalogs: CatalogData,
  input: RelevanceInput,
): Promise<RelevanceResult> {
  const scores = new Map<string, { score: number; signals: Set<string> }>();

  collectFromGraphNodes(catalogs, input.graphNodes, scores);
  collectFromSpecPreferences(catalogs, input.specPreferences, scores);
  collectFromRoleAffinity(catalogs, input.graphNodes, scores);
  collectFromArchetypeCategories(catalogs, input.archetypes, scores);

  const requirementText = input.requirements
    .map(r => `${r.name} ${r.description || ''}`)
    .join(' ')
    .trim();

  await Promise.all([
    collectFromTextSearch(
      supabase, input.userMessage, 'user-message',
      SIGNAL_WEIGHTS.userMessage, scores, 10,
    ),
    collectFromTextSearch(
      supabase, requirementText, 'requirement-keyword',
      SIGNAL_WEIGHTS.requirementKeyword, scores, 8,
    ),
  ]);

  const scored = assignTiers(scores);

  return {
    scored,
    mustInclude: scored.filter(s => s.tier === 'must-include').map(s => s.techId),
    stronglyRelevant: scored.filter(s => s.tier === 'strongly-relevant').map(s => s.techId),
    contextuallyRelevant: scored.filter(s => s.tier === 'contextually-relevant').map(s => s.techId),
  };
}

const TECH_GUIDANCE_BUDGET = 15_000;

const CODE_TEMPLATE_SUFFIX = ' [Tailor to project language and apply best practices for engineering and security if different from this example]';

function buildFullSection(tech: TechnologyRow): string {
  if (tech.is_user_contributed) {
    return `### ${tech.name} (${tech.id}) [user-specified]\nApply general software engineering principles for ${tech.name}.`;
  }
  if (!tech.ai_context) return '';
  const ctx = tech.ai_context;
  const parts: string[] = [`### ${tech.name} (${tech.id})`];
  if (ctx.purpose) parts.push(`Purpose: ${ctx.purpose}`);
  if (ctx.sdkInitPattern) {
    parts.push(`SDK Init: ${ctx.sdkInitPattern}${CODE_TEMPLATE_SUFFIX}`);
  }
  if (ctx.commonApiPatterns && ctx.commonApiPatterns.length > 0) {
    const patterns = ctx.commonApiPatterns.map(p =>
      `${p.name}: ${p.codeTemplate}${CODE_TEMPLATE_SUFFIX}${p.description ? ` -- ${p.description}` : ''}`
    );
    parts.push(`Common Patterns:\n${patterns.join('\n')}`);
  }
  if (ctx.configurationTemplate) {
    parts.push(`Config: ${ctx.configurationTemplate}${CODE_TEMPLATE_SUFFIX}`);
  }
  if (ctx.bestPractices && ctx.bestPractices.length > 0) {
    parts.push(`Best practices: ${ctx.bestPractices.join('; ')}`);
  }
  if (ctx.securityGuidance) {
    parts.push(`Security: ${ctx.securityGuidance}`);
  }
  if (ctx.freshnessNote) {
    parts.push(`Freshness: ${ctx.freshnessNote}`);
  }
  if (ctx.integrationPatterns && ctx.integrationPatterns.length > 0) {
    parts.push(`Integrations: ${ctx.integrationPatterns.join('; ')}`);
  }
  if (ctx.antiPatterns && ctx.antiPatterns.length > 0) {
    parts.push(`Avoid: ${ctx.antiPatterns.join('; ')}`);
  }
  if (Array.isArray(tech.suggested_files) && tech.suggested_files.length > 0) {
    parts.push(`Suggested files: ${tech.suggested_files.map(sf => `${sf.path} (${sf.kind})`).join(', ')}`);
  }
  const connections = normalizeCommonConnections(tech.common_connections);
  if (connections.length > 0) {
    parts.push(`Typical connections: ${connections.map(formatCommonConnection).join(', ')}`);
  }
  return parts.join('\n');
}

function buildCompressedSection(tech: TechnologyRow): string {
  if (tech.is_user_contributed) {
    return `### ${tech.name} (${tech.id}) [user-specified]`;
  }
  const purpose = tech.ai_context?.purpose;
  if (!purpose) return `### ${tech.name} (${tech.id})`;
  return `### ${tech.name} (${tech.id})\nPurpose: ${purpose}`;
}

function buildMediumSection(tech: TechnologyRow): string {
  if (!tech.ai_context) return '';
  const ctx = tech.ai_context;
  const parts: string[] = [`### ${tech.name} (${tech.id})`];
  if (ctx.purpose) parts.push(`Purpose: ${ctx.purpose}`);
  if (ctx.bestPractices && ctx.bestPractices.length > 0) {
    parts.push(`Best practices: ${ctx.bestPractices.join('; ')}`);
  }
  return parts.join('\n');
}

function buildLightSection(tech: TechnologyRow): string {
  const purpose = tech.ai_context?.purpose;
  const summary = purpose ? purpose.substring(0, 120) : tech.name;
  return `- ${tech.id}: ${summary}`;
}

export function buildTieredTechnologyGuidance(
  catalogs: CatalogData,
  relevance: RelevanceResult,
): string {
  if (relevance.scored.length === 0) return '';

  let budget = TECH_GUIDANCE_BUDGET;
  const lines: string[] = [];

  if (relevance.mustInclude.length > 0) {
    const fullSections: Array<{ section: string; techId: string }> = [];
    let fullTotal = 0;
    for (const techId of relevance.mustInclude) {
      const tech = catalogs.technologies[techId];
      if (!tech) continue;
      const section = buildFullSection(tech);
      if (!section) continue;
      fullSections.push({ section, techId });
      fullTotal += section.length;
    }

    if (fullTotal <= budget) {
      for (const { section } of fullSections) {
        lines.push(section);
        budget -= section.length;
      }
    } else {
      for (const { techId } of fullSections) {
        const tech = catalogs.technologies[techId];
        if (!tech) continue;
        const compressed = buildCompressedSection(tech);
        if (budget - compressed.length < 0 && lines.length > 0) break;
        lines.push(compressed);
        budget -= compressed.length;
      }
    }
  }

  if (budget > 1000 && relevance.stronglyRelevant.length > 0) {
    const tier2Sections: string[] = [];
    for (const techId of relevance.stronglyRelevant) {
      const tech = catalogs.technologies[techId];
      if (!tech) continue;
      const section = buildMediumSection(tech);
      if (!section) continue;
      if (budget - section.length < 0) break;
      tier2Sections.push(section);
      budget -= section.length;
    }
    if (tier2Sections.length > 0) {
      lines.push('', '--- Related technologies (use lookup_catalog for full details) ---');
      lines.push(...tier2Sections);
    }
  }

  if (budget > 500 && relevance.contextuallyRelevant.length > 0) {
    const tier3Lines: string[] = [];
    for (const techId of relevance.contextuallyRelevant) {
      const tech = catalogs.technologies[techId];
      if (!tech) continue;
      const line = buildLightSection(tech);
      if (budget - line.length < 0) break;
      tier3Lines.push(line);
      budget -= line.length;
    }
    if (tier3Lines.length > 0) {
      lines.push('', '--- Other available technologies (use lookup_catalog for details) ---');
      lines.push(...tier3Lines);
    }
  }

  if (lines.length === 0) return '';

  return `\nTECHNOLOGY GUIDANCE (for this project's stack):\n${lines.join('\n')}`;
}
