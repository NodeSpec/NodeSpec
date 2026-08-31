import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Template Marketplace Routing', () => {
  describe('App.tsx route configuration', () => {
    const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');

    it('registers /templates route', () => {
      expect(appSource).toContain('path="/templates"');
      expect(appSource).toContain('TemplateMarketplacePage');
    });

    it('registers /templates/:slug route', () => {
      expect(appSource).toContain('path="/templates/:slug"');
      expect(appSource).toContain('TemplateDetailPage');
    });

    it('imports template page components', () => {
      expect(appSource).toContain("import { TemplateMarketplacePage, TemplateDetailPage }");
      expect(appSource).toContain("from './ui/components/templates/index.js'");
    });

    it('/templates routes are accessible without auth guard', () => {
      const lines = appSource.split('\n');
      const templateRouteIndex = lines.findIndex(l => l.includes('path="/templates"'));
      expect(templateRouteIndex).toBeGreaterThan(-1);

      const templateRouteBlock = lines.slice(templateRouteIndex, templateRouteIndex + 5).join('\n');
      expect(templateRouteBlock).not.toContain('Navigate to="/"');
      expect(templateRouteBlock).not.toContain('!user');
    });

    it('/templates/:slug route is accessible without auth guard', () => {
      const lines = appSource.split('\n');
      const detailRouteIndex = lines.findIndex(l => l.includes('path="/templates/:slug"'));
      expect(detailRouteIndex).toBeGreaterThan(-1);

      const detailRouteBlock = lines.slice(detailRouteIndex, detailRouteIndex + 3).join('\n');
      expect(detailRouteBlock).toContain('TemplateDetailPage');
      expect(detailRouteBlock).not.toContain('!user');
    });

    it('template routes appear before the catch-all wildcard route', () => {
      const templateRoutePos = appSource.indexOf('path="/templates"');
      const catchAllPos = appSource.indexOf('path="*"');
      expect(templateRoutePos).toBeGreaterThan(-1);
      expect(catchAllPos).toBeGreaterThan(-1);
      expect(templateRoutePos).toBeLessThan(catchAllPos);
    });
  });

  describe('auth redirect exclusions', () => {
    const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');

    it('getSession handler excludes /templates from redirect to /app', () => {
      // Both auth handlers now use the positive early-return form.
      const hits = appSource.match(/currentPath\.startsWith\('\/templates'\)/g) ?? [];
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    it('onAuthStateChange handler excludes /templates from redirect', () => {
      expect(appSource).toContain("currentPath.startsWith('/templates')");
    });

    it('logout does not redirect away from /templates paths', () => {
      const logoutBlock = appSource.slice(
        appSource.indexOf('setStore(null)'),
        appSource.indexOf("navigate('/', { replace: true })") + 50
      );
      expect(logoutBlock).toContain("currentPath === '/app'");
      expect(logoutBlock).not.toContain("currentPath === '/templates'");
    });
  });
});

describe('TemplateMarketplacePage component contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateMarketplacePage.tsx'),
    'utf-8'
  );

  it('uses useTemplates hook from ServiceContext', () => {
    expect(source).toContain("useTemplates");
    expect(source).toContain("from '../../context/ServiceContext.js'");
  });

  it('checks auth state for conditional rendering', () => {
    expect(source).toContain('supabase.auth.getSession()');
    expect(source).toContain('setUser');
  });

  it('passes isAuthenticated to TemplateCard for conditional rendering', () => {
    expect(source).toContain('isAuthenticated={!!user}');
  });

  it('passes onUseTemplate handler to TemplateCard', () => {
    expect(source).toContain('onUseTemplate={handleUseTemplate}');
  });

  it('supports category filtering', () => {
    expect(source).toContain('activeCategory');
    expect(source).toContain("setActiveCategory");
  });

  it('supports search', () => {
    expect(source).toContain('searchQuery');
    expect(source).toContain('handleSearchSubmit');
  });

  it('delegates template detail navigation to TemplateCard', () => {
    expect(source).toContain('<TemplateCard');
    expect(source).toContain("template={template}");
  });

  it('calls templateService.useTemplate on use', () => {
    expect(source).toContain('templateService.useTemplate');
  });

  it('navigates to /app after using a template', () => {
    expect(source).toContain("navigate('/app')");
  });

  it('switches into the new project after template use (ProjectSwitchContext, not localStorage)', () => {
    expect(source).toContain('projectSwitch.switchToProject(');
    expect(source).toContain("navigate('/app')");
  });
});

