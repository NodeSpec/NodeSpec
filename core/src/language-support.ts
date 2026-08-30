import type { ProgrammingLanguage } from './node-metadata.js';

export interface LanguageInfo {
  language: ProgrammingLanguage;
  runtime: string;
  fileExtension: string;
  configFiles: string[];
  packageManager?: string;
}

export interface FrameworkLanguageMapping {
  framework: string;
  language: ProgrammingLanguage;
  runtime: string;
  typicalExtension: string;
}

export const FRAMEWORK_TO_LANGUAGE: FrameworkLanguageMapping[] = [
  { framework: 'express', language: 'typescript', runtime: 'node', typicalExtension: '.ts' },
  { framework: 'fastify', language: 'typescript', runtime: 'node', typicalExtension: '.ts' },
  { framework: 'nestjs', language: 'typescript', runtime: 'node', typicalExtension: '.ts' },
  { framework: 'koa', language: 'typescript', runtime: 'node', typicalExtension: '.ts' },
  { framework: 'hapi', language: 'typescript', runtime: 'node', typicalExtension: '.ts' },

  { framework: 'fastapi', language: 'python', runtime: 'python', typicalExtension: '.py' },
  { framework: 'django', language: 'python', runtime: 'python', typicalExtension: '.py' },
  { framework: 'flask', language: 'python', runtime: 'python', typicalExtension: '.py' },
  { framework: 'starlette', language: 'python', runtime: 'python', typicalExtension: '.py' },

  { framework: 'spring-boot', language: 'java', runtime: 'jvm', typicalExtension: '.java' },
  { framework: 'spring', language: 'java', runtime: 'jvm', typicalExtension: '.java' },
  { framework: 'micronaut', language: 'java', runtime: 'jvm', typicalExtension: '.java' },
  { framework: 'quarkus', language: 'java', runtime: 'jvm', typicalExtension: '.java' },

  { framework: 'gin', language: 'go', runtime: 'go', typicalExtension: '.go' },
  { framework: 'echo', language: 'go', runtime: 'go', typicalExtension: '.go' },
  { framework: 'fiber', language: 'go', runtime: 'go', typicalExtension: '.go' },
  { framework: 'chi', language: 'go', runtime: 'go', typicalExtension: '.go' },

  { framework: 'aspnet', language: 'csharp', runtime: 'dotnet', typicalExtension: '.cs' },
  { framework: 'aspnet-core', language: 'csharp', runtime: 'dotnet', typicalExtension: '.cs' },

  { framework: 'actix-web', language: 'rust', runtime: 'rust', typicalExtension: '.rs' },
  { framework: 'axum', language: 'rust', runtime: 'rust', typicalExtension: '.rs' },
  { framework: 'rocket', language: 'rust', runtime: 'rust', typicalExtension: '.rs' },

  { framework: 'laravel', language: 'php', runtime: 'php', typicalExtension: '.php' },
  { framework: 'symfony', language: 'php', runtime: 'php', typicalExtension: '.php' },

  { framework: 'rails', language: 'ruby', runtime: 'ruby', typicalExtension: '.rb' },
  { framework: 'sinatra', language: 'ruby', runtime: 'ruby', typicalExtension: '.rb' },
];

export const LANGUAGE_CONFIGS: Record<ProgrammingLanguage, LanguageInfo> = {
  typescript: {
    language: 'typescript',
    runtime: 'node',
    fileExtension: '.ts',
    configFiles: ['package.json', 'tsconfig.json'],
    packageManager: 'npm',
  },
  javascript: {
    language: 'javascript',
    runtime: 'node',
    fileExtension: '.js',
    configFiles: ['package.json'],
    packageManager: 'npm',
  },
  python: {
    language: 'python',
    runtime: 'python',
    fileExtension: '.py',
    configFiles: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'],
  },
  java: {
    language: 'java',
    runtime: 'jvm',
    fileExtension: '.java',
    configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  },
  go: {
    language: 'go',
    runtime: 'go',
    fileExtension: '.go',
    configFiles: ['go.mod', 'go.sum'],
  },
  csharp: {
    language: 'csharp',
    runtime: 'dotnet',
    fileExtension: '.cs',
    configFiles: ['.csproj', 'project.json'],
  },
  rust: {
    language: 'rust',
    runtime: 'rust',
    fileExtension: '.rs',
    configFiles: ['Cargo.toml', 'Cargo.lock'],
  },
  php: {
    language: 'php',
    runtime: 'php',
    fileExtension: '.php',
    configFiles: ['composer.json', 'composer.lock'],
  },
  ruby: {
    language: 'ruby',
    runtime: 'ruby',
    fileExtension: '.rb',
    configFiles: ['Gemfile', 'Gemfile.lock'],
  },
  swift: {
    language: 'swift',
    runtime: 'swift',
    fileExtension: '.swift',
    configFiles: ['Package.swift', 'project.pbxproj'],
  },
  kotlin: {
    language: 'kotlin',
    runtime: 'jvm',
    fileExtension: '.kt',
    configFiles: ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts'],
  },
  dart: {
    language: 'dart',
    runtime: 'dart',
    fileExtension: '.dart',
    configFiles: ['pubspec.yaml', 'pubspec.lock'],
    packageManager: 'pub',
  },
  other: {
    language: 'other',
    runtime: 'unknown',
    fileExtension: '.txt',
    configFiles: [],
  },
};

