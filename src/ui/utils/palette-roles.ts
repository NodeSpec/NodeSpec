import type { CatalogResolver } from '../../persistence/supabase/catalog-repository.js';
import type { NodeNature } from '@nodespec/core/ontology.js';
import {
  Server, Database, Monitor, Lock, Brain, Globe, Zap, Box,
  Activity, Cloud, Layers, Folder, ExternalLink, Download,
  Smartphone, Cpu, Shield, Network, Mail, Search, TrendingUp,
  Share2, ArrowRightLeft, GitBranch, Radio, GitMerge, HardDrive,
  FileText, Clock, Settings, Package, Hexagon, Library, ClipboardList,
  Gamepad2, Terminal, Webhook, Bot, Thermometer, Router, Archive,
  Megaphone, ScrollText, Warehouse, ListOrdered,
  Binary, Cog, Timer, BarChart3, Key, Sliders,
  type LucideIcon,
} from 'lucide-react';

export interface PaletteCategory {
  id: string;
  label: string;
  iconName: string;
  sortOrder: number;
  roles: PaletteRoleItem[];
  isPrimary: boolean;
}

// M6: the axis pivot ('ownership'), the project-context lens, and OWNERSHIP_GROUPS are
// deleted. No palette surface has used them since N4.7 made the sidebar three sections
// (Structure / Technology / Functional Node Types); buildPaletteCategories' only runtime
// consumer is the admin diagnostics panel, which always called it on the domain axis with
// no lens. The lens was also BROKEN — it matched category labels against agent aliases, so
// it could never activate. Categories are a filing/reporting axis now, not the browse
// taxonomy (NODE_REFERENCE §12).


export interface PaletteRoleItem {
  id: string;
  label: string;
  description: string;
  whenToUse: string | null;
  iconName: string;
  color: string;
  isContainer: boolean;
  containerStyle: 'hosting' | 'logical-boundary' | null;
  sortOrder: number;
  technologyCount: number;
  capabilityTags: string[];
  /** M1b/M1c: `nature` is what paletteChip reads; kind/treatmentMode are gone. */
  nature?: NodeNature;
}

const CATEGORY_SORT_ORDER: Record<string, number> = {
  'Services': 1,
  'Database': 2,
  'Networking': 3,
  'AI & ML': 4,
  'Messaging': 5,
  'Infrastructure': 6,
  'Platform': 7,
  'Automation': 8,
  'External': 9,
  'Observability': 10,
  'Hardware': 11,
  'Game Development': 12,
  'Logical': 13,
};

const PRIMARY_CATEGORIES = new Set([
  'services', 'database', 'networking',
  'ai---ml', 'messaging', 'infrastructure', 'platform',
]);

const ROLE_ICON_MAP: Record<string, LucideIcon> = {
  'server': Server,
  'database': Database,
  'monitor': Monitor,
  'lock': Lock,
  'brain': Brain,
  'globe': Globe,
  'zap': Zap,
  'box': Box,
  'activity': Activity,
  'cloud': Cloud,
  'layers': Layers,
  'folder': Folder,
  'external-link': ExternalLink,
  'download': Download,
  'smartphone': Smartphone,
  'cpu': Cpu,
  'shield': Shield,
  'network': Network,
  'mail': Mail,
  'search': Search,
  'trending-up': TrendingUp,
  'share-2': Share2,
  'arrow-right-left': ArrowRightLeft,
  'git-branch': GitBranch,
  'radio': Radio,
  'git-merge': GitMerge,
  'hard-drive': HardDrive,
  'file-text': FileText,
  'clock': Clock,
  'cog': Settings,
  'package': Package,
  'hexagon': Hexagon,
  'library': Library,
  'ClipboardList': ClipboardList,
  'gamepad-2': Gamepad2,
  'Gamepad2': Gamepad2,
  'Terminal': Terminal,
  'Webhook': Webhook,
  'Bot': Bot,
  'Thermometer': Thermometer,
  'Router': Router,
  'Archive': Archive,
  'Megaphone': Megaphone,
  'ScrollText': ScrollText,
  'Warehouse': Warehouse,
  'ListOrdered': ListOrdered,

  // Icons a live role names but the map never carried, so 21 roles fell through to the
  // category icon or to Box — every cloud platform among them (aws, netlify, vercel,
  // railway, render, fly-io all name 'Cloud'). Found while chasing a report that the
  // Supabase Auth icon would not render.
  'Binary': Binary,
  'Cog': Cog,
  'Timer': Timer,
  'bar-chart-3': BarChart3,
  'key': Key,
  'sliders': Sliders,
};

