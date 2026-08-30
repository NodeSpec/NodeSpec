import { describe, it, expect } from 'vitest';
import {
  populateTechnologyVisuals,
  getTechnologyLogo,
  getTechnologyColors,
  getTechnologyDisplayName,
} from '../ui/utils/technology-logo-map.js';
import type { CatalogResolver } from '../persistence/supabase/catalog-repository.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  getMetadataTypeForNodeType,
  createDefaultMetadataForNodeType,
  getMetadataDefaults,
  extractNodeDomainMetadata,
} from '@nodespec/core/node-metadata.js';
import type { MobileMetadata } from '@nodespec/core/node-metadata.js';
import { formatNodeMetadataForAI } from '@nodespec/core/ai-context.js';
import { getLanguageDisplayName, getTypicalDirectoryStructure } from '@nodespec/core/language-support.js';
import type { ProgrammingLanguage } from '@nodespec/core/node-metadata.js';
import type { Node } from '@nodespec/core/types.js';

function loadFile(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf-8');
}

describe('Mobile Metadata Type System', () => {
  const mobileTypes = ['mobile.swift', 'mobile.kotlin', 'mobile.flutter', 'mobile.react-native'];

  it('maps all mobile node types to mobile metadata type', () => {
    for (const nodeType of mobileTypes) {
      expect(getMetadataTypeForNodeType(nodeType)).toBe('mobile');
    }
  });

  it('maps frontend.dioxus to mobile metadata type', () => {
    expect(getMetadataTypeForNodeType('frontend.dioxus')).toBe('mobile');
  });

  it('creates default mobile metadata for each mobile type', () => {
    for (const nodeType of mobileTypes) {
      const metadata = createDefaultMetadataForNodeType(nodeType);
      expect(metadata).toBeDefined();
      expect(metadata!.type).toBe('mobile');
      const data = metadata!.data as MobileMetadata;
      expect(data.platform).toBeDefined();
      expect(data.language).toBeDefined();
      expect(data.framework).toBeDefined();
      expect(data.architecture).toBeDefined();
      expect(data.dependencies).toEqual([]);
      expect(data.screens).toEqual([]);
    }
  });

  it('returns mobile defaults from getMetadataDefaults', () => {
    const defaults = getMetadataDefaults('mobile');
    expect(defaults.platform).toBe('cross-platform');
    expect(defaults.language).toBe('typescript');
    expect(defaults.framework).toBe('react-native');
    expect(defaults.architecture).toBe('mvvm');
  });

  it('extracts mobile domain metadata from node metadata', () => {
    const nodeMetadata = {
      domainMetadata: {
        type: 'mobile',
        data: {
          platform: 'ios',
          language: 'swift',
          framework: 'swiftui',
          architecture: 'mvvm',
          dependencies: [],
          envVars: [],
          screens: [],
        },
      },
    };
    const result = extractNodeDomainMetadata(nodeMetadata as Record<string, unknown>);
    expect(result).toBeDefined();
    expect(result!.type).toBe('mobile');
  });
});

describe('Mobile AI Context Formatting', () => {
  function makeMobileNode(overrides: Partial<MobileMetadata> = {}): Node {
    return {
      id: 'test-mobile',
      label: 'Test Mobile App',
      type: 'mobile.swift',
      position: { x: 0, y: 0 },
      ports: [],
      metadata: {
        domainMetadata: {
          type: 'mobile',
          data: {
            platform: 'ios',
            language: 'swift',
            framework: 'swiftui',
            architecture: 'mvvm',
            dependencies: [],
            envVars: [],
            screens: [],
            ...overrides,
          },
        },
      },
    } as unknown as Node;
  }

  it('formats mobile platform in AI context', () => {
    const result = formatNodeMetadataForAI(makeMobileNode());
    expect(result).toContain('Platform: ios');
  });

  it('formats mobile language in AI context', () => {
    const result = formatNodeMetadataForAI(makeMobileNode());
    expect(result).toContain('Language: swift');
  });

  it('formats mobile UI framework in AI context', () => {
    const result = formatNodeMetadataForAI(makeMobileNode());
    expect(result).toContain('UI Framework: swiftui');
  });

  it('formats mobile architecture in AI context', () => {
    const result = formatNodeMetadataForAI(makeMobileNode());
    expect(result).toContain('Architecture: MVVM');
  });

  it('formats Android-specific fields', () => {
    const result = formatNodeMetadataForAI(makeMobileNode({
      platform: 'android',
      language: 'kotlin' as ProgrammingLanguage,
      framework: 'jetpack-compose',
      minSdk: 26,
    }));
    expect(result).toContain('Min SDK: Android 26');
  });

  it('formats iOS-specific fields', () => {
    const result = formatNodeMetadataForAI(makeMobileNode({
      minDeploymentTarget: '16.0',
    }));
    expect(result).toContain('Min Deployment Target: iOS 16.0');
  });

  it('formats bundle ID and package name', () => {
    const result = formatNodeMetadataForAI(makeMobileNode({
      bundleId: 'com.example.app',
      packageName: 'com.example.app',
    }));
    expect(result).toContain('Bundle ID: com.example.app');
    expect(result).toContain('Package Name: com.example.app');
  });

  it('formats screens list', () => {
    const result = formatNodeMetadataForAI(makeMobileNode({
      screens: [{ name: 'Home', path: '/home' }, { name: 'Settings', path: '/settings' }],
    }));
    expect(result).toContain('Screens: Home, Settings');
  });

  it('formats features list', () => {
    const result = formatNodeMetadataForAI(makeMobileNode({
      features: ['push-notifications', 'biometric-auth'],
    }));
    expect(result).toContain('Features: push-notifications, biometric-auth');
  });
});

