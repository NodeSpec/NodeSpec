/**
 * Extended Database Technology Enrichment
 *
 * Provides enrichment for Redis, DynamoDB, CosmosDB, Firestore, Neo4j,
 * Elasticsearch, InfluxDB, and Cassandra with streamlined but comprehensive metadata.
 */

import type { DatabaseEnrichment } from './database-enrichment.js';

// ============================================
// REDIS ENRICHMENT
// ============================================
export const REDIS_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.redis',
  fileTypes: [
    {
      extension: '.conf',
      description: 'Redis configuration file',
      purpose: 'config',
      examples: ['redis.conf', '6379.conf'],
    },
    {
      extension: '.rdb',
      description: 'Redis snapshot file',
      purpose: 'backup',
      examples: ['dump.rdb', 'backup.rdb'],
    },
    {
      extension: '.aof',
      description: 'Redis Append Only File',
      purpose: 'backup',
      examples: ['appendonly.aof'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: 'ioredis', package: 'ioredis', description: 'Robust Redis client with cluster support', popularity: 'primary'},
        {name: 'node-redis', package: 'redis', description: 'Official Redis client for Node.js', popularity: 'primary'},
        {name: '@redis/client', package: '@redis/client', description: 'Modular Redis client', popularity: 'popular'},
      ],
      typicalUseCases: ['Caching layer', 'Session storage', 'Real-time leaderboards', 'Pub/sub messaging'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'redis-py', package: 'redis', description: 'Python interface to Redis', popularity: 'primary'},
        {name: 'aioredis', package: 'aioredis', description: 'Async Redis client', popularity: 'popular'},
        {name: 'walrus', package: 'walrus', description: 'Lightweight Python utilities for Redis', popularity: 'alternative'},
      ],
      typicalUseCases: ['Flask/Django caching', 'Celery broker', 'Rate limiting', 'Real-time analytics'],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {name: 'Jedis', package: 'redis.clients:jedis', description: 'Blazingly small and sane Redis client', popularity: 'primary'},
        {name: 'Lettuce', package: 'io.lettuce:lettuce-core', description: 'Advanced Redis client', popularity: 'primary'},
        {name: 'Redisson', package: 'org.redisson:redisson', description: 'Redis Java client with features', popularity: 'popular'},
      ],
      typicalUseCases: ['Spring Boot caching', 'Distributed locking', 'Session management'],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {name: 'go-redis', package: 'github.com/go-redis/redis/v9', description: 'Type-safe Redis client for Go', popularity: 'primary'},
        {name: 'redigo', package: 'github.com/gomodule/redigo', description: 'Go client for Redis', popularity: 'popular'},
      ],
      typicalUseCases: ['High-performance caching', 'Microservices communication', 'Rate limiting'],
    },
    {
      language: 'csharp',
      primary: true,
      clientLibraries: [
        {name: 'StackExchange.Redis', package: 'StackExchange.Redis', description: 'High performance Redis client', popularity: 'primary'},
      ],
      typicalUseCases: ['ASP.NET Core distributed cache', 'Session state', 'SignalR backplane'],
    },
    {
      language: 'php',
      primary: true,
      clientLibraries: [
        {name: 'Predis', package: 'predis/predis', description: 'Flexible Redis client library', popularity: 'primary'},
        {name: 'PhpRedis', package: 'ext-redis', description: 'PHP extension for Redis', popularity: 'primary'},
      ],
      typicalUseCases: ['Laravel cache', 'WordPress object cache', 'Session storage'],
    },
    {
      language: 'ruby',
      primary: true,
      clientLibraries: [
        {name: 'redis-rb', package: 'redis', description: 'Ruby client for Redis', popularity: 'primary'},
      ],
      typicalUseCases: ['Rails caching', 'Sidekiq job queue', 'ActionCable adapter'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'API server using Redis for caching and sessions',
      commonScenarios: ['Response caching', 'Session storage', 'Rate limiting', 'API key validation'],
      securityConsiderations: ['Enable AUTH', 'Use TLS for connections', 'Rename dangerous commands', 'Bind to specific interfaces'],
    },
    {
      sourceType: 'backend.nodejs',
      description: 'Backend service with Redis for distributed operations',
      commonScenarios: ['Distributed locking', 'Job queues', 'Pub/sub messaging', 'Real-time data'],
      securityConsiderations: ['Use connection pooling', 'Implement retry logic', 'Set appropriate TTLs', 'Monitor memory usage'],
    },
    {
      sourceType: 'cache.redis',
      description: 'Dedicated cache layer',
      commonScenarios: ['Cache-aside pattern', 'Write-through cache', 'Read-through cache', 'Cache warming'],
      securityConsiderations: ['Set maxmemory policy', 'Use keyspace notifications carefully', 'Implement cache stampede prevention'],
    },
  ],
  migrationStrategy: {
    tooling: ['redis-cli', 'redis-dump', 'Custom scripts', 'RIOT (Redis Input/Output Tools)'],
    filePattern: 'N/A (in-memory store)',
    bestPractices: [
      'Use SCAN instead of KEYS',
      'Set TTLs on all cache keys',
      'Use pipelining for bulk operations',
      'Monitor memory usage',
      'Use appropriate eviction policies',
      'Test failover scenarios',
    ],
    versioningStrategy: 'N/A - data structure versioning in application code',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'AWS',
        service: 'Amazon ElastiCache for Redis',
        advantages: ['Automated failover', 'Auto-scaling', 'Multi-AZ replication', 'Backup and restore'],
        considerations: ['Cannot access Redis instance directly', 'Limited configuration options', 'VPC required'],
      },
      {
        provider: 'Azure',
        service: 'Azure Cache for Redis',
        advantages: ['Enterprise tier with RediSearch/RedisJSON', 'Zone redundancy', 'Geo-replication', 'Azure Private Link'],
        considerations: ['Pricing tiers affect features', 'Connection limits vary by tier'],
      },
      {
        provider: 'GCP',
        service: 'Google Cloud Memorystore',
        advantages: ['High availability', 'Auto-failover', 'Import/export', 'VPC integration'],
        considerations: ['Limited to Google Cloud regions', 'Basic and Standard tiers'],
      },
      {
        provider: 'Redis',
        service: 'Redis Enterprise Cloud',
        advantages: ['Active-active geo-distribution', 'Auto-tiering', 'RedisJSON/RediSearch/etc', 'Multi-cloud'],
        considerations: ['Higher cost', 'Vendor-specific features'],
      },
      {
        provider: 'Upstash',
        service: 'Upstash Redis',
        advantages: ['Serverless pricing', 'REST API', 'Global replication', 'Free tier'],
        considerations: ['Per-request pricing model', 'Lower throughput than dedicated'],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: ['Optional persistence volume', 'redis.conf configuration', 'Health check setup'],
        scalingStrategy: 'Redis Sentinel for HA, Redis Cluster for horizontal scaling',
      },
      {
        platform: 'Kubernetes',
        requirements: ['StatefulSet or Deployment', 'ConfigMap for redis.conf', 'Optional PVC for persistence'],
        scalingStrategy: 'Redis Operator, Redis Enterprise Operator',
      },
      {
        platform: 'Bare Metal / VM',
        requirements: ['redis.conf tuning', 'Sufficient RAM', 'Persistence configuration', 'Replication setup'],
        scalingStrategy: 'Redis Sentinel for HA, Redis Cluster for sharding',
      },
    ],
    dockerImage: 'redis:7-alpine',
    kubernetesOperator: 'spotahome/redis-operator, RedisLabs/redis-enterprise-k8s-docs',
  },
  monitoringTools: ['redis-cli INFO', 'RedisInsight', 'Prometheus + redis_exporter', 'Datadog', 'New Relic'],
  backupStrategies: ['RDB snapshots', 'AOF (Append Only File)', 'Redis Enterprise active-passive', 'Managed service backups'],
  securityFeatures: ['AUTH password', 'ACL (Access Control Lists)', 'TLS/SSL', 'Protected mode', 'Command renaming'],
};