describe('TemplateDetailPage component contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateDetailPage.tsx'),
    'utf-8'
  );

  it('uses useParams to extract slug', () => {
    expect(source).toContain('useParams');
    expect(source).toContain('slug');
  });

  it('uses useTemplates hook from ServiceContext', () => {
    expect(source).toContain("useTemplates");
  });

  it('loads template by slug', () => {
    expect(source).toContain('getTemplateBySlug');
  });

  it('delegates rendering to TemplateDetail component', () => {
    expect(source).toContain("import { TemplateDetail }");
    expect(source).toContain("from './TemplateDetail.js'");
    expect(source).toContain('<TemplateDetail');
  });

  it('passes template, user, onUseTemplate, and usingTemplate props', () => {
    expect(source).toContain('template={template}');
    expect(source).toContain('user={user}');
    expect(source).toContain('onUseTemplate={handleUseTemplate}');
    expect(source).toContain('usingTemplate={usingTemplate}');
  });

  it('stores pending template in localStorage for unauthenticated users', () => {
    expect(source).toContain("localStorage.setItem('nodespec_pending_template'");
  });

  it('redirects unauthenticated users to signup flow', () => {
    expect(source).toContain("navigate('/?signup=templates')");
  });

  it('shows template not found state', () => {
    expect(source).toContain('Template not found');
  });

  it('has back navigation to /templates', () => {
    expect(source).toContain("navigate('/templates')");
    expect(source).toContain('Back to Templates');
  });
});