describe('Mobile Language Support', () => {
  it('provides display names for mobile languages', () => {
    expect(getLanguageDisplayName('swift')).toBe('Swift');
    expect(getLanguageDisplayName('kotlin')).toBe('Kotlin');
    expect(getLanguageDisplayName('dart')).toBe('Dart');
  });

  it('provides directory structures for Swift', () => {
    const dirs = getTypicalDirectoryStructure('swift');
    expect(dirs).toContain('Sources/');
    expect(dirs).toContain('Views/');
    expect(dirs).toContain('ViewModels/');
  });

  it('provides directory structures for Kotlin', () => {
    const dirs = getTypicalDirectoryStructure('kotlin');
    expect(dirs).toContain('app/src/main/java/');
    expect(dirs).toContain('app/src/main/res/');
  });

  it('provides directory structures for Dart', () => {
    const dirs = getTypicalDirectoryStructure('dart');
    expect(dirs).toContain('lib/');
    expect(dirs).toContain('lib/screens/');
    expect(dirs).toContain('test/');
  });
});

describe('Mobile Technology Visuals', () => {
  // M6/M7: this block used to assert static `import swiftIcon from '../assets/Swift.png'`
  // lines, a hardcoded TECHNOLOGY_LOGO_MAP, a hardcoded colour table, and a
  // `'mobile.swift': 'swift'` legacy-type map. None of that exists: visuals are POPULATED
  // FROM THE CATALOG (icon_url / brand_color / display_name), and the legacy map went with
  // the table M4 deleted. The behavior worth pinning is that mobile technologies flow
  // through that population like any other.
  const mobileCatalog = {
    getAllTechnologies: () => [
      { id: 'swift', name: 'Swift', iconUrl: 'https://cdn.test/swift.png', brandColor: '#F05138', secondaryColor: null, displayName: null },
      { id: 'swift-ios', name: 'Swift (iOS)', iconUrl: 'https://cdn.test/swift.png', brandColor: '#F05138', secondaryColor: null, displayName: 'Swift (iOS)' },
      { id: 'flutter', name: 'Flutter', iconUrl: 'https://cdn.test/flutter.png', brandColor: '#02569B', secondaryColor: null, displayName: null },
      { id: 'kotlin', name: 'Kotlin', iconUrl: 'https://cdn.test/kotlin.png', brandColor: '#7F52FF', secondaryColor: null, displayName: null },
      { id: 'kotlin-android', name: 'Kotlin (Android)', iconUrl: 'https://cdn.test/kotlin.png', brandColor: '#7F52FF', secondaryColor: null, displayName: 'Kotlin (Android)' },
      { id: 'dioxus', name: 'Dioxus', iconUrl: 'https://cdn.test/dioxus.png', brandColor: '#EAB308', secondaryColor: null, displayName: null },
      { id: 'react-native', name: 'React Native', iconUrl: 'https://cdn.test/react.png', brandColor: '#61DAFB', secondaryColor: null, displayName: 'React Native' },
    ],
  } as unknown as CatalogResolver;

  const MOBILE = ['swift', 'swift-ios', 'flutter', 'kotlin', 'kotlin-android', 'dioxus', 'react-native'];

  it('populates a logo for every mobile technology that carries an icon', () => {
    populateTechnologyVisuals(mobileCatalog);
    for (const id of MOBILE) {
      expect(getTechnologyLogo(id), `no logo for ${id}`).toBeTruthy();
    }
  });

  it('populates brand colours for every mobile technology', () => {
    populateTechnologyVisuals(mobileCatalog);
    expect(getTechnologyColors('swift')?.primary).toBe('#F05138');
    expect(getTechnologyColors('flutter')?.primary).toBe('#02569B');
    expect(getTechnologyColors('kotlin')?.primary).toBe('#7F52FF');
    expect(getTechnologyColors('dioxus')?.primary).toBe('#EAB308');
    expect(getTechnologyColors('react-native')?.primary).toBe('#61DAFB');
  });

  it('display names prefer display_name and fall back to a humanized id', () => {
    populateTechnologyVisuals(mobileCatalog);
    expect(getTechnologyDisplayName('swift-ios')).toBe('Swift (iOS)');
    expect(getTechnologyDisplayName('kotlin-android')).toBe('Kotlin (Android)');
    expect(getTechnologyDisplayName('react-native')).toBe('React Native');
    expect(getTechnologyDisplayName('swift')).toBe('Swift');
    // not in the catalog at all -> humanized, never a raw slug
    expect(getTechnologyDisplayName('some-new-framework')).toBe('Some New Framework');
  });
});