// ============================================
// DYNAMODB ENRICHMENT
// ============================================
export const DYNAMODB_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.dynamodb',
  fileTypes: [
    {
      extension: '.json',
      description: 'DynamoDB table schema and data export',
      purpose: 'schema',
      examples: ['table-schema.json', 'items-export.json'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: 'AWS SDK v3', package: '@aws-sdk/client-dynamodb', description: 'Official AWS SDK for JavaScript', popularity: 'primary'},
        {name: 'DynamoDB DocumentClient', package: '@aws-sdk/lib-dynamodb', description: 'Simplified DynamoDB interactions', popularity: 'primary'},
        {name: 'DynamoDB Toolbox', package: 'dynamodb-toolbox', description: 'Single-table design helper', popularity: 'popular'},
      ],
      typicalUseCases: ['Serverless applications', 'Single-table design', 'Event-driven architectures'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'Boto3', package: 'boto3', description: 'AWS SDK for Python', popularity: 'primary'},
        {name: 'PynamoDB', package: 'pynamodb', description: 'Pythonic interface to DynamoDB', popularity: 'popular'},
      ],
      typicalUseCases: ['Lambda functions', 'Data processing pipelines', 'Machine learning workflows'],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {name: 'AWS SDK for Java', package: 'software.amazon.awssdk:dynamodb', description: 'Official AWS SDK', popularity: 'primary'},
        {name: 'DynamoDB Enhanced Client', package: 'software.amazon.awssdk:dynamodb-enhanced', description: 'Higher-level DynamoDB client', popularity: 'primary'},
      ],
      typicalUseCases: ['Spring Boot applications', 'Enterprise serverless', 'Android backends'],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {name: 'AWS SDK for Go', package: 'github.com/aws/aws-sdk-go-v2/service/dynamodb', description: 'Official Go SDK', popularity: 'primary'},
      ],
      typicalUseCases: ['Lambda functions in Go', 'High-performance microservices'],
    },
    {
      language: 'csharp',
      primary: true,
      clientLibraries: [
        {name: 'AWSSDK.DynamoDBv2', package: 'AWSSDK.DynamoDBv2', description: 'AWS SDK for .NET', popularity: 'primary'},
      ],
      typicalUseCases: ['.NET Lambda functions', 'Azure-AWS hybrid architectures'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'API connecting to DynamoDB',
      commonScenarios: ['CRUD operations', 'Query with partition and sort keys', 'Batch operations', 'Conditional writes'],
      securityConsiderations: ['Use IAM roles', 'Implement least privilege access', 'Use VPC endpoints', 'Enable encryption at rest'],
    },
    {
      sourceType: 'runtime.lambda-function',
      description: 'Lambda function accessing DynamoDB',
      commonScenarios: ['Event-driven data processing', 'DynamoDB Streams processing', 'Serverless APIs', 'Real-time aggregation'],
      securityConsiderations: ['Use execution role', 'Enable DynamoDB Streams encryption', 'Implement exponential backoff'],
    },
  ],
  migrationStrategy: {
    tooling: ['AWS Data Pipeline', 'AWS DMS', 'EMR with Hive', 'Custom Lambda functions'],
    filePattern: 'N/A (managed service)',
    bestPractices: [
      'Design partition keys for even distribution',
      'Use sort keys for range queries',
      'Create GSIs strategically',
      'Use single-table design pattern',
      'Implement optimistic locking with version numbers',
      'Use batch operations when possible',
      'Monitor consumed capacity',
    ],
    versioningStrategy: 'Version fields in items',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'AWS',
        service: 'Amazon DynamoDB',
        advantages: ['Fully managed', 'Auto-scaling', 'Global tables', 'DynamoDB Streams', 'Point-in-time recovery'],
        considerations: ['AWS-specific', 'NoSQL limitations', 'Complex pricing model'],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: ['DynamoDB Local container', 'Testing only'],
        scalingStrategy: 'Not applicable (local testing only)',
      },
    ],
    dockerImage: 'amazon/dynamodb-local',
    kubernetesOperator: 'N/A (managed service only)',
  },
  monitoringTools: ['CloudWatch', 'X-Ray', 'DynamoDB Contributor Insights', 'AWS Cost Explorer'],
  backupStrategies: ['On-demand backups', 'Point-in-time recovery', 'AWS Backup', 'Export to S3'],
  securityFeatures: ['IAM policies', 'VPC endpoints', 'Encryption at rest', 'Encryption in transit', 'Fine-grained access control'],
};