// The map is authored in two dialects — kebab-case ('git-merge') and PascalCase
// ('ScrollText') — because rows were added by different hands over time. That is
// tolerable in the data but it silently loses a lookup whenever the two disagree on a
// name they both spell, which is exactly how 'Cloud' missed 'cloud' for six platforms.
// This index resolves the same name written either way, and NEVER matches a different
// icon: 'Cloud' and 'cloud' collapse to the same key, 'ScrollText' and 'scroll-text' do
// too, and anything genuinely absent still falls through to the caller's fallback.
const NORMALIZED_ICON_INDEX: Record<string, LucideIcon> = (() => {
  const index: Record<string, LucideIcon> = {};
  for (const [name, icon] of Object.entries(ROLE_ICON_MAP)) {
    const key = name.toLowerCase().replace(/-/g, '');
    if (!(key in index)) index[key] = icon;
  }
  return index;
})();

function lookupIcon(iconName: string): LucideIcon | undefined {
  return ROLE_ICON_MAP[iconName] ?? NORMALIZED_ICON_INDEX[iconName.toLowerCase().replace(/-/g, '')];
}

export function getRoleIcon(iconName: string): LucideIcon {
  return lookupIcon(iconName) ?? Box;
}

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  'Services': Globe,
  'Database': Database,
  'Networking': Shield,
  'AI & ML': Brain,
  'Messaging': Mail,
  'Infrastructure': Layers,
  'Platform': Cloud,
  'Automation': GitBranch,
  'External': ExternalLink,
  'Observability': Activity,
  'Hardware': Cpu,
  'Game Development': Gamepad2,
  'Logical': Folder,
  'Ownership: build': Package,
  'Ownership: rent': Cloud,
  'Ownership: call': ExternalLink,
  'Ownership: host': Layers,
  'Altitude: system': Layers,
  'Altitude: service': Globe,
  'Altitude: component': Box,
};

/** N4.8 (owner: "for nodes missing brand/stored iconography… defer to their parent
 *  category node-type iconography. No emojicons"): role icon → the role's palette
 *  CATEGORY icon → generic box. Never an emoji at any step. */
export function getRoleOrCategoryIcon(
  iconName: string | null | undefined,
  paletteCategory: string | null | undefined,
): LucideIcon {
  const direct = iconName ? lookupIcon(iconName) : undefined;
  if (direct) return direct;
  if (paletteCategory && CATEGORY_ICON_MAP[paletteCategory]) return CATEGORY_ICON_MAP[paletteCategory];
  return Box;
}

export function getRegisteredCategoryDisplayKeys(): string[] {
  return Object.keys(CATEGORY_SORT_ORDER);
}

