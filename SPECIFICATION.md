# NodeSpec Complete Technical Specification

**Version:** 1.4.0
**Last Updated:** 2026-07-05
**Status:** Production

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Core Concepts](#core-concepts)
4. [Data Model](#data-model)
5. [Database Schema](#database-schema)
6. [Patch Operations](#patch-operations)
7. [Domain Layer](#domain-layer)
8. [Persistence Layer](#persistence-layer)
9. [UI Layer](#ui-layer)
10. [AI Integration](#ai-integration)
11. [Development](#development)
12. [Testing](#testing)
13. [Deployment](#deployment)

---

## System Overview

NodeSpec is a version-controlled, collaborative system architecture editor with AI-assisted design capabilities. It enables teams to design, document, and evolve system architectures through a visual graph interface backed by an immutable patch-based versioning system.

### Key Features

- **Visual Architecture Editor**: Drag-and-drop node-based interface using ReactFlow with 200+ node types
- **Patch-Based Versioning**: Every change is an immutable, auditable patch operation
- **Branch System**: Parallel development with conflict detection and merge support
- **Draft Semantics**: Incremental specification building without breaking invariants
- **AI Agents**: Tool-calling agents for architecture and specification generation with real-time SSE streaming
- **Repository Import**: Analyze and import existing codebases into architecture diagrams
- **Template Marketplace**: Pre-built architecture templates with admin authoring tools (AWS Full-Stack, GCP Full-Stack, Next.js + Supabase + Stripe, AI RAG Pipeline)
- **Specification System**: Structured requirements, acceptance criteria, test cases with bidirectional traceability to architecture nodes
- **Subscription & Billing**: Stripe-integrated with BYOK-primary pricing (600K lifetime platform tokens across all tiers)
- **Real-time Collaboration**: Multi-user support via Supabase realtime subscriptions
- **Blog CMS**: Built-in content management for the public blog
- **MCP Server**: Model Context Protocol server with OAuth 2.0 + PKCE and JSON-RPC 2.0 for external AI agent connectivity
- **MCP Admin Template Tools**: Separate admin endpoint for template authoring, validation, and management
- **Type Safety**: Strict TypeScript with Zod runtime validation
- **Comprehensive Testing**: 102 test files with 100% pass rate

### Technology Stack

```
Frontend:     React 18, TypeScript 5.3, XYFlow/ReactFlow 12
Build:        Vite 5.4, Vitest 1.2
Backend:      Supabase (PostgreSQL 15, PostgREST, Realtime, Edge Functions)
Validation:   Zod 3.22
Editor:       Monaco Editor, TinyMCE
Styling:      CSS-in-JS with theme system
```

---

## Architecture

### Layered Architecture

```
┌────────────────────────────────────────────┐
│          UI Layer (React)                   │
│  - Components, Panels, Editors              │
│  - ReactFlow Graph Visualization            │
│  - State Management                          │
└──────────────┬─────────────────────────────┘
               │
               ├─── Adapters (Boundary)
               │    - graph-to-reactflow.ts
               │    - interaction-to-patch.ts
               │
┌──────────────▼─────────────────────────────┐
│       Domain Layer (Pure TypeScript)        │
│  - Graph, Patch, Branch Models              │
│  - Validation, Versioning, Templates        │
│  - AI Proposal System                       │
│  - Zero Framework Dependencies              │
└──────────────┬─────────────────────────────┘
               │
               ├─── Ports (Interfaces)
               │    - Repository Contracts
               │
┌──────────────▼─────────────────────────────┐
│    Persistence Layer (Supabase)             │
│  - GraphRepository, PatchRepository         │
│  - BranchRepository, ProjectRepository      │
│  - ArtifactRepository, ProposalRepository   │
└──────────────┬─────────────────────────────┘
               │
┌──────────────▼─────────────────────────────┐
│      Supabase Platform                      │
│  - PostgreSQL 15 with RLS                   │
│  - Realtime Subscriptions                   │
│  - Edge Functions (AI Agents + Services)    │
└─────────────────────────────────────────────┘
```

### Design Principles

1. **Domain-First**: Business logic is framework-agnostic with zero framework dependencies
2. **Role + Technology Separation**: Node `type` = architectural role; `technology` = implementation
3. **Immutability**: Patches are never modified after creation
4. **Auditability**: Every change has actor attribution and timestamp
5. **Determinism**: Replaying patches always produces the same result
6. **Type Safety**: Zod schemas validate at all layer boundaries
7. **Separation of Concerns**: Clear layer boundaries with explicit adapters

---

## Core Concepts

### Graph

The **Graph** is the central data structure representing a complete system architecture:

```typescript
interface Graph {
  id: string;                          // UUID
  schemaVersion: number;               // Currently 8
  version: number;                     // Incremental version counter
  hash: string;                        // Content hash for integrity
  nodes: Record<string, Node>;         // System components
  edges: Record<string, Edge>;         // Connections between nodes
  contracts: Record<string, Contract>; // Protocol specifications
  artifacts: Record<string, Artifact>; // Code, docs, configs
  nodeGroups?: Record<string, NodeGroup>;
  metadata?: Record<string, unknown>;
  origin?: 'spec_authored' | 'reverse_engineered' | 'hybrid';
  sourceContext?: Record<string, unknown>;
}
```

### Node (Component)

Represents a system component with architectural role + optional technology:

```typescript
interface Node {
  id: string;                      // UUID
  type: string;                    // Role ID from node_roles table
  label: string;                   // Human-readable name
  technology?: string;             // Technology ID from technology_catalog
  parentId?: string;               // Parent container UUID
  placementKind?: PlacementKind;   // 'contains' | 'hosts' | 'deployed_to' | 'scopes'
  ports?: Port[];
  artifacts?: string[];            // Referenced artifact IDs
  deploymentTarget?: string;
  data?: Record<string, unknown>;  // { description }
  metadata?: Record<string, unknown>; // { rationale, featureId, ... }
  status?: 'suggested' | 'draft' | 'complete';
}
```

**Critical design**: A node's `type` is the **architectural role** (what it IS), and `technology` is the **implementation** (what runs it). Example: `type: "database"` + `technology: "postgresql"`, not `type: "postgresql-database"`.

**Important**: `position` is **UI-only ephemeral state** stored in ReactFlow, not in the domain model. Moving nodes does NOT create patches or persist to database.

### Port (Connection Point)

Typed communication endpoint on a node:

```typescript
interface Port {
  id: string;
  name: string;
  direction: 'in' | 'out' | 'bidirectional';
  contractId?: string;
  multiplicity?: string;
  bindingAddress?: string;
  discoverability?: 'static' | 'dynamic' | 'service_mesh';
  idempotency?: 'idempotent' | 'non_idempotent' | 'at_most_once';
  required?: boolean;
  schemaRef?: string;
  status?: 'suggested' | 'draft' | 'complete';
}
```

### Edge (Connection)

Typed, directional connection between two nodes:

```typescript
interface Edge {
  id: string;
  source: string;               // Source node UUID
  target: string;               // Target node UUID
  sourcePortId?: string;
  targetPortId?: string;
  contractId: string;           // REQUIRED — contract governing this edge
  direction?: 'unidirectional' | 'bidirectional';
  criticality?: 'required' | 'optional' | 'fallback';
  label?: string;
  metadata?: Record<string, unknown>;
}
```

**Note**: There is no `edgeKind` field. The architectural category of a connection is fully expressed by the referenced contract's `interactionKind`.

### Contract (Protocol Definition)

A reusable, named specification of a communication or dependency relationship:

```typescript
interface Contract {
  id: string;
  name: string;                      // User-facing name
  kind: ContractKind;                // REQUIRED — protocol family (color)
  interactionKind?: InteractionKind; // Communication pattern (dash)
  transport?: TransportKind;         // Wire-level protocol
  specFormat?: SpecFormat;           // Formal spec representation
  schema?: Record<string, unknown>;
  schemaRef?: string;
  status?: 'suggested' | 'draft' | 'complete';
  metadata?: Record<string, unknown>;
}
```

**ContractKind — 11 canonical values:**

```
rest | graphql | grpc | websocket | sse | kafka | amqp | sql | nosql | ipc | custom
```

**ContractKind visual encoding (edge color):**

| Kind | Dark Mode | Light Mode |
|------|-----------|------------|
| `rest` | #38bdf8 | #0284c7 |
| `graphql` | #e879f9 | #a21caf |
| `grpc` | #34d399 | #059669 |
| `websocket` | #fbbf24 | #d97706 |
| `sse` | #fb923c | #c2410c |
| `kafka` | #a78bfa | #6d28d9 |
| `amqp` | #f472b6 | #be185d |
| `sql` | #60a5fa | #2563eb |
| `nosql` | #2dd4bf | #0d9488 |
| `ipc` | #94a3b8 | #64748b |
| `custom` | #cbd5e1 | #475569 |

**InteractionKind — 11 values (dash pattern):**

```
request_response | event | queue | data_read | data_write | data_sync |
file_transfer | auth | telemetry | ipc | dependency
```

| InteractionKind | Dash Pattern |
|----------------|-------------|
| `request_response` | solid |
| `event` | 8,4 |
| `queue` | 4,4 |
| `data_read` | 12,4,4,4 |
| `data_write` | 12,4,4,4 |
| `data_sync` | 6,3 |
| `file_transfer` | 10,6 |
| `auth` | 2,4 |
| `telemetry` | 4,8 |
| `ipc` | solid |
| `dependency` | 2,2 |

**Contract Kind Usage Rules:**

| Kind | Use For |
|------|---------|
| `rest` | HTTP APIs, REST endpoints, auth flows |
| `graphql` | GraphQL queries, mutations, subscriptions |
| `grpc` | High-performance RPC with Protobuf |
| `websocket` | Real-time bidirectional connections |
| `sse` | Server-sent event streams |
| `kafka` | Kafka event streaming |
| `amqp` | RabbitMQ / AMQP message queuing |
| `sql` | SQL database access (PostgreSQL, MySQL, etc.) |
| `nosql` | NoSQL database access (MongoDB, DynamoDB, etc.) |
| `ipc` | Inter-process communication, library dependencies |
| `custom` | Any pattern not covered by the above |

**Common mistakes to avoid:**
- Using `rest` for database connections (use `sql` or `nosql`)
- Using `sql` for service-to-service HTTP calls (use `rest`)
- Using `rest` for fire-and-forget notifications (use `kafka` or `amqp`)

### Artifact (Implementation Content)

Files attached to nodes:

```typescript
interface Artifact {
  id: string;
  nodeId?: string;                    // Owning node UUID
  kind: ArtifactKind;                 // 7 values
  path: string;                       // Relative file path
  language?: string;
  content?: string;
  contentHash?: string;
  uri?: string;
  description?: string;
  status?: 'suggested' | 'draft' | 'complete';
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}
```

**ArtifactKind — 7 values:**
- `source` — Source code (.ts, .js, .py, .go, .rs, etc.)
- `schema` — API specs, database schemas, protobuf definitions
- `doc` — Documentation (README.md, design docs)
- `config` — Configuration files (.env, package.json, tsconfig.json)
- `build` — Build scripts (Dockerfile, CI workflows, Makefile)
- `design` — Figma links, wireframes, design tokens
- `task` — Task documents for AI context (`.nodespec/tasks/*.task.md`)

### Patch Operation

Atomic, immutable operations that modify the graph:

```typescript
interface PatchMetadata {
  id: string;
  timestamp: string;
  actorType: 'human' | 'ai' | 'system';
  actorId?: string;
  summary: string;
  preconditions?: Precondition[];
}

type PatchOperation =
  | AddNodePatch | UpdateNodePatch | RemoveNodePatch
  | AddEdgePatch | UpdateEdgePatch | RemoveEdgePatch
  | AddContractPatch | UpdateContractPatch | RemoveContractPatch
  | AddArtifactPatch | UpdateArtifactPatch | RemoveArtifactPatch
  | AddPortPatch | UpdatePortPatch | DeletePortPatch
  | ConnectPortsPatch
  | CreateNodeFromTemplatePatch
  | InstantiateContractStubPatch
  | AttachArtifactStubPatch
  | MarkEntityCompletePatch
  | UpdateGraphMetadataPatch;
```

**Patch Characteristics:**
- **Immutable**: Never modified after creation
- **Validated**: Schema + semantic validation before application
- **Auditable**: Full actor attribution and timestamp
- **Replayable**: Deterministic graph reconstruction
- **Preconditioned**: Optional hash/value checks for optimistic locking

### Branch

Named sequence of patches with optional base snapshot:

```typescript
interface Branch {
  id: string;
  name: string;                       // 'main' | 'feature/x' | 'proposal/y'
  baseSnapshotId: string | null;
  patches: PatchOperation[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}
```

**Branch Types:**
- `main`: Primary development branch
- `feature/*`: Feature development branches
- `proposal/*`: AI-generated proposal branches (auto-created)

### Draft Semantics

Entities can be `suggested`, `draft`, or `complete`:

- **`suggested`**: AI-proposed, not yet accepted
- **`draft`**: Accepted but incomplete
- **`complete`**: Fully specified and ready for implementation

**Scaffolding Patches:**
1. `create_node_from_template`: Creates node + ports + contracts from template
2. `instantiate_contract_stub`: Creates draft contract with placeholder schema
3. `attach_artifact_stub`: Creates draft artifact with empty content
4. `mark_entity_complete`: Promotes entity from draft to complete

**Completeness Validation**: Non-blocking warnings for draft entities missing required fields.

### Contract-Aware Validation

**Obligations** are requirements derived from the graph structure:

- `contract_required`: Port references a contract
- `artifact_required`: Node needs artifacts of a specific kind
- `schema_present`: Draft contract missing schema definition

**Validation Rules** (11 rules, see Ontology.md section 7):
- `edge-has-contract`: Every edge references a valid contract
- `edge-port-direction-valid`: Port directions must be compatible
- `contract-has-schema`: REST/GraphQL/gRPC contracts should have schemas
- `containment-mismatch`: Child type must be in parent's canContain list
- `orphaned-platform-capability`: Platform capabilities need matching platform parent
- And 6 additional rules for artifacts, ports, config, task document staleness

---

## Understanding Contracts and Edges

### The Mental Model: Contracts as "Conversation Rules"

Think of your system as components having conversations (edges). The **contract** defines the rules:

- **REST** = "I ask a question (HTTP request), you answer immediately (HTTP response)"
- **SQL** = "I need to store/retrieve data from a relational database"
- **AMQP/Kafka** = "I leave a message in a queue; you process it when ready"
- **WebSocket** = "We maintain a persistent two-way channel"
- **SSE** = "You stream events to me as they occur"

### How AI Uses Contracts

When AI generates code for a node, it reads the incoming and outgoing contracts to understand the implementation:

```
Node: "Tasks API" (backend-service / nodejs)
Incoming: rest (request_response) from "Frontend"
Outgoing: sql (data_write) to "PostgreSQL Database"

→ AI generates: Express routes + pg queries
```

**The AI knows:**
1. To generate Express/Fastify routes (REST in)
2. To use parameterized SQL queries (sql out)
3. The exact schema from both contracts
4. Error handling patterns for each communication type

### Best Practices

1. Design contracts before nodes — let protocol choices drive implementation
2. Use `interactionKind` to convey communication pattern (data_read vs. data_write produce different code)
3. Attach schemas to contracts before generating code
4. Contract changes trigger automatic obligation updates

---

## Data Model

### Entity Relationships

```
Project (1) ──┬─> (N) Branches ──┬─> (N) Patches
              │                   └─> (1) Base Snapshot
              │
              ├─> (N) Snapshots
              ├─> (N) Specifications ──> (N) Requirements
              ├─> (N) AI Runs ──> (N) AI Proposals ──> (N) Proposal Artifacts
              └─> (N) Test Cases
```

### Graph Structure

```
Graph (schemaVersion: 8)
├── nodes (Record<UUID, Node>)
│   └── Node { type (role), technology, parentId, ports, artifacts }
├── edges (Record<UUID, Edge>)
│   └── Edge → contractId (REQUIRED)
├── contracts (Record<UUID, Contract>)
│   └── Contract { kind (12 values), interactionKind (11 values) }
├── artifacts (Record<UUID, Artifact>)
│   └── Artifact { kind (7 values) }
└── nodeGroups (Record<UUID, NodeGroup>)
```

---

## Database Schema

### Core Tables

#### projects
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
name            text NOT NULL
owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
metadata        jsonb DEFAULT '{}'::jsonb
```

#### branches
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
name            text NOT NULL
base_snapshot_id uuid REFERENCES graph_snapshots(id) ON DELETE SET NULL
created_at      timestamptz NOT NULL DEFAULT now()
created_by      uuid NOT NULL REFERENCES auth.users(id)
metadata        jsonb DEFAULT '{}'::jsonb
UNIQUE(project_id, name)
```

#### graph_snapshots
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE
graph_data      jsonb NOT NULL        -- Full Graph JSONB blob (schemaVersion: 8)
version         integer NOT NULL DEFAULT 0
hash            text NOT NULL
created_at      timestamptz NOT NULL DEFAULT now()
patch_sequence  bigint NOT NULL DEFAULT 0
```

#### graph_patches
```sql
id              uuid PRIMARY KEY
branch_id       uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE
sequence        bigint NOT NULL
patch_type      text NOT NULL
actor_type      text NOT NULL CHECK (actor_type IN ('human', 'ai', 'system'))
actor_id        uuid
summary         text NOT NULL
payload         jsonb NOT NULL
preconditions   jsonb
created_at      timestamptz NOT NULL DEFAULT now()
applied_at      timestamptz
UNIQUE(branch_id, sequence)
```

#### artifacts
```sql
id              uuid PRIMARY KEY
project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
type            text NOT NULL
uri             text
content         jsonb
storage_path    text
created_at      timestamptz NOT NULL DEFAULT now()
metadata        jsonb DEFAULT '{}'::jsonb
```

#### ai_runs
```sql
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
branch_id           uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE
model               text NOT NULL
prompt_hash         text NOT NULL
status              text NOT NULL DEFAULT 'pending'
started_at          timestamptz NOT NULL DEFAULT now()
completed_at        timestamptz
input_snapshot_id   uuid REFERENCES graph_snapshots(id)
output_patches      uuid[]
proposal_id         uuid REFERENCES ai_proposals(id)
metadata            jsonb DEFAULT '{}'::jsonb
```

#### ai_proposals
```sql
id                      uuid PRIMARY KEY DEFAULT gen_random_uuid()
ai_run_id               uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE
source_branch_id        uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE
proposal_branch_id      uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE
status                  text NOT NULL DEFAULT 'pending'
patches                 jsonb NOT NULL DEFAULT '[]'::jsonb
validation_expectations text[] DEFAULT '{}'
created_at              timestamptz NOT NULL DEFAULT now()
reviewed_at             timestamptz
merged_at               timestamptz
metadata                jsonb DEFAULT '{}'::jsonb
```

#### ai_proposal_artifacts
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
proposal_id     uuid NOT NULL REFERENCES ai_proposals(id) ON DELETE CASCADE
node_id         text NOT NULL
artifact_kind   text NOT NULL
file_path       text NOT NULL
language        text
content         text NOT NULL
content_hash    text
description     text
created_at      timestamptz NOT NULL DEFAULT now()
```

Stores artifact file content separately from `ai_proposals.patches` JSONB to avoid PostgREST request body size limits on large repository imports. RLS scopes access through proposal → branch → project ownership chain.

#### user_settings
```sql
user_id                 uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
use_global_ai           boolean DEFAULT true NOT NULL
ai_provider             text
ai_api_key_encrypted    text
subscription_tier       text DEFAULT 'free' NOT NULL
subscription_status     text DEFAULT 'active' NOT NULL
created_at              timestamptz DEFAULT now() NOT NULL
updated_at              timestamptz DEFAULT now() NOT NULL
```

#### project_specifications
```sql
id                      uuid PRIMARY KEY DEFAULT gen_random_uuid()
project_id              uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE
vision                  text
scope_archetype         text
architecture_pattern    text
constraints             text[]
phase_status            jsonb DEFAULT '{}'::jsonb
created_at              timestamptz DEFAULT now() NOT NULL
updated_at              timestamptz DEFAULT now() NOT NULL
```

#### requirements (within project_specifications)
```sql
id                      uuid PRIMARY KEY DEFAULT gen_random_uuid()
specification_id        uuid NOT NULL REFERENCES project_specifications(id) ON DELETE CASCADE
name                    text NOT NULL
description             text
category                text
source                  text
acceptance_criteria     text[]
architecture_trace      text[]
created_at              timestamptz DEFAULT now() NOT NULL
```

### Ontology Tables

#### node_roles
```sql
id                  text PRIMARY KEY        -- kebab-case role slug
label               text NOT NULL
description         text NOT NULL DEFAULT ''
kind                text NOT NULL           -- 13-value enum (see Ontology.md)
functional_kind     text                    -- 11-value enum or NULL
palette_category    text NOT NULL
palette_category_label text
rf_visual_type      text NOT NULL           -- 8-value enum
is_container        boolean NOT NULL DEFAULT false
container_layer     text                    -- infrastructure|orchestration|runtime|logical
container_style     text                    -- hosting|logical-boundary
can_contain         jsonb DEFAULT '[]'::jsonb
metadata_schema     jsonb DEFAULT '{}'::jsonb
default_ports       jsonb DEFAULT '[]'::jsonb
suggested_contracts jsonb DEFAULT '[]'::jsonb
capability_tags     text[] DEFAULT '{}'
sort_order          integer NOT NULL DEFAULT 0
provider            text
when_to_use         text
default_technology  text
deprecated          boolean NOT NULL DEFAULT false
```

#### technology_catalog
```sql
id                  text PRIMARY KEY        -- lowercase kebab-case slug
name                text NOT NULL
brand_color         text NOT NULL DEFAULT '#6b7280'
role_affinities     jsonb NOT NULL DEFAULT '[]'
ai_context          jsonb NOT NULL DEFAULT '{}'
suggested_files     jsonb DEFAULT '[]'
common_connections  jsonb DEFAULT '[]'
default_metadata    jsonb DEFAULT '{}'
metadata_schema     jsonb DEFAULT '{}'
icon_url            text
display_name        text
node_shape          text DEFAULT 'rounded'
secondary_color     text
svg_icon            jsonb
search_vector       tsvector               -- auto-generated by trigger
```

#### legacy_type_mappings
```sql
legacy_type         text PRIMARY KEY       -- 'frontend.react', 'database.postgresql', etc.
role_id             text NOT NULL          -- maps to node_roles.id
technology_id       text                   -- maps to technology_catalog.id
deployment_target_id text
```

These mappings allow backward compatibility for graphs using the old dotted-notation type system (e.g., `frontend.react` → role: `frontend-app`, technology: `react`). They are NOT current type identifiers.

### Security (Row Level Security)

All tables have RLS enabled. Every policy checks authentication and project ownership:

```sql
CREATE POLICY "Patch access follows branch ownership"
  ON graph_patches FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM branches
      JOIN projects ON projects.id = branches.project_id
      WHERE branches.id = graph_patches.branch_id
      AND projects.owner_id = auth.uid()
    )
  );
```

### Key Indexes

- `idx_branches_project` — Branch listing by project
- `idx_patches_branch_sequence` — Ordered patch retrieval
- `idx_snapshots_branch` — Latest snapshot lookup
- `idx_artifacts_project` — Artifact queries
- `idx_ai_runs_branch` — AI run history
- `idx_technology_catalog_search_vector` — Full-text technology search

---

## Patch Operations

### Node Operations

```typescript
type AddNodePatch = {
  type: 'add_node';
  metadata: PatchMetadata;
  payload: Node;
};

// NOTE: position is NOT in Node — position is UI-only state
type UpdateNodePatch = {
  type: 'update_node';
  metadata: PatchMetadata;
  payload: { id: string; changes: Partial<Omit<Node, 'id'>> };
};

type RemoveNodePatch = {
  type: 'remove_node';
  metadata: PatchMetadata;
  payload: { id: string };
};
```

### Edge Operations

```typescript
type AddEdgePatch = {
  type: 'add_edge';
  metadata: PatchMetadata;
  payload: Edge;
};

type RemoveEdgePatch = {
  type: 'remove_edge';
  metadata: PatchMetadata;
  payload: { id: string };
};
```

### Draft Scaffolding Operations

```typescript
type CreateNodeFromTemplatePatch = {
  type: 'create_node_from_template';
  metadata: PatchMetadata;
  payload: { templateId: string; label: string };
};

type MarkEntityCompletePatch = {
  type: 'mark_entity_complete';
  metadata: PatchMetadata;
  payload: {
    entityType: 'node' | 'port' | 'contract' | 'artifact';
    entityId: string;
    nodeId?: string;
  };
};
```

### Validation Pipeline

```
1. Schema Validation (Zod)
   ├─> Structural correctness
   ├─> Required fields present
   └─> Type conformance

2. Precondition Check
   ├─> Hash matches expected
   ├─> Referenced entities exist
   └─> Values equal expected

3. Semantic Validation
   ├─> Entity exists (for updates)
   ├─> Entity doesn't exist (for adds)
   ├─> No dangling references
   └─> Port direction correctness

4. Graph Consistency
   ├─> All edge refs valid
   ├─> All contract refs valid
   ├─> All artifact refs valid
   └─> No duplicate IDs

Success → Apply Patch
Failure → Return ValidationError
```

---

## Domain Layer

**Location**: `src/domain/`
**Dependencies**: Zero (pure TypeScript + Zod)

### Key Files

#### `types.ts` / `schemas.ts`
Core type definitions and Zod validation schemas for all entities and patches.

#### `patch-engine.ts`
```typescript
function validatePatch(graph: Graph, patch: PatchOperation): ValidationResult
function applyPatch(graph: Graph, patch: PatchOperation): PatchResult
```

#### `patch-factory.ts`
Safe patch builders with automatic metadata (18+ builder functions).

#### `branch.ts`
```typescript
function replayPatches(baseGraph: Graph, patches: PatchOperation[]): PatchResult
function detectConflicts(graph: Graph, patches: PatchOperation[]): ConflictInfo[]
function computeDiff(branch1: Branch, branch2: Branch): BranchDiff
```

#### `draft-semantics.ts`
```typescript
function validateCompleteness(graph: Graph): CompletenessWarning[]
function canMarkComplete(entityType: string, entityId: string, graph: Graph): boolean
```

#### `ai-proposal.ts`
```typescript
function buildAIInputContext(graph: Graph, selection: Selection): AIContext
function validateAIOutput(patches: PatchOperation[]): ValidationResult
```

#### `obligations.ts`
```typescript
function deriveNodeObligations(graph: Graph, nodeId: string): Obligation[]
function deriveAllObligations(graph: Graph): Map<string, Obligation[]>
```

#### `artifact-validation.ts`
Pure validation against obligations without side effects.

#### `specification.ts` / `specification-editing.ts`
Specification and requirements CRUD and editing operations.

#### `scaffold-prompt-builder.ts`
Builds terse, contract-aware prompts for AI code generation:
```
Node: "<label>" (<technology> <role>)
Rationale: <metadata.rationale>
Connections:
  OUT -> "<targetLabel>" via <contractKind>/<interactionKind>
  IN  <- "<sourceLabel>" via <contractKind>/<interactionKind>
```

#### Sub-Modules
- `detection/` — AI code detection strategies (coordinator, ai-strategy, regex-strategy)
- `generation/` — AI generation types and response parsing
- `repo-import/` — Repository import pipeline (analyzer, grouping, layout, patch generator)
- `validation/` — Validation engine and rules

---

## Persistence Layer

**Location**: `src/persistence/`

### Repository Interfaces (`ports.ts`)

```typescript
interface GraphRepository {
  saveSnapshot(graph: Graph): Promise<void>;
  getSnapshot(id: string): Promise<Graph | null>;
  getLatestSnapshot(projectId: string): Promise<Graph | null>;
}

interface PatchRepository {
  savePatch(branchId: string, patch: PatchOperation): Promise<void>;
  getPatches(branchId: string): Promise<PatchOperation[]>;
}

interface BranchRepository {
  createBranch(branch: Omit<Branch, 'id' | 'createdAt'>): Promise<Branch>;
  getBranch(id: string): Promise<Branch | null>;
  listBranches(projectId: string): Promise<Branch[]>;
}
// Also: ProjectRepository, ArtifactRepository, AIRunRepository,
//       ProposalRepository, SpecificationRepository, TestCaseRepository
```

### Supabase Implementations (`supabase/`)

16 repository implementations including:
- `client.ts` — Singleton Supabase client
- `factory.ts` — Repository factory
- `graph-repository.ts`, `patch-repository.ts`, `branch-repository.ts`
- `project-repository.ts`, `artifact-repository.ts`
- `ai-run-repository.ts`, `proposal-repository.ts`
- `specification-repository.ts`, `requirements-repository.ts`
- `catalog-repository.ts`, `template-repository.ts`
- `test-case-repository.ts`, `code-structure-repository.ts`

### Realtime Strategy (`realtime-strategy.ts`)

Supabase realtime subscriptions for live collaboration:

```typescript
function subscribeToPatches(branchId: string, callback: (patch) => void): Subscription
```

---

## UI Layer

**Location**: `src/ui/`

### Component Structure

```
src/ui/
├── components/
│   ├── GraphEditor.tsx              # Main application component
│   ├── admin/                       # Admin dashboard, blog CMS, subscriptions
│   ├── auth/                        # Authentication, landing pages, feature showcase
│   ├── blog/                        # Public blog pages and rendering
│   ├── nodes/                       # Node renderers (Base, Container, Icon, Specialized)
│   ├── edges/                       # Custom edge renderers (CustomEdge, ContainerSummaryEdge)
│   ├── panels/                      # Inspector, workbench, settings, specification panels
│   │   ├── TopBar.tsx               # Actions, help, theme toggle
│   │   ├── AIChatPanel.tsx          # AI chat with agent routing
│   │   ├── SidePanel.tsx            # Activity log (patches)
│   │   ├── ArtifactWorkbenchPanel.tsx # Multi-artifact editor with AI
│   │   ├── SpecificationPanelV3.tsx # Specification management
│   │   └── import-wizard/          # Repository import wizard
│   ├── proposal/                    # AI proposal review and diff views
│   ├── pricing/                     # Pricing pages and subscription UI
│   ├── spec-v3/                     # Specification panel (features, requirements)
│   ├── templates/                   # Template marketplace and preview canvas
│   ├── layout/                      # Canvas, palette, sidebar
│   │   ├── Canvas.tsx               # Main canvas with controls
│   │   ├── ContainerLayer.tsx       # Container overlay rendering
│   │   └── TabbedSidebar.tsx        # Left sidebar (palette + catalog)
│   ├── legal/                       # Terms of service, privacy policy
│   ├── editor/                      # Code editor (Monaco)
│   └── common/                      # Shared UI components
│       ├── LayerModeToggle.tsx      # Functional/Deployment/Compact/Depth controls
│       ├── (EdgeLegend.tsx removed — the legend lives in Ontology.md §4)
│       ├── EdgeVisibilityPopover.tsx # Edge type filter popover
│       └── ...                      # Modals, tooltips, badges, etc.
│
├── services/                        # 23 UI service modules
│   ├── AgentService.ts              # SSE streaming client for agents
│   ├── AuthService.ts               # Supabase auth wrapper
│   ├── SubscriptionService.ts       # Stripe subscription management
│   ├── TemplateService.ts           # Template marketplace operations
│   ├── SpecificationService.ts      # Specification CRUD
│   ├── TestCaseService.ts           # Test case management
│   ├── CatalogService.ts            # Technology catalog loading
│   └── ...                          # 16 additional services
│
├── hooks/                           # 14 custom React hooks
│   ├── useAgentStream.ts            # React hook for agent streaming
│   ├── useFeatureGate.ts            # Subscription-based feature gating
│   ├── useCatalog.ts                # Technology catalog access
│   ├── useRealtimeSpecification.ts  # Live specification updates
│   └── ...
│
├── adapters/
│   ├── graph-to-reactflow.ts        # Domain Graph → ReactFlow nodes/edges
│   ├── interaction-to-patch.ts      # UI Events → Patch operations
│   └── rf-visual-type-resolver.ts   # ReactFlow component selector
│
├── builders/
│   └── patchBuilders.ts             # UI-level patch builder utilities
│
├── context/
│   ├── ServiceContext.tsx            # Service dependency injection
│   └── ProjectSwitchContext.tsx      # Project switching state
│
├── store/
│   ├── branch-store.ts              # Branch and graph state management
│   └── notification-store.ts        # Notification state
│
└── theme/
    ├── index.ts                     # Light/dark theme definitions
    └── ThemeContext.tsx              # Theme provider + hook
```

### Data Flow

```
User Interaction (drag node, edit label, click artifact)
    ↓
React Event Handler
    ↓
interaction-to-patch.ts (converts to domain patch)
    ↓
Domain Validation (patch-engine.ts)
    ↓
BranchStore.applyPatch() (updates state)
    ↓
Persistence (save to Supabase)
    ↓
graph-to-reactflow.ts (converts back to ReactFlow)
    ↓
ReactFlow Re-render
```

### Canvas Controls

**Bottom-center**: `LayerModeToggle` — stacked column of pills (from top to bottom):
1. Depth pills (D1 / D2 / D3 / All) — shown in nested edge mode
2. "All Edges" visibility popover — shown in nested edge mode
3. Regular / Compact toggle
4. Functional / Deployment mode toggle (always visible)

**Bottom-left**: Canvas action buttons:
- *(`EdgeLegend` was removed; the edge visual key is documented in `Ontology.md` §4.)*
- Auto-layout button (Ctrl+L)
- Expand/Retract/Reorganize buttons

### Theme System

**Light Mode**: Background `#f5f7fa`, Surface `#ffffff`, Primary `#0066cc`, Text `#2e3440`
**Dark Mode**: Background `#1a1d24`, Surface `#20242e`, Primary `#5c9eff`, Text `#e5e9f0`

Persistent via `localStorage`.

### Node Position: UI-Only State

**Critical Design Decision**: Node X/Y positions are ephemeral ReactFlow state.
- Moving nodes does NOT create patches
- Positions NOT persisted to database
- Positions reset on page reload
- This prevents patch log pollution and separates visual layout from domain semantics

---

## AI Integration

### Agentic Architecture

AI capabilities are delivered through **tool-calling agents** — edge functions that run in a loop, calling tools against the database and streaming progress to the frontend via Server-Sent Events (SSE).

```
Frontend (AgentService + useAgentStream)
    ↓ POST with JWT + params
Agent Edge Function (e.g., agent-orchestrator-v4)
    ↓ validates JWT, checks project ownership
    ↓ creates SSE response stream
    ↓ enters agent loop (OpenAI/Anthropic tool-calling)
    ├── LLM decides which tool to call
    ├── Tool executes (DB write + SSE event)
    ├── Result fed back to LLM
    └── Repeats until LLM says "stop" or maxTurns reached
    ↓
Frontend receives real-time SSE events
```

### Shared Agent Infrastructure

All agents share a common set of backend modules in `supabase/functions/_shared/` (25 modules):

| Module | Purpose |
|--------|---------|
| `agent-runner-v4.ts` | Generic agent loop: system prompt + tools → LLM tool-calling loop |
| `agent-loop-v4.ts` | Architecture-specific agent loop with graph context loading |
| `phased-agent-runner-v4.ts` | Multi-phase agent runner for complex generation pipelines |
| `tool-executor.ts` | Executes architecture tools (add_node, add_edge, etc.) against DB |
| `streaming.ts` | SSE emitter with typed events and optional event persistence |
| `auth-helpers.ts` | JWT validation, userId extraction for orchestrator functions |
| `token-tracker.ts` | Token usage tracking and enforcement |
| `token-enforcer.ts` | Budget enforcement for token-limited tiers |
| `catalog-loader.ts` | Technology catalog loading for AI context |
| `technology-relevance.ts` | Technology relevance scoring for architecture suggestions |
| `role-registry.ts` | Node role registry for type validation |
| `graph-schema.ts` | Graph schema definitions for validation |
| `architecture-validator.ts` | Architecture validation rules |
| `validation.ts` | General validation utilities |
| `import-patch-generator.ts` | Patch generation for repository imports |
| `mcp-context-assembly.ts` | MCP context assembly (richest AI context format) |
| `mcp-overview-assembly.ts` | MCP project overview context |
| `mermaid-formatter.ts` | Architecture diagram export as Mermaid |
| `task-document-generator.ts` | Generates `.nodespec/tasks/*.task.md` artifacts |
| `test-document-generator.ts` | Generates test case documents |
| `ai-context-helpers.ts` | AI context formatting helpers |
| `ai-provider.ts` | Multi-provider AI client (OpenAI, Anthropic, BYOK) |
| `crypto.ts` | Cryptographic utilities |
| `enums.ts` | Shared enum definitions (synced with `src/shared/enums.ts`) |
| `legacy-mappings.ts` | Legacy type mapping utilities |

### Agent Edge Functions (28 deployed)

#### Architecture Agent (`agent-orchestrator-v4`)

Entry point for architecture-related AI operations. Creates nodes, edges, contracts, and ports on a branch.

**Request**: `{ projectId, branchId, message, specificationId?, maxTurns?, model? }`
**Auth**: JWT via `Authorization: Bearer <token>`
**Tools**: `add_node`, `add_edge`, `add_contract`, `add_port`, `remove_node`, `remove_edge`, `update_node`, `list_nodes`, `list_edges`, `get_node`

### SSE Event Types

| Event Type | Payload |
|-----------|---------|
| `status` | `{ message }` |
| `thinking` | `{ message }` |
| `tool_call` | `{ tool, args }` |
| `tool_result` | `{ tool, result }` |
| `node_created` | `{ id, label, type, technology }` |
| `edge_created` | `{ id, sourceLabel, targetLabel, contractName }` |
| `contract_created` | `{ id, name, kind }` |
| `port_added` | `{ nodeId, nodeLabel, portName, direction }` |
| `node_removed` | `{ id, label }` |
| `error` | `{ message }` |
| `complete` | `{ summary, patchCount, patches }` |

### Frontend Agent Integration

**`AgentService`** (`src/ui/services/AgentService.ts`): Connects to agent endpoints, sends a POST with JWT auth, processes the SSE stream.

**`useAgentStream`** (`src/ui/hooks/useAgentStream.ts`): React hook wrapping `AgentService`. Manages running state, accumulates nodes/edges/toolCalls, exposes `runAgent`, `cancel`, `reset`.

### Authentication Pattern

1. Frontend includes `Authorization: Bearer <access_token>` header
2. Agent calls `extractOrchestratorAuth(req)` — validates JWT via `supabase.auth.getUser()`
3. Agent verifies project ownership: `projects.owner_id = userId`
4. Downstream internal calls pass `userId` in the request body

### MCP Server (`mcp-server`)

A Model Context Protocol server that enables external AI agents (Claude Code, Cursor, etc.) to access NodeSpec project context. Deployed as a Supabase Edge Function and proxied via Cloudflare Worker at `mcp.nodespec.io`.

**Protocol Support:**
- JSON-RPC 2.0 (MCP protocol version 2025-03-26)
- Batch requests and notifications
- MCP session ID header support

**Authentication Methods:**
- OAuth 2.0 with PKCE (S256 code challenge required)
- API key via `X-MCP-API-Key` header
- JWT via `Authorization: Bearer <token>`

**OAuth 2.0 Endpoints:**
- `/.well-known/oauth-authorization-server` — OAuth metadata discovery
- `/.well-known/protected-resource` — Resource metadata
- `/register` — Dynamic client registration (no auth required)
- `/authorize` — Authorization endpoint with PKCE validation
- `/token` — Token exchange endpoint

**Scopes:** `read`, `write`, `propose`

**Context Formats:**
- **Full node context**: Richest format with technologyContext, contracts with schema content, ports, traceability
- **Project overview**: Condensed project summary for initial orientation

**Security:** Turnstile CAPTCHA integration, MFA support with TOTP verification, session tokens for streamlined approval.

### MCP Admin Template Tools (`mcp-admin-template`)

A separate MCP endpoint for admin template authoring and management. Requires admin authentication (`app_metadata.is_admin === true`).

**Tools (6):**
1. `get_template_authoring_context` — Returns complete catalog context (node roles, technologies, deployment targets, scope archetypes, enums, schema documentation)
2. `validate_template` — Validates template payloads with detailed errors/warnings
3. `publish_template` — Creates new official templates with graph_data validation
4. `update_template` — Modifies existing templates by ID or slug
5. `list_templates_admin` — Lists templates with filtering (category, author_type, is_public)
6. `delete_template` — Permanently deletes templates and associated usage/upvote records

**Template Categories (10):**
```
general | saas | e-commerce | microservices | iot | mobile | data-pipeline | real-time | ai-ml | devops
```

**Template Schema:**
- `graph_data`: Validated graph structure (nodes, edges, contracts, artifacts, schemaVersion, version, hash)
- `template_specification`: Optional structured spec (vision, preferences, requirements, mappings)
- Metadata: node_count, edge_count, author_type (official|community), is_public, is_featured, use_count, upvote_count

---

## Development

### Environment Setup

```bash
npm install
# .env:
# VITE_SUPABASE_URL=<your-supabase-url>
# VITE_SUPABASE_ANON_KEY=<your-anon-key>

npm run build
```

### Database Migrations

250+ migrations in `supabase/migrations/`. Apply via Supabase Dashboard or CLI. All migrations are idempotent with `ON CONFLICT DO NOTHING`.

### Project Structure

```
nodespec/
├── src/
│   ├── domain/              # Pure TypeScript domain logic (~50 files)
│   │   ├── types.ts, schemas.ts, patch-engine.ts, patch-factory.ts
│   │   ├── branch.ts, draft-semantics.ts, ai-proposal.ts, obligations.ts
│   │   ├── specification.ts, scaffold-prompt-builder.ts
│   │   ├── detection/       # AI detection strategies
│   │   ├── generation/      # AI generation system
│   │   ├── repo-import/     # Repository import pipeline
│   │   └── validation/      # Validation engine (11 rules)
│   │
│   ├── persistence/         # Data layer
│   │   ├── ports.ts         # Repository interfaces
│   │   ├── supabase/        # 16 repository implementations
│   │   └── testing/         # Mock repositories
│   │
│   ├── ui/                  # React UI
│   │   ├── adapters/        # Domain <-> UI boundary
│   │   ├── builders/        # Patch builder utilities
│   │   ├── components/      # React components (15 subdirectories)
│   │   ├── context/         # React context providers
│   │   ├── hooks/           # Custom React hooks (14 hooks)
│   │   ├── services/        # UI service layer (23 services)
│   │   ├── store/           # State management
│   │   ├── theme/           # Light/dark theme system
│   │   └── utils/           # UI utilities
│   │
│   └── tests/               # Test suite (102 test files)
│
├── supabase/
│   ├── migrations/          # 250+ database migrations
│   └── functions/           # 28 edge functions + 25 shared modules
│       ├── _shared/         # Shared infrastructure (25 modules)
│       ├── agent-orchestrator-v4/
│       ├── analyze-repo-import-v4/
│       ├── analyze-repo-tree/
│       ├── code-detection-v4/
│       ├── generate-test-cases-v4/
│       ├── parse-all-code-v4/
│       ├── parse-code-structure-v4/
│       ├── suggest-node-mappings-v4/
│       ├── validate-implementation-v4/
│       ├── detect-dependencies/
│       ├── git-pull/, git-push/, git-webhook/
│       ├── manage-ai-keys/
│       ├── mcp-server/
│       ├── mcp-admin-template/
│       ├── stripe-checkout/, stripe-webhook/
│       ├── cancel-subscription/, sync-subscription/
│       ├── cron-sync-subscriptions/
│       ├── create-free-customer/
│       ├── admin-update-subscription/
│       ├── save-git-integration/
│       ├── delete-account/
│       ├── provisioning-health/
│       └── sitemap/
│
└── scripts/                 # Development utilities
```

### File Naming Conventions

- TypeScript: `kebab-case.ts`
- React Components: `PascalCase.tsx`
- Tests: `*.test.ts`
- Edge Functions: `kebab-case-v4/` (for AI agent functions, `-v4` suffix)

---

## Testing

### Test Suite Overview

**Test Files**: 102
**Pass Rate**: 100%

### Test Organization

**Domain Tests** (`src/tests/`):
- `patch-engine.test.ts` — Patch validation and application
- `patch-builders.test.ts` — Safe patch construction
- `branch.test.ts` — Branch operations and replay
- `draft-semantics.test.ts` — Draft lifecycle
- `ai-proposal.test.ts` — AI proposal system
- `ai-edge-function.test.ts` — AI integration
- `specification-parsing.test.ts` — Specification system
- `artifact-validation.test.ts` — Contract-aware validation
- `obligations.test.ts` — Obligation derivation
- `event-log.test.ts` — Event tracking
- ...and 90+ additional test files

**Test Patterns:**

```typescript
describe('Feature', () => {
  it('should behave correctly', () => {
    // Arrange
    const graph = createEmptyGraph();
    const patch = buildAddNodePatch({ type: 'backend-service', label: 'API' });

    // Act
    const result = applyPatch(graph, patch);

    // Assert
    expect(result.success).toBe(true);
    expect(result.graph?.nodes[patch.payload.id]).toBeDefined();
  });
});
```

---

## Deployment

### Frontend Deployment

```bash
npm run build   # Output: dist/
```

Deploy `dist/` to Netlify (production: https://nodespec.io), Vercel, Cloudflare Pages, or any static hosting.

### Environment Variables

```
VITE_SUPABASE_URL=<your-supabase-url>
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### Supabase Configuration

1. Run all migrations from `supabase/migrations/`
2. Deploy all edge functions via Supabase CLI or dashboard
3. RLS is enabled on all tables — no additional configuration needed
4. Enable Realtime on: `graph_patches`, `project_specifications`, `features`, `requirements`, `test_cases`, `stripe_subscriptions`

---

## Active Edge Functions (28)

### AI & Architecture
- **agent-orchestrator-v4** — Architecture agent: creates nodes, edges, contracts, ports via tool-calling loop with SSE streaming
- **suggest-node-mappings-v4** — AI-powered mapping suggestions between requirements and architecture nodes
- **generate-test-cases-v4** — AI-powered test case generation from requirements and acceptance criteria

### Code Analysis
- **code-detection-v4** — AI-powered code structure detection
- **parse-code-structure-v4** — Parse code files into structured format
- **parse-all-code-v4** — Batch code parsing for all project files
- **analyze-repo-import-v4** — Repository analysis for architecture import (4-phase pipeline)
- **analyze-repo-tree** — Directory classification by architectural role using NodeSpec v7 ontology
- **detect-dependencies** — Dependency detection for imported repositories
- **validate-implementation-v4** — Implementation validation against requirements

### Git Integration
- **git-pull** — Pull changes from remote git repository
- **git-push** — Push changes to remote git repository
- **git-webhook** — Inbound webhook handler for git events
- **save-git-integration** — Git settings persistence

### MCP & AI Keys
- **mcp-server** — Model Context Protocol server with OAuth 2.0 + PKCE and JSON-RPC 2.0 for external AI agent access
- **mcp-admin-template** — Admin template authoring and management tools (validate, publish, update, list, delete)
- **manage-ai-keys** — Multi-provider AI API key management (encrypt/decrypt)

### Billing & Subscriptions
- **stripe-checkout** — Stripe checkout session creation
- **stripe-webhook** — Stripe webhook handler for payment events
- **cancel-subscription** — Subscription cancellation
- **sync-subscription** — Subscription sync with Stripe
- **cron-sync-subscriptions** — Scheduled subscription synchronization
- **create-free-customer** — Free tier customer provisioning
- **admin-update-subscription** — Admin subscription management

### Account & System
- **delete-account** — Account deletion with data cleanup
- **provisioning-health** — Health monitoring for provisioning
- **sitemap** — Dynamic sitemap generation for SEO

---

## Node Role Ontology

### Role Kind Classification (12 active kinds)

The `type` field on a node is a **role ID** from the `node_roles` table:

| Kind | Example Role IDs |
|------|-----------------|
| `app_service` | `backend-service`, `frontend-app`, `worker`, `rest-api`, `graphql-api` |
| `data_store` | `database`, `cache`, `object-storage`, `feature-store` |
| `messaging` | `message-broker`, `queue`, `event-stream` |
| `platform` | `aws`, `supabase`, `gcp`, `azure`, `firebase`, `cloudflare` |
| `platform_capability` | `aws-lambda`, `supabase-auth`, `supabase-storage`, `aws-s3` |
| `deployment_container` | `vpc`, `k8s-cluster`, `docker-compose`, `cloud-project`, `cdn` |
| `logical_group` | `bounded-context`, `software-layer`, `microservice-boundary` |
| `hardware_device` | `sensor`, `microcontroller`, `robot` |
| `automation_pipeline` | `ci-pipeline`, `ml-pipeline`, `cd-pipeline` |
| `external_system` | `external-service` |
| `observability` | `monitoring`, `logging` |
| `game` | `game-engine-project` |

### Palette Categories (13 groups)

| palette_category | Display Label | Contents |
|-----------------|---------------|----------|
| `Services` | Services | frontend-app, mobile-app, backend-service, worker, realtime-service, webhook, rest-api, graphql-api, static-site |
| `Database` | Data & Storage | database, cache, object-storage, search-engine, feature-store |
| `Networking` | Networking | api-gateway, load-balancer, cdn, service-mesh |
| `AI & ML` | AI & ML | llm-gateway, inference-service, ai-agent-service, ml-pipeline, vector-database |
| `Messaging` | Messaging | message-broker, queue, event-stream, event-bus |
| `Infrastructure` | Infrastructure | vpc, k8s-cluster, docker-compose, cloud-project |
| `Platform` | Platforms | aws, supabase, gcp, azure, firebase, cloudflare |
| `Automation` | Automation | ci-pipeline, cd-pipeline, iac-pipeline |
| `External` | Integrations | external-service |
| `Observability` | Observability | monitoring, logging |
| `Hardware` | Hardware & IoT | sensor, microcontroller, embedded-system, robot |
| `Game Development` | Game Dev | game-engine-project |
| `Logical` | Structure | bounded-context, software-layer, shared-library, microservice-boundary |

**Note**: Platform capabilities (aws-lambda, supabase-auth, etc.) are NOT shown in the palette. They appear contextually inside platform containers only.

### Node Type vs. Legacy Mappings

**Current system (v7+ ontology):** Node `type` = role ID (e.g., `backend-service`, `database`, `frontend-app`)

**Legacy compatibility:** The `legacy_type_mappings` table maps old dotted-notation strings (e.g., `frontend.react`, `database.postgresql`) to modern role IDs + technology IDs. These are migration artifacts, not current type identifiers.

---

## Template Marketplace

Four production templates currently available:

| Template | Stack | Description |
|----------|-------|-------------|
| AWS Full-Stack Web App | React + Node.js + AWS (ECS, RDS, S3, CloudFront) | Cloud-native full-stack on AWS |
| GCP Full-Stack Web App | React + Node.js + GCP (Cloud Run, Cloud SQL, GCS) | Cloud-native full-stack on GCP |
| Next.js + Supabase + Stripe | Next.js + Supabase (Auth, DB, Storage) + Stripe | Modern SaaS starter |
| AI RAG Pipeline | LLM Gateway + Vector DB + Embedding Service | Retrieval-Augmented Generation |

### Template Administration

Admin users (`app_metadata.is_admin === true`) can manage templates via the `mcp-admin-template` edge function, which exposes MCP tools for the full template lifecycle: authoring context retrieval, validation, publish, update, list, and delete. Templates are validated against the graph schema and support 10 categories.

Templates are stored in `project_templates` with admin-specific RLS policies allowing management of `author_type = 'official'` templates.

---

## Key Files Quick Reference

| File | Purpose |
|------|---------|
| `src/domain/types.ts` | Core type definitions |
| `src/domain/schemas.ts` | Zod validation schemas |
| `src/domain/patch-engine.ts` | Patch validation & application |
| `src/domain/branch.ts` | Branch operations |
| `src/domain/scaffold-prompt-builder.ts` | AI context building for code gen |
| `src/persistence/ports.ts` | Repository interfaces |
| `src/shared/enums.ts` | Client-side enum definitions |
| `src/ui/components/GraphEditor.tsx` | Main UI component |
| `src/ui/store/branch-store.ts` | State management |
| `src/ui/services/AgentService.ts` | Frontend agent streaming client |
| `src/ui/hooks/useAgentStream.ts` | React hook for agent streaming |
| `src/ui/adapters/graph-to-reactflow.ts` | Domain→ReactFlow adapter |
| `src/ui/components/edges/CustomEdge.tsx` | Edge rendering (color + dash) |
| *(removed)* `EdgeLegend.tsx` | Edge visual key now lives in `Ontology.md` §4 |
| `src/ui/components/panels/AIChatPanel.tsx` | AI chat with agent routing |
| `supabase/functions/agent-orchestrator-v4/index.ts` | Architecture agent |
| `supabase/functions/_shared/agent-runner-v4.ts` | Generic agent loop |
| `supabase/functions/_shared/agent-loop-v4.ts` | Architecture agent loop |
| `supabase/functions/_shared/streaming.ts` | SSE event streaming |
| `supabase/functions/_shared/auth-helpers.ts` | Agent JWT auth |
| `supabase/functions/_shared/mcp-context-assembly.ts` | MCP context format |
| `supabase/functions/_shared/enums.ts` | Server-side enum definitions |

---

## Version History

- **1.4.0** (2026-07-05): MCP enhancements, pricing restructure, domain cleanup
  - MCP server upgraded with OAuth 2.0 + PKCE authentication and JSON-RPC 2.0 protocol support
  - Added `mcp-admin-template` edge function for template authoring and management (6 tools)
  - Added `analyze-repo-tree` edge function for directory classification by architectural role
  - Added `ai_proposal_artifacts` table for large repository import artifact storage
  - Added admin RLS policies for template management
  - BYOK-primary pricing strategy: 600K lifetime platform tokens across all tiers
  - Palette categories restructured to 13 groups (Services, Database, Networking, AI & ML, Messaging, Infrastructure, Platform, Automation, External, Observability, Hardware, Game Development, Logical)
  - Removed `specification_features` table and features domain entirely (requirements-only approach)
  - 250+ database migrations
  - 28 deployed edge functions

- **1.3.0** (2026-05-17): Ontology v7 alignment + new features
  - Updated contract kinds to canonical 11-value enum: `rest | graphql | grpc | websocket | sse | kafka | amqp | sql | nosql | ipc | custom`
  - Added Supabase Storage (`supabase-storage`) technology catalog entry
  - Updated Next.js template: replaced AWS S3 with Supabase Storage inside Supabase platform container
  - Added EdgeLegend component (expandable edge type key on canvas)
  - Canvas controls repositioned: Regular/Compact and All Edges flush with Functional/Deployment pills
  - Added MCP server edge function for external AI agent connectivity
  - Added `manage-ai-keys` edge function for multi-provider AI key management
  - Added `git-webhook` edge function for inbound git events
  - Added `generate-test-cases-v4` edge function
  - Expanded `_shared/` to 25 modules
  - Graph schemaVersion updated to 8
  - 150+ database migrations
  - Clarified Role + Technology separation throughout documentation

- **1.2.0** (2026-03-26): Production consolidation
  - 102 test files with 100% pass rate
  - Added Stripe subscription management
  - Added template marketplace (AWS, GCP, Next.js + Supabase + Stripe)
  - Added blog CMS with TinyMCE
  - Added repository import and dependency detection
  - Added acceptance criteria validation

- **1.1.0** (2026-02-06): Agentic AI architecture
  - Tool-calling agent edge functions
  - AgentService (SSE streaming client) and useAgentStream hook
  - JWT-based agent authentication

- **1.0.0** (2026-01-05): Initial production release

---

**Documentation Last Updated**: 2026-07-05
**Specification Version**: 1.4.0
