import type { ProgrammingLanguage } from './node-metadata.js';
import {
  detectLanguageFromFileExtension,
  detectLanguageFromConfigFiles,
  detectLanguageFromFramework,
} from './language-support.js';

export function detectLanguageFromArtifacts(artifacts: Array<{ path: string; content: string }>): ProgrammingLanguage | null {
  const configFiles = artifacts.map(a => a.path);

  const fromConfigFiles = detectLanguageFromConfigFiles(configFiles);
  if (fromConfigFiles) {
    return fromConfigFiles;
  }

  for (const artifact of artifacts) {
    const fromExtension = detectLanguageFromFileExtension(artifact.path);
    if (fromExtension && fromExtension !== 'other') {
      return fromExtension;
    }

    const fromContent = detectLanguageFromContent(artifact.content);
    if (fromContent) {
      return fromContent;
    }
  }

  return null;
}

export function detectLanguageFromContent(content: string): ProgrammingLanguage | null {
  if (content.includes('package.json') || /import\s+.*\s+from\s+['"]/.test(content) || /require\s*\(['"]/.test(content)) {
    if (/:\s*\w+/.test(content) || content.includes('interface ') || content.includes('type ')) {
      return 'typescript';
    }
    return 'javascript';
  }

  if (/import\s+\w+/.test(content) || /from\s+\w+\s+import/.test(content) || /def\s+\w+\s*\(/.test(content)) {
    return 'python';
  }

  if (/package\s+\w+/.test(content) || /public\s+class\s+\w+/.test(content) || /@Override/.test(content)) {
    return 'java';
  }

  if (/func\s+\w+\s*\(/.test(content) || /package\s+main/.test(content) || /:=/.test(content)) {
    return 'go';
  }

  if (/namespace\s+\w+/.test(content) || /using\s+System/.test(content) || /public\s+void\s+\w+/.test(content)) {
    return 'csharp';
  }

  if (/fn\s+\w+\s*\(/.test(content) || content.includes('use std::') || /let\s+mut\s+/.test(content)) {
    return 'rust';
  }

  if (/<\?php/.test(content) || /namespace\s+\w+\\/.test(content)) {
    return 'php';
  }

  if (/def\s+\w+/.test(content) || /module\s+\w+/.test(content) || /class\s+\w+\s*<\s*/.test(content)) {
    return 'ruby';
  }

  return null;
}

export function detectLanguageFromNodeMetadata(
  framework?: string,
  runtime?: string,
  existingLanguage?: ProgrammingLanguage
): ProgrammingLanguage | null {
  if (existingLanguage) return existingLanguage;

  const fromFramework = detectLanguageFromFramework(framework);
  if (fromFramework) return fromFramework;

  if (runtime) {
    const runtimeToLanguage: Record<string, ProgrammingLanguage> = {
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
    return runtimeToLanguage[runtime.toLowerCase()] || null;
  }

  return null;
}
