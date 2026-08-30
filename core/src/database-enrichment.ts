/**
 * Database Technology Enrichment
 *
 * Provides comprehensive technology-specific metadata for database nodes
 * including file types, language support, client libraries, and connection patterns.
 * This metadata assists AI in generating accurate, contextual recommendations.
 */

import type { ProgrammingLanguage } from './node-metadata.js';

export interface DatabaseFileType {
  extension: string;
  description: string;
  purpose: 'migration' | 'schema' | 'seed' | 'config' | 'query' | 'backup';
  examples: string[];
}

export interface DatabaseLanguageSupport {
  language: ProgrammingLanguage;
  primary: boolean;
  clientLibraries: {
    name: string;
    package: string;
    description: string;
    popularity: 'primary' | 'popular' | 'alternative';
  }[];
  typicalUseCases: string[];
  codeExample?: string;
}

export interface DatabaseConnectionPattern {
  sourceType: string;
  description: string;
  commonScenarios: string[];
  securityConsiderations: string[];
}

export interface DatabaseMigrationStrategy {
  tooling: string[];
  filePattern: string;
  bestPractices: string[];
  versioningStrategy: string;
}

export interface DatabaseDeploymentContext {
  managedServices: {
    provider: string;
    service: string;
    advantages: string[];
    considerations: string[];
  }[];
  selfHostedOptions: {
    platform: string;
    requirements: string[];
    scalingStrategy: string;
  }[];
  dockerImage?: string;
  kubernetesOperator?: string;
}

export interface DatabaseEnrichment {
  databaseId: string;
  fileTypes: DatabaseFileType[];
  languageSupport: DatabaseLanguageSupport[];
  connectionPatterns: DatabaseConnectionPattern[];
  migrationStrategy: DatabaseMigrationStrategy;
  deploymentContext: DatabaseDeploymentContext;
  monitoringTools: string[];
  backupStrategies: string[];
  securityFeatures: string[];
}