// ============================================
// NEO4J ENRICHMENT
// ============================================
export const NEO4J_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.neo4j',
  fileTypes: [
    {
      extension: '.cypher',
      description: 'Cypher query files',
      purpose: 'query',
      examples: ['queries.cypher', 'schema.cypher', 'constraints.cypher'],
    },
    {
      extension: '.cql',
      description: 'Cypher Query Language scripts',
      purpose: 'migration',
      examples: ['V1__initial_schema.cql', 'migration.cql'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: 'neo4j-driver', package: 'neo4j-driver', description: 'Official Neo4j JavaScript driver', popularity: 'primary'},
        {name: 'neode', package: 'neode', description: 'Neo4j OGM for Node.js', popularity: 'popular'},
      ],
      typicalUseCases: ['Social networks', 'Recommendation engines', 'Knowledge graphs', 'Fraud detection'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'neo4j-python-driver', package: 'neo4j', description: 'Official Python driver', popularity: 'primary'},
        {name: 'py2neo', package: 'py2neo', description: 'Client library and toolkit', popularity: 'popular'},
        {name: 'neomodel', package: 'neomodel', description: 'OGM for Neo4j', popularity: 'popular'},
      ],
      typicalUseCases: ['Data science on graphs', 'Network analysis', 'AI/ML on relationships'],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {name: 'Neo4j Java Driver', package: 'org.neo4j.driver:neo4j-java-driver', description: 'Official driver', popularity: 'primary'},
        {name: 'Spring Data Neo4j', package: 'org.springframework.boot:spring-boot-starter-data-neo4j', description: 'Spring Data integration', popularity: 'primary'},
      ],
      typicalUseCases: ['Enterprise graph applications', 'Master data management'],
    },
    {
      language: 'go',
      primary: false,
      clientLibraries: [
        {name: 'neo4j-go-driver', package: 'github.com/neo4j/neo4j-go-driver/v5', description: 'Official Go driver', popularity: 'primary'},
      ],
      typicalUseCases: ['High-performance graph APIs'],
    },
    {
      language: 'csharp',
      primary: true,
      clientLibraries: [
        {name: 'Neo4j.Driver', package: 'Neo4j.Driver', description: 'Official .NET driver', popularity: 'primary'},
      ],
      typicalUseCases: ['.NET enterprise applications'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'API querying graph relationships',
      commonScenarios: ['Social graph queries', 'Path finding', 'Recommendation queries', 'Pattern matching'],
      securityConsiderations: ['Use parameterized queries', 'Enable authentication', 'Use role-based access control', 'Limit query complexity'],
    },
  ],
  migrationStrategy: {
    tooling: ['Liquigraph', 'neo4j-migrations', 'Custom Cypher scripts', 'APOC procedures'],
    filePattern: '{version}_{description}.cypher',
    bestPractices: [
      'Create constraints and indexes first',
      'Use MERGE for idempotent operations',
      'Batch large imports with APOC',
      'Use parameters for queries',
      'Profile queries with EXPLAIN/PROFILE',
      'Optimize relationship directions',
    ],
    versioningStrategy: 'Sequential versioning',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'Neo4j',
        service: 'Neo4j Aura',
        advantages: ['Fully managed', 'Auto-scaling', 'Automated backups', 'Free tier'],
        considerations: ['Vendor lock-in', 'Limited customization'],
      },
      {
        provider: 'AWS',
        service: 'Neo4j on AWS Marketplace',
        advantages: ['Full control', 'AWS integration'],
        considerations: ['Self-managed', 'Manual scaling'],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: ['Persistent volumes', 'neo4j.conf configuration', 'Memory tuning'],
        scalingStrategy: 'Causal clustering for HA',
      },
      {
        platform: 'Kubernetes',
        requirements: ['StatefulSet', 'Headless service', 'PersistentVolumeClaims'],
        scalingStrategy: 'Neo4j Kubernetes Operator',
      },
    ],
    dockerImage: 'neo4j:5',
    kubernetesOperator: 'neo4j/neo4j-k8s-operator',
  },
  monitoringTools: ['Neo4j Browser', 'Neo4j Bloom', 'Prometheus + neo4j-exporter', 'Halin'],
  backupStrategies: ['neo4j-admin backup', 'Aura automated backups', 'Filesystem snapshots'],
  securityFeatures: ['Built-in authentication', 'RBAC', 'SSL/TLS', 'LDAP integration', 'Query whitelisting'],
};