describe('Node Size Toggle', () => {
  const canvasSource = loadFile('../ui/components/layout/Canvas.tsx');
  const layerToggleSource = loadFile('../ui/components/common/CanvasDock.tsx');
  const iconNodeSource = loadFile('../ui/components/nodes/IconNode.tsx');

  it('Canvas has nodeSize state with localStorage persistence', () => {
    expect(canvasSource).toContain("localStorage.getItem('specgraph_node_size')");
    expect(canvasSource).toContain("localStorage.setItem('specgraph_node_size'");
  });

  it('Canvas passes nodeSize to LayerModeToggle', () => {
    expect(canvasSource).toContain('nodeSize={nodeSize}');
    expect(canvasSource).toContain('onNodeSizeChange={setNodeSize}');
  });

  it('Canvas injects nodeSize into node data', () => {
    expect(canvasSource).toContain('nodeSize: effectiveNodeSize');
  });

  it('Canvas overrides node type to icon when compact', () => {
    expect(canvasSource).toContain("shouldCompact ? 'icon' : node.type");
  });

  it('Canvas handles S keyboard shortcut for compact toggle', () => {
    expect(canvasSource).toContain("event.key === 's'");
    expect(canvasSource).toContain("nodeSize === 'regular' ? 'compact' : 'regular'");
  });

  it('LayerModeToggle exports NodeSizeMode type', () => {
    expect(layerToggleSource).toContain("export type NodeSizeMode = 'regular' | 'compact'");
  });

  it('LayerModeToggle accepts nodeSize and onNodeSizeChange props', () => {
    expect(layerToggleSource).toContain('nodeSize?: NodeSizeMode');
    expect(layerToggleSource).toContain('onNodeSizeChange?: (size: NodeSizeMode) => void');
  });

  it('renders the sub-pill with Regular and Compact buttons', () => {
    expect(layerToggleSource).toContain('Regular');
    expect(layerToggleSource).toContain('Compact');
    expect(layerToggleSource).toContain("title=\"Regular sized nodes\"");
    expect(layerToggleSource).toContain("title=\"Compact icon nodes (S)\"");
  });

  it('the node-size sub-pill only exists when Functional mode is active', () => {
    // M7: was an opacity/pointerEvents pair; CanvasDock conditionally RENDERS it instead,
    // so the control is absent from the tree rather than invisible in it.
    expect(layerToggleSource).toContain('{isFlat && onNodeSizeChange && (');
  });

  it('IconNode renders compact when nodeSize is compact', () => {
    expect(iconNodeSource).toContain("props.data.nodeSize === 'compact'");
  });

  it('RFNodeData includes nodeSize field', () => {
    const adapterSource = loadFile('../ui/adapters/graph-to-reactflow.ts');
    expect(adapterSource).toContain("nodeSize?: 'regular' | 'compact'");
  });
});