// ============================================
// POSTGRESQL ENRICHMENT
// ============================================
export const POSTGRESQL_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.postgresql',
  fileTypes: [
    {
      extension: '.sql',
      description: 'SQL migration and schema files',
      purpose: 'migration',
      examples: ['001_create_users.sql', 'V1__initial_schema.sql', '20240101_add_index.sql'],
    },
    {
      extension: '.psql',
      description: 'PostgreSQL-specific scripts with psql meta-commands',
      purpose: 'query',
      examples: ['backup.psql', 'batch_update.psql'],
    },
    {
      extension: '.conf',
      description: 'PostgreSQL configuration files',
      purpose: 'config',
      examples: ['postgresql.conf', 'pg_hba.conf', 'pg_ident.conf'],
    },
    {
      extension: '.dump',
      description: 'PostgreSQL database dumps',
      purpose: 'backup',
      examples: ['mydb_backup.dump', 'prod_20240101.dump'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {
          name: 'node-postgres',
          package: 'pg',
          description: 'Non-blocking PostgreSQL client for Node.js',
          popularity: 'primary',
        },
        {
          name: 'Prisma',
          package: '@prisma/client',
          description: 'Next-generation ORM with type-safe queries',
          popularity: 'primary',
        },
        {
          name: 'TypeORM',
          package: 'typeorm',
          description: 'ORM supporting Active Record and Data Mapper patterns',
          popularity: 'popular',
        },
        {
          name: 'Drizzle ORM',
          package: 'drizzle-orm',
          description: 'Lightweight TypeScript ORM',
          popularity: 'popular',
        },
        {
          name: 'Kysely',
          package: 'kysely',
          description: 'Type-safe SQL query builder',
          popularity: 'alternative',
        },
      ],
      typicalUseCases: [
        'Backend APIs with complex queries',
        'Multi-tenant SaaS applications',
        'Data-intensive web applications',
        'Microservices with transactional requirements',
      ],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {
          name: 'psycopg2',
          package: 'psycopg2-binary',
          description: 'Most popular PostgreSQL adapter for Python',
          popularity: 'primary',
        },
        {
          name: 'SQLAlchemy',
          package: 'sqlalchemy',
          description: 'SQL toolkit and ORM',
          popularity: 'primary',
        },
        {
          name: 'asyncpg',
          package: 'asyncpg',
          description: 'Fast PostgreSQL client for async Python',
          popularity: 'popular',
        },
        {
          name: 'Django ORM',
          package: 'django',
          description: 'Built-in ORM for Django framework',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Data science and analytics applications',
        'Django web applications',
        'FastAPI microservices',
        'Machine learning pipelines',
      ],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {
          name: 'JDBC Driver',
          package: 'org.postgresql:postgresql',
          description: 'Official PostgreSQL JDBC driver',
          popularity: 'primary',
        },
        {
          name: 'Hibernate',
          package: 'org.hibernate:hibernate-core',
          description: 'Full-featured ORM framework',
          popularity: 'primary',
        },
        {
          name: 'jOOQ',
          package: 'org.jooq:jooq',
          description: 'Type-safe SQL builder',
          popularity: 'popular',
        },
        {
          name: 'Spring Data JPA',
          package: 'org.springframework.boot:spring-boot-starter-data-jpa',
          description: 'Spring Data abstraction over JPA',
          popularity: 'primary',
        },
      ],
      typicalUseCases: [
        'Enterprise applications with Spring Boot',
        'Complex transactional systems',
        'Legacy system integration',
        'High-performance business applications',
      ],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {
          name: 'pgx',
          package: 'github.com/jackc/pgx/v5',
          description: 'Pure Go PostgreSQL driver with excellent performance',
          popularity: 'primary',
        },
        {
          name: 'lib/pq',
          package: 'github.com/lib/pq',
          description: 'Pure Go PostgreSQL driver for database/sql',
          popularity: 'popular',
        },
        {
          name: 'GORM',
          package: 'gorm.io/gorm',
          description: 'Developer-friendly ORM for Go',
          popularity: 'popular',
        },
        {
          name: 'sqlx',
          package: 'github.com/jmoiron/sqlx',
          description: 'Extensions to database/sql',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'High-performance microservices',
        'Cloud-native applications',
        'Real-time data processing',
        'System tools and utilities',
      ],
    },
    {
      language: 'csharp',
      primary: true,
      clientLibraries: [
        {
          name: 'Npgsql',
          package: 'Npgsql',
          description: '.NET data provider for PostgreSQL',
          popularity: 'primary',
        },
        {
          name: 'Entity Framework Core',
          package: 'Npgsql.EntityFrameworkCore.PostgreSQL',
          description: 'EF Core provider for PostgreSQL',
          popularity: 'primary',
        },
        {
          name: 'Dapper',
          package: 'Dapper',
          description: 'Micro-ORM for .NET',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'ASP.NET Core web applications',
        'Enterprise .NET systems',
        'Windows services with database access',
        'Cross-platform .NET applications',
      ],
    },
    {
      language: 'rust',
      primary: false,
      clientLibraries: [
        {
          name: 'tokio-postgres',
          package: 'tokio-postgres',
          description: 'Async PostgreSQL client for Tokio',
          popularity: 'primary',
        },
        {
          name: 'SQLx',
          package: 'sqlx',
          description: 'Async SQL toolkit with compile-time checked queries',
          popularity: 'popular',
        },
        {
          name: 'Diesel',
          package: 'diesel',
          description: 'Safe, extensible ORM and query builder',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Performance-critical backend services',
        'System programming with database needs',
        'WebAssembly applications',
      ],
    },
    {
      language: 'php',
      primary: true,
      clientLibraries: [
        {
          name: 'PDO PostgreSQL',
          package: 'ext-pdo_pgsql',
          description: 'PHP Data Objects extension for PostgreSQL',
          popularity: 'primary',
        },
        {
          name: 'Laravel Eloquent',
          package: 'laravel/framework',
          description: 'Laravel ORM with PostgreSQL support',
          popularity: 'primary',
        },
        {
          name: 'Doctrine',
          package: 'doctrine/orm',
          description: 'PHP ORM and database abstraction',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Laravel web applications',
        'WordPress with PostgreSQL',
        'Legacy PHP systems',
        'Content management systems',
      ],
    },
    {
      language: 'ruby',
      primary: true,
      clientLibraries: [
        {
          name: 'pg',
          package: 'pg',
          description: 'Ruby interface to PostgreSQL',
          popularity: 'primary',
        },
        {
          name: 'ActiveRecord',
          package: 'activerecord',
          description: 'Rails ORM with PostgreSQL adapter',
          popularity: 'primary',
        },
        {
          name: 'Sequel',
          package: 'sequel',
          description: 'Database toolkit for Ruby',
          popularity: 'alternative',
        },
      ],
      typicalUseCases: [
        'Ruby on Rails applications',
        'API-only Rails backends',
        'Legacy Ruby applications',
      ],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'Backend API connecting to PostgreSQL for data persistence',
      commonScenarios: [
        'CRUD operations for application entities',
        'Complex joins for reporting',
        'Transactional workflows',
        'Full-text search queries',
      ],
      securityConsiderations: [
        'Use connection pooling (PgBouncer)',
        'Implement prepared statements',
        'Enable SSL/TLS connections',
        'Use least-privilege database users',
        'Implement Row Level Security (RLS) for multi-tenancy',
      ],
    },
    {
      sourceType: 'web.graphql-api',
      description: 'GraphQL server querying PostgreSQL',
      commonScenarios: [
        'Resolving nested queries with joins',
        'N+1 query optimization with DataLoader',
        'Pagination with cursor-based pagination',
        'Real-time subscriptions with pg_notify',
      ],
      securityConsiderations: [
        'Implement query depth limiting',
        'Use parameterized queries',
        'Rate limit expensive queries',
        'Validate input at GraphQL layer',
      ],
    },
    {
      sourceType: 'backend.nodejs',
      description: 'General backend service with database access',
      commonScenarios: [
        'Data processing jobs',
        'Background task execution',
        'Scheduled data synchronization',
        'Event-driven data updates',
      ],
      securityConsiderations: [
        'Use service accounts with limited privileges',
        'Implement connection retry logic',
        'Handle connection pool exhaustion',
        'Use read replicas for read-heavy operations',
      ],
    },
    {
      sourceType: 'cache.redis',
      description: 'Redis caching layer in front of PostgreSQL',
      commonScenarios: [
        'Cache-aside pattern for frequently accessed data',
        'Session storage with PostgreSQL persistence',
        'Write-through caching for consistency',
        'Invalidation on database updates',
      ],
      securityConsiderations: [
        'Ensure cache and database consistency',
        'Implement cache stampede prevention',
        'Use proper TTL strategies',
      ],
    },
    {
      sourceType: 'queue.worker',
      description: 'Worker processing queue jobs with database updates',
      commonScenarios: [
        'Asynchronous data processing',
        'Bulk import operations',
        'Report generation',
        'Data transformation pipelines',
      ],
      securityConsiderations: [
        'Implement idempotent operations',
        'Use transactions for data consistency',
        'Handle partial failures gracefully',
      ],
    },
  ],
  migrationStrategy: {
    tooling: [
      'Flyway',
      'Liquibase',
      'Prisma Migrate',
      'TypeORM Migrations',
      'Alembic (Python)',
      'Rails Migrations (Ruby)',
      'Goose (Go)',
      'dbmate',
      'Atlas',
      'sqitch',
    ],
    filePattern: '{version}_{description}.sql or {timestamp}_{description}.sql',
    bestPractices: [
      'Always make migrations reversible when possible',
      'Use transactions for DDL operations',
      'Test migrations on production-like data',
      'Avoid blocking ALTER TABLE on large tables',
      'Use CREATE INDEX CONCURRENTLY for zero-downtime indexing',
      'Version control all migration files',
      'Include rollback procedures',
      'Document breaking changes',
      'Use descriptive migration names',
      'Keep migrations idempotent',
    ],
    versioningStrategy: 'Sequential versioning or timestamp-based',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'AWS',
        service: 'Amazon RDS for PostgreSQL',
        advantages: [
          'Automated backups and snapshots',
          'Multi-AZ deployments for high availability',
          'Automated patching',
          'Read replicas for scaling',
          'CloudWatch integration',
        ],
        considerations: [
          'Limited access to operating system',
          'Cannot install custom extensions',
          'Higher cost than self-hosted',
          'Vendor lock-in considerations',
        ],
      },
      {
        provider: 'AWS',
        service: 'Amazon Aurora PostgreSQL',
        advantages: [
          '5x performance improvement over standard PostgreSQL',
          'Storage auto-scaling',
          'Automatic failover (< 30 seconds)',
          'Up to 15 read replicas',
          'Backtrack to restore to any point in time',
        ],
        considerations: [
          'Higher cost than RDS',
          'PostgreSQL version lag behind community',
          'Some PostgreSQL extensions not supported',
        ],
      },
      {
        provider: 'Supabase',
        service: 'Supabase Database',
        advantages: [
          'Built-in authentication and authorization',
          'Real-time subscriptions via pg_notify',
          'Automatic REST API generation',
          'Row Level Security (RLS) support',
          'Free tier available',
        ],
        considerations: [
          'Limited control over database configuration',
          'Primarily designed for Supabase ecosystem',
          'Free tier has connection limits',
        ],
      },
      {
        provider: 'Azure',
        service: 'Azure Database for PostgreSQL',
        advantages: [
          'Flexible Server with zone redundancy',
          'Built-in PgBouncer',
          'Azure integration (AD, Key Vault)',
          'Automated backups up to 35 days',
        ],
        considerations: [
          'Pricing complexity',
          'Performance varies by tier',
          'Regional availability limits',
        ],
      },
      {
        provider: 'GCP',
        service: 'Cloud SQL for PostgreSQL',
        advantages: [
          'High availability with automatic failover',
          'Point-in-time recovery',
          'Integration with GCP services',
          'Automated replication',
        ],
        considerations: [
          'Connection limits based on machine type',
          'Cloud SQL Proxy required for secure connections',
          'Regional deployment only',
        ],
      },
      {
        provider: 'Heroku',
        service: 'Heroku Postgres',
        advantages: [
          'Zero-configuration setup',
          'Dataclips for sharing queries',
          'Rollback feature',
          'Easy Heroku integration',
        ],
        considerations: [
          'Expensive for production workloads',
          'Limited customization',
          'Connection limits on lower tiers',
        ],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: [
          'Persistent volume for data directory',
          'Environment variables for credentials',
          'Network configuration for client access',
          'Health checks configuration',
        ],
        scalingStrategy: 'Vertical scaling, manual replication setup',
      },
      {
        platform: 'Kubernetes',
        requirements: [
          'StatefulSet for stable network identity',
          'PersistentVolumeClaim for data storage',
          'ConfigMap for postgresql.conf',
          'Secrets for credentials',
          'Service for stable DNS',
        ],
        scalingStrategy: 'Use operators like Crunchy, Zalando, or CloudNativePG for HA',
      },
      {
        platform: 'Bare Metal / VM',
        requirements: [
          'Operating system tuning (kernel parameters)',
          'Dedicated storage with proper I/O',
          'Monitoring and alerting setup',
          'Backup automation',
          'Replication configuration',
        ],
        scalingStrategy: 'Streaming replication, logical replication, or Patroni for HA',
      },
    ],
    dockerImage: 'postgres:16-alpine',
    kubernetesOperator: 'zalando/postgres-operator, CrunchyData PGO, CloudNativePG',
  },
  monitoringTools: [
    'pgAdmin',
    'pg_stat_statements (built-in)',
    'pg_stat_activity (built-in)',
    'pgBadger',
    'Prometheus + postgres_exporter',
    'Datadog',
    'New Relic',
    'pganalyze',
    'pgwatch2',
    'pgDash',
  ],
  backupStrategies: [
    'pg_dump for logical backups',
    'pg_basebackup for physical backups',
    'Continuous archiving with WAL (Write-Ahead Log)',
    'Point-in-time recovery (PITR) setup',
    'Third-party tools: pgBackRest, Barman, WAL-G',
    'Cloud provider automated backups',
    'Snapshot-based backups for managed services',
  ],
  securityFeatures: [
    'Row Level Security (RLS)',
    'SSL/TLS encryption',
    'Role-based access control (RBAC)',
    'Column-level encryption with pgcrypto',
    'Audit logging with pgAudit extension',
    'pg_hba.conf for connection authentication',
    'Password policies',
    'Transparent Data Encryption (TDE) in enterprise versions',
  ],
};