// ============================================
// ELASTICSEARCH ENRICHMENT
// ============================================
export const ELASTICSEARCH_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.elasticsearch',
  fileTypes: [
    {
      extension: '.json',
      description: 'Index mappings and settings',
      purpose: 'schema',
      examples: ['mappings.json', 'settings.json', 'index-template.json'],
    },
    {
      extension: '.ndjson',
      description: 'Bulk import data',
      purpose: 'seed',
      examples: ['bulk-data.ndjson', 'documents.ndjson'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: '@elastic/elasticsearch', package: '@elastic/elasticsearch', description: 'Official Elasticsearch client', popularity: 'primary'},
      ],
      typicalUseCases: ['Full-text search', 'Log analytics', 'Application search', 'Real-time dashboards'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'elasticsearch', package: 'elasticsearch', description: 'Official Python client', popularity: 'primary'},
        {name: 'elasticsearch-dsl', package: 'elasticsearch-dsl', description: 'High-level library', popularity: 'popular'},
      ],
      typicalUseCases: ['Log analysis', 'Data pipelines', 'ML on search data'],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {name: 'Elasticsearch Java Client', package: 'co.elastic.clients:elasticsearch-java', description: 'Official Java client', popularity: 'primary'},
        {name: 'Spring Data Elasticsearch', package: 'org.springframework.boot:spring-boot-starter-data-elasticsearch', description: 'Spring integration', popularity: 'popular'},
      ],
      typicalUseCases: ['Enterprise search', 'Spring Boot applications'],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {name: 'go-elasticsearch', package: 'github.com/elastic/go-elasticsearch/v8', description: 'Official Go client', popularity: 'primary'},
      ],
      typicalUseCases: ['High-throughput indexing', 'Log shipping'],
    },
    {
      language: 'php',
      primary: true,
      clientLibraries: [
        {name: 'elasticsearch-php', package: 'elasticsearch/elasticsearch', description: 'Official PHP client', popularity: 'primary'},
      ],
      typicalUseCases: ['Laravel Scout', 'E-commerce product search'],
    },
    {
      language: 'ruby',
      primary: true,
      clientLibraries: [
        {name: 'elasticsearch-ruby', package: 'elasticsearch', description: 'Official Ruby client', popularity: 'primary'},
      ],
      typicalUseCases: ['Rails search functionality'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'API with Elasticsearch for search',
      commonScenarios: ['Full-text search', 'Faceted search', 'Autocomplete', 'Aggregations'],
      securityConsiderations: ['Enable security features', 'Use API keys', 'Implement query sanitization', 'Rate limit search requests'],
    },
    {
      sourceType: 'backend.nodejs',
      description: 'Backend service indexing to Elasticsearch',
      commonScenarios: ['Log aggregation', 'Metrics collection', 'Document indexing', 'Change data capture'],
      securityConsiderations: ['Use bulk API', 'Implement retry logic', 'Monitor cluster health'],
    },
  ],
  migrationStrategy: {
    tooling: ['Reindex API', 'Elasticsearch-dump', 'Logstash', 'Custom scripts'],
    filePattern: 'N/A (schema in cluster state)',
    bestPractices: [
      'Define explicit mappings',
      'Use index templates',
      'Implement ILM policies',
      'Use aliases for zero-downtime reindexing',
      'Configure proper shard counts',
      'Use rollover for time-series data',
    ],
    versioningStrategy: 'Index aliases with versioned indices',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'Elastic',
        service: 'Elastic Cloud',
        advantages: ['Official managed service', 'Full Elastic Stack', 'Machine learning features', 'Support included'],
        considerations: ['Higher cost', 'Vendor lock-in'],
      },
      {
        provider: 'AWS',
        service: 'Amazon OpenSearch Service',
        advantages: ['AWS integration', 'Open-source OpenSearch', 'Automated snapshots'],
        considerations: ['Based on OpenSearch fork', 'Feature lag'],
      },
      {
        provider: 'Azure',
        service: 'Azure Managed Elasticsearch',
        advantages: ['Azure integration', 'Private endpoints'],
        considerations: ['Limited regions'],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: ['Persistent volumes', 'elasticsearch.yml', 'JVM heap settings', 'Memory limits'],
        scalingStrategy: 'Multi-node cluster',
      },
      {
        platform: 'Kubernetes',
        requirements: ['StatefulSet', 'PersistentVolumeClaims', 'Headless service', 'ConfigMaps'],
        scalingStrategy: 'ECK (Elastic Cloud on Kubernetes) Operator',
      },
    ],
    dockerImage: 'docker.elastic.co/elasticsearch/elasticsearch:8.11.0',
    kubernetesOperator: 'elastic/cloud-on-k8s',
  },
  monitoringTools: ['Kibana', 'Elastic Stack Monitoring', 'Prometheus + elasticsearch_exporter', 'Datadog', 'Grafana'],
  backupStrategies: ['Snapshot and Restore API', 'Elastic Cloud automated backups', 'Repository plugins (S3, Azure, GCS)'],
  securityFeatures: ['Built-in security (X-Pack)', 'Role-based access control', 'API keys', 'TLS/SSL', 'Field-level security', 'Document-level security'],
};

