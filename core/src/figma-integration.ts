export interface FigmaFile {
  name: string;
  lastModified: string;
  thumbnailUrl: string;
  version: string;
  document: FigmaNode;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  fills?: FigmaFill[];
  strokes?: FigmaStroke[];
  effects?: FigmaEffect[];
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  styles?: Record<string, string>;
}

export interface FigmaFill {
  type: string;
  color?: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
  imageRef?: string;
}

export interface FigmaStroke {
  type: string;
  color?: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
}

export interface FigmaEffect {
  type: string;
  visible: boolean;
  radius?: number;
  color?: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
}

export interface FigmaImageExport {
  nodeId: string;
  format: 'png' | 'svg' | 'jpg' | 'pdf';
  scale: number;
  url: string;
}

export interface FigmaStyles {
  fills: Record<string, FigmaStyleDefinition>;
  text: Record<string, FigmaStyleDefinition>;
  effects: Record<string, FigmaStyleDefinition>;
  grids: Record<string, FigmaStyleDefinition>;
}

export interface FigmaStyleDefinition {
  key: string;
  name: string;
  styleType: string;
  description: string;
}

export class FigmaAPIClient {
  private baseUrl = 'https://api.figma.com/v1';

  constructor(private accessToken: string) {}

  async getFile(fileKey: string): Promise<FigmaFile> {
    const response = await fetch(`${this.baseUrl}/files/${fileKey}`, {
      headers: {
        'X-Figma-Token': this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.statusText}`);
    }

    return await response.json();
  }

  async getFileNodes(fileKey: string, nodeIds: string[]): Promise<{ nodes: Record<string, { document: FigmaNode }> }> {
    const idsParam = nodeIds.join(',');
    const response = await fetch(
      `${this.baseUrl}/files/${fileKey}/nodes?ids=${idsParam}`,
      {
        headers: {
          'X-Figma-Token': this.accessToken,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.statusText}`);
    }

    return await response.json();
  }

  async getImages(
    fileKey: string,
    nodeIds: string[],
    options: {
      format?: 'png' | 'svg' | 'jpg' | 'pdf';
      scale?: number;
    } = {}
  ): Promise<{ images: Record<string, string> }> {
    const params = new URLSearchParams({
      ids: nodeIds.join(','),
      format: options.format || 'png',
      scale: String(options.scale || 2),
    });

    const response = await fetch(
      `${this.baseUrl}/images/${fileKey}?${params}`,
      {
        headers: {
          'X-Figma-Token': this.accessToken,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.statusText}`);
    }

    return await response.json();
  }

  async getStyles(fileKey: string): Promise<FigmaStyles> {
    const response = await fetch(`${this.baseUrl}/files/${fileKey}/styles`, {
      headers: {
        'X-Figma-Token': this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.meta?.styles || { fills: {}, text: {}, effects: {}, grids: {} };
  }

  extractFileKey(figmaUrl: string): string | null {
    const patterns = [
      /figma\.com\/file\/([a-zA-Z0-9]+)/,
      /figma\.com\/design\/([a-zA-Z0-9]+)/,
    ];

    for (const pattern of patterns) {
      const match = figmaUrl.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  extractNodeId(figmaUrl: string): string | null {
    const match = figmaUrl.match(/node-id=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

export function rgbaToHex(color: { r: number; g: number; b: number; a: number }): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

export function extractDesignTokens(file: FigmaFile): {
  colors: Record<string, string>;
  spacing: Record<string, string>;
} {
  const colors: Record<string, string> = {};
  const spacing: Record<string, string> = {};

  function traverseNode(node: FigmaNode) {
    if (node.name.startsWith('color/') || node.name.startsWith('Color/')) {
      const colorName = node.name.replace(/^color\//i, '').replace(/\s+/g, '-').toLowerCase();
      if (node.fills && node.fills.length > 0) {
        const fill = node.fills[0];
        if (fill.type === 'SOLID' && fill.color) {
          colors[colorName] = rgbaToHex(fill.color);
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        traverseNode(child);
      }
    }
  }

  traverseNode(file.document);

  return { colors, spacing };
}

export function findComponentNodes(file: FigmaFile): FigmaNode[] {
  const components: FigmaNode[] = [];

  function traverse(node: FigmaNode) {
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      components.push(node);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(file.document);
  return components;
}

export function findPageNodes(file: FigmaFile): FigmaNode[] {
  const pages: FigmaNode[] = [];

  function traverse(node: FigmaNode) {
    if (node.type === 'FRAME' && node.name.toLowerCase().includes('page')) {
      pages.push(node);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(file.document);
  return pages;
}