export function buildPaletteCategories(resolver: CatalogResolver): PaletteCategory[] {
  const roles = resolver.getAllRoles();
  const technologies = resolver.getAllTechnologies();

  const techCountByRole = new Map<string, number>();
  for (const tech of technologies) {
    for (const roleId of tech.roleAffinities) {
      techCountByRole.set(roleId, (techCountByRole.get(roleId) || 0) + 1);
    }
  }

  const groupOf = (role: ReturnType<CatalogResolver['getAllRoles']>[number]) => {
    const cat = role.paletteCategory;
    const id = cat.toLowerCase().replace(/[^a-z0-9]/g, '-');
    return {
      key: cat,
      label: cat,
      icon: cat,
      sortOrder: CATEGORY_SORT_ORDER[cat] ?? 99,
      primary: PRIMARY_CATEGORIES.has(id),
    };
  };

  const categoryMap = new Map<string, { label: string; icon: string; sortOrder: number; primary: boolean; items: PaletteRoleItem[] }>();
  // N4.4 (owner: "overly complex/confusing with the 6"): logical group flavors collapse
  // to ONE recognition-time entry on the browse (domain) axis. Grouping is OPTIONAL —
  // a node's direct parent is a group OR a hosting container, never both — so six
  // solemn structure types read as an obligation the model doesn't even have. The
  // flavors (Bounded Context, Software Layer, …) stay individually reachable via
  // SEARCH (direct-hit principle) and keep their catalog semantics for the AI.
  const logicalRoles: typeof roles = [];
  for (const role of roles) {
    if (role.deprecated) continue;
    if (role.nature === 'integrate') continue;
    if (role.containerStyle === 'logical-boundary') {
      logicalRoles.push(role);
      continue;
    }
    const group = groupOf(role);
    if (!categoryMap.has(group.key)) {
      categoryMap.set(group.key, { label: group.label, icon: group.icon, sortOrder: group.sortOrder, primary: group.primary, items: [] });
    }
    categoryMap.get(group.key)!.items.push({
      id: role.id,
      label: role.label,
      description: role.description,
      whenToUse: role.whenToUse,
      iconName: role.iconName,
      color: role.color,
      isContainer: role.isContainer,
      containerStyle: role.containerStyle ?? null,
      sortOrder: role.sortOrder,
      technologyCount: techCountByRole.get(role.id) || 0,
      capabilityTags: role.capabilityTags || [],
      nature: role.nature,
    });
  }

  if (logicalRoles.length > 0) {
    const generic = logicalRoles.find(r => r.id === 'application-module') ?? logicalRoles[0];
    const group = groupOf(generic);
    if (!categoryMap.has(group.key)) {
      categoryMap.set(group.key, { label: group.label, icon: group.icon, sortOrder: group.sortOrder, primary: group.primary, items: [] });
    }
    categoryMap.get(group.key)!.items.push({
      id: generic.id,
      label: 'Group',
      description: 'Optional — organizes related nodes into one collapsible unit. Nothing runs here; hosting containers are where things run. Specific flavors (Bounded Context, Software Layer, Microservice Boundary…) are searchable by name.',
      whenToUse: generic.whenToUse,
      iconName: generic.iconName,
      color: generic.color,
      isContainer: true,
      containerStyle: 'logical-boundary',
      sortOrder: 1,
      technologyCount: 0,
      capabilityTags: [],
      nature: generic.nature,
    });
  }

  const categories: PaletteCategory[] = [];
  for (const [key, { label, icon, sortOrder, primary, items }] of categoryMap) {
    categories.push({
      id: key.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      label,
      iconName: icon,
      sortOrder,
      roles: items.sort((a, b) => a.sortOrder - b.sortOrder),
      isPrimary: primary,
    });
  }

  return categories.sort((a, b) => a.sortOrder - b.sortOrder);
}


export function resolveNodeCreationParams(
  roleId: string,
  technologyId: string | null,
  resolver: CatalogResolver,
): { nodeType: string; technology: string | undefined; displayName: string } {
  const role = resolver.getRole(roleId);
  if (!role) {
    return { nodeType: roleId, technology: technologyId || undefined, displayName: roleId };
  }

  const effectiveTechId = technologyId || role.defaultTechnology || null;
  const tech = effectiveTechId ? resolver.getTechnology(effectiveTechId) : null;
  // N9a (owner-found: `frontend.react` vs `frontend-app` — mixed grammars raise AI
  // hallucination risk over MCP): node.type = role id, ALWAYS. The dotted legacy grammar
  // is a READ-compat dialect only (resolveNodeType at the read boundary); canvas creation
  // no longer prefers it, so canvas- and MCP-created nodes speak one grammar. The static
  // dotted-keyed template/defaultMetadata paths stop firing as a consequence — creation
  // flows through the catalog role path (buildNodePatchesFromRole), same as MCP.
  const nodeType = roleId;

  // N11(c) 2026-08-09: 'worker-service' dropped from this set — no such role exists in
  // the catalog (the audit's nonexistent-id hand-list finding). 'worker' is the one role
  // generic enough that "Celery" alone would under-describe the node.
  const ROLES_NEEDING_CONTEXT = new Set(['worker']);
  let displayName: string;
  if (tech && ROLES_NEEDING_CONTEXT.has(roleId)) {
    displayName = `${tech.name} ${role.label}`;
  } else {
    displayName = tech ? tech.name : role.label;
  }

  return { nodeType, technology: effectiveTechId || undefined, displayName };
}