// ============================================
// INFLUXDB ENRICHMENT
// ============================================
export const INFLUXDB_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.influxdb',
  fileTypes: [
    {
      extension: '.flux',
      description: 'Flux query language scripts',
      purpose: 'query',
      examples: ['query.flux', 'dashboard.flux'],
    },
    {
      extension: '.influxql',
      description: 'InfluxQL query scripts',
      purpose: 'query',
      examples: ['continuous-query.influxql'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: '@influxdata/influxdb-client', package: '@influxdata/influxdb-client', description: 'Official Node.js client', popularity: 'primary'},
      ],
      typicalUseCases: ['IoT data collection', 'Application metrics', 'Real-time monitoring'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'influxdb-client', package: 'influxdb-client', description: 'Official Python client', popularity: 'primary'},
      ],
      typicalUseCases: ['Data science on time-series', 'Industrial automation', 'DevOps metrics'],
    },
    {
      language: 'java',
      primary: false,
      clientLibraries: [
        {name: 'influxdb-client-java', package: 'com.influxdb:influxdb-client-java', description: 'Official Java client', popularity: 'primary'},
      ],
      typicalUseCases: ['Enterprise monitoring systems'],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {name: 'influxdb-client-go', package: 'github.com/influxdata/influxdb-client-go/v2', description: 'Official Go client', popularity: 'primary'},
      ],
      typicalUseCases: ['High-performance data ingestion', 'Monitoring agents'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'backend.nodejs',
      description: 'Service writing metrics to InfluxDB',
      commonScenarios: ['Application metrics', 'System metrics', 'IoT sensor data', 'Business KPIs'],
      securityConsiderations: ['Use authentication tokens', 'Batch writes', 'Implement retention policies', 'Monitor cardinality'],
    },
  ],
  migrationStrategy: {
    tooling: ['influx CLI', 'Telegraf', 'Custom scripts'],
    filePattern: 'N/A (schemaless with tags/fields)',
    bestPractices: [
      'Design tag schema carefully',
      'Avoid high-cardinality tags',
      'Use appropriate retention policies',
      'Batch data points',
      'Use continuous queries for downsampling',
      'Monitor series cardinality',
    ],
    versioningStrategy: 'N/A - schema defined by data',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'InfluxData',
        service: 'InfluxDB Cloud',
        advantages: ['Fully managed', 'Serverless', 'Auto-scaling', 'Free tier'],
        considerations: ['Usage-based pricing', 'Query limits'],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: ['Persistent volume', 'influxdb.conf', 'Resource limits'],
        scalingStrategy: 'InfluxDB Enterprise for clustering',
      },
      {
        platform: 'Kubernetes',
        requirements: ['StatefulSet', 'PersistentVolumeClaim', 'ConfigMap'],
        scalingStrategy: 'InfluxDB Enterprise Operator',
      },
    ],
    dockerImage: 'influxdb:2.7',
    kubernetesOperator: 'influxdata/influxdb-operator (community)',
  },
  monitoringTools: ['InfluxDB UI', 'Chronograf', 'Grafana', 'Kapacitor for alerting'],
  backupStrategies: ['influx backup/restore', 'InfluxDB Cloud backups', 'Filesystem snapshots'],
  securityFeatures: ['Token-based authentication', 'Organizations and buckets', 'TLS/SSL', 'RBAC'],
};

