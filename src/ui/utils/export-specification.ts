import type { ProjectExportData, ProjectExportSpecification } from './export-context.js';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatCategory(cat: string): string {
  return cat.split('-').map(capitalize).join('-');
}

function buildVisionSection(spec: ProjectExportSpecification): string[] {
  if (!spec.vision) return [];
  const lines: string[] = [];
  lines.push('## Vision');
  lines.push('');
  lines.push(spec.vision);
  lines.push('');
  return lines;
}

function buildArchitectureSummary(data: ProjectExportData): string[] {
  const lines: string[] = [];
  const spec = data.specification;
  if (!spec) return lines;

  lines.push('<!-- auto-generated: skip -->');
  lines.push('> **[READ-ONLY]** This section is auto-generated from the architecture canvas. Edits here will not be saved.');
  lines.push('');
  lines.push('## System Architecture Summary');
  lines.push('');

  const containers = data.nodes.filter(n => !n.parentId);
  const services = data.nodes.filter(n => n.parentId);
  const techs = [...new Set(data.nodes.map(n => n.technology).filter(Boolean))];
  const contractKinds = [...new Set(data.edges.map(e => e.contractKind))];

  const parts: string[] = [];

  if (containers.length > 0) {
    const containerList = containers.slice(0, 4).map(c => c.label).join(', ');
    const extra = containers.length > 4 ? ` and ${containers.length - 4} more` : '';
    parts.push(`The system is composed of ${data.meta.nodeCount} architectural components organized into ${containers.length} top-level containers (${containerList}${extra})`);
  } else {
    parts.push(`The system contains ${data.meta.nodeCount} architectural components`);
  }

  if (services.length > 0) {
    parts.push(`hosting ${services.length} services`);
  }

  if (techs.length > 0) {
    const techList = techs.slice(0, 5).join(', ');
    const extra = techs.length > 5 ? ` and ${techs.length - 5} more` : '';
    parts.push(`Technologies in use include ${techList}${extra}`);
  }

  if (contractKinds.length > 0) {
    parts.push(`Components communicate via ${data.meta.edgeCount} integration points using ${contractKinds.join(', ')} contracts`);
  }

  if (spec.preferences.deploymentTarget) {
    parts.push(`The system targets ${spec.preferences.deploymentTarget} for deployment`);
  }

  lines.push(parts.join('. ') + '.');
  lines.push('');
  return lines;
}

function buildTechStackSection(spec: ProjectExportSpecification): string[] {
  const p = spec.preferences;
  const hasPrefs = p.languages?.length || p.frameworks?.length || p.databases?.length || p.deploymentTarget || p.architecturePattern;
  const hasConstraints = spec.constraints.length > 0;
  if (!hasPrefs && !hasConstraints) return [];

  const lines: string[] = [];
  lines.push('<!-- auto-generated: skip -->');
  lines.push('> **[READ-ONLY]** This section is auto-generated from project settings. Edits here will not be saved.');
  lines.push('');
  lines.push('## Technology & Constraints');
  lines.push('');

  if (hasPrefs) {
    const items: string[] = [];
    if (p.languages?.length) items.push(`**Languages:** ${p.languages.join(', ')}`);
    if (p.frameworks?.length) items.push(`**Frameworks:** ${p.frameworks.join(', ')}`);
    if (p.databases?.length) items.push(`**Databases:** ${p.databases.join(', ')}`);
    if (p.deploymentTarget) items.push(`**Deployment:** ${p.deploymentTarget}`);
    if (p.architecturePattern && p.architecturePattern !== 'unknown') {
      items.push(`**Architecture:** ${capitalize(p.architecturePattern)}`);
    }
    if (items.length > 0) {
      lines.push('| Area | Details |');
      lines.push('|------|---------|');
      for (const item of items) {
        const [label, ...rest] = item.split(': ');
        lines.push(`| ${label.replace(/\*\*/g, '')} | ${rest.join(': ')} |`);
      }
      lines.push('');
    }
  }

  if (hasConstraints) {
    lines.push('### Constraints');
    lines.push('');
    for (const c of spec.constraints) {
      lines.push(`- **${formatCategory(c.type)}:** ${c.description}`);
    }
    lines.push('');
  }

  return lines;
}