describe('TemplateDetail component contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateDetail.tsx'),
    'utf-8'
  );

  describe('uses TemplatePreviewCanvas for canvas rendering', () => {
    it('imports TemplatePreviewCanvas', () => {
      expect(source).toContain("import { TemplatePreviewCanvas }");
      expect(source).toContain("from './TemplatePreviewCanvas.js'");
    });

    it('renders the 50vh preview canvas with a fullscreen lane (variant="detail" retired)', () => {
      expect(source).toContain('<TemplatePreviewCanvas');
      expect(source).toContain('height="50vh"');
      expect(source).toContain('fullscreen={true}');
    });

    it('renders detail variant canvas at 100% height for full screen', () => {
      expect(source).toContain('height="100%"');
    });

    it('only renders canvas when graph has nodes', () => {
      expect(source).toContain('hasGraph');
      expect(source).toContain("Object.keys(graphData.nodes || {}).length > 0");
    });
  });

  describe('full screen preview', () => {
    it('has fullScreen state toggle', () => {
      expect(source).toContain('const [fullScreen, setFullScreen] = useState(false)');
    });

    it('renders full screen overlay with fixed positioning', () => {
      expect(source).toContain("position: 'fixed'");
      expect(source).toContain('zIndex: 1000');
    });

    it('shows exit button in full screen mode', () => {
      expect(source).toContain('Exit Full Screen');
      expect(source).toContain('setFullScreen(false)');
    });

    it('has Preview Full Screen button in sidebar', () => {
      expect(source).toContain('Preview Full Screen');
      expect(source).toContain('setFullScreen(true)');
    });
  });

  describe('info panel', () => {
    it('displays template name', () => {
      expect(source).toContain('{template.name}');
    });

    it('shows author badge (official/community)', () => {
      expect(source).toContain("template.authorType === 'official'");
      expect(source).toContain('Official');
      expect(source).toContain('Community');
    });

    it('shows use count', () => {
      expect(source).toContain('template.useCount.toLocaleString()');
    });

    it('shows featured badge when applicable', () => {
      expect(source).toContain('template.isFeatured');
      expect(source).toContain('Featured');
    });

    it('renders full description with preserved whitespace', () => {
      expect(source).toContain('template.description');
      expect(source).toContain("whiteSpace: 'pre-wrap'");
    });

    it('shows version', () => {
      expect(source).toContain('template.version');
    });

    it('displays tags', () => {
      expect(source).toContain('template.tags');
    });
  });

  describe('technologies used section', () => {
    it('imports TECHNOLOGY_LOGO_MAP and getTechnologyDisplayName', () => {
      expect(source).toContain("import { TECHNOLOGY_LOGO_MAP, getTechnologyDisplayName }");
      expect(source).toContain("from '../../utils/technology-logo-map.js'");
    });

    it('extracts technologies from graph nodes and template array', () => {
      expect(source).toContain('extractTechnologies');
      expect(source).toContain('node.technology');
      expect(source).toContain('template.technologies');
    });

    it('renders technology icon + name list', () => {
      expect(source).toContain('src={tech.logo}');
      expect(source).toContain('alt={tech.name}');
      expect(source).toContain('{tech.name}');
    });

    it('has Technologies Used section header', () => {
      expect(source).toContain('Technologies Used');
    });
  });

  describe('architecture overview', () => {
    it('computes category counts from node types', () => {
      expect(source).toContain('buildArchitectureOverview');
      expect(source).toContain('getNodeCategory');
      expect(source).toContain('categoryCounts');
    });

    it('maps node type prefixes to role category labels', () => {
      expect(source).toContain('ROLE_CATEGORY_MAP');
      expect(source).toContain("'frontend': 'Frontend'");
      expect(source).toContain("'backend': 'Backend'");
      expect(source).toContain("'database': 'Database'");
      expect(source).toContain("'cache': 'Cache'");
    });

    it('shows category breakdown with counts', () => {
      expect(source).toContain('overview.categories');
      expect(source).toContain('{count}');
    });

    it('shows total nodes and connections', () => {
      expect(source).toContain('overview.totalNodes');
      expect(source).toContain('overview.totalEdges');
    });

    it('has Architecture Overview section header', () => {
      expect(source).toContain('Architecture Overview');
    });
  });

  describe('node list', () => {
    it('renders node list with labels and types', () => {
      expect(source).toContain('Node List');
      expect(source).toContain('{node.label}');
      expect(source).toContain('{node.type}');
    });

    it('shows technology display name for each node', () => {
      expect(source).toContain('getTechnologyDisplayName(node.technology)');
    });
  });

  describe('CTA buttons', () => {
    it('shows Use This Template for authenticated users', () => {
      expect(source).toContain("'Use This Template'");
    });

    it('shows sign up CTA for unauthenticated users', () => {
      expect(source).toContain("'Sign up to use this template'");
      expect(source).toContain("'Sign up to use'");
    });

    it('shows loading state while creating project', () => {
      expect(source).toContain("'Creating project...'");
    });

    it('receives onUseTemplate callback as prop', () => {
      expect(source).toContain('onUseTemplate: () => void');
    });
  });

  describe('layout', () => {
    it('uses two-column grid layout with sidebar', () => {
      expect(source).toContain("gridTemplateColumns: '1fr 320px'");
    });

    it('has sticky sidebar', () => {
      expect(source).toContain("position: 'sticky'");
      expect(source).toContain("top: '80px'");
    });
  });
});