// ============================================
// CASSANDRA ENRICHMENT
// ============================================
export const CASSANDRA_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.cassandra',
  fileTypes: [
    {
      extension: '.cql',
      description: 'CQL (Cassandra Query Language) scripts',
      purpose: 'migration',
      examples: ['V1__create_keyspace.cql', 'schema.cql', '001_tables.cql'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: false,
      clientLibraries: [
        {name: 'cassandra-driver', package: 'cassandra-driver', description: 'DataStax Node.js driver', popularity: 'primary'},
      ],
      typicalUseCases: ['Real-time analytics', 'Time-series data', 'Event logging'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'cassandra-driver', package: 'cassandra-driver', description: 'DataStax Python driver', popularity: 'primary'},
      ],
      typicalUseCases: ['Data pipelines', 'Analytics platforms', 'IoT backends'],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {name: 'DataStax Java Driver', package: 'com.datastax.oss:java-driver-core', description: 'Official Java driver', popularity: 'primary'},
        {name: 'Spring Data Cassandra', package: 'org.springframework.boot:spring-boot-starter-data-cassandra', description: 'Spring integration', popularity: 'popular'},
      ],
      typicalUseCases: ['Enterprise applications', 'Distributed systems', 'Big data processing'],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {name: 'gocql', package: 'github.com/gocql/gocql', description: 'Go driver for Cassandra', popularity: 'primary'},
      ],
      typicalUseCases: ['High-throughput services', 'Cloud-native applications'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'API with Cassandra for scalable data storage',
      commonScenarios: ['Write-heavy applications', 'Time-series data', 'User activity tracking', 'Sensor data'],
      securityConsiderations: ['Use prepared statements', 'Implement proper consistency levels', 'Enable authentication', 'Use TLS/SSL'],
    },
  ],
  migrationStrategy: {
    tooling: ['cqlsh', 'cassandra-migrate', 'Liquibase', 'Custom scripts'],
    filePattern: 'V{version}__{description}.cql',
    bestPractices: [
      'Design for query patterns',
      'Denormalize data',
      'Choose appropriate partition keys',
      'Use clustering columns for sorting',
      'Avoid large partitions',
      'Use appropriate consistency levels',
      'Test with production data volumes',
    ],
    versioningStrategy: 'Sequential versioning',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'DataStax',
        service: 'DataStax Astra DB',
        advantages: ['Serverless Cassandra', 'Global distribution', 'APIs included', 'Free tier'],
        considerations: ['Vendor-specific features', 'CQL compatibility'],
      },
      {
        provider: 'AWS',
        service: 'Amazon Keyspaces',
        advantages: ['Serverless', 'CQL compatible', 'AWS integration', 'No cluster management'],
        considerations: ['Not 100% Cassandra compatible', 'Feature limitations', 'Higher latency'],
      },
      {
        provider: 'Azure',
        service: 'Azure Cosmos DB (Cassandra API)',
        advantages: ['Global distribution', 'Multi-model', 'SLA guarantees'],
        considerations: ['CQL compatibility limitations', 'Different consistency model'],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: ['Persistent volumes', 'cassandra.yaml', 'JVM tuning', 'Multi-node setup'],
        scalingStrategy: 'Add nodes to cluster, replication factor tuning',
      },
      {
        platform: 'Kubernetes',
        requirements: ['StatefulSet', 'Headless service', 'PersistentVolumeClaims', 'Anti-affinity rules'],
        scalingStrategy: 'K8ssandra Operator, Cass Operator',
      },
    ],
    dockerImage: 'cassandra:4.1',
    kubernetesOperator: 'k8ssandra/k8ssandra-operator, datastax/cass-operator',
  },
  monitoringTools: ['nodetool', 'DataStax OpsCenter', 'Prometheus + cassandra_exporter', 'Grafana', 'Reaper for repairs'],
  backupStrategies: ['nodetool snapshot', 'Medusa', 'DataStax OpsCenter backups', 'Managed service backups'],
  securityFeatures: ['Authentication', 'Authorization', 'SSL/TLS', 'Encryption at rest', 'Audit logging (DSE)'],
};

// ============================================
// Additional databases (CosmosDB, Firestore) - Simplified enrichments
// ============================================
export const COSMOSDB_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.cosmosdb',
  fileTypes: [],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: '@azure/cosmos', package: '@azure/cosmos', description: 'Azure Cosmos DB SDK', popularity: 'primary'},
      ],
      typicalUseCases: ['Globally distributed applications', 'Multi-model data'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'azure-cosmos', package: 'azure-cosmos', description: 'Azure SDK for Python', popularity: 'primary'},
      ],
      typicalUseCases: ['Azure-native applications', 'Global data distribution'],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {name: 'azure-cosmos', package: 'com.azure:azure-cosmos', description: 'Azure SDK for Java', popularity: 'primary'},
      ],
      typicalUseCases: ['Enterprise Azure applications'],
    },
    {
      language: 'csharp',
      primary: true,
      clientLibraries: [
        {name: 'Microsoft.Azure.Cosmos', package: 'Microsoft.Azure.Cosmos', description: '.NET SDK', popularity: 'primary'},
      ],
      typicalUseCases: ['.NET on Azure', 'Enterprise applications'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'API using Cosmos DB',
      commonScenarios: ['Global data access', 'Multi-region writes', 'Low-latency reads'],
      securityConsiderations: ['Use Azure AD', 'Implement RU budgets', 'Enable private endpoints', 'Use managed identities'],
    },
  ],
  migrationStrategy: {
    tooling: ['Azure Data Factory', 'Azure Cosmos DB Data Migration Tool', 'Custom scripts'],
    filePattern: 'N/A (managed service)',
    bestPractices: ['Design partition keys carefully', 'Use appropriate consistency level', 'Optimize RU consumption', 'Use change feed'],
    versioningStrategy: 'Version fields in documents',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'Azure',
        service: 'Azure Cosmos DB',
        advantages: ['Multi-model support', 'Global distribution', 'Multiple APIs', 'SLA guarantees'],
        considerations: ['Complex pricing', 'RU planning required', 'Azure-specific'],
      },
    ],
    selfHostedOptions: [],
    dockerImage: 'mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator',
    kubernetesOperator: 'N/A',
  },
  monitoringTools: ['Azure Monitor', 'Cosmos DB Insights', 'Application Insights'],
  backupStrategies: ['Continuous backup', 'Periodic backup', 'Azure Backup'],
  securityFeatures: ['Azure AD integration', 'Private endpoints', 'Encryption', 'RBAC', 'Customer-managed keys'],
};

