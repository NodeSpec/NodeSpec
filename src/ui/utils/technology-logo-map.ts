import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';

export const TECHNOLOGY_LOGO_MAP: Record<string, string> = {};

const _colorMap: Record<string, { primary: string; secondary: string }> = {};
const _displayNameMap: Record<string, string> = {};
// M6: `_legacyToTech` is gone. It was populated from legacy_type_mappings, which M4
// deleted — so the `legacyNodeType` fallback parameter on the getters below had been
// resolving against a permanently EMPTY map. Every caller passed `data.nodeType` into a
// lookup that could not hit. Dropped from the signatures rather than left as a no-op.
let _populated = false;

export function populateTechnologyVisuals(catalog: CatalogResolver): void {
  for (const key of Object.keys(TECHNOLOGY_LOGO_MAP)) delete TECHNOLOGY_LOGO_MAP[key];
  for (const key of Object.keys(_colorMap)) delete _colorMap[key];
  for (const key of Object.keys(_displayNameMap)) delete _displayNameMap[key];

  for (const tech of catalog.getAllTechnologies()) {
    if (tech.iconUrl) {
      TECHNOLOGY_LOGO_MAP[tech.id] = tech.iconUrl;
    }
    _colorMap[tech.id] = {
      primary: tech.brandColor,
      secondary: tech.secondaryColor ?? tech.brandColor,
    };
    _displayNameMap[tech.id] = tech.displayName ?? tech.name;
  }

  _populated = true;
}

export function isTechnologyVisualsPopulated(): boolean {
  return _populated;
}

export function getTechnologyLogo(technologyId: string | undefined): string | undefined {
  if (technologyId && TECHNOLOGY_LOGO_MAP[technologyId]) {
    return TECHNOLOGY_LOGO_MAP[technologyId];
  }
  return undefined;
}

export function getTechnologyColors(technologyId: string | undefined): { primary: string; secondary: string } | undefined {
  if (technologyId && _colorMap[technologyId]) {
    return _colorMap[technologyId];
  }
  return undefined;
}

export function getTechnologyDisplayName(technologyId: string | undefined): string | undefined {
  if (!technologyId) return undefined;
  return _displayNameMap[technologyId] ?? technologyId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
