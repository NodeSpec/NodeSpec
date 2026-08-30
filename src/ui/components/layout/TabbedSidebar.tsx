import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { RepoExplorer } from '../panels/RepoExplorer.js';
import { SpecificationPanelV3 } from '../spec-v3/index.js';
import type { Graph } from '@nodespec/core/types.js';
import { useSpecification, useAuth } from '../../context/ServiceContext.js';
import {
  FolderTree,
  Workflow,
  FileText,
  Search,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useCatalog } from '../../hooks/useCatalog.js';
import { getRoleIcon } from '../../utils/palette-roles.js';
import { buildAlphabeticalPalette, buildStructureListItems, buildPlatformListItems, buildFunctionalRoleItems, groupByLetter, familiesInList, familyPlatformRoleIds } from '../../utils/palette-list.js';
import type { PaletteListItem } from '../../utils/palette-list.js';
import { getTechnologyLogo } from '../../utils/technology-logo-map.js';
import { deriveNodeNature, paletteChip, rankCatalogMatches } from '../../utils/node-nature.js';
import type { NodeRole, TechnologyCatalogEntry } from '../../../persistence/supabase/catalog-repository.js';

interface TabbedSidebarProps {
  graph: Graph;
  onFileSelect?: (artifactId: string, nodeId: string) => void;
  selectedArtifactId: string | null;
  onDragStart?: (nodeType: string) => void;

  projectId?: string | null;

  refreshCounter?: number;
}

type TabType = 'repo' | 'nodes' | 'spec';

