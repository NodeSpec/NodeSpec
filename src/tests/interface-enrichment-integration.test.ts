import { describe, it, expect } from 'vitest';
import {
  getInterfaceEnrichment,
  getInterfaceClientLibraries,
  getSupportedInterfaceLanguages,
  INTERFACE_ENRICHMENTS,
} from '@nodespec/core/interface-enrichment.js';

describe('Interface Enrichment Integration', () => {
  it('should provide enrichment data for all interface types', () => {
    const interfaceTypes = [
      'web.rest-api',
      'web.graphql-api',
      'web.grpc-service',
      'gateway.aws-api-gateway',
      'web.websocket-server',
      'mesh.istio',
      'gateway.kong',
    ];

    for (const interfaceType of interfaceTypes) {
      const enrichment = getInterfaceEnrichment(interfaceType);
      expect(enrichment).toBeTruthy();
      expect(enrichment?.interfaceId).toBe(interfaceType);
      expect(enrichment?.fileTypes.length).toBeGreaterThan(0);
    }
  });

  it('should provide language-specific client libraries for REST API', () => {
    const languages = ['typescript', 'python', 'java', 'go'] as const;

    for (const lang of languages) {
      const restLibs = getInterfaceClientLibraries('web.rest-api', lang);
      expect(restLibs.length).toBeGreaterThan(0);

      const primaryLibs = restLibs.filter(lib => lib.popularity === 'primary');
      expect(primaryLibs.length).toBeGreaterThan(0);
    }
  });

  it('should provide authentication strategies for each interface', () => {
    const restEnrichment = getInterfaceEnrichment('web.rest-api');
    expect(restEnrichment?.authStrategies.length).toBeGreaterThan(0);

    const jwtAuth = restEnrichment?.authStrategies.find(auth => auth.name === 'JWT (JSON Web Tokens)');
    expect(jwtAuth).toBeTruthy();
    expect(jwtAuth?.complexity).toBe('moderate');
  });

  it('should provide configuration patterns', () => {
    const restEnrichment = getInterfaceEnrichment('web.rest-api');
    expect(restEnrichment?.configPatterns.length).toBeGreaterThan(0);

    const rateLimiting = restEnrichment?.configPatterns.find(p => p.name === 'Rate Limiting');
    expect(rateLimiting).toBeTruthy();
  });

  it('should provide security features with importance levels', () => {
    const restEnrichment = getInterfaceEnrichment('web.rest-api');
    expect(restEnrichment?.securityFeatures.length).toBeGreaterThan(0);

    const criticalFeatures = restEnrichment?.securityFeatures.filter(
      sf => sf.importance === 'critical'
    );
    expect(criticalFeatures).toBeTruthy();
    expect(criticalFeatures!.length).toBeGreaterThan(0);
  });

  it('should provide deployment options', () => {
    const restEnrichment = getInterfaceEnrichment('web.rest-api');
    expect(restEnrichment?.deploymentOptions.length).toBeGreaterThan(0);

    const awsOption = restEnrichment?.deploymentOptions.find(
      opt => opt.provider === 'AWS'
    );
    expect(awsOption).toBeTruthy();
    expect(awsOption?.advantages.length).toBeGreaterThan(0);
  });

  it('should provide monitoring and testing tools', () => {
    const restEnrichment = getInterfaceEnrichment('web.rest-api');
    expect(restEnrichment?.monitoringTools.length).toBeGreaterThan(0);
    expect(restEnrichment?.testingTools.length).toBeGreaterThan(0);
  });

  it('should provide performance tips', () => {
    const restEnrichment = getInterfaceEnrichment('web.rest-api');
    expect(restEnrichment?.performanceTips.length).toBeGreaterThan(0);
  });

  it('should categorize interfaces correctly', () => {
    const restEnrichment = getInterfaceEnrichment('web.rest-api');
    expect(restEnrichment?.category).toBe('api');

    const awsGatewayEnrichment = getInterfaceEnrichment('gateway.aws-api-gateway');
    expect(awsGatewayEnrichment?.category).toBe('gateway');

    const wsEnrichment = getInterfaceEnrichment('web.websocket-server');
    expect(wsEnrichment?.category).toBe('realtime');

    const istioEnrichment = getInterfaceEnrichment('mesh.istio');
    expect(istioEnrichment?.category).toBe('mesh');
  });

  it('should provide GraphQL-specific information', () => {
    const graphqlEnrichment = getInterfaceEnrichment('web.graphql-api');
    expect(graphqlEnrichment).toBeTruthy();

    // Should have .graphql file types
    const graphqlFileType = graphqlEnrichment?.fileTypes.find(
      ft => ft.extension === '.graphql/.gql'
    );
    expect(graphqlFileType).toBeTruthy();

    // Should have Apollo Client
    const tsLibs = getInterfaceClientLibraries('web.graphql-api', 'typescript');
    const apolloClient = tsLibs.find(lib => lib.name === 'Apollo Client');
    expect(apolloClient).toBeTruthy();
  });

  it('should provide gRPC-specific information', () => {
    const grpcEnrichment = getInterfaceEnrichment('web.grpc-service');
    expect(grpcEnrichment).toBeTruthy();

    // Should have .proto file types
    const protoFileType = grpcEnrichment?.fileTypes.find(
      ft => ft.extension === '.proto'
    );
    expect(protoFileType).toBeTruthy();

    // Should have mTLS auth strategy
    const mtlsAuth = grpcEnrichment?.authStrategies.find(
      auth => auth.name === 'mTLS'
    );
    expect(mtlsAuth).toBeTruthy();
  });

  it('should provide API Gateway-specific configurations', () => {
    const awsGatewayEnrichment = getInterfaceEnrichment('gateway.aws-api-gateway');
    expect(awsGatewayEnrichment).toBeTruthy();

    // Should have usage plans config
    const usagePlans = awsGatewayEnrichment?.configPatterns.find(
      p => p.name === 'Usage Plans'
    );
    expect(usagePlans).toBeTruthy();

    // Should have Lambda Authorizers auth
    const lambdaAuth = awsGatewayEnrichment?.authStrategies.find(
      auth => auth.name === 'Lambda Authorizers'
    );
    expect(lambdaAuth).toBeTruthy();
  });

  it('should provide WebSocket-specific information', () => {
    const wsEnrichment = getInterfaceEnrichment('web.websocket-server');
    expect(wsEnrichment).toBeTruthy();

    // Should have heartbeat config
    const heartbeat = wsEnrichment?.configPatterns.find(
      p => p.name === 'Heartbeat/Ping-Pong'
    );
    expect(heartbeat).toBeTruthy();

    // Should have Socket.IO client for TypeScript
    const tsLibs = getInterfaceClientLibraries('web.websocket-server', 'typescript');
    const socketIO = tsLibs.find(lib => lib.name === 'Socket.IO Client');
    expect(socketIO).toBeTruthy();
  });

  it('should provide Service Mesh-specific information', () => {
    const istioEnrichment = getInterfaceEnrichment('mesh.istio');
    expect(istioEnrichment).toBeTruthy();

    // Should have VirtualService config
    const virtualService = istioEnrichment?.fileTypes.find(
      ft => ft.description.includes('VirtualService')
    );
    expect(virtualService).toBeTruthy();

    // Should have mTLS auth
    const mtlsAuth = istioEnrichment?.authStrategies.find(
      auth => auth.name === 'mTLS (Mutual TLS)'
    );
    expect(mtlsAuth).toBeTruthy();

    // Should have Kiali monitoring
    expect(istioEnrichment?.monitoringTools).toContain('Kiali (service mesh observability)');
  });

  it('should get supported languages for interfaces', () => {
    const restLanguages = getSupportedInterfaceLanguages('web.rest-api');
    expect(restLanguages.length).toBeGreaterThan(0);
    expect(restLanguages).toContain('typescript');
    expect(restLanguages).toContain('python');
    expect(restLanguages).toContain('java');
    expect(restLanguages).toContain('go');
  });

  it('should have all enrichments in the global registry', () => {
    expect(Object.keys(INTERFACE_ENRICHMENTS).length).toBeGreaterThan(0);
    expect(INTERFACE_ENRICHMENTS['web.rest-api']).toBeTruthy();
    expect(INTERFACE_ENRICHMENTS['web.graphql-api']).toBeTruthy();
    expect(INTERFACE_ENRICHMENTS['web.grpc-service']).toBeTruthy();
  });
});