describe('TemplatePreviewCanvas component contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplatePreviewCanvas.tsx'),
    'utf-8'
  );

  describe('React Flow setup', () => {
    it('imports ReactFlow with ReactFlowProvider and Controls', () => {
      expect(source).toContain("import { ReactFlow, ReactFlowProvider, Controls }");
      expect(source).toContain("from '@xyflow/react'");
    });

    it('uses mapGraphToRFNodes and mapGraphToRFEdges from the adapter', () => {
      expect(source).toContain("import { mapGraphToRFNodes, mapGraphToRFEdges }");
      expect(source).toContain("from '../../adapters/graph-to-reactflow.js'");
    });

    it('calls mapGraphToRFNodes in nested mode with the hydrated catalog resolver', () => {
      expect(source).toContain("mapGraphToRFNodes(graphData, 'nested', catalog)");
    });

    it('calls mapGraphToRFEdges in nested mode with the hydrated catalog resolver', () => {
      expect(source).toContain("mapGraphToRFEdges(graphData, 'nested', catalog)");
    });

    it('wraps in ReactFlowProvider for isolated instance', () => {
      expect(source).toContain('<ReactFlowProvider>');
      expect(source).toContain('</ReactFlowProvider>');
    });
  });

  describe('node and edge type registration', () => {
    it('imports nodeTypes from existing nodes index', () => {
      expect(source).toContain("nodeTypes");
      expect(source).toContain("from '../nodes/index.js'");
    });

    it('imports edgeTypes from existing edges index', () => {
      expect(source).toContain("import { edgeTypes }");
      expect(source).toContain("from '../edges/index.js'");
    });

    it('passes nodeTypes and edgeTypes to ReactFlow', () => {
      expect(source).toContain('nodeTypes={');
      expect(source).toContain('edgeTypes={edgeTypes}');
    });
  });

  describe('read-only mode (always)', () => {
    it('disables node dragging', () => {
      expect(source).toContain('nodesDraggable={false}');
    });

    it('disables node connecting', () => {
      expect(source).toContain('nodesConnectable={false}');
    });

    it('disables element selection', () => {
      expect(source).toContain('elementsSelectable={false}');
    });

    it('disables node focus', () => {
      expect(source).toContain('nodesFocusable={false}');
    });

    it('disables edge focus', () => {
      expect(source).toContain('edgesFocusable={false}');
    });
  });

  describe('fitView and attribution', () => {
    it('enables fitView', () => {
      expect(source).toContain('fitView');
    });

    it('hides React Flow attribution', () => {
      expect(source).toContain('proOptions={{ hideAttribution: true }}');
    });
  });

  describe('muted style', () => {
    it('applies a muted/transparent style to differentiate from real editor', () => {
      expect(source).toContain('MUTED_STYLE');
      expect(source).toContain("opacity: 0.85");
      expect(source).toContain("background: 'transparent'");
    });
  });

  describe('variant prop', () => {
    it('accepts a variant prop with mini and detail options (inline union)', () => {
      expect(source).toContain("variant?: 'mini' | 'detail'");
    });

    it('defaults to the non-interactive form (fullscreen=false)', () => {
      expect(source).toContain('fullscreen = false');
    });

    it('accepts flexible height as number or string', () => {
      expect(source).toContain('height?: number | string');
    });
  });

  describe('mini variant behavior', () => {
    it('disables pan on drag in mini mode', () => {
      expect(source).toContain('panOnDrag={interactive}');
    });

    it('disables zoom on scroll in mini mode', () => {
      expect(source).toContain('zoomOnScroll={interactive}');
    });

    it('disables zoom on pinch in mini mode', () => {
      expect(source).toContain('zoomOnPinch={interactive}');
    });

    it('disables zoom on double click in mini mode', () => {
      expect(source).toContain('zoomOnDoubleClick={interactive}');
    });

    it('applies pointerEvents none in mini mode', () => {
      expect(source).toContain("pointerEvents: 'none'");
    });

    it('does not render Controls in mini mode', () => {
      expect(source).toContain('{interactive && (');
    });
  });

  describe('detail variant behavior', () => {
    it('enables pan and zoom via the interactive (fullscreen) boolean', () => {
      expect(source).toContain('const interactive = fullscreen');
    });

    it('renders Controls in detail mode', () => {
      expect(source).toContain('<Controls');
      expect(source).toContain('showInteractive={false}');
    });

    it('uses wider zoom range for detail variant', () => {
      expect(source).toContain('minZoom={interactive ? 0.05 : 0.1}');
      expect(source).toContain('maxZoom={interactive ? 2 : 1}');
    });
  });

  describe('hidden node filtering', () => {
    it('filters out hidden nodes from rendering', () => {
      expect(source).toContain(".filter(n => !n.hidden)");
    });
  });
});