// M6: onNodeSelect / branchId / viewMode / onRefresh were passed by GraphEditor and
// destructured to `_`-prefixed names that nothing read. Dropped on both sides.
function TabbedSidebarComponent({ graph, onFileSelect, selectedArtifactId, onDragStart, projectId, refreshCounter }: TabbedSidebarProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const specificationService = useSpecification();
  const auth = useAuth();
  const catalog = useCatalog();
  const graphIsEmpty = Object.keys(graph.nodes).length === 0;
  const [activeTab, setActiveTab] = useState<TabType>(
    graphIsEmpty ? 'nodes' : 'spec'
  );
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [specificationId, setSpecificationId] = useState<string | null>(null);
  const [paletteSearch, setPaletteSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // N4.5: letter-snap rail — refs to each letter section in the A–Z list.
  const letterRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // N4.6: provider-family filter (AWS/Azure/GCP/… logo chips above the list).
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const alphaItems = useMemo(() => (catalog ? buildAlphabeticalPalette(catalog) : []), [catalog]);
  const familyChips = useMemo(() => familiesInList(alphaItems), [alphaItems]);
  // 2026-08-05: brand-logo lookup for Platforms rows — same fallback the family chips
  // use (platform tech row's own logo, else the first family member with one), but
  // with minCount 1 so single-member families still resolve a logo.
  const familyLogoSamples = useMemo(() => familiesInList(alphaItems, 1), [alphaItems]);

  // Custom-node state for the "Define custom…" flow (NODE-LOCAL identity — no catalog
  // writes). N4.5 removed the category/band browse, the lens chip, and the info popover
  // (owner: "just have a running list by alphabetical order").
  const [customName, setCustomName] = useState('');
  const [customRoleId, setCustomRoleId] = useState('external-service');
  // Owner 2026-08-05: the browse's parent sections are collapsible.
  const [collapsedPaletteSections, setCollapsedPaletteSections] = useState<Set<string>>(new Set());
  const togglePaletteSection = useCallback((key: string) => {
    setCollapsedPaletteSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const loadSpecificationId = useCallback(async () => {
    if (!projectId) {
      setSpecificationId(null);
      return;
    }

    try {
      const specs = await specificationService.getSpecificationsByProject(projectId);
      if (specs.length > 0) {
        setSpecificationId(specs[0].id);
      } else {
        const session = await auth.getSession();
        if (!session?.user?.id) {
          setSpecificationId(null);
          return;
        }
        const newSpec = await specificationService.createSpecification({
          vision: '',
          projectId,
          createdBy: session.user.id,
        });
        setSpecificationId(newSpec.id);
      }
    } catch {
      setSpecificationId(null);
    }
  }, [projectId, specificationService, auth]);

  // Load specification ID when project changes
  useEffect(() => {
    loadSpecificationId();
  }, [loadSpecificationId]);

  // Reload specification when refreshCounter changes
  useEffect(() => {
    if (refreshCounter !== undefined && refreshCounter > 0) {
      setTimeout(() => {
        loadSpecificationId();
      }, 800);
    }
  }, [refreshCounter, loadSpecificationId]);


  // N4.8 (owner): the Recently-Used picker is gone — the three-section browse IS the
  // picker; a fourth surface competing for pinned space was noise.
  const handleDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/specgraph-node', nodeType);
    event.dataTransfer.effectAllowed = 'move';
    onDragStart?.(nodeType);
  };

  const containerStyles: React.CSSProperties = {
    width: isCollapsed ? '52px' : '320px',
    backgroundColor: theme.mode === 'dark' ? c.backgroundSecondary : '#ffffff',
    borderRight: `1px solid ${c.border}`,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
    transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const tabBarStyles: React.CSSProperties = {
    display: 'flex',
    borderBottom: `1px solid ${c.border}`,
    backgroundColor: theme.mode === 'dark' ? c.backgroundSecondary : '#fafafa',
    flexShrink: 0,
  };

  const tabStyles = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '14px 16px',
    border: 'none',
    backgroundColor: isActive
      ? (theme.mode === 'dark' ? c.backgroundSecondary : '#ffffff')
      : 'transparent',
    color: isActive ? c.text : c.textMuted,
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: isActive ? 600 : 500,
    borderBottom: isActive ? `2px solid ${c.primary}` : '2px solid transparent',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  });

  const contentStyles: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  };

  const nodePanelStyles: React.CSSProperties = {
    padding: '12px',
  };



  if (isCollapsed) {
    return (
      <div style={containerStyles}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          padding: '16px 0',
        }}>
          <button
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
              color: c.textMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
            onClick={() => setIsCollapsed(false)}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
              e.currentTarget.style.color = c.text;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)';
              e.currentTarget.style.color = c.textMuted;
            }}
            title="Expand sidebar"
          >
            <span style={{ fontSize: '16px', transform: 'rotate(180deg)' }}>▶</span>
          </button>
          <div style={{
            width: '1px',
            height: '100px',
            backgroundColor: c.border,
          }} />
          <button
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeTab === 'repo'
                ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)')
                : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)'),
              color: activeTab === 'repo' ? c.text : c.textMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
            onClick={() => {
              setActiveTab('repo');
              setIsCollapsed(false);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = activeTab === 'repo'
                ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)')
                : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)');
            }}
            title="Design-bound files (the files linked to nodes — a subset of your repo, not a repo browser)"
          >
            <FolderTree size={18} />
          </button>
          <button
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeTab === 'nodes'
                ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)')
                : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)'),
              color: activeTab === 'nodes' ? c.text : c.textMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
            onClick={() => {
              setActiveTab('nodes');
              setIsCollapsed(false);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = activeTab === 'nodes'
                ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)')
                : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)');
            }}
            title="Node Panel"
          >
            <Workflow size={18} />
          </button>
          <button
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: activeTab === 'spec'
                ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)')
                : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)'),
              color: activeTab === 'spec' ? c.text : c.textMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
            }}
            onClick={() => {
              setActiveTab('spec');
              setIsCollapsed(false);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = activeTab === 'spec'
                ? (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)')
                : (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)');
            }}
            title="Specification"
          >
            <FileText size={18} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyles}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        borderBottom: `1px solid ${c.border}`,
        backgroundColor: theme.mode === 'dark' ? c.backgroundSecondary : '#fafafa',
      }}>
        <button
          style={{
            width: '40px',
            height: '48px',
            border: 'none',
            backgroundColor: 'transparent',
            color: c.textMuted,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            borderRight: `1px solid ${c.border}`,
          }}
          onClick={() => setIsCollapsed(true)}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)';
            e.currentTarget.style.color = c.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = c.textMuted;
          }}
          title="Collapse sidebar"
        >
          <span style={{ fontSize: '14px' }}>◀</span>
        </button>
        <div style={{ ...tabBarStyles, borderBottom: 'none', flex: 1 }}>
          <button
            style={tabStyles(activeTab === 'repo')}
          onClick={() => setActiveTab('repo')}
          onMouseEnter={(e) => {
            if (activeTab !== 'repo') {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'repo') {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <FolderTree size={16} />
          Files
        </button>
        <button
          style={tabStyles(activeTab === 'nodes')}
          onClick={() => setActiveTab('nodes')}
          onMouseEnter={(e) => {
            if (activeTab !== 'nodes') {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'nodes') {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <Workflow size={16} />
          Nodes
        </button>
        <button
          style={tabStyles(activeTab === 'spec')}
          onClick={() => setActiveTab('spec')}
          onMouseEnter={(e) => {
            if (activeTab !== 'spec') {
              e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== 'spec') {
              e.currentTarget.style.backgroundColor = 'transparent';
            }
          }}
        >
          <FileText size={16} />
          Spec
        </button>
        </div>
      </div>

      {/* N4.6: the nodes tab pins its header (search + family chips) and scrolls the
          LIST internally — the outer tab scroll is disabled for it. */}
      <div style={activeTab === 'nodes'
        ? { ...contentStyles, overflowY: 'hidden', display: 'flex', flexDirection: 'column' }
        : contentStyles}>
        {activeTab === 'repo' ? (
          <RepoExplorer
            graph={graph}
            onFileSelect={onFileSelect || (() => {})}
            selectedArtifactId={selectedArtifactId}
          />
        ) : activeTab === 'spec' ? (
          <SpecificationPanelV3
            specificationId={specificationId}
            graph={graph}
          />
        ) : (
          <div style={{ ...nodePanelStyles, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, boxSizing: 'border-box' }}>
            <div style={{
              position: 'relative',
              marginBottom: '12px',
              flexShrink: 0,
            }}>
              <Search size={14} style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: c.textMuted,
                pointerEvents: 'none',
              }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search nodes..."
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 32px 8px 32px',
                  borderRadius: '8px',
                  border: `1px solid ${c.border}`,
                  backgroundColor: theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)',
                  color: c.text,
                  fontSize: '13px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                  boxSizing: 'border-box',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = c.primary; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = c.border; }}
              />
              {paletteSearch && (
                <button
                  onClick={() => { setPaletteSearch(''); searchInputRef.current?.focus(); }}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: '2px',
                    cursor: 'pointer',
                    color: c.textMuted,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* N4.6/N4.7: provider-family filter — pinned with the search box, titled
                "Platform Filters" (owner 2026-07-25, expanding platforms). Chip logo
                falls back to the first member technology with a catalog logo
                (Supabase/Cloudflare have no family-key technology row). */}
            {!paletteSearch.trim() && familyChips.length > 0 && (
              <div style={{ flexShrink: 0, marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: c.textMuted, padding: '0 4px 6px' }}>
                Platform Filters
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {familyChips.map(f => {
                  const logo = getTechnologyLogo(f.key)
                    ?? f.sampleTechIds.map(id => getTechnologyLogo(id)).find(Boolean);
                  const active = activeFamily === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => setActiveFamily(active ? null : f.key)}
                      title={`${f.label} — ${f.count} technologies${active ? ' (click to clear)' : ''}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 7px',
                        borderRadius: '999px', cursor: 'pointer', fontSize: '10px', fontWeight: 600,
                        border: `1px solid ${active ? c.primary : c.border}`,
                        backgroundColor: active ? (theme.mode === 'dark' ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.10)') : 'transparent',
                        color: active ? c.primary : c.textMuted,
                      }}
                    >
                      {logo ? (
                        <img src={logo} alt={f.label} style={{ width: '12px', height: '12px', objectFit: 'contain' }} />
                      ) : (
                        <span>{f.label.charAt(0)}</span>
                      )}
                      <span>{f.label}</span>
                      <span style={{ opacity: 0.7 }}>{f.count}</span>
                    </button>
                  );
                })}
              </div>
              </div>
            )}

            {/* N4.6/N4.7: search results scroll as one region; the browse is a flex
                column of three independently-scrolling sections. */}
            <div style={paletteSearch.trim()
              ? { flex: 1, minHeight: 0, overflowY: 'auto' }
              : { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* N3.5: search-first — technologies are directly searchable and draggable.
                Direct-hit ranking: "aws s3" / "apache nifi" surface first. */}
            {paletteSearch.trim() && catalog && (() => {
              const matches = rankCatalogMatches(
                paletteSearch,
                catalog.getAllTechnologies().map(t => ({
                  id: t.id,
                  name: t.name,
                  displayName: t.displayName,
                  purpose: ((t.aiContext as Record<string, unknown>)?.purpose as string) ?? null,
                })),
                8,
              );
              // N3.7: ONE row per recognizable thing. The role is the system's filing —
              // resolved silently at drop (single affinity) or by one usage-phrased
              // question (UsagePicker). Role labels never appear at recognition time.
              const rows: Array<{ tech: TechnologyCatalogEntry; primaryRole: NodeRole; liveRoles: NodeRole[] }> = [];
              for (const m of matches) {
                const tech = catalog.getTechnology(m.id);
                if (!tech) continue;
                const liveRoles = tech.roleAffinities
                  .map(rid => catalog.getRole(rid))
                  .filter((r): r is NodeRole => !!r && !r.deprecated && !r.isContainer);
                if (liveRoles.length === 0) continue;
                rows.push({ tech, primaryRole: liveRoles[0], liveRoles });
              }
              // N4.8 (owner): `requirement` never appears in a picker — requirement
              // nodes live only on the decomposition canvas, generated or created via
              // CRUD, never dragged. (buildRoleListItems already excluded the kind;
              // this SEARCH lane did not.)
              const customRoles = catalog.getAllRoles()
                .filter(r => !r.deprecated && !r.isContainer && r.nature !== 'integrate')
                .sort((a, b) => a.label.localeCompare(b.label));
              // N4.4: structure (container) roles join the ranked search lane — "bounded
              // context" must come up like "AWS S3" does. Groups carry a 'Group' chip;
              // hosting containers keep 'Host'.
              const structureMatches = rankCatalogMatches(
                paletteSearch,
                catalog.getAllRoles()
                  .filter(r => !r.deprecated && r.isContainer)
                  .map(r => ({
                    id: r.id,
                    name: r.label,
                    purpose: r.description ? r.description.split('. ')[0] : null,
                    role: r,
                  })),
                5,
              );
              // N4.5: generic leaf roles (Backend Service, Worker…) rank in search too —
              // the old filtered-category rendering below is gone, so this is their lane.
              const roleMatches = rankCatalogMatches(
                paletteSearch,
                customRoles
                  .filter(r => !rows.some(row => row.liveRoles.length === 1 && row.primaryRole.id === r.id))
                  .map(r => ({
                    id: r.id,
                    name: r.label,
                    purpose: r.description ? r.description.split('. ')[0] : null,
                    role: r,
                  })),
                5,
              );
              return (
                <div style={{ marginBottom: '12px' }}>
                  {rows.length > 0 && (
                    <>
                      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: c.textMuted, padding: '4px 4px 6px' }}>
                        Technologies
                      </div>
                      {rows.map(({ tech, primaryRole, liveRoles }) => {
                        const aiCtx = tech.aiContext as Record<string, unknown> | undefined;
                        const purpose = (aiCtx?.purpose as string) ?? deriveNodeNature(primaryRole, tech).line;
                        const chip = paletteChip(primaryRole, tech);
                        // N3.8: brand logo (or brand-color initial) — recognition is visual
                        // first; same pattern as TechnologyPicker rows.
                        const logoSrc = getTechnologyLogo(tech.id);
                        return (
                          <div
                            key={tech.id}
                            draggable
                            onDragStart={(e) => {
                              // No effectAllowed restriction: the canvas dragover sets
                              // dropEffect='move', and 'move' ∉ 'copy' makes the browser
                              // refuse the drop entirely (bench-found 2026-07-22).
                              e.dataTransfer.setData('application/specgraph-tech', tech.id);
                              // Role travels only when unambiguous; otherwise the drop
                              // asks ONE usage-phrased question (UsagePicker).
                              if (liveRoles.length === 1) {
                                e.dataTransfer.setData('application/specgraph-node', primaryRole.id);
                              }
                            }}
                            title={deriveNodeNature(primaryRole, tech).line}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px',
                              borderRadius: '8px', cursor: 'grab', border: `1px solid transparent`,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div style={{
                              width: '28px', height: '28px', borderRadius: '6px',
                              backgroundColor: `${tech.brandColor}12`, border: `1px solid ${tech.brandColor}30`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                              {logoSrc ? (
                                <img src={logoSrc} alt={tech.name} draggable={false} style={{ width: '18px', height: '18px', objectFit: 'contain' }} />
                              ) : (
                                <span style={{ fontSize: '12px', fontWeight: 700, color: tech.brandColor }}>
                                  {tech.name.charAt(0)}
                                </span>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 500, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {tech.displayName || tech.name}
                              </div>
                              <div style={{ fontSize: '11px', color: c.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {purpose}
                              </div>
                            </div>
                            {chip && (
                              <span style={{ fontSize: '9px', color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: '4px', padding: '1px 5px', flexShrink: 0 }}>
                                {chip}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                  {structureMatches.length > 0 && (
                    <>
                      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: c.textMuted, padding: '8px 4px 6px' }}>
                        Structure
                      </div>
                      {structureMatches.map(m => {
                        const chip = paletteChip(m.role) ?? 'Group';
                        return (
                          <div
                            key={m.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, m.id)}
                            title={deriveNodeNature(m.role).line}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px',
                              borderRadius: '8px', cursor: 'grab', border: `1px solid transparent`,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 500, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.name}
                              </div>
                              {m.purpose && (
                                <div style={{ fontSize: '11px', color: c.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {m.purpose}
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: '9px', color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: '4px', padding: '1px 5px', flexShrink: 0 }}>
                              {chip}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                  {roleMatches.length > 0 && (
                    <>
                      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: c.textMuted, padding: '8px 4px 6px' }}>
                        Functional Node Types
                      </div>
                      {roleMatches.map(m => {
                        const RoleIcon = getRoleIcon(m.role.iconName);
                        const chip = paletteChip(m.role);
                        return (
                          <div
                            key={m.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, m.id)}
                            title={deriveNodeNature(m.role).line}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px',
                              borderRadius: '8px', cursor: 'grab', border: `1px solid transparent`,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div style={{
                              width: '28px', height: '28px', borderRadius: '6px',
                              backgroundColor: `${m.role.color}15`, border: `1px solid ${m.role.color}30`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: m.role.color,
                            }}>
                              <RoleIcon size={15} strokeWidth={2} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13px', fontWeight: 500, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.name}
                              </div>
                              {m.purpose && (
                                <div style={{ fontSize: '11px', color: c.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {m.purpose}
                                </div>
                              )}
                            </div>
                            {chip && (
                              <span style={{ fontSize: '9px', color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: '4px', padding: '1px 5px', flexShrink: 0 }}>
                                {chip}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                  {/* Define custom… — NODE-LOCAL: nothing is added to the catalog */}
                  <div style={{ marginTop: '6px', padding: '8px 10px', borderRadius: '8px', border: `1px dashed ${c.border}` }}>
                    <div style={{ fontSize: '11px', color: c.textMuted, marginBottom: '6px' }}>
                      Not in the catalog? Name it and pick what it is. Your own buildable
                      component becomes a normal node; an uncatalogued API, service, or
                      engine you depend on is tagged custom (the AI won't invent specifics
                      for it).
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        type="text"
                        placeholder={paletteSearch.trim()}
                        value={customName}
                        onChange={(e) => setCustomName(e.target.value)}
                        style={{ flex: 1, minWidth: 0, padding: '5px 8px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: c.text, fontSize: '12px', outline: 'none' }}
                      />
                      <select
                        value={customRoleId}
                        onChange={(e) => setCustomRoleId(e.target.value)}
                        title="What kind of thing is it?"
                        style={{ maxWidth: '45%', padding: '5px 4px', borderRadius: '6px', border: `1px solid ${c.border}`, backgroundColor: 'transparent', color: c.textMuted, fontSize: '11px', outline: 'none' }}
                      >
                        {customRoles.map(r => (
                          <option key={r.id} value={r.id}>{r.label}</option>
                        ))}
                      </select>
                    </div>
                    <div
                      draggable
                      onDragStart={(e) => {
                        const name = (customName || paletteSearch).trim();
                        e.dataTransfer.setData('application/specgraph-custom', JSON.stringify({ roleId: customRoleId, name }));
                      }}
                      style={{
                        marginTop: '6px', textAlign: 'center', padding: '6px', borderRadius: '6px',
                        border: `1px solid ${c.primary}40`, color: c.primary, fontSize: '12px', cursor: 'grab',
                        backgroundColor: theme.mode === 'dark' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.06)',
                      }}
                    >
                      Drag "{(customName || paletteSearch).trim() || 'custom node'}" to canvas
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* N4.7 browse (owner: "the sidebar should have internal scrolls of three
                sections: Structure, Technology, Functional Node Types"): three stacked
                sections, EACH with its own scroll. Technology keeps the A–Z letter
                rail; Functional Node Types shows the catalog-derived generic set
                (pure-provider and zero-tech app_service roles are hidden — searchable
                still; see buildFunctionalRoleItems). */}
            {!paletteSearch.trim() && catalog && (() => {
              // Owner rulings 2026-08-05: Structure = the organizational group roles
              // ONLY; Platforms = BRAND platforms only (nature 'host' — generic hosting
              // concepts browse under Functional Node Types). The N4.6/N4.7 family
              // filter narrows Technology and Platforms to that provider; logical
              // groups and generic concepts belong to no platform.
              const structureItems = activeFamily ? [] : buildStructureListItems(catalog);
              const platformItems = activeFamily
                ? buildPlatformListItems(catalog).filter(s => familyPlatformRoleIds(activeFamily).includes(s.id))
                : buildPlatformListItems(catalog);
              const letterGroups = groupByLetter(
                activeFamily ? alphaItems.filter(i => i.family === activeFamily) : alphaItems,
              );
              const functionalItems = buildFunctionalRoleItems(catalog);

              const listRow = (item: PaletteListItem) => {
                // Platforms rows carry the BRAND logo (owner 2026-08-05): the role id's
                // own tech-row logo when one exists (aws/azure/gcp), else the first
                // family member's (supabase/cloudflare/vercel… have no platform tech row).
                const logoSrc = item.kind === 'technology'
                  ? getTechnologyLogo(item.id)
                  : (getTechnologyLogo(item.id)
                      ?? familyLogoSamples.find(f => f.key === item.id)?.sampleTechIds.map(id => getTechnologyLogo(id)).find(Boolean));
                const RoleIcon = item.kind !== 'technology' ? getRoleIcon(item.iconName ?? 'box') : null;
                const boxColor = item.kind === 'technology' ? (item.brandColor ?? '#888888') : (item.color ?? '#888888');
                return (
                  <div
                    key={item.key}
                    draggable
                    onDragStart={(e) => {
                      if (item.kind === 'technology') {
                        // No effectAllowed restriction (bench-found 2026-07-22); role
                        // travels only when unambiguous — else UsagePicker asks at drop.
                        e.dataTransfer.setData('application/specgraph-tech', item.id);
                        if (item.dragRoleId) e.dataTransfer.setData('application/specgraph-node', item.dragRoleId);
                        onDragStart?.(item.id);
                      } else {
                        handleDragStart(e, item.id);
                      }
                    }}
                    title={item.natureLine}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px',
                      borderRadius: '8px', cursor: 'grab', border: '1px solid transparent',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = theme.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <div style={{
                      width: '26px', height: '26px', borderRadius: '6px',
                      backgroundColor: `${boxColor}12`, border: `1px solid ${boxColor}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, color: boxColor,
                    }}>
                      {logoSrc ? (
                        <img src={logoSrc} alt={item.name} draggable={false} style={{ width: '17px', height: '17px', objectFit: 'contain' }} />
                      ) : RoleIcon ? (
                        <RoleIcon size={14} strokeWidth={2} />
                      ) : (
                        <span style={{ fontSize: '11px', fontWeight: 700 }}>{item.name.charAt(0)}</span>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name}
                      </div>
                      {item.caption && (
                        <div style={{ fontSize: '10px', color: c.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.caption}
                        </div>
                      )}
                    </div>
                    {item.chip && (
                      <span style={{ fontSize: '9px', color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: '4px', padding: '1px 5px', flexShrink: 0 }}>
                        {item.chip}
                      </span>
                    )}
                  </div>
                );
              };

              // Collapsible parent sections (owner 2026-08-05): the header is the
              // toggle; a collapsed section shrinks to its header.
              const sectionHeader = (label: string, key: string) => {
                const collapsed = collapsedPaletteSections.has(key);
                return (
                  <div
                    onClick={() => togglePaletteSection(key)}
                    style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: c.textMuted, padding: '4px 4px 6px', borderBottom: `1px solid ${c.border}` }}
                  >
                    {collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    {label}
                  </div>
                );
              };
              const isOpen = (key: string) => !collapsedPaletteSections.has(key);

              return (
                <>
                  {/* Section 1 — Structure: the organizational group roles only
                      (owner ruling 2026-08-05). */}
                  {structureItems.length > 0 && (
                    <div style={{ flex: isOpen('structure') ? '0 1 auto' : '0 0 auto', maxHeight: isOpen('structure') ? '18%' : undefined, minHeight: isOpen('structure') ? '72px' : undefined, display: 'flex', flexDirection: 'column', marginBottom: '8px' }}>
                      {sectionHeader('Structure', 'structure')}
                      {isOpen('structure') && (
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                          {structureItems.map(listRow)}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Section 2 — Platforms: brand platforms ONLY (nature 'host'); generic
                      hosting concepts live under Functional Node Types. */}
                  {platformItems.length > 0 && (
                    <div style={{ flex: isOpen('platforms') ? '0 1 auto' : '0 0 auto', maxHeight: isOpen('platforms') ? '20%' : undefined, minHeight: isOpen('platforms') ? '72px' : undefined, display: 'flex', flexDirection: 'column', marginBottom: '8px' }}>
                      {sectionHeader('Platforms', 'platforms')}
                      {isOpen('platforms') && (
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                          {platformItems.map(listRow)}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Section 3 — Technology (A–Z with letter rail) */}
                  <div style={{ flex: isOpen('technology') ? '1 1 auto' : '0 0 auto', minHeight: isOpen('technology') ? '140px' : undefined, display: 'flex', flexDirection: 'column', marginBottom: '8px' }}>
                    {sectionHeader('Technology', 'technology')}
                    {isOpen('technology') && (
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', gap: '2px', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {letterGroups.map(group => (
                            <div
                              key={group.letter}
                              ref={(el) => { if (el) letterRefs.current.set(group.letter, el); }}
                            >
                              <div style={{ fontSize: '10px', fontWeight: 700, color: c.textMuted, padding: '6px 4px 2px' }}>
                                {group.letter}
                              </div>
                              {group.items.map(listRow)}
                            </div>
                          ))}
                        </div>
                        {/* Letter rail — snaps THIS section's scroll to a letter */}
                        <div style={{
                          position: 'sticky', top: '4px', alignSelf: 'flex-start',
                          display: 'flex', flexDirection: 'column', flexShrink: 0,
                        }}>
                          {letterGroups.map(group => (
                            <button
                              key={`rail-${group.letter}`}
                              onClick={() => letterRefs.current.get(group.letter)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: '9px', fontWeight: 600, color: c.textMuted,
                                padding: '1px 3px', lineHeight: '12px',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
                            >
                              {group.letter}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    )}
                  </div>
                  {/* Section 4 — Functional Node Types (generic concepts incl. generic
                      hosting/hardware containers; technology picked later). Hidden under
                      a platform filter — these concepts belong to no platform. */}
                  {!activeFamily && functionalItems.length > 0 && (
                    <div style={{ flex: isOpen('functional') ? '0 1 auto' : '0 0 auto', maxHeight: isOpen('functional') ? '30%' : undefined, minHeight: isOpen('functional') ? '96px' : undefined, display: 'flex', flexDirection: 'column' }}>
                      {sectionHeader('Functional Node Types', 'functional')}
                      {isOpen('functional') && (
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                          {functionalItems.map(listRow)}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const TabbedSidebar = memo(TabbedSidebarComponent);