export function detectLanguageFromFramework(framework?: string): ProgrammingLanguage | null {
  if (!framework) return null;

  const mapping = FRAMEWORK_TO_LANGUAGE.find(m =>
    m.framework.toLowerCase() === framework.toLowerCase()
  );

  return mapping ? mapping.language : null;
}

export function detectLanguageFromRuntime(runtime?: string): ProgrammingLanguage | null {
  if (!runtime) return null;

  const runtimeMapping: Record<string, ProgrammingLanguage> = {
    'node': 'typescript',
    'nodejs': 'typescript',
    'python': 'python',
    'python3': 'python',
    'jvm': 'java',
    'java': 'java',
    'go': 'go',
    'golang': 'go',
    'dotnet': 'csharp',
    '.net': 'csharp',
    'rust': 'rust',
    'php': 'php',
    'ruby': 'ruby',
  };

  return runtimeMapping[runtime.toLowerCase()] || null;
}

export function detectLanguageFromConfigFiles(configFileNames: string[]): ProgrammingLanguage | null {
  for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
    const hasConfigFile = config.configFiles.some(configFile =>
      configFileNames.some(fileName => fileName.endsWith(configFile))
    );
    if (hasConfigFile) {
      return lang as ProgrammingLanguage;
    }
  }
  return null;
}

export function detectLanguageFromFileExtension(fileName: string): ProgrammingLanguage | null {
  const ext = fileName.substring(fileName.lastIndexOf('.'));

  for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
    if (config.fileExtension === ext) {
      return lang as ProgrammingLanguage;
    }
  }

  return null;
}

export function getFileExtensionForLanguage(language: ProgrammingLanguage): string {
  return LANGUAGE_CONFIGS[language]?.fileExtension || '.txt';
}

export function getConfigFilesForLanguage(language: ProgrammingLanguage): string[] {
  return LANGUAGE_CONFIGS[language]?.configFiles || [];
}

export function getRuntimeForLanguage(language: ProgrammingLanguage): string {
  return LANGUAGE_CONFIGS[language]?.runtime || 'unknown';
}

export function getLanguageInfo(language: ProgrammingLanguage): LanguageInfo | null {
  return LANGUAGE_CONFIGS[language] || null;
}

export function inferLanguageFromMetadata(
  language?: ProgrammingLanguage,
  framework?: string,
  runtime?: string
): ProgrammingLanguage {
  if (language) return language;

  const fromFramework = detectLanguageFromFramework(framework);
  if (fromFramework) return fromFramework;

  const fromRuntime = detectLanguageFromRuntime(runtime);
  if (fromRuntime) return fromRuntime;

  return 'typescript';
}

export function getLanguageDisplayName(language: ProgrammingLanguage): string {
  const displayNames: Record<ProgrammingLanguage, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    python: 'Python',
    java: 'Java',
    go: 'Go',
    csharp: 'C#',
    rust: 'Rust',
    php: 'PHP',
    ruby: 'Ruby',
    swift: 'Swift',
    kotlin: 'Kotlin',
    dart: 'Dart',
    other: 'Other',
  };
  return displayNames[language] || language;
}

export function getTypicalDirectoryStructure(language: ProgrammingLanguage): string[] {
  const structures: Record<ProgrammingLanguage, string[]> = {
    typescript: ['src/', 'dist/', 'tests/', 'types/'],
    javascript: ['src/', 'lib/', 'test/'],
    python: ['src/', 'tests/', 'docs/'],
    java: ['src/main/java/', 'src/main/resources/', 'src/test/java/'],
    go: ['cmd/', 'internal/', 'pkg/', 'api/'],
    csharp: ['Controllers/', 'Models/', 'Services/', 'Tests/'],
    rust: ['src/', 'tests/', 'benches/', 'examples/'],
    php: ['src/', 'tests/', 'config/'],
    ruby: ['lib/', 'spec/', 'config/'],
    swift: ['Sources/', 'Tests/', 'Resources/', 'Views/', 'Models/', 'ViewModels/'],
    kotlin: ['app/src/main/java/', 'app/src/main/res/', 'app/src/test/', 'app/src/androidTest/'],
    dart: ['lib/', 'lib/src/', 'lib/widgets/', 'lib/models/', 'lib/screens/', 'test/'],
    other: ['src/', 'lib/'],
  };
  return structures[language] || ['src/'];
}