function buildRequirementsSection(
  spec: ProjectExportSpecification,
  testSuite: ProjectExportData['testSuite'],
): string[] {
  if (spec.requirements.length === 0) return [];

  const lines: string[] = [];
  lines.push('## Requirements');
  lines.push('');

  const totalCriteria = spec.requirements.reduce((sum, r) => sum + r.acceptanceCriteria.length, 0);
  const metCriteria = spec.requirements.reduce(
    (sum, r) => sum + r.acceptanceCriteria.filter(ac => ac.met).length, 0,
  );
  const stats: string[] = [
    `${spec.requirements.length} requirements`,
    `${totalCriteria} acceptance criteria`,
    `**${metCriteria}/${totalCriteria} met**`,
  ];
  lines.push(`> ${stats.join(' | ')}`);
  lines.push('');

  const categories = [...new Set(spec.requirements.map(r => r.category))];

  const testsByReqId = new Map<string, typeof testSuite>();
  for (const tc of testSuite) {
    const existing = testsByReqId.get(tc.requirementId) ?? [];
    existing.push(tc);
    testsByReqId.set(tc.requirementId, existing);
  }

  for (const category of categories) {
    const reqs = spec.requirements.filter(r => r.category === category);
    lines.push(`### ${formatCategory(category)} Requirements`);
    lines.push('');

    for (const req of reqs) {
      const reqMet = req.acceptanceCriteria.filter(ac => ac.met).length;
      const reqTotal = req.acceptanceCriteria.length;
      const coverageTag = reqTotal > 0 ? ` -- ${reqMet}/${reqTotal} criteria met` : '';

      lines.push(`#### ${req.name}${coverageTag}`);
      lines.push('');
      lines.push(`**ID:** ${req.requirementId}`);
      lines.push('');
      lines.push(req.description);
      lines.push('');

      if (req.acceptanceCriteria.length > 0) {
        lines.push('**Acceptance Criteria:**');
        lines.push('');
        for (const ac of req.acceptanceCriteria) {
          const check = ac.met ? '[x]' : '[ ]';
          lines.push(`- ${check} ${ac.text}`);
        }
        lines.push('');
      }

      const relatedTests = testsByReqId.get(req.requirementId) ?? [];
      if (relatedTests.length > 0) {
        lines.push('**Test Coverage:**');
        lines.push('');
        for (const tc of relatedTests) {
          const icon = tc.status === 'passed' ? 'PASS' : tc.status === 'failed' ? 'FAIL' : 'PENDING';
          lines.push(`- \\[${icon}\\] ${tc.name} *(${tc.testType}${tc.framework ? ', ' + tc.framework : ''})*`);
        }
        lines.push('');
      }
    }
  }

  return lines;
}

function buildProgressTable(data: ProjectExportData): string[] {
  const spec = data.specification;
  if (!spec) return [];

  const lines: string[] = [];
  lines.push('<!-- auto-generated: skip -->');
  lines.push('> **[READ-ONLY]** This section is auto-generated from requirement and test data. Edits here will not be saved.');
  lines.push('');
  lines.push('## Implementation Progress');
  lines.push('');

  // Requirements by coverage
  if (spec.requirements.length > 0) {
    const totalAc = spec.requirements.reduce((s, r) => s + r.acceptanceCriteria.length, 0);
    const metAc = spec.requirements.reduce((s, r) => s + r.acceptanceCriteria.filter(ac => ac.met).length, 0);
    const fullyMet = spec.requirements.filter(r =>
      r.acceptanceCriteria.length > 0 && r.acceptanceCriteria.every(ac => ac.met),
    ).length;
    const partiallyMet = spec.requirements.filter(r =>
      r.acceptanceCriteria.some(ac => ac.met) && !r.acceptanceCriteria.every(ac => ac.met),
    ).length;
    const unmet = spec.requirements.filter(r =>
      r.acceptanceCriteria.length > 0 && r.acceptanceCriteria.every(ac => !ac.met),
    ).length;
    const noCriteria = spec.requirements.filter(r => r.acceptanceCriteria.length === 0).length;

    lines.push('### Requirements Coverage');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total requirements | ${spec.requirements.length} |`);
    lines.push(`| Fully satisfied | ${fullyMet} |`);
    lines.push(`| Partially satisfied | ${partiallyMet} |`);
    lines.push(`| Not yet satisfied | ${unmet} |`);
    if (noCriteria > 0) lines.push(`| No criteria defined | ${noCriteria} |`);
    lines.push(`| Acceptance criteria | ${metAc}/${totalAc} met (${totalAc > 0 ? Math.round((metAc / totalAc) * 100) : 0}%) |`);
    lines.push('');
  }

  // Test pass rate
  if (data.testSuite.length > 0) {
    const passed = data.testSuite.filter(t => t.status === 'passed').length;
    const failed = data.testSuite.filter(t => t.status === 'failed').length;
    const pending = data.testSuite.filter(t => t.status !== 'passed' && t.status !== 'failed').length;

    lines.push('### Test Results');
    lines.push('');
    lines.push('| Status | Count | Percentage |');
    lines.push('|--------|-------|------------|');
    lines.push(`| Passed | ${passed} | ${Math.round((passed / data.testSuite.length) * 100)}% |`);
    lines.push(`| Failed | ${failed} | ${Math.round((failed / data.testSuite.length) * 100)}% |`);
    lines.push(`| Pending | ${pending} | ${Math.round((pending / data.testSuite.length) * 100)}% |`);
    lines.push(`| **Total** | **${data.testSuite.length}** | |`);
    lines.push('');
  }

  return lines;
}

export function formatSpecificationReadme(data: ProjectExportData): string | null {
  if (!data.specification) return null;

  const spec = data.specification;
  const lines: string[] = [];

  lines.push(`# ${data.meta.projectName}`);
  lines.push('');
  lines.push(`*Project Specification Document*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push(...buildVisionSection(spec));
  lines.push(...buildArchitectureSummary(data));
  lines.push(...buildTechStackSection(spec));
  lines.push(...buildRequirementsSection(spec, data.testSuite));
  lines.push(...buildProgressTable(data));

  lines.push('---');
  lines.push('');
  lines.push(`*Generated ${new Date(data.meta.exportedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}*`);
  lines.push('');

  return lines.join('\n');
}