export const FIRESTORE_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.firestore',
  fileTypes: [
    {
      extension: '.rules',
      description: 'Firestore security rules',
      purpose: 'config',
      examples: ['firestore.rules', 'security.rules'],
    },
    {
      extension: '.indexes.json',
      description: 'Firestore index definitions',
      purpose: 'config',
      examples: ['firestore.indexes.json'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: 'Firebase Admin SDK', package: 'firebase-admin', description: 'Server-side Firebase SDK', popularity: 'primary'},
        {name: '@google-cloud/firestore', package: '@google-cloud/firestore', description: 'Google Cloud client', popularity: 'primary'},
      ],
      typicalUseCases: ['Mobile backends', 'Real-time web apps', 'Serverless applications'],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {name: 'firebase-admin', package: 'firebase-admin', description: 'Firebase Admin SDK', popularity: 'primary'},
        {name: 'google-cloud-firestore', package: 'google-cloud-firestore', description: 'GCP client library', popularity: 'primary'},
      ],
      typicalUseCases: ['Cloud Functions', 'Data processing', 'Backend services'],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {name: 'Firebase Admin SDK', package: 'com.google.firebase:firebase-admin', description: 'Server SDK', popularity: 'primary'},
      ],
      typicalUseCases: ['Android backends', 'Enterprise systems'],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {name: 'firebase-admin-go', package: 'firebase.google.com/go/v4', description: 'Go Admin SDK', popularity: 'primary'},
      ],
      typicalUseCases: ['Cloud Functions', 'Backend services'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'API with Firestore backend',
      commonScenarios: ['Mobile app backends', 'Real-time sync', 'Offline support', 'User data storage'],
      securityConsiderations: ['Implement security rules', 'Validate on server', 'Use service accounts', 'Limit query size'],
    },
    {
      sourceType: 'runtime.cloud-function',
      description: 'Cloud Function triggered by Firestore',
      commonScenarios: ['Data processing', 'Triggers on document changes', 'Aggregation', 'Notifications'],
      securityConsiderations: ['Use service accounts', 'Implement idempotent functions', 'Handle errors gracefully'],
    },
  ],
  migrationStrategy: {
    tooling: ['Firebase CLI', 'firestore-import-export', 'Custom scripts'],
    filePattern: 'N/A (document-based)',
    bestPractices: [
      'Design collection structure',
      'Use subcollections appropriately',
      'Create composite indexes',
      'Implement security rules',
      'Use batched writes',
      'Optimize for offline support',
    ],
    versioningStrategy: 'Schema evolution in documents',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'Google Cloud',
        service: 'Cloud Firestore',
        advantages: ['Real-time sync', 'Offline support', 'Auto-scaling', 'Firebase integration', 'Free tier'],
        considerations: ['Query limitations', 'Pricing based on operations', 'GCP lock-in'],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Emulator',
        requirements: ['Firebase Emulator Suite', 'Testing only'],
        scalingStrategy: 'N/A (emulator)',
      },
    ],
    dockerImage: 'N/A',
    kubernetesOperator: 'N/A',
  },
  monitoringTools: ['Firebase Console', 'Cloud Monitoring', 'Firebase Performance Monitoring'],
  backupStrategies: ['Scheduled exports to Cloud Storage', 'Managed export service', 'Third-party backup tools'],
  securityFeatures: ['Security rules', 'App Check', 'IAM', 'Private Google Access', 'VPC Service Controls'],
};