describe('TemplateCard component contract', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/templates/TemplateCard.tsx'),
    'utf-8'
  );

  it('receives isAuthenticated prop for conditional rendering', () => {
    expect(source).toContain('isAuthenticated');
  });

  it('navigates to detail page on click', () => {
    expect(source).toContain('navigate(`/templates/${template.slug}`)');
  });

  it('shows featured badge when applicable', () => {
    expect(source).toContain('template.isFeatured');
    expect(source).toContain('Featured');
  });

  it('shows official and community author badges', () => {
    expect(source).toContain("template.authorType === 'official'");
    expect(source).toContain('Official');
    expect(source).toContain('Community');
  });

  it('calls onUseTemplate for authenticated users', () => {
    expect(source).toContain('onUseTemplate');
  });

  it('redirects to signup for unauthenticated users', () => {
    expect(source).toContain("navigate('/?signup=templates')");
  });

  describe('mini canvas preview', () => {
    it('imports TemplatePreviewCanvas', () => {
      expect(source).toContain("import { TemplatePreviewCanvas }");
      expect(source).toContain("from './TemplatePreviewCanvas.js'");
    });

    it('renders TemplatePreviewCanvas with mini variant when graph has nodes', () => {
      expect(source).toContain('<TemplatePreviewCanvas');
      expect(source).toContain('graphData={template.graphData}');
      expect(source).toContain('height={200}');
      expect(source).toContain('variant="mini"');
    });

    it('shows fallback when graph has no nodes', () => {
      expect(source).toContain('hasGraph');
      expect(source).toContain('template.nodeCount');
    });
  });

  describe('technology badges', () => {
    it('imports TECHNOLOGY_LOGO_MAP for badge rendering', () => {
      expect(source).toContain("import { TECHNOLOGY_LOGO_MAP, getTechnologyDisplayName }");
      expect(source).toContain("from '../../utils/technology-logo-map.js'");
    });

    it('extracts technologies from graph nodes', () => {
      expect(source).toContain('extractTechnologies');
      expect(source).toContain('node.technology');
      expect(source).toContain('TECHNOLOGY_LOGO_MAP[tech]');
    });

    it('limits visible technology badges to 6', () => {
      expect(source).toContain('MAX_VISIBLE_TECH');
      expect(source).toMatch(/MAX_VISIBLE_TECH\s*=\s*6/);
    });

    it('shows overflow count for excess technologies', () => {
      expect(source).toContain('overflowCount');
      expect(source).toContain('+{overflowCount}');
    });

    it('renders circular badge with logo image', () => {
      expect(source).toContain("borderRadius: '50%'");
      expect(source).toContain('src={tech.logo}');
      expect(source).toContain('alt={tech.name}');
    });

    it('shows technology name in title tooltip', () => {
      expect(source).toContain('title={tech.name}');
    });
  });

  describe('footer row', () => {
    it('displays node count with icon', () => {
      expect(source).toContain('{template.nodeCount}');
    });

    it('displays edge count with icon', () => {
      expect(source).toContain('{template.edgeCount}');
    });

  });

  describe('hover interaction', () => {
    it('uses state-driven hover for card lift', () => {
      expect(source).toContain('const [hovered, setHovered] = useState(false)');
      expect(source).toContain("onMouseEnter={() => setHovered(true)}");
      expect(source).toContain("onMouseLeave={() => setHovered(false)}");
    });

    it('applies translateY and shadow on hover', () => {
      expect(source).toContain("translateY(-4px)");
      expect(source).toContain("translateY(0)");
    });

    it('shows View Template overlay on hover', () => {
      expect(source).toContain('View Template');
      expect(source).toContain('opacity: hovered ? 1 : 0');
    });
  });
});

describe('Template module exports', () => {
  const indexSource = readFileSync(
    resolve(__dirname, '../ui/components/templates/index.ts'),
    'utf-8'
  );

  it('exports TemplateMarketplacePage', () => {
    expect(indexSource).toContain("export { TemplateMarketplacePage }");
  });

  it('exports TemplateDetailPage', () => {
    expect(indexSource).toContain("export { TemplateDetailPage }");
  });

  it('exports TemplateDetail', () => {
    expect(indexSource).toContain("export { TemplateDetail }");
  });

  it('exports TemplateCard', () => {
    expect(indexSource).toContain("export { TemplateCard }");
  });

  it('exports TemplatePreviewCanvas', () => {
    expect(indexSource).toContain("export { TemplatePreviewCanvas }");
  });
});

describe('ServiceContext template integration', () => {
  const contextSource = readFileSync(
    resolve(__dirname, '../ui/context/ServiceContext.tsx'),
    'utf-8'
  );

  it('imports TemplateService', () => {
    expect(contextSource).toContain('TemplateService');
  });

  it('declares template property on Services interface', () => {
    expect(contextSource).toContain('template: TemplateService');
  });

  it('instantiates TemplateService with persistence', () => {
    expect(contextSource).toContain('new TemplateService(persistence)');
  });

  it('exports useTemplates hook', () => {
    expect(contextSource).toContain('export function useTemplates()');
    expect(contextSource).toContain('services.template');
  });

  const contextIndexSource = readFileSync(
    resolve(__dirname, '../ui/context/index.ts'),
    'utf-8'
  );

  it('re-exports useTemplates from context index', () => {
    expect(contextIndexSource).toContain('useTemplates');
  });
});

