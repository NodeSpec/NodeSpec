// V3 7.1 (R1): the feature rules exist twice on purpose — the client
// bundle cannot import Deno-path modules — and these pins keep the copies
// honest: the same features, the same minimum tiers, the same labels and
// sentences, by executing BOTH modules (the server table is pure TS). Then
// the OPEN wiring: useFeatureGate binds the config table; below Indie the
// Plan tab is not shown at all (Q). This file SHIPS in the
// community export, so it reads open files only — the pins on the closed
// tools, llms-full and the plan live in feature-rules-wiring.test.ts
// (export-excluded, 7.2).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FEATURE_RULES as CLIENT, FEATURES as CLIENT_FEATURES, featureAllowed as clientAllowed,
  featureInEdition as clientInEdition, featureAvailable as clientAvailable, EDITIONS,
  AGENT_CONNECTION_LIMIT as CLIENT_CONNECTIONS, agentConnectionCapMessage as clientCap, agentConnectionAllowanceLine as clientAllowance,
} from '../ui/config/feature-rules.js';
import {
  FEATURE_RULES as SERVER, FEATURES as SERVER_FEATURES, featureAllowed as serverAllowed,
  featureInEdition as serverInEdition, featureAvailable as serverAvailable,
  AGENT_CONNECTION_LIMIT as SERVER_CONNECTIONS, agentConnectionCapMessage as serverCap, agentConnectionAllowanceLine as serverAllowance,
} from '../../supabase/functions/_shared/feature-rules.js';
import { CANONICAL_TIERS } from '../ui/config/tiers.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('feature rules — client/server parity', () => {
  it('both tables carry the same features with the same minimum tier, label and message', () => {
    expect(CLIENT_FEATURES).toEqual(SERVER_FEATURES);
    expect(CLIENT).toEqual(SERVER);
  });

  it('the V3 surfaces sit on the ladder as ruled (R1), on both sides', () => {
    for (const table of [CLIENT, SERVER]) {
      expect(table.workflow_space.minimumTier).toBe('indie'); // P (2026-09-22): Workflows start at Indie
      expect(table.priority_board.minimumTier).toBe('indie');
      expect(table.work_exports.minimumTier).toBe('team');
      expect(table.team_lanes.minimumTier).toBe('team');
      expect(table.classification.minimumTier).toBe('government');
      expect(table.repo_import.minimumTier).toBe('indie');
    }
  });

  it('the verdict agrees for every (tier, feature, edition) triple — both axes', () => {
    for (const tier of CANONICAL_TIERS) {
      for (const feature of CLIENT_FEATURES) {
        expect(clientAllowed(tier, feature)).toBe(serverAllowed(tier, feature));
        for (const edition of EDITIONS) {
          expect(clientInEdition(feature, edition)).toBe(serverInEdition(feature, edition));
          expect(clientAvailable(tier, feature, edition)).toBe(serverAvailable(tier, feature, edition));
        }
      }
    }
  });

  it('I (owner 2026-09-21): connected agents per person, the same number and the same sentences on both sides', () => {
    expect(CLIENT_CONNECTIONS).toEqual(SERVER_CONNECTIONS);
    expect(SERVER_CONNECTIONS).toEqual({ community: 1, indie: 5, team: 5, enterprise: 5, government: 5 });
    for (const tier of CANONICAL_TIERS) {
      expect(clientCap(tier)).toBe(serverCap(tier));
      expect(clientAllowance(tier)).toBe(serverAllowance(tier));
      expect(serverCap(tier)).not.toMatch(/\u2014/);
      expect(serverAllowance(tier)).not.toMatch(/\u2014/);
    }
    expect(serverCap('community')).toContain('one connected agent');
    expect(serverCap('community')).toContain('upgrade to Indie to connect up to five');
    expect(serverCap('indie')).toContain('Indie connects up to five agents per person');
    expect(serverCap('team')).toContain('Team connects up to five agents per person');
    expect(serverAllowance('community')).toBe('Your plan includes one connected agent.');
  });

  it('R9: the edition column agrees on both sides — the community tree loses exactly these', () => {
    for (const table of [CLIENT, SERVER]) {
      const closed = Object.keys(table).filter((f) => !table[f as keyof typeof table].editions.includes('oss')).sort();
      expect(closed).toEqual(['classification', 'compliance', 'full_catalog', 'gov_catalog', 'priority_board', 'repo_import', 'self_host', 'team_lanes', 'work_exports']);
    }
  });
});

describe('feature rules — the wiring', () => {
  it('the gate hook reads BOTH axes and fails closed on a build that lacks the code', () => {
    const hook = read('src/ui/hooks/useFeatureGate.ts');
    expect(hook).toContain('featureAvailable(plan, feature, buildEdition)');
    expect(read('src/ui/config/edition.ts')).toContain("isHostedEdition ? 'hosted' : isEnterpriseEdition ? 'enterprise' : isGovernmentEdition ? 'government' : 'oss'");
  });

  it('useFeatureGate binds the config table (no inline copy of the rules)', () => {
    const hook = read('src/ui/hooks/useFeatureGate.ts');
    expect(hook).toContain("import { FEATURE_RULES, featureAvailable, type Feature, type FeatureRule } from '../config/feature-rules.js';");
    expect(hook).toContain("export type { Feature, FeatureRule } from '../config/feature-rules.js';");
    expect(hook).not.toContain('const FEATURE_RULES: Record<Feature, FeatureRule>');
  });

  it('Q: below Indie the Plan tab is not shown and the plan is not read; no tier tag teases it (V3 4.1: Work\'s tabs)', () => {
    const space = read('src/ui/components/work/WorkSurface.tsx');
    expect(space).toContain("const canPriority = !gate.loading && gate.can('priority_board');");
    expect(space).toContain('usePriorityBoard(canPriority ? projectId : null, branchId)');
    expect(space).not.toContain('INDIE+');
    expect(space).not.toContain('mode-tier-tag');
    expect(space).not.toContain('work-lane-gate');
  });
});
