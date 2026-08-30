export interface DetectedDependency {
  name: string;
  version?: string;
  type: 'runtime' | 'dev' | 'peer';
  category?: 'framework' | 'database' | 'testing' | 'ui' | 'utility' | 'build';
}

export interface DetectedFramework {
  name: string;
  version?: string;
  type: 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'testing';
}

export interface DetectedEnvVar {
  name: string;
  required: boolean;
  description?: string;
  defaultValue?: string;
}

export interface DetectedAPIRoute {
  path: string;
  method: string;
  description?: string;
}

export interface DetectedComponent {
  name: string;
  type: 'component' | 'hook' | 'page' | 'layout';
  exported: boolean;
}

export interface DetectedPage {
  name: string;
  path: string;
  component?: string;
}

export interface DependencyAnalysisResult {
  dependencies: DetectedDependency[];
  frameworks: DetectedFramework[];
  envVars: DetectedEnvVar[];
  apiRoutes: DetectedAPIRoute[];
  runtime?: string;
  buildTool?: string;
  components?: DetectedComponent[];
  pages?: DetectedPage[];
}

const FRAMEWORK_PATTERNS: Record<string, DetectedFramework> = {
  'react': { name: 'React', type: 'frontend' },
  'vue': { name: 'Vue', type: 'frontend' },
  'angular': { name: 'Angular', type: 'frontend' },
  'svelte': { name: 'Svelte', type: 'frontend' },
  'next': { name: 'Next.js', type: 'fullstack' },
  'nuxt': { name: 'Nuxt', type: 'fullstack' },
  'express': { name: 'Express', type: 'backend' },
  'fastify': { name: 'Fastify', type: 'backend' },
  'nestjs': { name: 'NestJS', type: 'backend' },
  'flask': { name: 'Flask', type: 'backend' },
  'django': { name: 'Django', type: 'backend' },
  'fastapi': { name: 'FastAPI', type: 'backend' },
  'spring': { name: 'Spring Boot', type: 'backend' },
  'react-native': { name: 'React Native', type: 'mobile' },
  'expo': { name: 'Expo', type: 'mobile' },
};

const DEPENDENCY_CATEGORIES: Record<string, 'framework' | 'database' | 'testing' | 'ui' | 'utility' | 'build'> = {
  'react': 'framework',
  'vue': 'framework',
  'express': 'framework',
  'fastify': 'framework',
  'nestjs': 'framework',
  'next': 'framework',
  'postgres': 'database',
  'mongodb': 'database',
  'redis': 'database',
  'mysql': 'database',
  'prisma': 'database',
  'typeorm': 'database',
  'vitest': 'testing',
  'jest': 'testing',
  'mocha': 'testing',
  'chai': 'testing',
  'playwright': 'testing',
  'cypress': 'testing',
  'tailwindcss': 'ui',
  'styled-components': 'ui',
  'emotion': 'ui',
  'mui': 'ui',
  'antd': 'ui',
  'lodash': 'utility',
  'axios': 'utility',
  'dayjs': 'utility',
  'zod': 'utility',
  'vite': 'build',
  'webpack': 'build',
  'rollup': 'build',
  'esbuild': 'build',
};

export function analyzePackageJson(content: string): DependencyAnalysisResult {
  try {
    const pkg = JSON.parse(content);
    const result: DependencyAnalysisResult = {
      dependencies: [],
      frameworks: [],
      envVars: [],
      apiRoutes: [],
    };

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    for (const [name, version] of Object.entries(allDeps)) {
      const versionStr = typeof version === 'string' ? version : '';
      const isDev = pkg.devDependencies?.[name] !== undefined;
      const isPeer = pkg.peerDependencies?.[name] !== undefined;

      const cleanName = name.toLowerCase().replace(/[@/]/g, '');
      const category = DEPENDENCY_CATEGORIES[cleanName];

      result.dependencies.push({
        name,
        version: versionStr,
        type: isPeer ? 'peer' : isDev ? 'dev' : 'runtime',
        category,
      });

      const framework = FRAMEWORK_PATTERNS[cleanName];
      if (framework && !result.frameworks.find(f => f.name === framework.name)) {
        result.frameworks.push({
          ...framework,
          version: versionStr,
        });
      }
    }

    if (pkg.scripts) {
      if (pkg.scripts.dev?.includes('vite') || pkg.scripts.build?.includes('vite')) {
        result.buildTool = 'Vite';
      } else if (pkg.scripts.dev?.includes('webpack') || pkg.scripts.build?.includes('webpack')) {
        result.buildTool = 'Webpack';
      } else if (pkg.scripts.dev?.includes('next')) {
        result.buildTool = 'Next.js';
      }
    }

    return result;
  } catch (error) {
    return {
      dependencies: [],
      frameworks: [],
      envVars: [],
      apiRoutes: [],
    };
  }
}

export function analyzeRequirementsTxt(content: string): DependencyAnalysisResult {
  const result: DependencyAnalysisResult = {
    dependencies: [],
    frameworks: [],
    envVars: [],
    apiRoutes: [],
    runtime: 'Python',
  };

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([a-zA-Z0-9-_]+)(?:==|>=|<=|~=)?(.+)?/);
    if (match) {
      const [, name, version] = match;
      const cleanName = name.toLowerCase();

      result.dependencies.push({
        name,
        version: version?.trim(),
        type: 'runtime',
        category: DEPENDENCY_CATEGORIES[cleanName],
      });

      const framework = FRAMEWORK_PATTERNS[cleanName];
      if (framework && !result.frameworks.find(f => f.name === framework.name)) {
        result.frameworks.push({
          ...framework,
          version: version?.trim(),
        });
      }
    }
  }

  return result;
}