// ============================================
// MYSQL ENRICHMENT
// ============================================
export const MYSQL_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.mysql',
  fileTypes: [
    {
      extension: '.sql',
      description: 'MySQL migration and schema files',
      purpose: 'migration',
      examples: ['V1__create_tables.sql', '001_add_indexes.sql', 'schema.sql'],
    },
    {
      extension: '.my.cnf',
      description: 'MySQL configuration file',
      purpose: 'config',
      examples: ['my.cnf', 'my.ini', '.my.cnf'],
    },
    {
      extension: '.ibd',
      description: 'InnoDB tablespace files',
      purpose: 'backup',
      examples: ['users.ibd', 'orders.ibd'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {
          name: 'mysql2',
          package: 'mysql2',
          description: 'Fast MySQL driver with promise support',
          popularity: 'primary',
        },
        {
          name: 'Prisma',
          package: '@prisma/client',
          description: 'Type-safe ORM with MySQL support',
          popularity: 'primary',
        },
        {
          name: 'TypeORM',
          package: 'typeorm',
          description: 'ORM supporting MySQL and MariaDB',
          popularity: 'popular',
        },
        {
          name: 'Sequelize',
          package: 'sequelize',
          description: 'Promise-based ORM',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Web applications with moderate complexity',
        'E-commerce platforms',
        'Content management systems',
        'Legacy system modernization',
      ],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {
          name: 'PyMySQL',
          package: 'pymysql',
          description: 'Pure Python MySQL client',
          popularity: 'primary',
        },
        {
          name: 'MySQL Connector/Python',
          package: 'mysql-connector-python',
          description: 'Official Oracle MySQL driver',
          popularity: 'primary',
        },
        {
          name: 'SQLAlchemy',
          package: 'sqlalchemy',
          description: 'SQL toolkit with MySQL support',
          popularity: 'primary',
        },
        {
          name: 'aiomysql',
          package: 'aiomysql',
          description: 'Async MySQL driver',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Data analysis and ETL',
        'Django applications',
        'Flask microservices',
        'Automation scripts',
      ],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {
          name: 'MySQL Connector/J',
          package: 'mysql:mysql-connector-java',
          description: 'Official MySQL JDBC driver',
          popularity: 'primary',
        },
        {
          name: 'Hibernate',
          package: 'org.hibernate:hibernate-core',
          description: 'JPA implementation with MySQL support',
          popularity: 'primary',
        },
        {
          name: 'MyBatis',
          package: 'org.mybatis:mybatis',
          description: 'SQL mapper framework',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Spring Boot applications',
        'Enterprise systems',
        'Android applications',
        'Legacy Java systems',
      ],
    },
    {
      language: 'php',
      primary: true,
      clientLibraries: [
        {
          name: 'MySQLi',
          package: 'ext-mysqli',
          description: 'MySQL improved extension',
          popularity: 'primary',
        },
        {
          name: 'PDO MySQL',
          package: 'ext-pdo_mysql',
          description: 'PHP Data Objects MySQL driver',
          popularity: 'primary',
        },
        {
          name: 'Laravel Eloquent',
          package: 'laravel/framework',
          description: 'Laravel ORM with MySQL',
          popularity: 'primary',
        },
      ],
      typicalUseCases: [
        'WordPress sites',
        'Laravel applications',
        'PHP e-commerce platforms',
        'Legacy LAMP stack applications',
      ],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {
          name: 'go-sql-driver/mysql',
          package: 'github.com/go-sql-driver/mysql',
          description: 'MySQL driver for Go database/sql',
          popularity: 'primary',
        },
        {
          name: 'GORM',
          package: 'gorm.io/driver/mysql',
          description: 'Go ORM with MySQL support',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Microservices backends',
        'API servers',
        'Cloud-native applications',
      ],
    },
    {
      language: 'csharp',
      primary: true,
      clientLibraries: [
        {
          name: 'MySql.Data',
          package: 'MySql.Data',
          description: 'Official MySQL ADO.NET driver',
          popularity: 'primary',
        },
        {
          name: 'Pomelo EF Core',
          package: 'Pomelo.EntityFrameworkCore.MySql',
          description: 'EF Core provider for MySQL',
          popularity: 'primary',
        },
      ],
      typicalUseCases: [
        'ASP.NET applications',
        '.NET enterprise systems',
      ],
    },
    {
      language: 'ruby',
      primary: true,
      clientLibraries: [
        {
          name: 'mysql2',
          package: 'mysql2',
          description: 'Modern MySQL library for Ruby',
          popularity: 'primary',
        },
        {
          name: 'ActiveRecord',
          package: 'activerecord',
          description: 'Rails ORM with MySQL adapter',
          popularity: 'primary',
        },
      ],
      typicalUseCases: [
        'Ruby on Rails applications',
        'Redmine',
        'Discourse',
      ],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'REST API with MySQL backend',
      commonScenarios: [
        'CRUD operations',
        'Join queries for related data',
        'Full-text search with FULLTEXT indexes',
        'Stored procedures for complex logic',
      ],
      securityConsiderations: [
        'Use prepared statements to prevent SQL injection',
        'Implement connection pooling',
        'Enable SSL connections',
        'Use least privilege MySQL users',
        'Limit max_connections appropriately',
      ],
    },
    {
      sourceType: 'backend.nodejs',
      description: 'Backend service accessing MySQL',
      commonScenarios: [
        'Batch data processing',
        'Reporting queries',
        'Data synchronization',
        'Background jobs',
      ],
      securityConsiderations: [
        'Use read-only connections for reports',
        'Implement query timeouts',
        'Use replication for read scaling',
      ],
    },
    {
      sourceType: 'frontend.wordpress',
      description: 'WordPress CMS with MySQL',
      commonScenarios: [
        'Content management',
        'User authentication',
        'Plugin data storage',
        'WooCommerce transactions',
      ],
      securityConsiderations: [
        'Use wp-config.php for credentials',
        'Enable query caching',
        'Regular database optimization',
        'Implement backup strategy',
      ],
    },
  ],
  migrationStrategy: {
    tooling: [
      'Flyway',
      'Liquibase',
      'Rails Migrations',
      'Laravel Migrations',
      'Prisma Migrate',
      'dbmate',
      'Alembic',
      'Goose',
    ],
    filePattern: 'V{version}__{description}.sql or {timestamp}_{description}.sql',
    bestPractices: [
      'Use InnoDB for ACID transactions',
      'Avoid ALTER TABLE on large tables during peak hours',
      'Use pt-online-schema-change for zero-downtime migrations',
      'Test migrations with production data size',
      'Keep migrations reversible',
      'Document data transformations',
      'Use transactions for data migrations',
    ],
    versioningStrategy: 'Sequential or timestamp-based versioning',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'AWS',
        service: 'Amazon RDS for MySQL',
        advantages: [
          'Automated backups',
          'Multi-AZ deployments',
          'Read replicas',
          'Automated patching',
        ],
        considerations: [
          'Limited MySQL configuration access',
          'Higher cost than self-hosted',
          'Cannot install custom plugins',
        ],
      },
      {
        provider: 'AWS',
        service: 'Amazon Aurora MySQL',
        advantages: [
          '5x performance vs MySQL',
          'Auto-scaling storage',
          'Fast failover',
          'Up to 15 read replicas',
        ],
        considerations: [
          'MySQL version compatibility',
          'Higher cost',
          'Some MySQL features not supported',
        ],
      },
      {
        provider: 'Azure',
        service: 'Azure Database for MySQL',
        advantages: [
          'Flexible Server with zone redundancy',
          'Built-in security',
          'Automated backups',
          'Azure integration',
        ],
        considerations: [
          'Regional availability',
          'Performance tier limitations',
        ],
      },
      {
        provider: 'GCP',
        service: 'Cloud SQL for MySQL',
        advantages: [
          'High availability',
          'Automatic replication',
          'GCP integration',
          'Point-in-time recovery',
        ],
        considerations: [
          'Connection limits',
          'Cloud SQL Proxy requirement',
        ],
      },
      {
        provider: 'PlanetScale',
        service: 'PlanetScale MySQL',
        advantages: [
          'Branching for databases',
          'Schema migrations without downtime',
          'Horizontal scaling with Vitess',
          'Generous free tier',
        ],
        considerations: [
          'No foreign key constraints',
          'Vitess-specific limitations',
          'Query compatibility considerations',
        ],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: [
          'Persistent volume for /var/lib/mysql',
          'Environment variables for root password',
          'my.cnf configuration mounting',
          'Health check configuration',
        ],
        scalingStrategy: 'Vertical scaling, manual replication',
      },
      {
        platform: 'Kubernetes',
        requirements: [
          'StatefulSet for MySQL',
          'PersistentVolumeClaim',
          'ConfigMap for my.cnf',
          'Secrets for passwords',
          'Headless service',
        ],
        scalingStrategy: 'Use operators like MySQL Operator, Vitess',
      },
      {
        platform: 'Bare Metal / VM',
        requirements: [
          'Proper storage I/O',
          'my.cnf tuning',
          'Monitoring setup',
          'Replication configuration',
          'Backup automation',
        ],
        scalingStrategy: 'Master-slave replication, ProxySQL for load balancing',
      },
    ],
    dockerImage: 'mysql:8.0',
    kubernetesOperator: 'mysql/mysql-operator, vitessio/vitess-operator',
  },
  monitoringTools: [
    'MySQL Workbench',
    'phpMyAdmin',
    'Percona Monitoring and Management (PMM)',
    'Prometheus + mysqld_exporter',
    'Datadog',
    'New Relic',
    'MySQL Enterprise Monitor',
    'pt-query-digest (Percona Toolkit)',
  ],
  backupStrategies: [
    'mysqldump for logical backups',
    'MySQL Enterprise Backup',
    'Percona XtraBackup for hot backups',
    'Binary log replication',
    'LVM snapshots',
    'Cloud provider automated backups',
    'mydumper/myloader for parallel backups',
  ],
  securityFeatures: [
    'User privilege management',
    'SSL/TLS encryption',
    'Password policies',
    'Audit logging with Enterprise Audit',
    'Data-at-rest encryption',
    'Firewall with MySQL Enterprise Firewall',
    'Role-based access control',
  ],
};

