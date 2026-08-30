# NodeSpec Marketing Context & Template Generation Guide

**Version:** 1.3.0
**Product:** NodeSpec
**Last Updated:** 2026-05-17
**Purpose:** Reference document for AI-assisted template generation, blog articles, and marketing content

---

## Table of Contents

1. [Product Identity](#1-product-identity)
2. [Pricing & Plans](#2-pricing--plans)
3. [Core Concepts Glossary](#3-core-concepts-glossary)
4. [Technology Catalog Reference](#4-technology-catalog-reference)
5. [Container Type Reference](#5-container-type-reference)
6. [Graph Schema Reference](#6-graph-schema-reference)
7. [Template Generation Prompt](#7-template-generation-prompt)
8. [Blog Article Generation Prompt](#8-blog-article-generation-prompt)
9. [Template Examples & Patterns](#9-template-examples--patterns)
10. [Tone & Voice Guidelines](#10-tone--voice-guidelines)

---

## 1. Product Identity

**Product name:** NodeSpec
**Tagline:** Design. Specify. Build.
**Category:** Visual system architecture editor with AI-assisted design
**Target audience:** Software architects, senior engineers, product-minded developers, CTOs/VPEs, engineering leads
**Core value proposition:** NodeSpec turns system architecture from a whiteboard exercise into a living, version-controlled, AI-powered specification that stays in sync with what you actually build.

### What NodeSpec Does

- Provides a drag-and-drop visual canvas for designing system architectures using typed nodes and edges
- Tracks every architectural change as an immutable, auditable patch — like Git for architecture diagrams
- Supports branches so teams can explore parallel architectural directions without overwriting shared work
- Generates and manages software specifications (requirements, features, acceptance criteria, test cases) tied directly to architecture nodes
- Imports existing GitHub/GitLab repositories and reverse-engineers a visual architecture diagram using a 4-phase AI agent pipeline
- Generates code scaffolding, artifacts, and context-rich exports for AI coding agents (Cursor, Claude, Copilot)
- Offers a template marketplace for common architecture patterns (AWS full-stack, GCP cloud-native, Next.js + Supabase + Stripe SaaS, etc.)

### What NodeSpec Is Not

- Not a code editor or IDE
- Not a simple diagramming tool (Lucidchart, Miro) — everything is typed, versioned, and semantically meaningful
- Not a project management tool (Jira, Linear)
- Not a pure infrastructure-as-code tool (Terraform, Pulumi) — though it can export to those formats

---

## 2. Pricing & Plans

| Plan | Price | Token Limit | Key Capabilities |
|------|-------|-------------|------------------|
| **Free** | $0 | 600K (one-time trial) | 1 project, canvas access, BYOK or Platform AI |
| **Bring Your Own Key (BYOK)** | $15/mo ($12/mo annual) | None (use own API key) | Unlimited projects, full canvas, node/project export |
| **Architect** | $50/mo ($40/mo annual) | 25M tokens/month | Everything in BYOK + GitHub export, repo import & reverse architect, 1-month token rollover, additional token purchases ($12/1M) |
| **Pro** | $79/mo ($65/mo annual) | 35M tokens/month | Everything in Architect + Agent connectivity & MCP (coming soon) |
| **Enterprise** | Custom | Custom | Self-hosted or managed deployment, custom model API, data residency, SSO & team management, dedicated support |

**Key differentiator:** The Architect plan includes "repo import & reverse architect" — the ability to feed a GitHub repo URL and have NodeSpec automatically reverse-engineer the architecture into a visual diagram using a 4-phase AI agentic pipeline.

---

## 3. Core Concepts Glossary

These terms appear throughout templates, blog posts, and AI-generated content. Use them consistently.

| Term | Definition |
|------|-----------|
| **Node** | A single architectural component on the canvas. Has a typed `role` (e.g., `frontend-app`, `database`) from the `node_roles` table, a `technology` (e.g., `react`, `postgresql`), label, ports, metadata, and optional artifacts. |
| **Container** | A special node that visually and logically wraps other nodes. Represents infrastructure or logical groupings: VPC, Kubernetes cluster, Docker Compose stack, microservice boundary, etc. |
| **Edge** | A connection between two nodes. Always backed by a Contract. |
| **Contract** | Defines the communication protocol of an edge. `kind` is one of 12 canonical values: `rest`, `graphql`, `grpc`, `websocket`, `sse`, `kafka`, `amqp`, `sql`, `nosql`, `ipc`, `dependency`, `custom`. Additionally has an `interactionKind` (11 values) that controls the edge dash pattern. |
| **Port** | A named connection point on a node. Has a direction (`in` or `out`) and can be bound to a Contract. |
| **Artifact** | A file associated with a node. Has a kind: `source`, `schema`, `doc`, `config`, `build`, or `design`. Contains real file content. |
| **Patch** | An immutable, atomic change operation applied to a graph. The unit of version control. |
| **Branch** | A parallel version of a project graph, similar to a Git branch. Consists of a base snapshot + a sequence of patches. |
| **Graph** | The complete architectural model: all nodes, edges, contracts, artifacts, and node groups at a point in time. Always has a `schemaVersion` (currently `8`). |
| **Specification** | A structured requirements document attached to a project. Contains: vision, features, requirements, acceptance criteria, and test cases — all linked to architecture nodes. |
| **Template** | A pre-built architecture graph (nodes, edges, contracts, artifacts, and optionally a full specification) that users can apply to a new or existing project. |
| **Scope Archetype** | High-level classification of what a project is: `simple-web-app`, `cloud-native`, `desktop-app`, `mobile-app`, `iot-embedded`, `data-pipeline`, `enterprise-platform`. |
| **Architecture Pattern** | The structural style of a template: `monolith`, `microservices`, `serverless`, or `unknown` (custom). |
| **Entity Status** | Lifecycle state of any entity: `suggested` → `draft` → `complete`. |
| **Repo Import** | Feature that takes a GitHub/GitLab repository and uses a 4-phase AI pipeline (Discovery → Grouping → Relationships → Validation) to generate a visual architecture diagram. |
| **AI Agent** | A tool-calling LLM loop that performs multi-step architectural tasks: generation, specification writing, test case creation, code scaffolding, repo import. |
| **BYOK** | Bring Your Own Key — users can supply their own OpenAI, Anthropic, or other model API keys instead of consuming platform tokens. |

---

## 4. Technology Catalog Reference

This is the complete list of node type IDs available in NodeSpec. Every node in a template **must** use one of these IDs as its `type` field.

### Frontend

| ID | Label | Notes |
|----|-------|-------|
| `frontend.html-css` | HTML/CSS/JS | Static site, no framework |
| `frontend.react` | React App | SPA, SSR, SSG, PWA |
| `frontend.vue` | Vue.js App | Vue 3 with Composition API |
| `frontend.angular` | Angular App | Enterprise Angular |
| `frontend.svelte` | Svelte App | Svelte/SvelteKit |
| `frontend.solid` | SolidJS App | Fine-grained reactivity |
| `frontend.next` | Next.js App | App Router, RSC, SSR/SSG |
| `frontend.nuxt` | Nuxt App | Vue-based SSR/SSG |
| `frontend.astro` | Astro Site | Islands architecture |
| `frontend.blazor` | Blazor App | .NET WebAssembly/Server |
| `frontend.yew` | Yew App | Rust/WASM frontend |
| `frontend.dioxus` | Dioxus App | Rust cross-platform UI |

### Mobile

| ID | Label | Notes |
|----|-------|-------|
| `mobile.swift` | iOS (Swift) | Native iOS/macOS |
| `mobile.kotlin` | Android (Kotlin) | Native Android |
| `mobile.react-native` | React Native | Cross-platform mobile |
| `mobile.flutter` | Flutter | Dart cross-platform mobile |

### Backend / Runtime

| ID | Label | Notes |
|----|-------|-------|
| `backend.nodejs` | Node.js Service | Express, Fastify, NestJS, Hono |
| `backend.rust` | Rust Service | Axum, Actix |
| `backend.python` | Python Service | FastAPI, Django, Flask |
| `backend.go` | Go Service | Gin, Echo, Chi |

### Interfaces / APIs

| ID | Label | Notes |
|----|-------|-------|
| `web.rest-api` | REST API | HTTP REST |
| `web.graphql-api` | GraphQL API | Apollo, Hasura, Strawberry |
| `web.grpc-service` | gRPC Service | Protocol Buffers |
| `web.websocket-server` | WebSocket Server | Real-time bidirectional |

### API Gateways

| ID | Label | Notes |
|----|-------|-------|
| `gateway.aws-api-gateway` | AWS API Gateway | REST/HTTP/WebSocket APIs |
| `gateway.azure-api-management` | Azure API Management | Azure API gateway |
| `gateway.gcp-api-gateway` | GCP API Gateway | Google Cloud API gateway |
| `gateway.kong` | Kong Gateway | Open-source API gateway |

### Service Mesh

| ID | Label | Notes |
|----|-------|-------|
| `mesh.istio` | Istio | Service mesh for K8s |
| `mesh.linkerd` | Linkerd | Lightweight service mesh |
| `mesh.consul` | Consul | Multi-platform service mesh |

### Databases

| ID | Label | Notes |
|----|-------|-------|
| `database.postgresql` | PostgreSQL | Relational SQL |
| `database.supabase` | Supabase Postgres | Postgres with RLS + Realtime |
| `database.mysql` | MySQL | Relational SQL |
| `database.mongodb` | MongoDB | Document database |
| `database.redis` | Redis (DB) | In-memory data store |
| `database.dynamodb` | AWS DynamoDB | Managed NoSQL |
| `database.cosmosdb` | Azure Cosmos DB | Multi-model distributed DB |
| `database.firestore` | Firestore | GCP NoSQL document store |
| `database.neo4j` | Neo4j | Graph database |
| `database.elasticsearch` | Elasticsearch | Search + analytics engine |
| `database.influxdb` | InfluxDB | Time-series database |
| `database.cassandra` | Apache Cassandra | Wide-column distributed DB |
| `database.rds` | AWS RDS | Managed relational DB |
| `database.aurora` | AWS Aurora | High-performance managed DB |

### Cache

| ID | Label | Notes |
|----|-------|-------|
| `cache.redis` | Redis Cache | In-memory caching |
| `cache.memcached` | Memcached | Simple distributed cache |
| `cache.valkey` | Valkey | Open-source Redis fork |
| `cache.elasticache` | AWS ElastiCache | Managed Redis/Memcached |
| `cache.cloudflare-kv` | Cloudflare KV | Edge key-value store |

### Data / Analytics

| ID | Label | Notes |
|----|-------|-------|
| `data.etl-pipeline` | ETL Pipeline | Extract, Transform, Load |
| `data.data-warehouse` | Data Warehouse | Analytical data storage |
| `data.stream-processor` | Stream Processor | Real-time data processing |
| `data.bi-tool` | BI Tool | Business intelligence |
| `data.apache-kafka` | Apache Kafka | Distributed event streaming |
| `data.apache-spark` | Apache Spark | Large-scale data processing |
| `data.apache-airflow` | Apache Airflow | Workflow orchestration |
| `data.dbt` | dbt | Analytics engineering |

### Messaging

| ID | Label | Notes |
|----|-------|-------|
| `messaging.rabbitmq` | RabbitMQ | Message broker (AMQP) |
| `messaging.nats` | NATS | Lightweight messaging |
| `messaging.sqs` | AWS SQS | Managed message queue |

### Serverless Compute

| ID | Label | Notes |
|----|-------|-------|
| `cloud.compute.lambda` | AWS Lambda | Event-driven functions |
| `cloud.compute.azure-functions` | Azure Functions | Serverless on Azure |
| `cloud.compute.cloud-functions` | GCP Cloud Functions | Serverless on GCP |
| `cloud.compute.cloudflare-workers` | Cloudflare Workers | Edge compute |

### Object Storage

| ID | Label | Notes |
|----|-------|-------|
| `cloud.storage.s3` | AWS S3 | Object storage |
| `cloud.storage.azure-blob` | Azure Blob Storage | Object storage on Azure |
| `cloud.storage.gcs` | GCP Cloud Storage | Object storage on GCP |
| `cloud.storage.minio` | MinIO | Self-hosted S3-compatible |
| `supabase.storage` | Supabase Storage | S3-compatible object storage with RLS; use inside Supabase platform container |

### Networking

| ID | Label | Notes |
|----|-------|-------|
| `network.firewall` | Firewall | Network security |
| `network.vpn` | VPN | Private network tunnel |

### Load Balancers

| ID | Label | Notes |
|----|-------|-------|
| `lb.aws-alb` | AWS ALB | Application Load Balancer |
| `lb.aws-nlb` | AWS NLB | Network Load Balancer |
| `lb.azure-load-balancer` | Azure Load Balancer | L4 load balancer |
| `lb.azure-app-gateway` | Azure App Gateway | L7 load balancer / WAF |
| `lb.gcp-load-balancer` | GCP Load Balancer | Global HTTP(S) LB |
| `lb.nginx` | NGINX | Reverse proxy / LB |
| `lb.haproxy` | HAProxy | High-availability proxy |

### CDN

| ID | Label | Notes |
|----|-------|-------|
| `cloud.cdn.cloudfront` | AWS CloudFront | CDN + edge |
| `web.cdn` | Generic CDN | Provider-agnostic CDN node |

### Auth

| ID | Label | Notes |
|----|-------|-------|
| `auth.supabase-auth` | Supabase Auth | Email + OAuth, JWT |
| `auth.auth0` | Auth0 | Universal identity platform |
| `auth.aws-cognito` | AWS Cognito | Managed user pools |
| `auth.keycloak` | Keycloak | Self-hosted identity |
| `auth.firebase-auth` | Firebase Auth | Google Firebase auth |
| `auth.azure-ad-b2c` | Azure AD B2C | Microsoft identity |

### CI/CD

| ID | Label | Notes |
|----|-------|-------|
| `cicd.github-actions` | GitHub Actions | CI/CD workflows |
| `cicd.gitlab-ci` | GitLab CI | GitLab-native pipelines |
| `cicd.jenkins` | Jenkins | Self-hosted CI/CD |
| `cicd.argocd` | ArgoCD | GitOps for Kubernetes |
| `cicd.circleci` | CircleCI | Cloud CI/CD |

### Observability

| ID | Label | Notes |
|----|-------|-------|
| `observability.prometheus` | Prometheus | Metrics collection |
| `observability.grafana` | Grafana | Dashboards + alerting |
| `observability.datadog` | Datadog | APM + observability |
| `observability.sentry` | Sentry | Error tracking |
| `observability.elk-stack` | ELK Stack | Elasticsearch + Logstash + Kibana |
| `observability.opentelemetry` | OpenTelemetry | Vendor-neutral observability |

### Distribution (Desktop)

| ID | Label | Notes |
|----|-------|-------|
| `distribution.windows-installer` | Windows Installer | NSIS / WiX / MSI |
| `distribution.macos-package` | macOS Package | DMG / pkg / notarized |
| `distribution.linux-package` | Linux Package | .deb / .rpm / AppImage |

### AI / ML

| ID | Label | Notes |
|----|-------|-------|
| `ai.openai-api` | OpenAI API | GPT-4, DALL-E, Embeddings |
| `ai.anthropic-claude` | Anthropic Claude | Claude 3.x models |
| `ai.aws-sagemaker` | AWS SageMaker | ML training + inference |
| `ai.langchain` | LangChain | LLM application framework |
| `ai.agent` | AI Agent | Autonomous agent system |
| `ai.rag-pipeline` | RAG Pipeline | Retrieval-Augmented Generation |
| `vectordb.pinecone` | Pinecone | Managed vector database |
| `vectordb.weaviate` | Weaviate | Open-source vector database |
| `mlops.pipeline` | MLOps Pipeline | ML workflow automation |
| `mlops.model-registry` | Model Registry | Versioned model storage |
| `mlops.feature-store` | Feature Store | ML feature management |
| `mlops.model-serving` | Model Serving | Inference serving layer |

### External

| ID | Label | Notes |
|----|-------|-------|
| `external.service` | External Service | Third-party API / SaaS |
| `external.webhook` | Webhook Receiver | Inbound webhook handler |

### Logical

| ID | Label | Notes |
|----|-------|-------|
| `logical.application-module` | Application Module | Logical code module |
| `logical.software-layer` | Software Layer | Architectural layer (MVC, Clean) |
| `logical.component-library` | Component Library | Shared UI components |

### Infrastructure (Virtual)

| ID | Label | Notes |
|----|-------|-------|
| `infrastructure.vpc` | VPC | AWS Virtual Private Cloud |
| `infrastructure.azure-vnet` | Azure VNet | Azure Virtual Network |
| `infrastructure.gcp-vpc` | GCP VPC | GCP Virtual Private Cloud |
| `infrastructure.vmware-vsphere` | VMware vSphere | VMware virtualization |
| `infrastructure.hyper-v` | Hyper-V | Microsoft virtualization |
| `infrastructure.proxmox` | Proxmox | Open-source virtualization |
| `infrastructure.virtual-machine` | Virtual Machine | Generic VM |

### Orchestration

| ID | Label | Notes |
|----|-------|-------|
| `orchestration.kubernetes-cluster` | Kubernetes Cluster | K8s cluster |
| `orchestration.kubernetes-namespace` | K8s Namespace | Namespace within cluster |
| `orchestration.docker-compose` | Docker Compose | Multi-container local/prod |
| `orchestration.docker-swarm` | Docker Swarm | Docker clustering |
| `orchestration.nomad` | HashiCorp Nomad | Workload orchestrator |
| `orchestration.openshift` | OpenShift | Red Hat K8s platform |
| `orchestration.ecs` | AWS ECS | Elastic Container Service |

---

## 5. Container Type Reference

Containers are nodes that visually and logically wrap other nodes. Every container has a `layer` and a `canContain` list that restricts which role types may be nested inside it.

### Infrastructure Layer (hosting)

| ID | Label | Can Contain (key roles) |
|----|-------|------------------------|
| `vpc` | VPC / Virtual Network | subnet, k8s-cluster, docker-compose, ecs-cluster, serverless-function, rest-api, database, cache, load-balancer, api-gateway, message-broker, ai-service, object-storage |
| `subnet` | Subnet | k8s-cluster, docker-container, serverless-function, backend-service, database, cache, load-balancer |
| `cloud-project` | Cloud Project / Account | Everything — vpc, subnet, k8s-cluster, docker-compose, serverless-function, virtual-machine, database, frontend-app, mobile-app, cdn, external-service, object-storage, and more |
| `hypervisor` | Hypervisor Cluster | virtual-machine, vpc, k8s-cluster, docker-compose, backend-service, database |
| `virtual-machine` | Virtual Machine | k8s-cluster, docker-compose, docker-container, rest-api, backend-service, database, cache |
| `embedded-system` | Embedded System | backend-service, rest-api, worker, frontend-app, database |

### Orchestration Layer (hosting)

| ID | Label | Can Contain (key roles) |
|----|-------|------------------------|
| `k8s-cluster` | Kubernetes Cluster | k8s-namespace, docker-container, serverless-function, backend-service, database, cache, message-broker, monitoring, rest-api, graphql-api, ai-service |
| `k8s-namespace` | Kubernetes Namespace | docker-container, backend-service, database, cache, message-broker, monitoring, rest-api, ai-service |
| `docker-compose` | Docker Compose Stack | docker-container, backend-service, database, cache, message-broker, frontend-app, rest-api, monitoring, ai-service |
| `docker-swarm` | Docker Swarm | docker-container, rest-api, backend-service, database, cache, ai-service |
| `ecs-cluster` | ECS Cluster | backend-service, database, cache, rest-api, monitoring, ai-service |

### Runtime Layer (hosting)

| ID | Label | Can Contain (key roles) |
|----|-------|------------------------|
| `docker-container` | Docker Container | backend-service, frontend-app, worker, database, cache, ai-service |
| `serverless-function` | Serverless Function | backend-service, rest-api, worker |
| `desktop-app` | Desktop Application | frontend-app, static-site, backend-service, rest-api, database, cache, worker |
| `mobile-device` | Mobile Device | mobile-app, frontend-app, database, cache, backend-service, rest-api, ai-service |

### Logical Layer (logical-boundary)

| ID | Label | Can Contain (key roles) |
|----|-------|------------------------|
| `microservice-boundary` | Microservice Boundary | rest-api, graphql-api, grpc-service, backend-service, worker, database, cache, message-broker, monitoring |
| `bounded-context` | Bounded Context (DDD) | microservice-boundary, rest-api, backend-service, database, cache, message-broker, event-stream |
| `service-mesh` | Service Mesh | rest-api, graphql-api, grpc-service, websocket-server, backend-service, worker |
| `application-module` | Application Module | software-layer, rest-api, backend-service, worker, database, cache, frontend-app, message-broker, monitoring |
| `software-layer` | Software Layer | rest-api, graphql-api, backend-service, worker, database, cache, frontend-app |

---

## 6. Graph Schema Reference

Every template's `graph_data` must conform to the following structure. This is the authoritative schema used by NodeSpec's Zod validator.

### Top-Level Graph Object

```json
{
  "id": "<uuid>",
  "schemaVersion": 8,
  "version": 0,
  "hash": "<descriptive-slug-or-uuid>",
  "nodes": { "<node-uuid>": <NodeObject>, ... },
  "edges": { "<edge-uuid>": <EdgeObject>, ... },
  "contracts": { "<contract-uuid>": <ContractObject>, ... },
  "artifacts": { "<artifact-uuid>": <ArtifactObject>, ... },
  "nodeGroups": { "<group-uuid>": <NodeGroupObject>, ... }
}
```

### Node Object

```json
{
  "id": "<uuid>",
  "type": "<node-type-id>",
  "label": "Human-readable name",
  "technology": "<optional tech slug>",
  "ports": [<PortObject>, ...],
  "artifacts": ["<artifact-uuid>", ...],
  "metadata": {
    "position": { "x": 0, "y": 0 },
    "description": "What this node does",
    "parentId": "<optional container node uuid>"
  },
  "status": "complete"
}
```

**Required fields:** `id`, `type`, `label`
**Status values:** `suggested` | `draft` | `complete`
**Type:** Must be a valid ID from Section 4 (node types) or a valid container ID from Section 5

### Port Object

```json
{
  "id": "<uuid>",
  "name": "Port Label",
  "direction": "in" | "out",
  "contractId": "<optional contract uuid>",
  "required": true
}
```

### Contract Object

```json
{
  "id": "<uuid>",
  "kind": "<contract-kind>",
  "name": "Human-readable contract name",
  "status": "complete"
}
```

**Valid `kind` values (11 canonical values):** `rest` | `graphql` | `grpc` | `websocket` | `sse` | `kafka` | `amqp` | `sql` | `nosql` | `ipc` | `custom`

### Edge Object

```json
{
  "id": "<uuid>",
  "source": "<source-node-uuid>",
  "target": "<target-node-uuid>",
  "sourcePortId": "<optional port uuid>",
  "targetPortId": "<optional port uuid>",
  "contractId": "<contract-uuid>",
  "label": "Optional edge label"
}
```

**Every edge must reference a valid `contractId` that exists in the `contracts` map.**

### Artifact Object

```json
{
  "id": "<uuid>",
  "nodeId": "<node-uuid>",
  "kind": "source" | "schema" | "doc" | "config" | "build" | "design",
  "path": "relative/path/to/file.ext",
  "content": "actual file content as string",
  "language": "typescript",
  "description": "What this file does",
  "status": "complete",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

**Artifact kinds (7 values):**
- `source` — application source code (.ts, .py, .go, .rs, etc.)
- `schema` — database schemas, migrations, GraphQL schemas, Protobuf files
- `doc` — README, architecture docs, API docs
- `config` — package.json, tsconfig.json, .env.example, docker-compose.yml, nginx.conf
- `build` — Dockerfile, CI workflow files, Makefile, Terraform
- `design` — Figma links, wireframes, design tokens
- `task` — AI task context documents (`.nodespec/tasks/*.task.md`)

---

## 7. Template Generation Prompt

Use this prompt when asking an AI to generate a new NodeSpec template. Paste it directly, filling in `[TEMPLATE TOPIC]` and `[ARCHITECTURE DESCRIPTION]`.

---

```
You are an expert software architect generating a NodeSpec architecture template.

NodeSpec is a visual system architecture editor where every component is a typed node
connected by typed edges (contracts). Templates are complete architecture graphs with
nodes, edges, contracts, and artifact files — stored as JSON and seeded into the
project_templates database table.

## YOUR TASK

Generate a complete NodeSpec template for: [TEMPLATE TOPIC]
Architecture: [ARCHITECTURE DESCRIPTION]

## STRICT RULES

### Rule 1: Use Only Valid Node Type IDs
Every node's `type` field must be one of these exact IDs (dot-separated format):

FRONTEND: frontend.html-css, frontend.react, frontend.vue, frontend.angular,
  frontend.svelte, frontend.solid, frontend.next, frontend.nuxt, frontend.astro,
  frontend.blazor, frontend.yew, frontend.dioxus

MOBILE: mobile.swift, mobile.kotlin, mobile.react-native, mobile.flutter

BACKEND: backend.nodejs, backend.rust, backend.python, backend.go

INTERFACES: web.rest-api, web.graphql-api, web.grpc-service, web.websocket-server

GATEWAYS: gateway.aws-api-gateway, gateway.azure-api-management,
  gateway.gcp-api-gateway, gateway.kong

DATABASES: database.postgresql, database.supabase, database.mysql, database.mongodb,
  database.redis, database.dynamodb, database.cosmosdb, database.firestore,
  database.neo4j, database.elasticsearch, database.influxdb, database.cassandra,
  database.rds, database.aurora

CACHE: cache.redis, cache.memcached, cache.valkey, cache.elasticache,
  cache.cloudflare-kv

DATA/ANALYTICS: data.etl-pipeline, data.data-warehouse, data.stream-processor,
  data.bi-tool, data.apache-kafka, data.apache-spark, data.apache-airflow, data.dbt

MESSAGING: messaging.rabbitmq, messaging.nats, messaging.sqs

SERVERLESS: cloud.compute.lambda, cloud.compute.azure-functions,
  cloud.compute.cloud-functions, cloud.compute.cloudflare-workers

STORAGE: cloud.storage.s3, cloud.storage.azure-blob, cloud.storage.gcs,
  cloud.storage.minio

CDN: cloud.cdn.cloudfront, web.cdn

LOAD BALANCERS: lb.aws-alb, lb.aws-nlb, lb.azure-load-balancer,
  lb.azure-app-gateway, lb.gcp-load-balancer, lb.nginx, lb.haproxy

AUTH: auth.supabase-auth, auth.auth0, auth.aws-cognito, auth.keycloak,
  auth.firebase-auth, auth.azure-ad-b2c

CICD: cicd.github-actions, cicd.gitlab-ci, cicd.jenkins, cicd.argocd,
  cicd.circleci

OBSERVABILITY: observability.prometheus, observability.grafana, observability.datadog,
  observability.sentry, observability.elk-stack, observability.opentelemetry

AI/ML: ai.openai-api, ai.anthropic-claude, ai.aws-sagemaker, ai.langchain,
  ai.agent, ai.rag-pipeline, vectordb.pinecone, vectordb.weaviate, mlops.pipeline,
  mlops.model-registry, mlops.feature-store, mlops.model-serving

EXTERNAL: external.service, external.webhook

LOGICAL: logical.application-module, logical.software-layer,
  logical.component-library

INFRASTRUCTURE: infrastructure.vpc, infrastructure.azure-vnet, infrastructure.gcp-vpc,
  infrastructure.vmware-vsphere, infrastructure.hyper-v, infrastructure.proxmox,
  infrastructure.virtual-machine

ORCHESTRATION: orchestration.kubernetes-cluster, orchestration.kubernetes-namespace,
  orchestration.docker-compose, orchestration.docker-swarm, orchestration.nomad,
  orchestration.openshift, orchestration.ecs

NETWORKING: network.firewall, network.vpn

### Rule 2: Use Only Valid Container IDs
Container nodes (nodes that visually wrap other nodes) must use one of these IDs:

INFRASTRUCTURE CONTAINERS (layer: infrastructure):
- vpc — wraps subnets, clusters, services, databases inside a cloud network
- subnet — public or private subnet inside a VPC
- cloud-project — top-level cloud account (AWS account, GCP project, Azure subscription)
- hypervisor — VMware/Hyper-V/Proxmox cluster
- virtual-machine — single VM instance
- embedded-system — hardware-software integrated system

ORCHESTRATION CONTAINERS (layer: orchestration):
- k8s-cluster — Kubernetes cluster
- k8s-namespace — namespace within a K8s cluster
- docker-compose — Docker Compose stack
- docker-swarm — Docker Swarm cluster
- ecs-cluster — AWS ECS cluster

RUNTIME CONTAINERS (layer: runtime):
- docker-container — single Docker container
- serverless-function — Lambda / Cloud Function / Azure Function
- desktop-app — Electron / Tauri / MAUI desktop app
- mobile-device — iOS or Android device

LOGICAL CONTAINERS (layer: logical, style: logical-boundary):
- microservice-boundary — groups related microservices
- bounded-context — DDD bounded context
- service-mesh — Istio/Linkerd/Consul service mesh
- application-module — self-contained feature module
- software-layer — architectural layer (presentation, business, data)

Container nesting rules (a container node has its UUID in the `parentId` of the
metadata of nodes nested inside it):
- cloud-project can contain everything
- vpc can contain subnet, k8s-cluster, docker-compose, ecs-cluster, serverless-function,
  rest-api, database, cache, load-balancer, api-gateway, message-broker, ai-service
- k8s-cluster can contain k8s-namespace, docker-container, backend-service,
  database, cache, message-broker, monitoring, ai-service
- docker-compose can contain docker-container, backend-service, database, cache,
  message-broker, frontend-app, monitoring, ai-service
- microservice-boundary can contain rest-api, backend-service, database, cache,
  message-broker, monitoring

### Rule 3: Use Only Valid Contract Kinds
Every edge must reference a contract. Valid contract `kind` values (11 canonical values):
- rest — HTTP REST API calls, auth flows
- graphql — GraphQL queries/mutations/subscriptions
- grpc — Protocol Buffer RPC calls
- websocket — WebSocket real-time bidirectional connections
- sse — Server-sent event streams (one-way push)
- kafka — Kafka event streaming / pub-sub
- amqp — RabbitMQ / AMQP message queuing
- sql — SQL database connections (PostgreSQL, MySQL, etc.)
- nosql — NoSQL database connections (MongoDB, DynamoDB, etc.)
- ipc — Inter-process communication, library dependencies
- custom — Any pattern not covered above

### Rule 4: All UUIDs Must Be Unique
Every `id` field across nodes, edges, contracts, artifacts, and ports must be a
unique UUIDv4. Do not reuse any ID. Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx

### Rule 5: Every Edge References a Real Contract
An edge's `contractId` must match the `id` of a contract that exists in the
`contracts` map. Never create an edge with a contractId that doesn't have a
corresponding contract object.

### Rule 6: Ports Must Match Edge Source/Target
If an edge specifies `sourcePortId` and `targetPortId`, those port IDs must exist
in the respective node's `ports` array. Port IDs are also unique UUIDs.

### Rule 7: Container Nesting via parentId
When a node is visually inside a container, set its metadata.parentId to the
container node's UUID. Only nest node types that are in the container's canContain
list (see Rule 2).

### Rule 8: Position Nodes Sensibly
Use `metadata.position: { "x": N, "y": N }` to lay out nodes left-to-right
following the data flow. Suggested column positions:
- x=0-200: External clients, CDN, load balancers
- x=300-500: Frontend apps, API gateways
- x=600-900: Backend services, auth
- x=1000-1200: Databases, caches, storage
- x=1300-1500: Messaging, queues, observability
Container nodes should have position of their top-left corner and a `width`/`height`
in their metadata to encompass all child nodes.

### Rule 9: Artifacts Must Have Real Content
Every artifact must have a `content` field with real, useful file content — not
placeholder text. Include enough content to be genuinely useful as a starting point.
Minimum: 20 meaningful lines. Preferred: 50-200 lines for primary source files.

### Rule 10: Status Is Always "complete" for Templates
Set `"status": "complete"` on all nodes, contracts, and artifacts in a template.

### Rule 11: Template Metadata
Produce the following fields for the template record:
- `name`: Human-readable template name (e.g., "Next.js + Supabase + Stripe SaaS Starter")
- `slug`: URL-safe lowercase with hyphens (e.g., "nextjs-supabase-stripe-saas")
- `description`: 2-3 sentence description of what the template builds, the key
  technologies, and what problem it solves. Maximum 300 characters.
- `category`: One of: saas | data-pipeline | microservices | ai-ml | mobile |
  desktop | iot | ecommerce | internal-tool | cloud-native
- `tags`: Array of lowercase strings (10-15 tags) — cloud provider, frameworks,
  tech stack, architecture pattern, use case
- `technologies`: Array of technology slug strings matching what's in the nodes
- `node_count`: Total number of non-container nodes
- `edge_count`: Total number of edges
- `author_type`: "official"
- `is_public`: true
- `is_featured`: true for flagship templates, false for niche ones
- `architecture_pattern`: "monolith" | "microservices" | "serverless" | "unknown"

### Rule 12: Include a template_specification (recommended for rich templates)
A template_specification should include:
- `vision`: 2-3 sentence project vision statement
- `features`: Array of 5-10 features, each with { name, description, priority }
- `requirements`: Array of 8-15 requirements with { name, description, category }
  where category is one of: functional | non-functional | technical
- `architecture_trace`: For each feature, map to 1-3 node IDs that implement it

## OUTPUT FORMAT

Output a complete SQL INSERT statement using this structure:

INSERT INTO project_templates (
  name, slug, description, category,
  tags, technologies,
  node_count, edge_count,
  author_type, is_public, is_featured,
  graph_data,
  template_specification
) VALUES (
  '<name>',
  '<slug>',
  '<description>',
  '<category>',
  '<tags-json-array>'::jsonb,
  '<technologies-json-array>'::jsonb,
  <node_count>, <edge_count>,
  'official', true, <is_featured>,
  '<graph_data_json>'::jsonb,
  '<template_specification_json>'::jsonb
);

## ARCHITECTURE QUALITY CHECKLIST

Before finalizing, verify:
[ ] Every node type ID is in the valid list above
[ ] Every contract kind is valid
[ ] Every edge's contractId matches a real contract object
[ ] Every artifact has real file content (not lorem ipsum or TODO)
[ ] Container nodes have width/height in metadata
[ ] Nested nodes have parentId in their metadata
[ ] Node positions flow left-to-right following data flow
[ ] No duplicate UUIDs anywhere
[ ] All status fields are "complete"
[ ] tags array has 8+ entries
[ ] description is under 300 characters
[ ] template_specification.features covers the core value of the template
```

---

## 8. Blog Article Generation Prompt

Use this prompt when generating blog articles for NodeSpec's blog. All articles should appear at the `/blog` route and be seeded into the `blog_posts` table.

---

```
You are writing a technical blog article for NodeSpec — a visual system architecture editor
with AI-assisted design capabilities. NodeSpec's audience is senior engineers, software
architects, and engineering leads who design and build complex systems.

## ARTICLE BRIEF
Topic: [TOPIC]
Target keyword: [KEYWORD]
Article type: [tutorial | deep-dive | opinion | case-study | comparison | announcement]
Target length: [800-1200 | 1500-2500 | 2500-4000] words

## NODAL PRODUCT CONTEXT

NodeSpec is a visual architecture canvas where:
- Engineers design systems using typed nodes (React apps, Postgres databases,
  Kafka streams, Kubernetes clusters, etc.)
- Every change is an immutable patch — architecture is version-controlled like code
- AI agents help generate specifications, reverse-engineer repos into visual diagrams,
  and scaffold code artifacts
- Specifications (requirements, features, acceptance criteria) are directly linked
  to architecture nodes
- The template marketplace offers production-ready architectures: AWS Full-Stack,
  GCP Full-Stack, Next.js + Supabase + Stripe SaaS, AI RAG Pipeline, and more

## TONE & VOICE RULES

1. Write for builders, not managers — assume the reader writes code
2. Be direct and specific — avoid fluff, filler phrases, and hedging
3. Use concrete examples — "use Supabase RLS for row-level access control"
   not "implement proper security measures"
4. Technical accuracy matters — never make up API names, flag names, or syntax
5. Reference real trade-offs — great architecture content acknowledges what you
   give up, not just what you gain
6. No hyperbole — do not call anything "revolutionary", "game-changing", "magical"
7. Do not use purple prose or marketing clichés
8. NodeSpec can be mentioned as a tool but the article must provide genuine standalone
   value — it is not a sales pitch
9. Code examples must be real and runnable, not pseudocode placeholders
10. Use headings (H2, H3) to break content into scannable sections

## FORMATTING REQUIREMENTS

- Format as HTML (not Markdown) for direct insertion into TinyMCE / Supabase blog_posts
- Use <h2> for major sections, <h3> for sub-sections
- Use <p> for paragraphs
- Use <pre><code class="language-[lang]"> for code blocks
- Use <ul> / <ol> for lists
- Use <strong> for key terms on first introduction
- Include a 1-sentence meta description at the top as an HTML comment:
  <!-- meta: Your meta description here -->
- Do NOT include an <h1> — the title is stored separately in the database
- Do NOT include any inline styles

## ARTICLE STRUCTURE (adapt as needed)

For tutorials:
1. Opening — the problem this solves (2-3 paragraphs, no fluff intro)
2. Prerequisites / what you'll need
3. Core implementation sections (H2 per major step)
4. Common pitfalls / gotchas
5. Closing — what you built and where to go next

For deep-dives:
1. Opening — what question this answers
2. Background / why this matters
3. Core analysis sections
4. Comparison table (if applicable)
5. Recommendation / conclusion

For comparisons:
1. Frame the decision — who needs to make this choice and why
2. Option A analysis
3. Option B analysis
4. Side-by-side comparison table
5. When to choose what

## DATABASE FIELDS

When providing SQL for blog_posts insertion:
- title: Article title (no H1 in body)
- slug: URL-safe slug (e.g., "building-rag-pipeline-supabase-pgvector")
- content: Full HTML body (no <html>/<body> wrapper)
- excerpt: 1-2 sentence summary for list pages (max 200 chars)
- status: "published" | "draft"
- author_name: "NodeSpec Team" (unless specified)
- tags: JSON array of lowercase tag strings (5-10 tags)
- reading_time_minutes: Estimated reading time (word count / 200, rounded up)
- meta_description: SEO description (max 155 chars)
- published_at: ISO timestamp or null for drafts
```

---

## 9. Template Examples & Patterns

### Existing Official Templates

| Template | Slug | Architecture Pattern | Key Technologies |
|----------|------|---------------------|-----------------|
| AWS Full-Stack Web Application | `aws-fullstack-webapp` | cloud-native | React, Node.js, ECS, RDS PostgreSQL, Redis, Cognito, S3, CloudFront, ALB, VPC |
| Next.js + Supabase + Stripe SaaS Starter | `nextjs-supabase-stripe-saas` | monolith | Next.js 14, Supabase Auth, Supabase Postgres, Supabase Storage, Stripe, Vercel |
| GCP Full-Stack Web Application | `gcp-fullstack-webapp` | cloud-native | React, Node.js, Cloud Run, Cloud SQL, Memorystore, Firebase Auth, Cloud CDN, GCS, Cloud LB, VPC |
| AI RAG Pipeline | `ai-rag-pipeline` | unknown | LLM Gateway, Inference Service, Vector DB (Pinecone), Embedding Service, PostgreSQL, Python backend |

### Recommended Templates to Build Next

These are high-value gaps in the current template library:

**AI / ML**
- RAG Pipeline with Pinecone + OpenAI — `ai.rag-pipeline`, `vectordb.pinecone`, `ai.openai-api`, `database.postgresql`, `backend.python`
- LLM Agent Platform — `ai.agent`, `ai.langchain`, `ai.openai-api`, `vectordb.weaviate`, `messaging.rabbitmq`, `backend.python`
- ML Training Pipeline (SageMaker) — `ai.aws-sagemaker`, `mlops.pipeline`, `mlops.model-registry`, `cloud.storage.s3`, `data.apache-airflow`

**Microservices**
- Event-Driven Microservices — `data.apache-kafka`, multiple `web.rest-api` + `backend.nodejs`, `database.postgresql`, `k8s-cluster`, `observability.prometheus`, `observability.grafana`
- CQRS + Event Sourcing — `messaging.rabbitmq` or `data.apache-kafka`, multiple bounded-context containers, `database.postgresql`, `cache.redis`

**Mobile**
- React Native + Supabase App — `mobile.react-native`, `auth.supabase-auth`, `database.supabase`, `cloud.storage.s3`, `external.service` (Stripe), `mobile-device` container
- Flutter + Firebase App — `mobile.flutter`, `auth.firebase-auth`, `database.firestore`, `cloud.storage.gcs`, `mobile-device` container

**Data Platforms**
- Modern Data Stack — `data.apache-airflow`, `data.apache-spark`, `data.data-warehouse`, `data.dbt`, `data.bi-tool`, `cloud.storage.s3`, `database.postgresql`
- Real-Time Analytics Pipeline — `data.apache-kafka`, `data.stream-processor`, `database.elasticsearch`, `observability.grafana`, `database.influxdb`

**Cloud-Native**
- Azure Full-Stack — `frontend.react`, `lb.azure-app-gateway`, `backend.nodejs`, `database.cosmosdb` or `database.postgresql`, `auth.azure-ad-b2c`, `cloud.storage.azure-blob`, VPC (`infrastructure.azure-vnet`)
- Kubernetes-Native Microservices — `k8s-cluster` > `k8s-namespace` per service > multiple `docker-container` + `web.rest-api` + `database.postgresql`, `observability.prometheus`, `observability.grafana`, `mesh.istio`

**IoT / Edge**
- IoT Data Pipeline — `embedded-system` container, `backend.python` (edge), `messaging.nats` or `messaging.rabbitmq`, `backend.nodejs` (cloud), `database.influxdb`, `observability.grafana`

### Container Nesting Patterns

These are the most common valid nesting patterns used in templates:

```
cloud-project
  └── vpc
        ├── subnet (public)
        │     └── lb.aws-alb
        └── subnet (private)
              ├── k8s-cluster
              │     └── k8s-namespace
              │           └── docker-container > backend service
              ├── database.postgresql
              └── cache.redis
```

```
cloud-project (Vercel/Netlify)
  └── frontend.next (no nested container needed for PaaS)
```

```
docker-compose
  ├── docker-container > backend.nodejs
  ├── docker-container > database.postgresql
  └── docker-container > cache.redis
```

```
microservice-boundary (Order Service)
  ├── web.rest-api
  ├── backend.nodejs
  └── database.postgresql
```

---

## 10. Tone & Voice Guidelines

### For Templates (spec descriptions, artifact content, node labels)

- **Node labels** — Specific and descriptive: "React Dashboard" not "Frontend". "Order Processing API" not "Backend Service". "PostgreSQL Primary" not "Database".
- **Artifact content** — Real working code. Use the actual framework APIs and libraries relevant to the node type. For a `frontend.next` node, write real Next.js App Router code. For a `database.postgresql` node, write real SQL migrations.
- **Feature descriptions** — Written from the user perspective: "Users can sign up with email and password and receive a verification email" not "Implement authentication system".
- **Requirements** — Measurable when possible: "The API must respond to 95% of requests within 200ms under a load of 500 concurrent users" not "The API must be fast".

### For Blog Articles

- Audience is people who build systems for a living — assume deep technical knowledge
- Do not explain what React or PostgreSQL is
- Do not use the phrase "In today's world" or "In this article, we will"
- Do not end articles with "Happy coding!" or similar closings
- Attribute specific design decisions to real trade-offs, not authority ("use PostgreSQL because it's battle-tested" is weak; "use PostgreSQL here because you need ACID transactions across multiple tables during the checkout flow" is strong)
- NodeSpec references should feel organic — mention it when it genuinely helps, not as a recurring promotional beat

### Phrases to Avoid

- "seamlessly" — overused, meaningless
- "robust" — vague
- "cutting-edge" / "state-of-the-art" / "next-generation" — marketing language
- "leverage" (as a verb) — use "use"
- "utilize" — use "use"
- "innovative solution" — vague
- "in today's fast-paced world" — cliché opener
- "game-changer" / "revolutionary" — hyperbole
- "it's worth noting that" — filler
- "As mentioned earlier" — redundant in blog format