describe('TopBar templates navigation', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/panels/TopBar.tsx'),
    'utf-8'
  );

  it('imports useNavigate from react-router-dom', () => {
    expect(source).toContain("import { useNavigate }");
    expect(source).toContain("from 'react-router-dom'");
  });

  it('renders a Browse Templates button with themeToggleStyles', () => {
    expect(source).toContain("title=\"Browse Templates\"");
    expect(source).toContain("style={themeToggleStyles}");
  });

  it('navigates to /templates on click', () => {
    expect(source).toContain("navigate('/templates')");
  });

  it('renders an svg icon on the templates button (box icon, paths not rects)', () => {
    const templatesBtnIndex = source.indexOf('Browse Templates');
    expect(templatesBtnIndex).toBeGreaterThan(-1);
    const btnBlock = source.slice(templatesBtnIndex, templatesBtnIndex + 600);
    expect(btnBlock).toContain('<svg');
    expect(btnBlock).toContain('<path');
  });

  it('is positioned in the left section near the project selector', () => {
    const projectSelectorPos = source.indexOf("title=\"Switch Project\"");
    const templatesBtnPos = source.indexOf("title=\"Browse Templates\"");
    const rightSectionPos = source.indexOf('style={rightStyles}');
    expect(templatesBtnPos).toBeGreaterThan(projectSelectorPos);
    expect(templatesBtnPos).toBeLessThan(rightSectionPos);
  });
});

describe('AuthLandingPage templates navigation', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/auth/AuthLandingPage.tsx'),
    'utf-8'
  );

  it('imports useNavigate from react-router-dom', () => {
    expect(source).toContain("useNavigate");
    expect(source).toContain("from 'react-router-dom'");
  });

  it('includes Browse Templates in the navigation items', () => {
    expect(source).toContain("label: 'Browse Templates'");
  });

  it('navigates to /templates when Browse Templates is clicked', () => {
    expect(source).toContain("navigate('/templates')");
  });

  it('positions Browse Templates between Features and Pricing', () => {
    const featuresPos = source.indexOf("label: 'Features'");
    const templatesPos = source.indexOf("label: 'Browse Templates'");
    const pricingPos = source.indexOf("label: 'Pricing'");
    expect(featuresPos).toBeGreaterThan(-1);
    expect(templatesPos).toBeGreaterThan(featuresPos);
    expect(pricingPos).toBeGreaterThan(templatesPos);
  });

  it('renders Browse Templates as a nav link with the same pattern as other items', () => {
    const navItems = source.match(/label: '[^']+', action:/g) || [];
    const labels = navItems.map(item => item.match(/label: '([^']+)'/)?.[1]);
    expect(labels).toContain('Features');
    expect(labels).toContain('Browse Templates');
    expect(labels).toContain('Pricing');
    expect(labels).toContain('Contact');
  });
});

describe('ProjectExplorer Start from Template option', () => {
  const source = readFileSync(
    resolve(__dirname, '../ui/components/panels/ProjectExplorer.tsx'),
    'utf-8'
  );

  it('imports useNavigate from react-router-dom', () => {
    expect(source).toContain("import { useNavigate }");
    expect(source).toContain("from 'react-router-dom'");
  });

  it('renders a Start from Template button', () => {
    expect(source).toContain('Start from Template');
  });

  it('navigates to /templates on Start from Template click', () => {
    expect(source).toContain("navigate('/templates')");
  });

  it('closes the modal before navigating', () => {
    expect(source).toContain("onClose(); navigate('/templates')");
  });

  it('displays a grid icon on the Start from Template button', () => {
    const templateBtnPos = source.indexOf('Start from Template');
    expect(templateBtnPos).toBeGreaterThan(-1);
    const nearbyBlock = source.slice(Math.max(0, templateBtnPos - 800), templateBtnPos);
    expect(nearbyBlock).toContain('<svg');
    expect(nearbyBlock).toContain('<rect');
  });

  it('positions Start from Template alongside New Project in footer', () => {
    const templatePos = source.indexOf('Start from Template');
    const newProjectPos = source.indexOf('+ New Project');
    expect(templatePos).toBeGreaterThan(-1);
    expect(newProjectPos).toBeGreaterThan(templatePos);
  });

  it('uses secondary button styling for Start from Template', () => {
    const templateBtnPos = source.indexOf('Start from Template');
    const nearbyBlock = source.slice(Math.max(0, templateBtnPos - 800), templateBtnPos);
    expect(nearbyBlock).toContain('buttonStyles(false)');
  });
});

