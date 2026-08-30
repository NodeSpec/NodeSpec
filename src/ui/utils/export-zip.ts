import { zipSync, strToU8 } from 'fflate';
import type { ProjectExportData } from './export-context.js';
import { formatProjectExportAsMarkdown, buildGraphRefExport } from './export-context.js';
import { formatSpecificationReadme } from './export-specification.js';
import { formatAsClaude, formatAsCursorRules, formatAsAgents } from './export-agent-rules.js';
import { buildNodeRagContexts } from './export-rag.js';

interface ZipEntry {
  path: string;
  content: string;
}

function buildDirectoryTree(data: ProjectExportData): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();

  for (const artifact of data.artifacts) {
    if (!artifact.content || !artifact.path) continue;
    const normalized = artifact.path.replace(/^\/+/, '');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    entries.push({ path: normalized, content: artifact.content });
  }

  return entries;
}

export function downloadProjectAsZip(data: ProjectExportData): void {
  const fileEntries = buildDirectoryTree(data);
  const readme = formatProjectExportAsMarkdown(data);

  const zipData: Record<string, Uint8Array> = {};

  zipData['README.md'] = strToU8(readme);

  const specReadme = formatSpecificationReadme(data);
  if (specReadme) {
    zipData['SPECIFICATION.md'] = strToU8(specReadme);
  }

  zipData['CLAUDE.md'] = strToU8(formatAsClaude(data));
  zipData['AGENTS.md'] = strToU8(formatAsAgents(data));
  zipData['.cursor/rules/nodespec.mdc'] = strToU8(formatAsCursorRules(data));

  const jsonExport = JSON.stringify(data, null, 2);
  zipData['architecture.json'] = strToU8(jsonExport);

  const graphRef = JSON.stringify(buildGraphRefExport(data), null, 2);
  zipData['graph-ref.json'] = strToU8(graphRef);

  const ragContexts = buildNodeRagContexts(data);
  for (const ctx of ragContexts) {
    zipData[ctx.path] = strToU8(ctx.content);
  }

  for (const entry of fileEntries) {
    zipData[entry.path] = strToU8(entry.content);
  }

  const zipped = zipSync(zipData, { level: 6 });

  const safeName = data.meta.projectName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .toLowerCase();

  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}-repo.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
