// N8.4b-1b — CRITICAL (owner 2026-07-27): "Azure services cannot be contained by AWS
// projects, AWS nodes cannot be contained by Azure projects, GCP in azure or AWS, etc."
// A platform is a cloud account/subscription boundary — platforms are PEERS, never
// nested. Before this the rule held only by accident (no can_contain list happened to
// name a platform role), so every permissive path let it through: unknown container,
// empty rules, and the palette-drop path that skipped containment entirely.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  canContainerHoldNode, populateContainerTypes, setRoleResolver,
  type ContainerTypeDefinition, type RoleInfo,
} from '@nodespec/core/container-types.js';

const ROLES: Record<string, RoleInfo> = {
  aws:   { id: 'aws',   nature: 'host', provider: 'aws',   treatmentMode: 'container' },
  azure: { id: 'azure', nature: 'host', provider: 'azure', treatmentMode: 'container' },
  gcp:   { id: 'gcp',   nature: 'host', provider: 'gcp',   treatmentMode: 'container' },
  'k8s-cluster': { id: 'k8s-cluster', nature: 'build', provider: null, treatmentMode: 'container' },
  vpc: { id: 'vpc', nature: 'build', provider: null, treatmentMode: 'container' },
  'backend-service': { id: 'backend-service', nature: 'build', provider: null, treatmentMode: 'leaf' },
};

const CONTAINERS: ContainerTypeDefinition[] = [
  { id: 'aws',   label: 'AWS',   layer: 'infrastructure', canContain: { roleIds: ['aws-lambda'], providers: ['aws'] } } as unknown as ContainerTypeDefinition,
  { id: 'azure', label: 'Azure', layer: 'infrastructure', canContain: { roleIds: [], providers: ['azure'] } } as unknown as ContainerTypeDefinition,
  { id: 'k8s-cluster', label: 'K8s', layer: 'orchestration', canContain: ['backend-service'] } as unknown as ContainerTypeDefinition,
  // The real vpc role: a 48-entry legacy ARRAY with zero provider awareness.
  { id: 'vpc', label: 'VPC', layer: 'infrastructure', canContain: ['backend-service', 'k8s-cluster', 'database', 'cache'] } as unknown as ContainerTypeDefinition,
];

describe('N8.4b-1b platform-in-platform is refused everywhere', () => {
  beforeEach(() => {
    populateContainerTypes(CONTAINERS);
    setRoleResolver((id) => ROLES[id] ?? null);
  });

  it('refuses every cross-provider platform pairing (the reported bug)', () => {
    expect(canContainerHoldNode('aws', 'azure')).toBe(false);
    expect(canContainerHoldNode('azure', 'aws')).toBe(false);
    expect(canContainerHoldNode('aws', 'gcp')).toBe(false);
    expect(canContainerHoldNode('gcp', 'azure')).toBe(false);
  });

  it('refuses same-provider platform nesting too (AWS inside AWS)', () => {
    expect(canContainerHoldNode('aws', 'aws')).toBe(false);
  });

  it('holds even when the container is UNKNOWN to the registry (the permissive path)', () => {
    // Unregistered containers return true for everything — that fallback is exactly how
    // a platform could slip inside another. The invariant now runs BEFORE it.
    populateContainerTypes([]);
    expect(canContainerHoldNode('aws', 'azure')).toBe(false);
  });

  it('does NOT over-reach: a provider technology still nests under ITS platform', () => {
    // The real AKS drop passes the technology — that is what satisfies providers:['azure'].
    expect(canContainerHoldNode('azure', 'k8s-cluster', undefined, 'azure-kubernetes-service')).toBe(true);
    expect(canContainerHoldNode('aws', 'backend-service', undefined, 'aws-lambda')).toBe(true);
    expect(canContainerHoldNode('k8s-cluster', 'backend-service')).toBe(true);
  });

  it('THE REPORTED CASE: an azure node cannot live inside an AWS VPC (provider coherence)', () => {
    // Owner 2026-07-27: "azure nodes are still allowed as children within aws nodes like
    // AWS-VPC." The vpc ROLE's can_contain array lists k8s-cluster/backend-service with
    // no provider awareness — provider now comes from the NODES' technologies.
    expect(canContainerHoldNode('vpc', 'k8s-cluster', undefined, 'azure-kubernetes-service', 'aws-vpc')).toBe(false);
    expect(canContainerHoldNode('vpc', 'backend-service', undefined, 'azure-app-service', 'aws-vpc')).toBe(false);
    expect(canContainerHoldNode('vpc', 'database', undefined, 'gcp-cloud-sql', 'aws-vpc')).toBe(false);
    // …and the mirror direction.
    expect(canContainerHoldNode('vpc', 'backend-service', undefined, 'aws-lambda', 'azure-vnet')).toBe(false);
  });

  it('same-provider and provider-neutral containment still work', () => {
    expect(canContainerHoldNode('vpc', 'k8s-cluster', undefined, 'aws-eks', 'aws-vpc')).toBe(true);
    expect(canContainerHoldNode('vpc', 'backend-service', undefined, undefined, 'aws-vpc')).toBe(true);  // generic child
    expect(canContainerHoldNode('vpc', 'backend-service', undefined, 'express', 'aws-vpc')).toBe(true);  // non-provider tech
    expect(canContainerHoldNode('k8s-cluster', 'backend-service', undefined, 'azure-app-service')).toBe(true); // neutral container
  });

  it('documents the rule-object reality: a BARE generic role has no provider affinity', () => {
    // Not a platform-invariant refusal — the aws/azure rule objects simply enumerate
    // provider services, so a technology-less generic role matches nothing. The general
    // drop-path gate is deliberately NOT wired to this (it would refuse legitimate
    // generic drops); N8.2 owns that decision.
    expect(canContainerHoldNode('azure', 'k8s-cluster')).toBe(false);
  });
});