// ============================================
// SUPABASE DATABASE ENRICHMENT
// ============================================
const SUPABASE_DB_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.supabase',
  fileTypes: [
    {
      extension: '.sql',
      description: 'SQL migration files with schema changes and RLS policies',
      purpose: 'migration',
      examples: ['20240101_create_users.sql', '20240102_add_rls_policies.sql', 'seed.sql'],
    },
    {
      extension: '.toml',
      description: 'Supabase project configuration',
      purpose: 'config',
      examples: ['supabase/config.toml'],
    },
    {
      extension: '.ts',
      description: 'Edge Functions and generated types',
      purpose: 'query',
      examples: ['supabase/functions/hello/index.ts', 'src/types/database.types.ts'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {name: '@supabase/supabase-js', package: '@supabase/supabase-js', description: 'Official Supabase client with auth, realtime, and storage', popularity: 'primary'},
        {name: '@supabase/ssr', package: '@supabase/ssr', description: 'Server-side rendering helpers for Next.js, SvelteKit, Remix', popularity: 'primary'},
        {name: '@supabase/auth-helpers-react', package: '@supabase/auth-helpers-react', description: 'React hooks for Supabase Auth', popularity: 'alternative'},
      ],
      typicalUseCases: ['Full-stack web apps', 'Real-time dashboards', 'Mobile backends', 'SaaS applications'],
    },
    {
      language: 'python',
      primary: false,
      clientLibraries: [
        {name: 'supabase-py', package: 'supabase', description: 'Official Python client', popularity: 'primary'},
        {name: 'postgrest-py', package: 'postgrest', description: 'PostgREST Python client', popularity: 'alternative'},
      ],
      typicalUseCases: ['Data pipelines', 'Backend services', 'ML model serving'],
    },
    {
      language: 'dart',
      primary: false,
      clientLibraries: [
        {name: 'supabase-flutter', package: 'supabase_flutter', description: 'Flutter/Dart Supabase client', popularity: 'primary'},
      ],
      typicalUseCases: ['Flutter mobile apps', 'Cross-platform apps'],
    },
    {
      language: 'swift',
      primary: false,
      clientLibraries: [
        {name: 'supabase-swift', package: 'supabase-swift', description: 'Official Swift client', popularity: 'primary'},
      ],
      typicalUseCases: ['iOS apps', 'macOS apps'],
    },
    {
      language: 'kotlin',
      primary: false,
      clientLibraries: [
        {name: 'supabase-kt', package: 'io.github.jan-tennert.supabase', description: 'Kotlin Multiplatform client', popularity: 'primary'},
      ],
      typicalUseCases: ['Android apps', 'Kotlin backend services'],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'frontend-app',
      description: 'Frontend app with Supabase client',
      commonScenarios: ['CRUD via PostgREST auto-generated API', 'Real-time subscriptions', 'File uploads to Storage', 'Auth flows'],
      securityConsiderations: ['Always use anon key (not service_role) in client code', 'Enable RLS on all tables', 'Use auth.uid() in policies', 'Never expose service_role key'],
    },
    {
      sourceType: 'auth-provider',
      description: 'Supabase Auth (GoTrue) integration',
      commonScenarios: ['User authentication', 'RLS policy enforcement via auth.uid()', 'Custom claims via app_metadata', 'Auth hooks for provisioning'],
      securityConsiderations: ['Store authorization data in app_metadata not user_metadata', 'Use PKCE flow for SPAs', 'Enable email confirmation in production'],
    },
    {
      sourceType: 'serverless-function',
      description: 'Supabase Edge Functions accessing database',
      commonScenarios: ['Server-side business logic', 'External API proxying', 'Webhook handlers', 'Scheduled tasks via pg_cron'],
      securityConsiderations: ['Use service_role key only in Edge Functions', 'Validate auth tokens in function handlers', 'Use CORS headers on all responses'],
    },
  ],
  migrationStrategy: {
    tooling: ['Supabase CLI (supabase migration new/up)', 'supabase db diff', 'supabase gen types'],
    filePattern: 'supabase/migrations/YYYYMMDDHHMMSS_description.sql',
    bestPractices: [
      'Use IF NOT EXISTS and IF EXISTS for idempotent migrations',
      'Always enable RLS on new tables in the same migration',
      'Create RLS policies immediately after enabling RLS',
      'Generate TypeScript types after each migration (supabase gen types)',
      'Use seed.sql for development test data',
      'Never use DROP or destructive operations without safeguards',
      'Test migrations locally with supabase db reset before deploying',
    ],
    versioningStrategy: 'Timestamp-prefixed sequential migrations',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'Supabase',
        service: 'Supabase Platform',
        advantages: [
          'Integrated auth, realtime, storage, and edge functions',
          'Auto-generated REST and GraphQL APIs via PostgREST',
          'Built-in Row Level Security as authorization layer',
          'Real-time subscriptions via pg_notify',
          'Free tier with generous limits',
          'Dashboard with SQL editor and table viewer',
          'Automatic daily backups on Pro plan',
        ],
        considerations: [
          'Limited control over PostgreSQL configuration on lower tiers',
          'Edge Functions limited to Deno runtime',
          'Connection limits vary by plan',
          'Vendor-specific patterns (RLS, Edge Functions) may require migration effort',
        ],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker Compose',
        requirements: ['Docker', 'docker-compose', '2GB+ RAM'],
        scalingStrategy: 'Single node for development, Supabase Platform for production',
      },
      {
        platform: 'Kubernetes',
        requirements: ['Helm chart', 'Kubernetes cluster', 'Persistent volumes'],
        scalingStrategy: 'Horizontal scaling via read replicas and connection pooling',
      },
    ],
    dockerImage: 'supabase/postgres:15.6.1',
    kubernetesOperator: 'supabase-community/supabase-kubernetes',
  },
  monitoringTools: [
    'Supabase Dashboard (query performance, active connections)',
    'pg_stat_statements (query analysis)',
    'Supabase Log Explorer',
    'Prometheus + Grafana (self-hosted)',
    'Supabase Database Advisor',
  ],
  backupStrategies: [
    'Automatic daily backups (Pro plan and above)',
    'Point-in-time recovery (Pro plan)',
    'pg_dump for manual exports',
    'Logical replication to external systems',
  ],
  securityFeatures: [
    'Row Level Security (RLS) with auth.uid() and auth.jwt()',
    'SSL/TLS encryption in transit',
    'Encryption at rest (AES-256)',
    'Network restrictions (IP allowlisting)',
    'API key scoping (anon vs service_role)',
    'MFA for dashboard access',
    'Audit logging via pgAudit',
  ],
};

// Export all extended enrichments
export const EXTENDED_DATABASE_ENRICHMENTS: Record<string, DatabaseEnrichment> = {
  'database.redis': REDIS_ENRICHMENT,
  'database.dynamodb': DYNAMODB_ENRICHMENT,
  'database.neo4j': NEO4J_ENRICHMENT,
  'database.elasticsearch': ELASTICSEARCH_ENRICHMENT,
  'database.influxdb': INFLUXDB_ENRICHMENT,
  'database.cassandra': CASSANDRA_ENRICHMENT,
  'database.cosmosdb': COSMOSDB_ENRICHMENT,
  'database.firestore': FIRESTORE_ENRICHMENT,
  'database.supabase': SUPABASE_DB_ENRICHMENT,
};
