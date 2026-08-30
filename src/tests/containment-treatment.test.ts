// N2.3: containment honors EFFECTIVE treatment (core mirror of the server rule in
// role-registry.canContainerAcceptChild). Bench-found: "docker container cannot contain
// Data Prep Pipeline node type" — hosting containers hand-enumerate canContain role ids,
// so any unlisted role was rejected before treatment was consulted. The precedence rule:
// an effective-boundary child (role default, or raised by a boundary-engine technology)
// is placeable into any container; leaf children keep the existing enumeration behavior.
// Runs against the REAL static container defs (docker-container, virtual-machine) — the
// exact defs the bench hit.
import { afterEach, describe, expect, it } from 'vitest';
import {
  canContainerHoldNode,
  setTechnologyTreatmentResolver,
  type RoleResolver,
} from '@nodespec/core/container-types.js';

const roleResolver: RoleResolver = (roleId: string) => {
  const roles: Record<string, { kind: string; treatmentMode?: 'leaf' | 'container' | 'boundary' }> = {
    'data-prep-pipeline': { kind: 'app_service', treatmentMode: 'leaf' },
    'scheduled-trigger': { kind: 'automation_pipeline', treatmentMode: 'boundary' },
    'backend-service': { kind: 'app_service', treatmentMode: 'leaf' },
    'k8s-namespace': { kind: 'orchestration', treatmentMode: 'container' },
  };
  const r = roles[roleId];
  return r ? { id: roleId, kind: r.kind, functionalKind: null, provider: null, treatmentMode: r.treatmentMode } : null;
};

const techResolver = (technologyId: string) =>
  technologyId === 'n8n' ? 'boundary' : null;

afterEach(() => setTechnologyTreatmentResolver(null));

describe('N2.3 containment precedence (real static container defs)', () => {
  it('THE bench case: leaf role + n8n → allowed into docker-container and virtual-machine', () => {
    setTechnologyTreatmentResolver(techResolver);
    expect(canContainerHoldNode('docker-container', 'data-prep-pipeline', roleResolver, 'n8n')).toBe(true);
    expect(canContainerHoldNode('virtual-machine', 'data-prep-pipeline', roleResolver, 'n8n')).toBe(true);
  });

  it('role-level boundary needs no technology', () => {
    expect(canContainerHoldNode('virtual-machine', 'scheduled-trigger', roleResolver)).toBe(true);
  });

  it('leaf behavior unchanged: unlisted leaf still rejected; listed leaf still allowed', () => {
    setTechnologyTreatmentResolver(techResolver);
    // hand-coded ETL (no engine tech) — the enumerated list still applies
    expect(canContainerHoldNode('virtual-machine', 'data-prep-pipeline', roleResolver)).toBe(false);
    expect(canContainerHoldNode('virtual-machine', 'backend-service', roleResolver)).toBe(true);
  });

  it('container children are structural — never unlocked by a technology override', () => {
    setTechnologyTreatmentResolver(techResolver);
    // k8s-namespace is not in docker-container's list and must stay governed by nesting rules
    expect(canContainerHoldNode('docker-container', 'k8s-namespace', roleResolver, 'n8n')).toBe(false);
  });

  it('without any tech resolver registered, technology cannot unlock (safe default)', () => {
    expect(canContainerHoldNode('docker-container', 'data-prep-pipeline', roleResolver, 'n8n')).toBe(false);
  });
});