export function analyzeGoMod(content: string): DependencyAnalysisResult {
  const result: DependencyAnalysisResult = {
    dependencies: [],
    frameworks: [],
    envVars: [],
    apiRoutes: [],
    runtime: 'Go',
  };

  const lines = content.split('\n');
  let inRequire = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('require (')) {
      inRequire = true;
      continue;
    }

    if (inRequire && trimmed === ')') {
      inRequire = false;
      continue;
    }

    if (inRequire || trimmed.startsWith('require ')) {
      const match = trimmed.match(/([^\s]+)\s+v?([^\s]+)/);
      if (match) {
        const [, name, version] = match;
        result.dependencies.push({
          name,
          version,
          type: 'runtime',
        });
      }
    }
  }

  return result;
}

export function detectEnvVars(content: string): DetectedEnvVar[] {
  const envVars: DetectedEnvVar[] = [];
  const patterns = [
    /process\.env\.(\w+)/g,
    /import\.meta\.env\.(\w+)/g,
    /os\.getenv\(['"](\w+)['"]\)/g,
    /os\.environ\.get\(['"](\w+)['"]\)/g,
    /System\.getenv\(['"](\w+)['"]\)/g,
    /\$\{([A-Z_][A-Z0-9_]*)\}/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name && name.length > 1 && !envVars.find(v => v.name === name)) {
        envVars.push({
          name,
          required: true,
        });
      }
    }
  }

  return envVars;
}

export function detectAPIRoutes(content: string, framework?: string): DetectedAPIRoute[] {
  const routes: DetectedAPIRoute[] = [];

  const expressPatterns = [
    /app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g,
    /router\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g,
  ];

  const fastifyPatterns = [
    /fastify\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g,
  ];

  const patterns = framework === 'Express' || framework === 'Fastify'
    ? [...expressPatterns, ...fastifyPatterns]
    : [...expressPatterns, ...fastifyPatterns];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const [, method, path] = match;
      if (!routes.find(r => r.path === path && r.method === method.toUpperCase())) {
        routes.push({
          path,
          method: method.toUpperCase(),
        });
      }
    }
  }

  return routes;
}

export function detectReactComponents(content: string): DetectedComponent[] {
  const components: DetectedComponent[] = [];

  const functionComponentPatterns = [
    /export\s+(?:default\s+)?function\s+([A-Z]\w+)\s*\(/g,
    /(?:export\s+)?const\s+([A-Z]\w+)\s*[:=]\s*\([^)]*\)\s*=>/g,
    /(?:export\s+)?const\s+([A-Z]\w+)\s*[:=]\s*React\.FC/g,
  ];

  const hookPatterns = [
    /export\s+function\s+(use[A-Z]\w+)\s*\(/g,
    /(?:export\s+)?const\s+(use[A-Z]\w+)\s*=\s*\([^)]*\)\s*=>/g,
  ];

  for (const pattern of functionComponentPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name && !components.find(c => c.name === name)) {
        components.push({
          name,
          type: 'component',
          exported: /export/.test(match[0]),
        });
      }
    }
  }

  for (const pattern of hookPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name && !components.find(c => c.name === name)) {
        components.push({
          name,
          type: 'hook',
          exported: /export/.test(match[0]),
        });
      }
    }
  }

  return components;
}

export function detectReactPages(content: string): DetectedPage[] {
  const pages: DetectedPage[] = [];

  const elementPattern = /<Route\s+path=['"]([^'"]+)['"]\s+element=/g;
  const componentPattern = /<Route\s+path=['"]([^'"]+)['"]\s+component=/g;

  let match;

  while ((match = elementPattern.exec(content)) !== null) {
    const path = match[1];
    if (path && !pages.find(p => p.path === path)) {
      pages.push({
        name: path.split('/').filter(Boolean).join('-') || 'home',
        path,
      });
    }
  }

  while ((match = componentPattern.exec(content)) !== null) {
    const path = match[1];
    if (path && !pages.find(p => p.path === path)) {
      pages.push({
        name: path.split('/').filter(Boolean).join('-') || 'home',
        path,
      });
    }
  }

  return pages;
}

export function analyzeSourceCode(content: string, language: string, framework?: string): Partial<DependencyAnalysisResult> {
  const result: Partial<DependencyAnalysisResult> = {
    envVars: detectEnvVars(content),
    apiRoutes: detectAPIRoutes(content, framework),
  };

  if (language === 'typescript' || language === 'javascript' || language === 'tsx' || language === 'jsx') {
    const isReactCode = content.includes('react') ||
                        content.includes('React') ||
                        content.includes('useState') ||
                        content.includes('useEffect') ||
                        /function\s+[A-Z]\w+\s*\(/.test(content);

    if (isReactCode || framework?.toLowerCase().includes('react')) {
      const components = detectReactComponents(content);
      const pages = detectReactPages(content);

      return {
        ...result,
        components,
        pages,
      };
    }
  }

  return result;
}