// ── Owner 2026-08-31: gallery author attribution (managed editions only) ─────
describe('gallery author attribution → profile accessibility', () => {
  const card = readFileSync(resolve(__dirname, '../ui/components/templates/TemplateCard.tsx'), 'utf-8');
  const market = readFileSync(resolve(__dirname, '../ui/components/templates/TemplateMarketplacePage.tsx'), 'utf-8');
  const profilePage = readFileSync(resolve(__dirname, '../ui/components/profile/PublicProfilePage.tsx'), 'utf-8');

  it('the card author chip is HOSTED-gated — enterprise and OSS keep the plain badge', () => {
    expect(card).toContain("isHostedEdition && template.authorType === 'community' && !!authorProfile");
    // The plain Official/Community badge survives as the fallback branch.
    expect(card).toContain("template.authorType === 'official' ? 'Official' : 'Community'");
  });

  it('the chip routes to the author profile without triggering the card click', () => {
    const chip = card.slice(card.indexOf('showAuthorChip && authorProfile'));
    expect(chip).toContain('e.stopPropagation()');
    expect(chip).toContain('navigate(`/u/${authorProfile.handle}`)');
  });

  it('the marketplace batch-fetches author profiles ONCE per load, hosted-gated, best-effort', () => {
    expect(market).toContain('if (isHostedEdition) {');
    expect(market).toContain('getProfilesByUserIds(authorIds)');
    expect(market).toContain('cards fall back to the plain Community badge');
    // Only community-authored templates with an author id are looked up.
    expect(market).toContain("t.authorType === 'community' && t.authorId");
  });

  it('the profile page passes no authorProfile — its cards stay badge-only (the header names the author)', () => {
    expect(profilePage).not.toContain('authorProfile');
  });
});

// ── Owner 2026-08-31 follow-up: the Templates | Builders split ───────────────
describe('marketplace view split — Templates | Builders (managed only)', () => {
  const market = readFileSync(resolve(__dirname, '../ui/components/templates/TemplateMarketplacePage.tsx'), 'utf-8');
  const buildersView = readFileSync(resolve(__dirname, '../ui/components/templates/BuildersView.tsx'), 'utf-8');

  it('the toggle renders only on hosted builds and the view is linkable via ?view=builders', () => {
    // State initializer honors the query param ONLY under the hosted literal…
    expect(market).toContain("isHostedEdition && new URLSearchParams(window.location.search).get('view') === 'builders'");
    // …and the toggle itself sits behind the same gate.
    expect(market).toMatch(/\{isHostedEdition && \(\s*<div role="tablist"/);
    // Switching views keeps the URL shareable without a router remount.
    expect(market).toContain("params.set('view', 'builders')");
  });

  it('builders view replaces the grid AND the category chips; search is repurposed', () => {
    expect(market).toContain("view === 'builders' ? (");
    expect(market).toContain('<BuildersView searchQuery={searchQuery} />');
    expect(market.indexOf("view === 'builders' ? (")).toBeLessThan(market.indexOf('marketplace-categories'));
    expect(market).toContain("view === 'builders' ? 'Search builders...' : 'Search templates...'");
  });

  it('builders derive client-side from community templates + one batch profile read', () => {
    // No migration, no view — public templates aggregate per author, and only
    // authors with a public profile appear (same rule as the chips).
    expect(buildersView).toContain("t.authorType !== 'community' || !t.authorId");
    expect(buildersView).toContain('getProfilesByUserIds([...byAuthor.keys()])');
    expect(buildersView).toContain('if (profile) rows.push({ profile, ...agg });');
  });

  it('a builder card routes to the profile portfolio at /u/:handle', () => {
    expect(buildersView).toContain('navigate(`/u/${profile.handle}`)');
    // Ranked by community signal: upvotes, then volume, then name.
    expect(buildersView).toContain('b.upvoteTotal - a.upvoteTotal');
  });
});