// ============================================
// MONGODB ENRICHMENT
// ============================================
export const MONGODB_ENRICHMENT: DatabaseEnrichment = {
  databaseId: 'database.mongodb',
  fileTypes: [
    {
      extension: '.json',
      description: 'MongoDB data exports and schemas',
      purpose: 'schema',
      examples: ['schema.json', 'seed-data.json', 'collection-export.json'],
    },
    {
      extension: '.js',
      description: 'MongoDB shell scripts and migrations',
      purpose: 'migration',
      examples: ['migration_001.js', 'seed.js', 'aggregation_pipeline.js'],
    },
    {
      extension: '.bson',
      description: 'Binary JSON backup files',
      purpose: 'backup',
      examples: ['users.bson', 'backup.bson'],
    },
  ],
  languageSupport: [
    {
      language: 'typescript',
      primary: true,
      clientLibraries: [
        {
          name: 'MongoDB Node Driver',
          package: 'mongodb',
          description: 'Official MongoDB driver for Node.js',
          popularity: 'primary',
        },
        {
          name: 'Mongoose',
          package: 'mongoose',
          description: 'Elegant MongoDB object modeling with schemas',
          popularity: 'primary',
        },
        {
          name: 'Prisma',
          package: '@prisma/client',
          description: 'Type-safe ORM with MongoDB support',
          popularity: 'popular',
        },
        {
          name: 'TypeORM',
          package: 'typeorm',
          description: 'ORM with MongoDB support',
          popularity: 'alternative',
        },
      ],
      typicalUseCases: [
        'Real-time applications',
        'Content management systems',
        'Catalog and inventory systems',
        'Event logging and analytics',
      ],
    },
    {
      language: 'python',
      primary: true,
      clientLibraries: [
        {
          name: 'PyMongo',
          package: 'pymongo',
          description: 'Official Python driver for MongoDB',
          popularity: 'primary',
        },
        {
          name: 'Motor',
          package: 'motor',
          description: 'Async Python driver for MongoDB',
          popularity: 'popular',
        },
        {
          name: 'MongoEngine',
          package: 'mongoengine',
          description: 'Python ODM for MongoDB',
          popularity: 'popular',
        },
        {
          name: 'Beanie',
          package: 'beanie',
          description: 'Async ODM based on Pydantic',
          popularity: 'alternative',
        },
      ],
      typicalUseCases: [
        'Data science and ML pipelines',
        'FastAPI backends',
        'Web scraping and ETL',
        'Analytics applications',
      ],
    },
    {
      language: 'java',
      primary: true,
      clientLibraries: [
        {
          name: 'MongoDB Java Driver',
          package: 'org.mongodb:mongodb-driver-sync',
          description: 'Official synchronous Java driver',
          popularity: 'primary',
        },
        {
          name: 'Spring Data MongoDB',
          package: 'org.springframework.boot:spring-boot-starter-data-mongodb',
          description: 'Spring Data repository abstraction',
          popularity: 'primary',
        },
        {
          name: 'Morphia',
          package: 'dev.morphia.morphia:morphia-core',
          description: 'Lightweight type-safe ODM',
          popularity: 'alternative',
        },
      ],
      typicalUseCases: [
        'Spring Boot microservices',
        'Enterprise applications',
        'Android backends',
        'Reactive applications',
      ],
    },
    {
      language: 'go',
      primary: true,
      clientLibraries: [
        {
          name: 'mongo-go-driver',
          package: 'go.mongodb.org/mongo-driver',
          description: 'Official MongoDB driver for Go',
          popularity: 'primary',
        },
        {
          name: 'mgo',
          package: 'gopkg.in/mgo.v2',
          description: 'Community driver (legacy)',
          popularity: 'alternative',
        },
      ],
      typicalUseCases: [
        'High-performance APIs',
        'Cloud-native microservices',
        'Real-time data processing',
      ],
    },
    {
      language: 'csharp',
      primary: true,
      clientLibraries: [
        {
          name: 'MongoDB.Driver',
          package: 'MongoDB.Driver',
          description: 'Official .NET driver',
          popularity: 'primary',
        },
        {
          name: 'MongoDB.Entities',
          package: 'MongoDB.Entities',
          description: 'Simplified data access library',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'ASP.NET Core applications',
        '.NET microservices',
        'Unity game backends',
      ],
    },
    {
      language: 'php',
      primary: true,
      clientLibraries: [
        {
          name: 'MongoDB PHP Library',
          package: 'mongodb/mongodb',
          description: 'High-level abstraction for PHP',
          popularity: 'primary',
        },
        {
          name: 'Laravel MongoDB',
          package: 'jenssegers/mongodb',
          description: 'Eloquent model and Query builder for MongoDB',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Laravel applications',
        'CMS systems',
        'PHP microservices',
      ],
    },
    {
      language: 'ruby',
      primary: false,
      clientLibraries: [
        {
          name: 'Mongoid',
          package: 'mongoid',
          description: 'ODM for MongoDB in Ruby',
          popularity: 'primary',
        },
        {
          name: 'Mongo Ruby Driver',
          package: 'mongo',
          description: 'Official Ruby driver',
          popularity: 'popular',
        },
      ],
      typicalUseCases: [
        'Rails applications',
        'Ruby microservices',
      ],
    },
  ],
  connectionPatterns: [
    {
      sourceType: 'web.rest-api',
      description: 'REST API with MongoDB backend',
      commonScenarios: [
        'CRUD operations with flexible schemas',
        'Document embedding for related data',
        'Aggregation pipelines for analytics',
        'Text search with $text indexes',
      ],
      securityConsiderations: [
        'Enable authentication',
        'Use parameterized queries to prevent NoSQL injection',
        'Implement connection pooling',
        'Enable SSL/TLS connections',
        'Use field-level encryption for sensitive data',
      ],
    },
    {
      sourceType: 'web.graphql-api',
      description: 'GraphQL with MongoDB',
      commonScenarios: [
        'Flexible schema aligns with GraphQL',
        'Denormalized data for efficient queries',
        'Real-time subscriptions with change streams',
        'Aggregation for complex queries',
      ],
      securityConsiderations: [
        'Validate input schemas',
        'Implement query depth limiting',
        'Use projection to limit returned fields',
        'Rate limit expensive operations',
      ],
    },
    {
      sourceType: 'backend.nodejs',
      description: 'Backend service with MongoDB',
      commonScenarios: [
        'Event sourcing',
        'Caching layer',
        'Session storage',
        'Activity logs',
      ],
      securityConsiderations: [
        'Use read concerns for consistency',
        'Implement write concerns for durability',
        'Monitor connection pool usage',
        'Use transactions for multi-document operations',
      ],
    },
    {
      sourceType: 'queue.worker',
      description: 'Queue worker processing MongoDB data',
      commonScenarios: [
        'Bulk data imports',
        'Data transformations',
        'Report generation',
        'Index building',
      ],
      securityConsiderations: [
        'Use bulk write operations',
        'Implement proper error handling',
        'Monitor memory usage for large operations',
        'Use cursor-based pagination',
      ],
    },
  ],
  migrationStrategy: {
    tooling: [
      'migrate-mongo',
      'mongodb-migrations',
      'Mongoose migrations',
      'mongosh (MongoDB Shell) scripts',
      'Flyway (with MongoDB support)',
    ],
    filePattern: '{timestamp}_{description}.js',
    bestPractices: [
      'Use explicit schema validation',
      'Version your document schemas',
      'Test migrations with production data volumes',
      'Use $rename for field renaming',
      'Create indexes in background',
      'Backup before major migrations',
      'Use bulkWrite for data transformations',
      'Document schema changes',
      'Keep migrations idempotent',
    ],
    versioningStrategy: 'Timestamp-based versioning',
  },
  deploymentContext: {
    managedServices: [
      {
        provider: 'MongoDB',
        service: 'MongoDB Atlas',
        advantages: [
          'Fully managed with auto-scaling',
          'Built-in backup and point-in-time recovery',
          'Multi-region clusters',
          'Atlas Search for full-text search',
          'Performance advisor',
          'Free tier available',
        ],
        considerations: [
          'Data transfer costs',
          'Egress charges',
          'Vendor lock-in',
        ],
      },
      {
        provider: 'AWS',
        service: 'Amazon DocumentDB',
        advantages: [
          'MongoDB-compatible API',
          'AWS integration',
          'Automated backups',
          'Auto-scaling storage',
        ],
        considerations: [
          'Not 100% MongoDB compatible',
          'Some features missing',
          'Aggregation pipeline limitations',
        ],
      },
      {
        provider: 'Azure',
        service: 'Azure Cosmos DB (MongoDB API)',
        advantages: [
          'Global distribution',
          'Multi-model support',
          'Azure integration',
          'Auto-indexing',
        ],
        considerations: [
          'MongoDB wire protocol compatibility',
          'RU-based pricing complexity',
          'Feature limitations',
        ],
      },
    ],
    selfHostedOptions: [
      {
        platform: 'Docker',
        requirements: [
          'Persistent volume for /data/db',
          'mongod.conf configuration',
          'Replica set configuration',
          'Authentication setup',
        ],
        scalingStrategy: 'Replica sets, sharding for horizontal scaling',
      },
      {
        platform: 'Kubernetes',
        requirements: [
          'StatefulSet for MongoDB',
          'PersistentVolumeClaims',
          'ConfigMap for configuration',
          'Headless service for replica set',
        ],
        scalingStrategy: 'MongoDB Community Operator, Percona Operator',
      },
      {
        platform: 'Bare Metal / VM',
        requirements: [
          'Sufficient RAM for working set',
          'Fast storage (SSD recommended)',
          'Replica set configuration',
          'Monitoring setup',
        ],
        scalingStrategy: 'Replica sets for HA, sharding for horizontal scaling',
      },
    ],
    dockerImage: 'mongo:7.0',
    kubernetesOperator: 'mongodb/mongodb-kubernetes-operator, percona/percona-server-mongodb-operator',
  },
  monitoringTools: [
    'MongoDB Compass',
    'MongoDB Atlas monitoring',
    'Ops Manager',
    'Prometheus + mongodb_exporter',
    'Datadog',
    'New Relic',
    'mongostat',
    'mongotop',
    'profiler (built-in)',
  ],
  backupStrategies: [
    'mongodump/mongorestore for logical backups',
    'MongoDB Atlas automated backups',
    'Filesystem snapshots (for replica sets)',
    'Ops Manager backup',
    'Continuous backup with oplog',
    'Point-in-time recovery',
    'Percona Backup for MongoDB',
  ],
  securityFeatures: [
    'Authentication (SCRAM, x.509, LDAP)',
    'Role-based access control (RBAC)',
    'SSL/TLS encryption',
    'Encryption at rest',
    'Field-level encryption',
    'Auditing',
    'Network isolation',
    'IP whitelisting',
  ],
};

// Import extended enrichments
import { EXTENDED_DATABASE_ENRICHMENTS } from './database-enrichment-extended.js';

// Export all enrichments as a map
export const DATABASE_ENRICHMENTS: Record<string, DatabaseEnrichment> = {
  'database.postgresql': POSTGRESQL_ENRICHMENT,
  'database.mysql': MYSQL_ENRICHMENT,
  'database.mongodb': MONGODB_ENRICHMENT,
  ...EXTENDED_DATABASE_ENRICHMENTS,
};

/**
 * Get enrichment data for a specific database type
 */
export function getDatabaseEnrichment(databaseId: string): DatabaseEnrichment | null {
  return DATABASE_ENRICHMENTS[databaseId] || null;
}

/**
 * Get all supported languages for a database
 */
export function getSupportedLanguages(databaseId: string): ProgrammingLanguage[] {
  const enrichment = getDatabaseEnrichment(databaseId);
  if (!enrichment) return [];
  return enrichment.languageSupport.map(ls => ls.language);
}

/**
 * Get primary languages for a database (most commonly used)
 */
export function getPrimaryLanguages(databaseId: string): ProgrammingLanguage[] {
  const enrichment = getDatabaseEnrichment(databaseId);
  if (!enrichment) return [];
  return enrichment.languageSupport
    .filter(ls => ls.primary)
    .map(ls => ls.language);
}

/**
 * Get client libraries for a specific database and language
 */
export function getClientLibraries(databaseId: string, language: ProgrammingLanguage) {
  const enrichment = getDatabaseEnrichment(databaseId);
  if (!enrichment) return [];

  const langSupport = enrichment.languageSupport.find(ls => ls.language === language);
  return langSupport?.clientLibraries || [];
}

/**
 * Get connection patterns for a specific source type
 */
export function getConnectionPatterns(databaseId: string, sourceType?: string) {
  const enrichment = getDatabaseEnrichment(databaseId);
  if (!enrichment) return [];

  if (sourceType) {
    return enrichment.connectionPatterns.filter(cp => cp.sourceType === sourceType);
  }

  return enrichment.connectionPatterns;
}
