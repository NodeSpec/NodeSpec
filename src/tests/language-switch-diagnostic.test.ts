import { describe, it, expect } from 'vitest';
import { getArtifactPlaceholdersForNode } from '@nodespec/core/templates.js';
import type { Node } from '@nodespec/core/types.js';
import type { NodeDomainMetadata } from '@nodespec/core/node-metadata.js';

describe('Language Switching Diagnostic', () => {
  it('should show difference between TypeScript and Python artifacts', () => {
    const tsMetadata: NodeDomainMetadata = {
      type: 'web-service',
      data: {
        language: 'typescript',
        framework: undefined,
        runtime: undefined,
        dependencies: [],
        envVars: [],
        apiRoutes: [],
      },
    };

    const pyMetadata: NodeDomainMetadata = {
      type: 'web-service',
      data: {
        language: 'python',
        framework: undefined,
        runtime: undefined,
        dependencies: [],
        envVars: [],
        apiRoutes: [],
      },
    };

    const tsNode: Partial<Node> = {
      id: 'test-rest-api',
      type: 'web.rest-api',
      metadata: { domainMetadata: tsMetadata },
    };

    const pyNode: Partial<Node> = {
      id: 'test-rest-api',
      type: 'web.rest-api',
      metadata: { domainMetadata: pyMetadata },
    };

    const tsArtifacts = getArtifactPlaceholdersForNode(tsNode);
    const pyArtifacts = getArtifactPlaceholdersForNode(pyNode);

    console.log('\n=== TYPESCRIPT ARTIFACTS ===');
    tsArtifacts.forEach((a, i) => {
      console.log(`${i + 1}. ${a.suggestedPath} [${a.kind}] (${a.language || 'no-lang'})`);
    });

    console.log('\n=== PYTHON ARTIFACTS ===');
    pyArtifacts.forEach((a, i) => {
      console.log(`${i + 1}. ${a.suggestedPath} [${a.kind}] (${a.language || 'no-lang'})`);
    });

    console.log('\n=== COMPARISON ===');
    console.log(`TypeScript artifacts: ${tsArtifacts.length}`);
    console.log(`Python artifacts: ${pyArtifacts.length}`);

    const tsPathsSet = new Set(tsArtifacts.map(a => a.suggestedPath));
    const pyPathsSet = new Set(pyArtifacts.map(a => a.suggestedPath));

    const onlyInTs = tsArtifacts.filter(a => !pyPathsSet.has(a.suggestedPath));
    const onlyInPy = pyArtifacts.filter(a => !tsPathsSet.has(a.suggestedPath));

    if (onlyInTs.length > 0) {
      console.log('\nOnly in TypeScript:');
      onlyInTs.forEach(a => console.log(`  - ${a.suggestedPath}`));
    }

    if (onlyInPy.length > 0) {
      console.log('\nOnly in Python:');
      onlyInPy.forEach(a => console.log(`  - ${a.suggestedPath}`));
    }

    const matchableByBase: Array<{old: string, new: string}> = [];
    onlyInTs.forEach(tsArt => {
      const tsBase = tsArt.suggestedPath.substring(0, tsArt.suggestedPath.lastIndexOf('.'));
      const match = onlyInPy.find(pyArt => {
        const pyBase = pyArt.suggestedPath.substring(0, pyArt.suggestedPath.lastIndexOf('.'));
        return tsBase === pyBase;
      });
      if (match) {
        matchableByBase.push({ old: tsArt.suggestedPath, new: match.suggestedPath });
      }
    });

    if (matchableByBase.length > 0) {
      console.log('\nMatchable by base path (extension change):');
      matchableByBase.forEach(m => console.log(`  ${m.old} → ${m.new}`));
    }

    const unmatchableTs = onlyInTs.filter(tsArt => {
      const tsBase = tsArt.suggestedPath.substring(0, tsArt.suggestedPath.lastIndexOf('.'));
      return !onlyInPy.some(pyArt => {
        const pyBase = pyArt.suggestedPath.substring(0, pyArt.suggestedPath.lastIndexOf('.'));
        return tsBase === pyBase;
      });
    });

    if (unmatchableTs.length > 0) {
      console.log('\n❌ TypeScript artifacts with NO Python equivalent:');
      unmatchableTs.forEach(a => console.log(`  - ${a.suggestedPath} (${a.description})`));
      console.log('\nThese would remain as-is when switching to Python!');
    }

    const unmatchablePy = onlyInPy.filter(pyArt => {
      const pyBase = pyArt.suggestedPath.substring(0, pyArt.suggestedPath.lastIndexOf('.'));
      return !onlyInTs.some(tsArt => {
        const tsBase = tsArt.suggestedPath.substring(0, tsArt.suggestedPath.lastIndexOf('.'));
        return tsBase === pyBase;
      });
    });

    if (unmatchablePy.length > 0) {
      console.log('\n❌ Python artifacts NOT created (no TypeScript equivalent to update):');
      unmatchablePy.forEach(a => console.log(`  - ${a.suggestedPath} (${a.description})`));
      console.log('\nThese would be MISSING when switching to Python!');
    }

    expect(true).toBe(true);
  });

  it('should show the actual user experience flow', () => {
    console.log('\n=== USER FLOW SIMULATION ===');
    console.log('1. User drags REST API node onto canvas');
    console.log('   → Node created with language=typescript');

    const tsMetadata: NodeDomainMetadata = {
      type: 'web-service',
      data: {
        language: 'typescript',
        framework: undefined,
        runtime: undefined,
        dependencies: [],
        envVars: [],
        apiRoutes: [],
      },
    };

    const node: Partial<Node> = {
      id: 'test-rest-api',
      type: 'web.rest-api',
      metadata: { domainMetadata: tsMetadata },
    };

    const initialArtifacts = getArtifactPlaceholdersForNode(node);
    console.log(`   → ${initialArtifacts.length} suggested artifacts created:`);
    initialArtifacts.forEach(a => {
      if (a.kind === 'source') {
        console.log(`      - ${a.suggestedPath} (${a.language})`);
      }
    });

    console.log('\n2. User opens inspector and changes language to Python');
    console.log('   → System calls getArtifactPlaceholdersForNode with language=python');

    const pyMetadata: NodeDomainMetadata = {
      type: 'web-service',
      data: {
        language: 'python',
        framework: undefined,
        runtime: undefined,
        dependencies: [],
        envVars: [],
        apiRoutes: [],
      },
    };

    const updatedNode: Partial<Node> = {
      ...node,
      metadata: { domainMetadata: pyMetadata },
    };

    const newArtifacts = getArtifactPlaceholdersForNode(updatedNode);
    console.log(`   → ${newArtifacts.length} new suggested artifacts:`);
    newArtifacts.forEach(a => {
      if (a.kind === 'source') {
        console.log(`      - ${a.suggestedPath} (${a.language})`);
      }
    });

    console.log('\n3. System tries to match old → new artifacts:');

    const tsPathMap = new Map(initialArtifacts.map(a => [a.suggestedPath, a]));

    newArtifacts.forEach(newArt => {
      const exactMatch = tsPathMap.get(newArt.suggestedPath);
      if (exactMatch) {
        console.log(`   ✓ Exact match: ${newArt.suggestedPath} (no change)`);
        return;
      }

      const newBase = newArt.suggestedPath.substring(0, newArt.suggestedPath.lastIndexOf('.'));
      const oldMatch = initialArtifacts.find(oldArt => {
        const oldBase = oldArt.suggestedPath.substring(0, oldArt.suggestedPath.lastIndexOf('.'));
        return oldBase === newBase;
      });

      if (oldMatch) {
        console.log(`   ✓ Update: ${oldMatch.suggestedPath} → ${newArt.suggestedPath}`);
      } else {
        console.log(`   ❌ No match: ${newArt.suggestedPath} (NOT CREATED)`);
      }
    });

    initialArtifacts.forEach(oldArt => {
      const newBase = oldArt.suggestedPath.substring(0, oldArt.suggestedPath.lastIndexOf('.'));
      const hasMatch = newArtifacts.some(newArt => {
        const nb = newArt.suggestedPath.substring(0, newArt.suggestedPath.lastIndexOf('.'));
        return nb === newBase || newArt.suggestedPath === oldArt.suggestedPath;
      });

      if (!hasMatch && oldArt.kind === 'source') {
        console.log(`   ❌ Orphaned: ${oldArt.suggestedPath} (STILL SHOWS ${oldArt.language})`);
      }
    });

    expect(true).toBe(true);
  });
});
