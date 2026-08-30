// N8.4a-1b — client half of the stray-id normalization. The core map is the single
// source; catalog-repository registers alias keys at techIndex build so pre-rename
// graph values (nodes still carrying 'ec2') keep resolving to the canonical row.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TECHNOLOGY_ID_ALIASES, resolveTechnologyId } from '@nodespec/core/technology-aliases.js';

describe('N8.4a-1b technology-id aliases (client/core)', () => {
  it('maps the three AWS strays to provider-prefixed canonical ids', () => {
    expect(TECHNOLOGY_ID_ALIASES).toEqual({
      aurora: 'aws-aurora',
      dynamodb: 'aws-dynamodb',
      ec2: 'aws-ec2',
      elasticache: 'aws-elasticache',
      cosmosdb: 'azure-cosmos-db',
      // 4b-3: merged duplicate — both rows were named "Microsoft Entra ID".
      'azure-ad-b2c': 'azure-entra-id',
      // 4c-1: GCP had four un-prefixed rows; two were duplicate pairs.
      gcs: 'gcp-cloud-storage',
      'gcp-cloud-storage-for-archive': 'gcp-cloud-storage',
      firestore: 'gcp-firestore',
      'firebase-firestore': 'gcp-firestore',
      'gce-instance': 'gcp-compute-engine',
      // 4c-5 owner rulings: Vertex arbiter merge + dead-product retirement.
      'gcp-cloud-natural-language-api': 'gcp-vertex-ai',
      'openai-assistants': 'openai',
    });
    expect(resolveTechnologyId('ec2')).toBe('aws-ec2');
    expect(resolveTechnologyId('react')).toBe('react');
  });

  it('catalog-repository registers the aliases into techIndex (read tolerance)', () => {
    const src = readFileSync(resolve(__dirname, '../persistence/supabase/catalog-repository.ts'), 'utf-8');
    expect(src).toContain("import { TECHNOLOGY_ID_ALIASES } from '@nodespec/core/technology-aliases.js'");
    expect(src).toContain('if (row && !techIndex.has(alias)) techIndex.set(alias, row);');
  });

  it('the server mirror map stays byte-identical to core (enums.ts pattern)', () => {
    const server = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/catalog-loader.ts'), 'utf-8');
    for (const [alias, canonical] of Object.entries(TECHNOLOGY_ID_ALIASES)) {
      // Hyphenated aliases (azure-ad-b2c) must be written as quoted keys in both files.
      const bare = `${alias}: '${canonical}'`;
      const quoted = `'${alias}': '${canonical}'`;
      expect(server.includes(bare) || server.includes(quoted)).toBe(true);
    }
  });
});
