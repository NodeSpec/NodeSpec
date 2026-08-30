// P0-3: schema fabrication -> "⚠ SCHEMA UNDEFINED".
//
// A contract with no schema/schemaRef used to get an invented payload shape
// ("Inferred Payload") — fabricated REST endpoints, event/message shapes, gRPC
// stubs — which agents then implemented against. Now it renders an explicit
// warning block naming the contract, and contracts WITH schemas are unchanged.
import { describe, expect, it } from 'vitest';
import {
  generateTaskDocument,
  type TaskDocumentInput,
} from '../../supabase/functions/_shared/task-document-generator.ts';

const catalogs: TaskDocumentInput['catalogs'] = {
  nodeRoles: {},
  technologies: {},
  deploymentTargets: {},
  cloudProviderPatterns: [],
  scopeArchetypes: {},
};

function docFor(contract: Record<string, unknown>): string {
  const graph = {
    nodes: {
      a: { id: 'a', label: 'Service A', type: 'backend-service' },
      b: { id: 'b', label: 'Service B', type: 'backend-service' },
    },
    edges: { e1: { id: 'e1', source: 'a', target: 'b', contractId: 'c1' } },
    contracts: { c1: contract as never },
    artifacts: {},
  };
  return generateTaskDocument({ node: graph.nodes.a, graph, catalogs, requirements: [] });
}

// Every distinct string inferPayloadShape used to fabricate, per interaction kind.
const FABRICATION_MARKERS = [
  'Inferred Payload',
  'Expected REST endpoints',
  'GET    /',
  'DELETE /',
  'Event payload shape',
  'eventType:',
  'Queue message shape',
  'jobId: string',
  'retryCount',
  'Data access pattern',
  'client SDK',
  'gRPC service definition',
  'rpc Method(Request)',
  'GraphQL schema expected',
  'type Mutation',
  'WebSocket message protocol',
  'channel: string',
];

describe('P0-3: schema-less contracts render ⚠ SCHEMA UNDEFINED, never invented shapes', () => {
  const schemalessKinds = [
    { kind: 'rest_api', interactionKind: 'rest_api' },
    { kind: 'custom', interactionKind: 'request_response' },
    { kind: 'event', interactionKind: 'pub_sub' },
    { kind: 'queue', interactionKind: 'async_job' },
    { kind: 'custom', interactionKind: 'data_read' },
    { kind: 'grpc', interactionKind: 'grpc' },
    { kind: 'graphql', interactionKind: 'graphql' },
    { kind: 'websocket', interactionKind: 'realtime' },
    { kind: 'sql', interactionKind: undefined }, // previously silent — now warned too
  ];

  for (const c of schemalessKinds) {
    it(`${c.kind}/${c.interactionKind ?? 'no interaction'}: warning block, zero fabricated content`, () => {
      const doc = docFor({ id: 'c1', name: 'User API', kind: c.kind, interactionKind: c.interactionKind });

      expect(doc).toContain('⚠ SCHEMA UNDEFINED');
      expect(doc).toContain('Contract "User API"');
      expect(doc).toContain('propose_patches');

      for (const marker of FABRICATION_MARKERS) {
        expect(doc, `fabrication marker leaked: ${marker}`).not.toContain(marker);
      }
    });
  }

  it('contract WITH inline schema renders the schema unchanged and no warning (golden)', () => {
    const schema = { type: 'object', properties: { taskId: { type: 'string' } } };
    const doc = docFor({ id: 'c1', name: 'User API', kind: 'rest_api', interactionKind: 'rest_api', schema });

    expect(doc).toContain('**Schema:**');
    expect(doc).toContain(JSON.stringify(schema, null, 2));
    expect(doc).not.toContain('SCHEMA UNDEFINED');
  });

  it('contract with schemaRef resolving to an artifact renders that content and no warning', () => {
    const graph = {
      nodes: {
        a: { id: 'a', label: 'Service A', type: 'backend-service' },
        b: { id: 'b', label: 'Service B', type: 'backend-service' },
      },
      edges: { e1: { id: 'e1', source: 'a', target: 'b', contractId: 'c1' } },
      contracts: {
        c1: { id: 'c1', name: 'User API', kind: 'rest_api', schemaRef: 'art1' } as never,
      },
      artifacts: {
        art1: {
          id: 'art1', nodeId: 'a', kind: 'schema', path: 'openapi.yaml',
          content: 'openapi: 3.0.0\npaths:\n  /users: {}',
        },
      },
    };
    const doc = generateTaskDocument({ node: graph.nodes.a, graph, catalogs, requirements: [] });

    expect(doc).toContain('openapi: 3.0.0');
    expect(doc).not.toContain('SCHEMA UNDEFINED');
  });

  it('empty-object schema counts as no schema (warning, not an empty schema block)', () => {
    const doc = docFor({ id: 'c1', name: 'User API', kind: 'rest_api', schema: {} });
    expect(doc).toContain('⚠ SCHEMA UNDEFINED');
    expect(doc).not.toContain('**Schema:**');
  });
});
