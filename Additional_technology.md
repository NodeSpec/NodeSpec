# Additional Technology Guide

Complete reference for adding node roles, platform capabilities, or technology entries to the NodeSpec ontology catalog. Intended for use by a third-party AI generating Supabase SQL migrations.

---

## Section 1: Purpose and Audience

This document enables an AI to produce Supabase SQL migrations that modify three tables:

1. **`node_roles`** -- Defines architectural building blocks shown in the canvas palette
2. **`technology_catalog`** -- Defines concrete implementations that attach to roles
3. **`legacy_type_mappings`** -- Maps old dotted-notation types to the modern role+technology split

### Three Types of Additions

| Type | Table(s) Affected | Example |
|------|-------------------|---------|
| New Node Role | node_roles + optionally legacy_type_mappings | Adding "GraphQL Federation Gateway" |
| New Platform Capability | node_roles + technology_catalog + parent platform update | Adding "AWS AppSync" |
| New Technology | technology_catalog + legacy_type_mappings | Adding "Bun" runtime |

All additions must be idempotent SQL that can be re-run without error or data loss.

### Data-only additions vs. changes that need app code

**Adding technologies, platforms, and roles is a pure DATA operation.** The canvas, the palette sidebar, categorization, the technology picker, node logos, and availability to the internal/external AI are ALL driven from these three Postgres tables plus icon files in storage. When the catalog reloads (on next app load), new rows automatically populate everywhere. You do NOT need to change the React SPA, and there is NO Zod / TypeScript enum that lists node types, roles, or categories that could reject a new row — none of these values are hard-coded in validation schemas.

To add a technology or platform end-to-end with data only:
1. Insert the `node_roles` / `technology_catalog` / `legacy_type_mappings` rows (idempotent SQL).
2. Upload the logo to the icon storage bucket and set `technology_catalog.icon_url` to its public URL. The picker and canvas render it automatically; if omitted, they fall back to the role icon, then a colored initial.

That is the whole flow. No code deploy, no schema/type edits.

**There are exactly THREE things that CANNOT be introduced by data alone — each requires an app code change first:**

| Trigger | Why | Safe fallback if you ignore it |
|---------|-----|--------------------------------|
| A `palette_category` value not in the 13-category list | The sidebar's category order/icon/primary map is defined in app code (`palette-roles.ts`) | Row still loads, but the category sinks to an ungrouped bucket at the bottom with a generic icon and is never primary |
| An `icon_name` not in the icon allowlist | Role icons resolve from a fixed lookup map in app code, not the full Lucide set | Renders as a generic box icon |
| An `rf_visual_type` not in the 11-value list | The ReactFlow component selector is defined in app code | Silently falls back to the `service` node visual |

**Rule for a third-party AI: stay strictly within the three allowlists above (categories, icon names, rf_visual_types).** If a genuinely new category, icon, or visual type is required, flag it as needing an app code change rather than inventing a value in the migration.

---

## Section 2: The node_roles Table Schema

### All 25 Columns

| # | Column | Type | Nullable | Default | Purpose |
|---|--------|------|----------|---------|---------|
| 1 | `id` | text PK | NO | - | Kebab-case slug (e.g., `backend-service`) |
| 2 | `label` | text | NO | - | Display name in palette/inspector |
| 3 | `description` | text | NO | `''` | Tooltip text |
| 4 | `icon_name` | text | NO | `'box'` | Lucide icon name — MUST be from the allowlist in "Choosing icon_name" (unlisted names render as a box) |
| 5 | `color` | text | NO | `'#6b7280'` | Hex color for borders/badges |
| 6 | `rf_visual_type` | text | NO | `'service'` | ReactFlow node component selector — MUST be one of the 11 valid values (see "Setting rf_visual_type"; unlisted values fall back to `service`) |
| 7 | `palette_category` | text | NO | `'general'` | Palette sidebar grouping — MUST be EXACTLY one of the 13 valid values (see "How to Assign palette_category"; the `'general'` default is a fallback, not a valid category, so always set this explicitly) |
| 8 | `is_container` | boolean | NO | `false` | Can this role contain child nodes? |
| 9 | `container_layer` | text | YES | null | Nesting hierarchy level |
| 10 | `can_contain` | jsonb | YES | `'[]'` | Allowed child roles (array or rule object) |
| 11 | `metadata_schema` | jsonb | YES | `'{}'` | Inspector config fields definition |
| 12 | `default_ports` | jsonb | YES | `'[]'` | Auto-created ports on node creation |
| 13 | `suggested_contracts` | jsonb | YES | `'[]'` | Recommended interaction patterns |
| 14 | `sort_order` | integer | NO | `0` | Position within palette category |
| 15 | `created_at` | timestamptz | NO | `now()` | Row creation time |
| 16 | `updated_at` | timestamptz | NO | `now()` | Last modification time |
| 17 | `container_style` | text | YES | null | Visual style for containers |
| 18 | `capability_tags` | text[] | YES | `'{}'` | Searchable keyword tags |
| 19 | `kind` | text | NO | `'app_service'` | Broad classification |
| 20 | `functional_kind` | text | YES | null | Finer-grained classification |
| 21 | `deprecated` | boolean | NO | `false` | Soft-delete flag |
| 22 | `provider` | text | YES | null | Cloud vendor (aws, gcp, azure, etc.) |
| 23 | `when_to_use` | text | YES | null | AI selection guidance |
| 24 | `palette_category_label` | text | YES | null | Human-friendly category label |
| 25 | `default_technology` | text | YES | null | Auto-assigned technology_catalog.id |

### kind Constraint (13 valid values)

```
app_service           -- Standard application services (APIs, workers, frontends)
automation_pipeline   -- CI/CD, ETL, ML pipelines
data_store            -- Databases, caches, object stores
deployment_container  -- Environments that host other nodes
external_system       -- Third-party integrations
game                  -- Game-specific nodes
hardware_device       -- Physical IoT/embedded devices
logical_group         -- Organizational groupings
messaging             -- Queues, event buses, brokers
observability         -- Logging, monitoring, tracing
platform              -- Top-level cloud platforms
platform_capability   -- Vendor-specific managed services
requirement           -- Specification requirement nodes
```

### functional_kind Constraint (11 valid values or NULL)

```
ai_runtime        -- LLM gateways, inference endpoints
auth              -- Authentication/authorization services
compute           -- Generic compute (lambdas, pipelines)
data_store        -- Data persistence
deployment        -- Deployment targets
edge_runtime      -- Edge compute functions (Cloudflare Workers, etc.)
event_bus         -- Event routing/distribution
infrastructure    -- Networking, load balancing
messaging         -- Message transport
object_storage    -- Blob/file storage
observability     -- Monitoring, logging, tracing
```

### container_layer Constraint (4 valid values or NULL)

```
infrastructure  -- VPC, hypervisor, bare-metal
orchestration   -- Kubernetes, Docker Swarm, Nomad
runtime         -- Desktop app, mobile device
logical         -- Software layers, service meshes
```

### container_style Constraint (2 valid values or NULL)

```
hosting          -- Solid boundary with resize handles (19 containers)
logical-boundary -- Dashed boundary for logical grouping (7 containers)
```

### rf_visual_type Constraint (11 valid values)

```
service         -- Standard service node with metadata (38 roles)
icon            -- Compact icon-only node (37 roles)
container       -- Expandable container node (28 roles)
queue           -- Message queue visual (2 roles)
external        -- External system visual (2 roles)
api             -- API-specific visual (1 role)
cache           -- Cache-specific visual (1 role)
requirement     -- Requirements node (1 role)
database        -- Data-store visual (renders like a service node)
logicalBoundary -- Logical grouping boundary (auto-selected when container_style = 'logical-boundary')
library         -- Shared library / package node
```

Any value outside this set silently falls back to `service`. Note the exact casing of `logicalBoundary`.

### can_contain Format Constraint

Two valid formats:

**Format A: Simple array** (used by non-platform containers)
```json
["backend-service", "frontend-app", "worker", "database", "cache"]
```

**Format B: Rule object** (used by aws, gcp, azure platform containers)
```json
{
  "roleIds": ["aws-lambda", "aws-s3", "aws-sqs", "aws-rds"],
  "providers": ["aws"]
}
```

In Format B, a child is allowed if it matches EITHER the `roleIds` list OR has a matching `provider` field.

---

## Section 3: Adding a New Node Role

### Required Fields

Every role MUST have: `id`, `label`, `kind`, `rf_visual_type`, `palette_category`, `sort_order`

### Sensible Defaults

| Field | Default if omitted | When to override |
|-------|-------------------|-----------------|
| `description` | `''` | Always provide a description |
| `icon_name` | `'box'` | Pick a name from the allowlist in "Choosing icon_name" below (NOT any lucide.dev icon) |
| `color` | `'#6b7280'` | Always set a meaningful brand color |
| `is_container` | `false` | Only true for hosting/grouping roles |
| `functional_kind` | `null` | Set when a finer classification applies |
| `provider` | `null` | Only for platform_capability roles |
| `default_technology` | `null` | Only for platform_capability roles |

### How to Pick kind

| If the role... | Use kind |
|----------------|----------|
| Runs application code (APIs, workers, frontends) | `app_service` |
| Stores data persistently | `data_store` |
| Hosts/contains other nodes | `deployment_container` |
| Is a cloud vendor's managed service | `platform_capability` |
| Processes pipelines (CI/CD, ETL, ML) | `automation_pipeline` |
| Transports messages between services | `messaging` |
| Monitors or logs | `observability` |
| Is physical hardware | `hardware_device` |
| Is a logical grouping | `logical_group` |
| Is a top-level platform | `platform` |
| Is a third-party external system | `external_system` |
| Is game-related | `game` |

### How to Pick functional_kind

| If the role primarily... | Use functional_kind |
|--------------------------|---------------------|
| Serves AI/ML inference | `ai_runtime` |
| Handles authentication | `auth` |
| Runs generic compute | `compute` |
| Stores structured data | `data_store` |
| Deploys workloads | `deployment` |
| Routes events | `event_bus` |
| Manages network infrastructure | `infrastructure` |
| Transports messages | `messaging` |
| Stores blobs/files | `object_storage` |
| Monitors/logs/traces | `observability` |

### Choosing icon_name

**HARD RULE: `icon_name` MUST be one of the exact strings in the allowlist below.** The role icon is resolved from a fixed lookup map in the app, NOT from the full lucide.dev catalog. A name that is not in this list (or has the wrong casing) silently renders as a generic box icon. Do NOT assume "any Lucide icon works" — only these registered names do.

Allowed `icon_name` values (reproduce exactly, casing matters):

```
server, database, monitor, lock, brain, globe, zap, box, activity, cloud,
layers, folder, external-link, download, smartphone, cpu, shield, network,
mail, search, trending-up, share-2, arrow-right-left, git-branch, radio,
git-merge, hard-drive, file-text, clock, cog, package, hexagon, library,
ClipboardList, gamepad-2, Gamepad2, Terminal, Webhook, Bot, Thermometer,
Router, Archive, Megaphone, ScrollText, Warehouse, ListOrdered
```

Pick the closest semantic match (e.g. `server` for compute, `database` for stores, `brain` for AI/ML, `network`/`router`/`shield` for networking, `git-branch` for pipelines, `activity` for observability, `cpu`/`Thermometer` for hardware, `Gamepad2` for game, `external-link`/`Webhook` for integrations). If nothing fits well, use `box`. Adding a genuinely new icon name requires an app code change (see "Data-only additions vs. changes that need app code").

### How to Assign palette_category and sort_order

**HARD RULE: `palette_category` MUST be one of the exact 13 strings below — nothing else.** The sidebar groups roles by this exact string (case- and space-sensitive). A value outside this list still renders, but it lands in an ungrouped bucket at the very bottom of the palette (sort order 99), gets a generic box icon, and is never treated as a primary category. Do not invent new category names. Do not use `Backend`, `Frontend`, `API`, `Worker`, `Data`, `Services & Apps`, or any variant — those are NOT valid categories.

| palette_category (exact) | Suggested palette_category_label | Primary | Use for |
|--------------------------|----------------------------------|---------|---------|
| `Services` | Services | Yes | Backend services, frontend/web apps, mobile apps, workers, schedulers, API services — the default for anything that runs application code |
| `Database` | Data & Storage | Yes | Relational/NoSQL databases, caches, object/blob storage, data warehouses |
| `Networking` | Networking | Yes | Load balancers, API gateways, DNS, CDNs, VPCs, firewalls, service meshes |
| `AI & ML` | AI & ML | Yes | LLM gateways, inference endpoints, vector DBs, model training/serving |
| `Messaging` | Messaging | Yes | Message brokers, event streams, queues, pub/sub |
| `Infrastructure` | Infrastructure | Yes | VMs, compute instances, containers/orchestration hosts, storage volumes |
| `Platform` | Platforms | Yes | Top-level cloud platforms and their managed capabilities |
| `Automation` | Automation | No | CI/CD pipelines, ETL/data pipelines, build/deploy automation |
| `External` | Integrations | No | Third-party APIs, webhooks, SaaS integrations, external systems |
| `Observability` | Observability | No | Monitoring, logging, tracing, alerting, metrics |
| `Hardware` | Hardware & IoT | No | Sensors, actuators, embedded/edge devices |
| `Game Development` | Game Dev | No | Game clients, servers, engines, simulation |
| `Logical` | Structure | No | Logical groupings, software layers, shared libraries, boundaries |

Notes:
- The value in the **palette_category** column is the grouping key and MUST be reproduced exactly. The **palette_category_label** is the human-readable heading shown on the sidebar group; supply it on every role and keep it consistent for all roles sharing a category. If you omit the label, the raw category string is shown instead.
- **Primary** categories appear expanded by default; non-primary categories are collapsed under a "show more" affordance. This is controlled by the app, not the data — you cannot promote a category to primary by editing the DB.
- There is intentionally no `requirements` category. Requirements are internal, not technology nodes; never assign that category.

`sort_order` determines position within the category. Check existing roles in the same category and pick a value that doesn't collide. Higher numbers appear lower in the list.

### Setting rf_visual_type

**HARD RULE: `rf_visual_type` MUST be one of these exact 11 strings.** This selects the ReactFlow node component used to draw the node on the canvas. Any value outside this list silently falls back to `service` (a plain rectangular service node), so an unrecognized value will not crash but will render as a generic service.

| rf_visual_type (exact) | Use for |
|------------------------|---------|
| `service` | Standard backend/frontend/mobile services and workers — the default for anything running app code |
| `database` | Persistent data stores (renders like a service node with a DB affordance) |
| `api` | API gateways or API endpoints |
| `queue` | Message queues and event streams |
| `cache` | Cache / Redis-style stores |
| `external` | Third-party external systems |
| `container` | Roles that contain other nodes (requires `is_container = true`) |
| `logicalBoundary` | Logical grouping boundaries (auto-selected when `container_style = 'logical-boundary'`) |
| `icon` | Compact infrastructure drawn as an icon (CDN, DNS, load balancer) |
| `requirement` | Requirement nodes (internal — not for technology roles) |
| `library` | Shared library / package nodes |

Note the exact casing of `logicalBoundary` (camelCase). Do not use any value not in this table.

### When is_container = true

When a role can contain child nodes, you MUST also set:
- `container_layer` (one of: infrastructure, orchestration, runtime, logical)
- `container_style` (one of: hosting, logical-boundary)
- `can_contain` (array of role IDs or rule object)
- `rf_visual_type` MUST be `'container'`
- Optionally `metadata_schema` for container-specific config fields

### default_ports Format

JSONB array of `{name, direction}` objects:

```json
[
  {"name": "HTTP In", "direction": "in"},
  {"name": "API Call", "direction": "out"}
]
```

- `direction`: `"in"` (receives connections) or `"out"` (initiates connections)
- Most roles have one inbound and one outbound port
- Names should be descriptive of the data flow

### suggested_contracts Format

JSONB array of interaction pattern strings:

```json
["request_response", "event_publish"]
```

Valid values:
- `request_response` -- Synchronous call-and-wait
- `event_publish` -- Fire-and-forget event emission
- `event_subscribe` -- Listening for events
- `data_access` -- Database/store read/write
- `realtime_channel` -- Persistent bidirectional connection
- `stream` -- Continuous data flow

### capability_tags

PostgreSQL text array of lowercase keywords for search/filtering:

```sql
'{compute, serverless, aws}'::text[]
```

### The deprecated Flag

Set `deprecated = true` to soft-delete a role. Deprecated roles:
- Are hidden from the palette
- Are skipped in catalog loading
- Should NOT be referenced in new templates or technologies
- Are preserved for backwards compatibility with existing projects

### The provider Field

ONLY set for `platform_capability` roles. Must match one of the platform container IDs:
- `aws`, `gcp`, `azure`, `supabase`, `firebase`, `cloudflare`

### The when_to_use Field

Free-form guidance text that helps AI and users choose the right role:

```
'Use for containerized microservices that need auto-scaling without managing Kubernetes'
```

### The default_technology Field

When set, this technology is automatically assigned to new nodes of this role. ONLY use for platform capabilities where the role-technology mapping is 1:1.

The referenced technology_catalog entry MUST exist.

### SQL Template for a New Role

```sql
INSERT INTO node_roles (
  id, label, description, icon_name, color,
  rf_visual_type, palette_category, palette_category_label,
  is_container, kind, functional_kind,
  default_ports, suggested_contracts, capability_tags,
  when_to_use, sort_order
) VALUES (
  'my-new-role',
  'My New Role',
  'Short description of this architectural role',
  'server',
  '#3B82F6',
  'service',
  'Services',
  'Services',
  false,
  'app_service',
  'compute',
  '[{"name": "Request In", "direction": "in"}, {"name": "Response Out", "direction": "out"}]'::jsonb,
  '["request_response"]'::jsonb,
  '{compute, processing}'::text[],
  'Use when you need...',
  50
)
ON CONFLICT (id) DO NOTHING;
```

---

## Section 4: Adding a Platform Capability

Platform capabilities are vendor-specific managed services (e.g., AWS Lambda, GCP Cloud Run).

### Requirements

1. `kind` MUST be `'platform_capability'`
2. `provider` MUST be set to the parent platform ID (aws, gcp, azure, supabase, firebase, cloudflare)
3. `default_technology` SHOULD reference a matching technology_catalog entry
4. `functional_kind` MUST be set (compute, data_store, messaging, event_bus, object_storage, auth)
5. `palette_category` MUST be `'Platform'`
6. `palette_category_label` MUST be `'Platforms'`
7. `rf_visual_type` is typically `'icon'` (compact display)

### Existing Platform Capabilities (23 roles)

| Provider | Roles |
|----------|-------|
| aws | aws-lambda, aws-s3, aws-sqs, aws-rds, aws-eventbridge |
| azure | azure-functions, azure-blob-storage, azure-service-bus, azure-event-grid, azure-cosmos-db |
| gcp | gcp-cloud-functions, gcp-cloud-sql, gcp-cloud-storage, gcp-cloud-pub-sub, gcp-cloud-run |
| supabase | supabase-auth, supabase-database, supabase-edge-functions, supabase-storage |
| firebase | firebase-auth, firebase-firestore |
| cloudflare | cloudflare-workers, cloudflare-r2 |

### Must Update Parent Platform's can_contain

After adding a platform capability, add it to the parent platform container:

**For platforms using rule object format (aws, gcp, azure):**
```sql
UPDATE node_roles
SET can_contain = jsonb_set(
  can_contain,
  '{roleIds}',
  (can_contain -> 'roleIds') || '["new-capability-id"]'::jsonb
)
WHERE id = 'aws'
  AND can_contain -> 'roleIds' IS NOT NULL
  AND NOT (can_contain -> 'roleIds' @> '"new-capability-id"'::jsonb);
```

**For platforms using simple array format (supabase, firebase, cloudflare):**
```sql
UPDATE node_roles
SET can_contain = can_contain || '["new-capability-id"]'::jsonb
WHERE id = 'supabase'
  AND NOT (can_contain @> '"new-capability-id"'::jsonb);
```

### Inspector Behavior

Platform capabilities render as `managed-service` domain metadata type in the inspector panel. This shows:
- Provider name
- Region selector
- Service tier/configuration
- No language/framework pickers

### Complete Platform Capability SQL Template

```sql
-- 1. Add the role
INSERT INTO node_roles (
  id, label, description, icon_name, color,
  rf_visual_type, palette_category, palette_category_label,
  is_container, kind, functional_kind, provider,
  default_technology, default_ports, suggested_contracts,
  capability_tags, when_to_use, sort_order
) VALUES (
  'aws-appsync',
  'AWS AppSync',
  'Managed GraphQL API service with real-time subscriptions',
  'globe',
  '#E535AB',
  'icon',
  'Platform',
  'Platforms',
  false,
  'platform_capability',
  'compute',
  'aws',
  'aws-appsync',
  '[{"name": "Query In", "direction": "in"}, {"name": "Resolver Out", "direction": "out"}]'::jsonb,
  '["request_response", "realtime_channel"]'::jsonb,
  '{aws, graphql, realtime, serverless}'::text[],
  'Use for managed GraphQL APIs with built-in real-time subscriptions and offline sync',
  110
)
ON CONFLICT (id) DO NOTHING;

-- 2. Add matching technology
INSERT INTO technology_catalog (id, name, brand_color, role_affinities, ai_context)
VALUES (
  'aws-appsync',
  'AWS AppSync',
  '#E535AB',
  '["aws-appsync", "graphql-api"]'::jsonb,
  '{
    "purpose": "Managed GraphQL API with real-time subscriptions and offline data sync",
    "typicalTech": ["AWS Amplify", "DynamoDB", "Lambda Resolvers", "Cognito"],
    "bestPractices": [
      "Use pipeline resolvers for complex operations",
      "Leverage DynamoDB direct resolvers for simple CRUD",
      "Implement fine-grained authorization with @auth directives",
      "Use subscriptions for real-time updates"
    ],
    "antiPatterns": [
      "Making all resolvers Lambda-backed when DynamoDB direct works",
      "Skipping caching for frequently accessed data",
      "Using a single large schema without modularization"
    ]
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 3. Update parent platform can_contain
UPDATE node_roles
SET can_contain = jsonb_set(
  can_contain,
  '{roleIds}',
  (can_contain -> 'roleIds') || '["aws-appsync"]'::jsonb
)
WHERE id = 'aws'
  AND can_contain -> 'roleIds' IS NOT NULL
  AND NOT (can_contain -> 'roleIds' @> '"aws-appsync"'::jsonb);

-- 4. Add legacy mapping
INSERT INTO legacy_type_mappings (legacy_type, role_id, technology_id, deployment_target_id)
VALUES ('gateway.aws-appsync', 'aws-appsync', 'aws-appsync', 'managed')
ON CONFLICT (legacy_type) DO NOTHING;
```

---

## Section 5: Container Configuration

### The metadata_schema JSONB Format

The `metadata_schema` field on container roles defines config fields rendered in the inspector. It is a JSON object where each key is a field name:

```json
{
  "fieldName": {
    "type": "string|number|boolean|array|object",
    "label": "Human Readable Label",
    "description": "Help text for the inspector",
    "default": "default-value",
    "required": true
  }
}
```

### Field Types

| Type | Inspector Rendering | Default Value Format |
|------|--------------------|--------------------|
| `string` | Text input | `"some-text"` |
| `number` | Numeric input | `42` |
| `boolean` | Toggle/checkbox | `true` or `false` |
| `array` | Multi-select/list | `["item1", "item2"]` |
| `object` | Key-value editor | `{}` |

### Real metadata_schema Examples

**Docker Compose:**
```json
{
  "version": {"type": "string", "label": "Compose Version", "default": "3.8", "description": "Docker Compose file version"},
  "networks": {"type": "array", "label": "Networks", "description": "Docker networks"},
  "volumes": {"type": "array", "label": "Named Volumes", "description": "Persistent volume definitions"},
  "secrets": {"type": "array", "label": "Secrets", "description": "Secret management configuration"}
}
```

**Kubernetes Cluster:**
```json
{
  "version": {"type": "string", "label": "Kubernetes Version", "default": "1.28", "required": true, "description": "Cluster version (e.g., 1.28)"},
  "nodeCount": {"type": "number", "label": "Node Count", "default": 3, "required": true, "description": "Number of worker nodes"},
  "nodeType": {"type": "string", "label": "Node Instance Type", "default": "t3.medium", "description": "Instance type for nodes"},
  "networking": {"type": "string", "label": "CNI Plugin", "default": "calico", "description": "Network plugin (calico, flannel, weave)"},
  "ingressController": {"type": "string", "label": "Ingress Controller", "default": "nginx", "description": "nginx, traefik, or istio"},
  "rbacEnabled": {"type": "boolean", "label": "RBAC Enabled", "default": true, "description": "Role-based access control"},
  "certManager": {"type": "boolean", "label": "Cert Manager", "default": true, "description": "Automatic TLS certificate management"},
  "monitoring": {"type": "string", "label": "Monitoring Stack", "default": "Prometheus", "description": "Prometheus, Datadog, etc."}
}
```

**VPC / Virtual Network:**
```json
{
  "region": {"type": "string", "label": "Region", "required": true, "description": "Geographic region (e.g., us-east-1)"},
  "cidrBlock": {"type": "string", "label": "CIDR Block", "default": "10.0.0.0/16", "required": true, "description": "IP address range"},
  "internetGateway": {"type": "boolean", "label": "Internet Gateway", "default": true, "description": "Allow internet access"},
  "natGateway": {"type": "boolean", "label": "NAT Gateway", "default": false, "description": "Allow private subnets to access internet"},
  "enableDnsSupport": {"type": "boolean", "label": "DNS Support", "default": true},
  "enableDnsHostnames": {"type": "boolean", "label": "DNS Hostnames", "default": true},
  "flowLogsEnabled": {"type": "boolean", "label": "Flow Logs", "default": false, "description": "Enable traffic flow logging"},
  "tags": {"type": "object", "label": "Resource Tags", "description": "Key-value pairs for organization and billing"}
}
```

### container_layer Values and Meaning

| Layer | Nesting Level | Purpose | Examples |
|-------|--------------|---------|----------|
| `infrastructure` | Highest | Physical/virtual infra | VPC, hypervisor, bare-metal |
| `orchestration` | High | Container orchestration | K8s cluster, Docker Swarm |
| `runtime` | Medium | Application runtimes | Desktop app, mobile device |
| `logical` | Lowest | Logical grouping | Software layer, service mesh |

Higher layers can contain lower layers (e.g., VPC can contain K8s cluster).

### container_style Values

| Style | Visual Rendering | Use For |
|-------|-----------------|---------|
| `hosting` | Solid border, resize handles, background fill | Physical/virtual deployment targets |
| `logical-boundary` | Dashed border, transparent background | Organizational/logical groupings |

### can_contain Details

**Simple array format** -- list of role IDs allowed as children:
```json
["backend-service", "worker", "database", "cache", "rest-api"]
```

**Rule object format** -- used by major cloud platforms:
```json
{
  "roleIds": ["aws-lambda", "aws-s3", "aws-sqs", "aws-rds", "aws-eventbridge"],
  "providers": ["aws"]
}
```

With the rule object, a child node is permitted if:
- Its role ID appears in `roleIds`, OR
- Its role has a `provider` field matching one of the `providers` values

This means adding a new `platform_capability` with `provider: "aws"` automatically makes it containable by the AWS platform, even without explicitly adding it to `roleIds`.

---

## Section 6: The technology_catalog Table Schema

### All 20 Columns

| # | Column | Type | Nullable | Default | Purpose |
|---|--------|------|----------|---------|---------|
| 1 | `id` | text PK | NO | - | Lowercase slug (e.g., `react`, `postgresql`) |
| 2 | `name` | text | NO | - | Display name (e.g., `React`, `PostgreSQL`) |
| 3 | `icon_url` | text | YES | null | External icon URL |
| 4 | `brand_color` | text | NO | `'#6b7280'` | Primary brand hex color |
| 5 | `role_affinities` | jsonb | NO | `'[]'` | Array of compatible role IDs |
| 6 | `ai_context` | jsonb | NO | `'{}'` | Structured AI guidance object |
| 7 | `suggested_files` | jsonb | YES | `'[]'` | File patterns for code detection |
| 8 | `default_metadata` | jsonb | YES | `'{}'` | Auto-populated node metadata |
| 9 | `metadata_schema` | jsonb | YES | `'{}'` | Technology-specific inspector fields |
| 10 | `common_connections` | jsonb | YES | `'[]'` | Typically paired technologies |
| 11 | `is_user_contributed` | boolean | NO | `false` | Project-scoped entry flag |
| 12 | `project_id` | uuid | YES | null | Scoping for user contributions |
| 13 | `created_by` | uuid | YES | null | Creator user ID |
| 14 | `created_at` | timestamptz | NO | `now()` | Creation timestamp |
| 15 | `updated_at` | timestamptz | NO | `now()` | Last update timestamp |
| 16 | `display_name` | text | YES | null | Alternative display name |
| 17 | `node_shape` | text | YES | `'rounded'` | Node shape override |
| 18 | `secondary_color` | text | YES | null | Secondary brand color |
| 19 | `svg_icon` | jsonb | YES | null | Inline SVG icon data |
| 20 | `search_vector` | tsvector | YES | null | Full-text search (auto-generated by trigger) |

### role_affinities

A JSONB array of role IDs this technology can be attached to. When a user selects a node, the technology picker shows only technologies whose `role_affinities` include that node's role.

Most common patterns:
| role_affinities | Count | Examples |
|----------------|-------|----------|
| `["database"]` | 18 | PostgreSQL, MySQL, MongoDB, etc. |
| `["auth-provider"]` | 9 | Auth0, Keycloak, Clerk, etc. |
| `["inference-service"]` | 9 | OpenAI, Claude, Ollama, etc. |
| `["object-storage"]` | 8 | S3, GCS, Cloudflare R2, etc. |
| `["cache"]` | 5 | Redis, Memcached, Valkey, etc. |
| `["frontend-app", "static-site"]` | varies | React, Vue, Angular, etc. |

### ai_context Structure

The richest and most important field. Provides structured guidance for AI code generation:

```json
{
  "purpose": "One-line description of what this technology does and when to use it",
  "typicalTech": ["Related-lib-1", "Related-lib-2", "Common-SDK"],
  "bestPractices": [
    "Specific actionable practice 1",
    "Specific actionable practice 2"
  ],
  "antiPatterns": [
    "Thing to avoid 1",
    "Thing to avoid 2"
  ],
  "sdkInitPattern": "const client = new SDK({ key: process.env.KEY });",
  "securityGuidance": "Security-specific advice",
  "commonApiPatterns": [
    {"name": "Pattern Name", "code": "code template"}
  ],
  "integrationPatterns": ["How this connects to other services"],
  "configurationTemplate": "YAML/HCL/JSON config template string"
}
```

**Required fields:** `purpose`, `typicalTech`, `bestPractices`, `antiPatterns`
**Optional fields:** `sdkInitPattern`, `securityGuidance`, `commonApiPatterns`, `integrationPatterns`, `configurationTemplate`

**Real example (Node.js):**
```json
{
  "purpose": "JavaScript runtime for server-side applications with event-driven, non-blocking I/O",
  "typicalTech": ["Node.js 20+", "Express/Fastify/Hono", "TypeScript", "npm/pnpm", "Jest/Vitest"],
  "bestPractices": [
    "Use async/await for all asynchronous operations",
    "Add error handling middleware for all routes",
    "Use env vars for all configuration",
    "Validate requests with Zod or Joi",
    "Implement rate limiting on public endpoints",
    "Use TypeScript for type safety",
    "Set up connection pooling for database access",
    "Implement graceful shutdown handlers"
  ],
  "antiPatterns": [
    "Using callback hell instead of promises",
    "Leaving unhandled promise rejections",
    "Blocking the event loop with synchronous I/O",
    "Using console.log in production",
    "Importing entire lodash instead of specific methods"
  ],
  "sdkInitPattern": "import express from 'express';\nconst app = express();\napp.listen(3000);",
  "securityGuidance": "Use helmet middleware, validate all input, use parameterized queries, implement rate limiting",
  "commonApiPatterns": [
    {"name": "REST Endpoint", "code": "app.get('/api/items', async (req, res) => { ... })"},
    {"name": "Auth Middleware", "code": "app.use(authenticate)"},
    {"name": "Error Handler", "code": "app.use((err, req, res, next) => { ... })"}
  ],
  "integrationPatterns": ["Express/Fastify for HTTP", "Prisma/Drizzle for DB", "Bull for queues"],
  "configurationTemplate": "{\n  \"compilerOptions\": { \"target\": \"ES2022\", \"module\": \"ESNext\" }\n}"
}
```

### suggested_files

JSONB array of file patterns for detecting this technology in codebases:

```json
[
  {"kind": "schema", "path": "db/extensions/pgvector.sql", "priority": "essential", "description": "pgvector extension setup"},
  {"kind": "source", "path": "src/retrieval/pgvector-store.ts", "priority": "essential"},
  {"kind": "config", "path": "config/embedding-config.json", "priority": "recommended"}
]
```

Fields: `kind` (schema/source/config/build), `path` (glob pattern), `priority` (essential/recommended), `description`

### default_metadata

Auto-populated metadata when this technology is selected:

```json
{"port": 3306, "dbType": "mysql"}         // MySQL
{"distanceMetric": "cosine"}               // pgvector
{"persistenceMode": "disk"}                // ChromaDB
```

### svg_icon Field

Inline SVG icon for technologies without external icon URLs:

```json
{
  "path": "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  "color": "#68a063",
  "viewBox": "0 0 24 24"
}
```

Contains a `path` (SVG d attribute), `color` (fill/stroke), and `viewBox`.

### node_shape Field

Controls the visual shape of the rendered node:
- `'rounded'` (default) -- Standard rounded rectangle
- Other values possible but `'rounded'` covers virtually all cases

### search_vector (auto-generated)

A `tsvector` column auto-populated by a database trigger from `name`, `display_name`, and `ai_context` fields. Do NOT manually set this; it updates automatically.

---

## Section 7: Adding a New Technology

### Required Fields

At minimum, a technology needs: `id`, `name`, `brand_color`, `role_affinities`, `ai_context`

### SQL Template

```sql
INSERT INTO technology_catalog (
  id, name, brand_color, role_affinities, ai_context,
  suggested_files, common_connections
) VALUES (
  'bun',
  'Bun',
  '#FBF0DF',
  '["backend-service", "rest-api", "worker", "serverless-function"]'::jsonb,
  '{
    "purpose": "All-in-one JavaScript runtime with bundler, transpiler, and package manager",
    "typicalTech": ["Bun.serve", "Hono", "Elysia", "TypeScript", "SQLite"],
    "bestPractices": [
      "Use Bun.serve for HTTP servers instead of Express",
      "Leverage built-in SQLite for local persistence",
      "Use bun:test for unit testing",
      "Take advantage of native TypeScript support without separate compilation"
    ],
    "antiPatterns": [
      "Using Node.js-specific APIs not yet supported by Bun",
      "Installing bundlers when Bun handles bundling natively",
      "Using npm/yarn when bun install is faster"
    ],
    "sdkInitPattern": "Bun.serve({\n  port: 3000,\n  fetch(req) {\n    return new Response(\"Hello!\");\n  }\n});"
  }'::jsonb,
  '[{"path": "bun.lockb"}, {"path": "bunfig.toml"}]'::jsonb,
  '[{"id": "postgresql", "reason": "Primary database"}, {"id": "redis", "reason": "Caching layer"}]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
```

### How to Set role_affinities Correctly

Rules:
- MUST reference only valid, non-deprecated role IDs
- MUST include at least one role
- Only list roles where this technology is a legitimate implementation
- The technology picker filters based on these affinities

Common patterns:
| Technology Type | Typical role_affinities |
|----------------|------------------------|
| Frontend framework | `["frontend-app", "static-site"]` |
| Backend runtime/framework | `["backend-service", "rest-api", "worker"]` |
| Database | `["database"]` |
| Cache | `["cache"]` |
| Message broker | `["message-broker", "event-stream"]` |
| Auth provider | `["auth-provider"]` |
| Object storage | `["object-storage"]` |
| ML/AI platform | `["inference-service"]` |
| Cloud-specific | `["<platform-capability-role-id>"]` |

### How to Write Good ai_context

Quality rules:
1. **purpose**: Single sentence, max 100 chars. Starts with noun or action verb. Explains what AND when.
2. **typicalTech**: 3-8 entries. Most commonly paired tools/libraries. Include version hints (e.g., "React 18+").
3. **bestPractices**: 4-8 items. Imperative voice. Specific to THIS technology, not generic programming advice.
4. **antiPatterns**: 3-6 items. Start with gerund ("Using...", "Storing...", "Skipping..."). Explain what NOT to do.
5. **sdkInitPattern**: Minimal 2-5 line initialization code. The "hello world" of this tech.

### Setting brand_color

- Use the official brand color from the technology's website/logo
- Must be valid hex format (e.g., `#FF6600`)
- NEVER use purple/indigo/violet unless that IS the official brand color
- If unknown, use a neutral color like `#374151`

### display_name vs name

- `name`: The canonical name stored and used internally
- `display_name`: Optional override shown in the UI when different from `name`
- Example: `name: "nodejs"`, `display_name: "Node.js"`

### How Icons Work

Priority order for rendering:
1. `svg_icon` (inline SVG data) -- best for custom icons
2. `icon_url` (external URL) -- for hosted icon files
3. Falls back to the role's `icon_name` (Lucide icon)

To add an inline SVG icon:
```json
{
  "path": "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z",
  "color": "#61DAFB",
  "viewBox": "0 0 24 24"
}
```

---

## Section 8: The legacy_type_mappings Table

### Purpose

Provides backwards compatibility for graphs created before the role+technology split. When the migration pipeline encounters a node with an old dotted-notation type (e.g., `frontend.react`), it looks up the mapping to determine the modern role ID, technology ID, and deployment target.

### Schema

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| `legacy_type` | text PK | NO | Old dotted-notation string |
| `role_id` | text | NO | Maps to node_roles.id |
| `technology_id` | text | YES | Maps to technology_catalog.id |
| `deployment_target_id` | text | YES | Deployment context |
| `created_at` | timestamptz | NO | Auto-set to now() |

### When to Add New Mappings

Add a legacy_type_mapping when:
1. You create a new role that AI might reference using old naming patterns
2. You want to support migration from a similar external tool
3. A deprecated role is being replaced by a new one
4. The AI code detection system might generate a type string in this format

### Naming Convention

Legacy types follow `category.technology-name` pattern:
- `frontend.react`, `frontend.vue`, `frontend.angular`
- `backend.nodejs`, `backend.python`, `backend.golang`
- `database.postgresql`, `database.mongodb`
- `infrastructure.k8s-cluster`, `infrastructure.docker-compose`
- `gateway.aws-api-gateway`

### Valid Deployment Targets (13)

| Target | Use When |
|--------|----------|
| `browser` | Runs in user's web browser |
| `server` | Traditional server deployment |
| `container` | Docker/OCI container |
| `serverless` | FaaS (Lambda, Cloud Functions) |
| `edge` | Edge compute (Cloudflare Workers) |
| `mobile` | Mobile app (iOS/Android) |
| `desktop` | Desktop application |
| `embedded` | Embedded/IoT device |
| `cdn` | Content delivery network |
| `managed` | Fully managed cloud service |
| `kubernetes` | Kubernetes cluster |
| `on-premise` | Self-hosted on-premise |
| `hybrid` | Multi-environment |

### SQL Template

```sql
INSERT INTO legacy_type_mappings (legacy_type, role_id, technology_id, deployment_target_id)
VALUES
  ('frontend.solidjs', 'frontend-app', 'solidjs', 'browser'),
  ('backend.bun', 'backend-service', 'bun', 'server')
ON CONFLICT (legacy_type) DO NOTHING;
```

---

## Section 9: Inspector Panel Integration

### How the Inspector Determines What to Show

The data flow from catalog to inspector:

```
node_roles + technology_catalog (DB)
    |
    v  CatalogService.loadCatalog()
    |
    +---> CatalogResolver (lookup by ID)
    |
    +---> buildNodeType(legacyMapping, role, tech)
    |       -> DomainNodeType (merged role+tech info)
    |
    +---> buildDomainsFromCatalog()
    |       groups by palette_category -> palette sidebar
    |
    +---> buildContainerTypesFromCatalog()
    |       registers container metadata_schema
    |
    +---> buildRoleResolverFromCatalog()
            exposes kind/functionalKind/provider per role
```

### The domainMetadata Discriminated Union

The inspector uses `NodeDomainMetadata` to decide which UI sections to render. This is a TypeScript union type with 11 variants:

| domainMetadata.type | UI Sections Shown | For Roles Like |
|--------------------|-------------------|----------------|
| `web-service` | Language, port, CORS, rate limit, API routes, streaming | backend-service, rest-api, grpc-service, websocket-server |
| `frontend` | Framework, deployment type, state management, styling, router | frontend-app, static-site |
| `database` | DB type, version, connection string, replication | database |
| `auth-service` | Provider, MFA config, session management | auth-provider |
| `cache` | Eviction policy, max memory, TTL, cluster mode | cache |
| `message-queue` | Protocol, retention period, message ordering, DLQ | message-broker, queue |
| `object-storage` | Bucket config, versioning, lifecycle rules | object-storage |
| `managed-service` | Provider, region, tier (generic) | all platform_capability roles |
| `mobile` | Platform (iOS/Android), min OS version, app store | mobile-app |
| `inference-service` | Model, endpoint, batch size, GPU config | inference-service |
| `ai-service` | Model, provider, temperature, tools/agents | ai-agent-service, llm-gateway |

### How metadata_schema Drives Container Inspector

For container roles, the `metadata_schema` defines dynamic form fields. The `ContainerMetadataEditor` component:
1. Looks up the container type definition via `getContainerTypeById(node.type)`
2. Reads the `metadataSchema` field from the definition
3. Renders input controls based on field types (string -> text input, number -> numeric, boolean -> toggle)
4. Saves changes as patches to `node.metadata.containerMetadata`

### What CatalogService Does

1. **Builds palette**: Groups roles by `palette_category` -> shows in sidebar
2. **Resolves visual types**: Uses `rf_visual_type` to select ReactFlow component
3. **Filters technologies**: When user selects a node, shows only technologies whose `role_affinities` include that role
4. **Provides AI context**: Merges role description + technology ai_context for AI code generation

### Impact of New Roles on Inspector

| Scenario | Inspector Behavior | Code Changes Needed |
|----------|-------------------|---------------------|
| New app_service role | Generic service inspector (label, tech picker, ports) | None |
| New data_store role | Database inspector if mapped, else generic | None |
| New platform_capability | Managed-service inspector (provider, region) | None |
| New container with metadata_schema | Auto-renders config fields from schema | None |
| Need entirely new inspector section | Requires TypeScript code change | Out of scope for SQL |

For most additions, NO code changes are needed. The catalog system dynamically builds the palette and technology picker from the database.

---

## Section 10: SQL Migration Format

### File Naming Convention

```
YYYYMMDDHHMMSS_descriptive_name_in_snake_case.sql
```

Examples:
- `20260516120000_add_graphql_federation_gateway_role.sql`
- `20260516120100_add_bun_runtime_technology.sql`
- `20260516120200_add_aws_appsync_platform_capability.sql`

### Required Migration Header

Every migration MUST start with a detailed multi-line comment:

```sql
/*
  # Add GraphQL Federation Gateway Role

  1. New Roles
    - `graphql-federation` -- Federated GraphQL gateway for composing subgraphs
      - kind: app_service, functional_kind: compute
      - palette_category: Services
      - rf_visual_type: service
      - default_ports: [Schema In, Federated Out]

  2. New Technologies
    - `apollo-router` -- Apollo Federation runtime router
      - role_affinities: [graphql-federation, graphql-api]

  3. Legacy Mappings
    - `gateway.graphql-federation` -> graphql-federation + apollo-router + server

  4. Container Updates
    - Added graphql-federation to k8s-cluster, docker-compose can_contain

  5. Notes
    - Distinct from graphql-api which represents a single GraphQL schema
    - This role specifically handles subgraph composition and query planning
*/
```

### Idempotent INSERT Pattern

```sql
INSERT INTO node_roles (id, label, ...)
VALUES ('role-id', 'Label', ...)
ON CONFLICT (id) DO NOTHING;
```

ALWAYS use `ON CONFLICT (id) DO NOTHING` to prevent errors on re-run.

### Updating Existing Roles

When modifying a role (e.g., adding to can_contain):

```sql
-- Safe: only updates if target exists
UPDATE node_roles
SET can_contain = can_contain || '["new-child-role"]'::jsonb
WHERE id = 'target-container'
  AND NOT (can_contain @> '"new-child-role"'::jsonb);
```

### Conditional Logic with DO Blocks

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM node_roles WHERE id = 'my-role') THEN
    INSERT INTO node_roles (id, label, kind, rf_visual_type, palette_category, sort_order)
    VALUES ('my-role', 'My Role', 'app_service', 'service', 'Services', 50);
  END IF;
END $$;
```

### Combined Role + Technology + Mapping Pattern

```sql
-- Step 1: Role
INSERT INTO node_roles (...) VALUES (...) ON CONFLICT (id) DO NOTHING;

-- Step 2: Technology
INSERT INTO technology_catalog (...) VALUES (...) ON CONFLICT (id) DO NOTHING;

-- Step 3: Legacy mapping
INSERT INTO legacy_type_mappings (...) VALUES (...) ON CONFLICT (legacy_type) DO NOTHING;

-- Step 4: Container updates (if needed)
UPDATE node_roles SET can_contain = ... WHERE id = '...' AND NOT ...;
```

### Safety Rules

1. **NEVER** use `DROP`, `DELETE`, `TRUNCATE`
2. **NEVER** use `BEGIN`, `COMMIT`, `ROLLBACK` (transaction control)
3. **ALWAYS** use `ON CONFLICT ... DO NOTHING` for inserts
4. **ALWAYS** add idempotency guards for updates
5. **NEVER** reference UUIDs that might not exist
6. Validate all JSONB is syntactically correct
7. Escape single quotes in JSON strings by doubling them (`''`)

---

## Section 11: Complete Working Examples

### Example A: Adding a New app_service Role ("GraphQL Federation Gateway")

```sql
/*
  # Add GraphQL Federation Gateway

  1. New Roles
    - `graphql-federation` -- Federated GraphQL gateway composing multiple subgraphs
      - kind: app_service, functional_kind: compute
      - palette_category: Services, rf_visual_type: service
      - default_ports: [Subgraph In, Federated Query Out]
      - suggested_contracts: [request_response]

  2. New Technologies
    - `apollo-router` -- Apollo Federation v2 runtime router
      - role_affinities: [graphql-federation, graphql-api]
      - ai_context with federation-specific patterns

  3. Legacy Mappings
    - `gateway.graphql-federation` -> graphql-federation + apollo-router + server

  4. Container Updates
    - Added to k8s-cluster, docker-compose can_contain lists
*/

-- Role
INSERT INTO node_roles (
  id, label, description, icon_name, color,
  rf_visual_type, palette_category, palette_category_label,
  is_container, kind, functional_kind,
  default_ports, suggested_contracts, capability_tags,
  when_to_use, sort_order
) VALUES (
  'graphql-federation',
  'GraphQL Federation',
  'Federated GraphQL gateway that composes multiple subgraph schemas into a unified API',
  'git-merge',
  '#E535AB',
  'service',
  'Services',
  'Services',
  false,
  'app_service',
  'compute',
  '[{"name": "Subgraph In", "direction": "in"}, {"name": "Federated Query", "direction": "out"}]'::jsonb,
  '["request_response"]'::jsonb,
  '{graphql, federation, gateway, api-composition}'::text[],
  'Use when you need to compose multiple GraphQL subgraphs into a single unified schema, typically in a microservices architecture where each team owns their own subgraph',
  45
)
ON CONFLICT (id) DO NOTHING;

-- Technology
INSERT INTO technology_catalog (
  id, name, brand_color, role_affinities, ai_context,
  suggested_files, common_connections
) VALUES (
  'apollo-router',
  'Apollo Router',
  '#311C87',
  '["graphql-federation", "graphql-api"]'::jsonb,
  '{
    "purpose": "High-performance GraphQL federation runtime that composes subgraphs into a supergraph",
    "typicalTech": ["Apollo Federation 2", "Rover CLI", "GraphOS", "TypeScript", "Rust"],
    "bestPractices": [
      "Use @key directives for entity resolution across subgraphs",
      "Implement query planning optimization with @defer",
      "Version supergraph schema with Rover CLI in CI",
      "Use Apollo GraphOS for schema registry and observability",
      "Set query depth and complexity limits"
    ],
    "antiPatterns": [
      "Putting business logic in the gateway layer",
      "Creating circular entity references between subgraphs",
      "Using Federation 1 features that break composition",
      "Skipping schema validation before deployment"
    ],
    "sdkInitPattern": "rover supergraph compose --config supergraph.yaml > supergraph.graphql\napollo-router --supergraph supergraph.graphql --config router.yaml"
  }'::jsonb,
  '[{"path": "supergraph.yaml"}, {"path": "router.yaml"}, {"path": "**/*.graphql", "contains": "@key"}]'::jsonb,
  '[{"id": "graphql", "reason": "Subgraph implementation"}, {"id": "nodejs", "reason": "Subgraph runtime"}]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Legacy mapping
INSERT INTO legacy_type_mappings (legacy_type, role_id, technology_id, deployment_target_id)
VALUES ('gateway.graphql-federation', 'graphql-federation', 'apollo-router', 'server')
ON CONFLICT (legacy_type) DO NOTHING;

-- Container updates
UPDATE node_roles
SET can_contain = can_contain || '["graphql-federation"]'::jsonb
WHERE id = 'k8s-cluster'
  AND NOT (can_contain @> '"graphql-federation"'::jsonb);

UPDATE node_roles
SET can_contain = can_contain || '["graphql-federation"]'::jsonb
WHERE id = 'docker-compose'
  AND NOT (can_contain @> '"graphql-federation"'::jsonb);
```

### Example B: Adding a New platform_capability ("AWS AppSync")

See Section 4 for the complete example (included inline there).

### Example C: Adding a New Technology ("Bun" Runtime)

```sql
/*
  # Add Bun Runtime Technology

  1. New Technologies
    - `bun` -- All-in-one JavaScript runtime, bundler, and package manager
      - role_affinities: [backend-service, rest-api, worker, serverless-function]
      - ai_context with Bun-specific patterns and APIs
      - brand_color: official Bun cream (#FBF0DF)

  2. Legacy Mappings
    - `backend.bun` -> backend-service + bun + server
    - `backend.bun-api` -> rest-api + bun + server

  3. Notes
    - Complements existing nodejs technology -- distinct runtime with different APIs
    - role_affinities overlap with nodejs but Bun has unique initialization patterns
*/

-- Technology
INSERT INTO technology_catalog (
  id, name, brand_color, role_affinities, ai_context,
  suggested_files, common_connections, default_metadata
) VALUES (
  'bun',
  'Bun',
  '#FBF0DF',
  '["backend-service", "rest-api", "worker", "serverless-function"]'::jsonb,
  '{
    "purpose": "All-in-one JavaScript runtime with built-in bundler, transpiler, and package manager",
    "typicalTech": ["Bun.serve", "Hono", "Elysia", "TypeScript", "SQLite", "bun:test"],
    "bestPractices": [
      "Use Bun.serve() for HTTP servers instead of importing express",
      "Leverage built-in SQLite via bun:sqlite for local persistence",
      "Use bun:test for unit testing without additional test runners",
      "Take advantage of native TypeScript support without tsconfig",
      "Use Bun.file() for efficient file I/O",
      "Prefer Web APIs (fetch, Request, Response) over Node.js equivalents"
    ],
    "antiPatterns": [
      "Installing separate bundlers (webpack, esbuild) when bun build works",
      "Using npm/yarn/pnpm when bun install is significantly faster",
      "Relying on Node.js-specific APIs not yet supported",
      "Using express when Bun.serve is faster and simpler"
    ],
    "sdkInitPattern": "Bun.serve({\n  port: 3000,\n  fetch(req) {\n    const url = new URL(req.url);\n    if (url.pathname === \"/api\") return Response.json({ ok: true });\n    return new Response(\"Not found\", { status: 404 });\n  }\n});"
  }'::jsonb,
  '[{"path": "bun.lockb"}, {"path": "bunfig.toml"}, {"path": "package.json", "contains": "\"bun\""}]'::jsonb,
  '[{"id": "postgresql", "reason": "Primary database"}, {"id": "redis", "reason": "Caching"}, {"id": "hono", "reason": "Routing framework"}]'::jsonb,
  '{"runtime": "bun"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Legacy mappings
INSERT INTO legacy_type_mappings (legacy_type, role_id, technology_id, deployment_target_id)
VALUES
  ('backend.bun', 'backend-service', 'bun', 'server'),
  ('backend.bun-api', 'rest-api', 'bun', 'server')
ON CONFLICT (legacy_type) DO NOTHING;
```

---

## Section 12: Validation Checklist

### Role Validation

- [ ] `id` is kebab-case, unique across all node_roles, max 40 chars
- [ ] `id` does not collide with any deprecated role
- [ ] `label` is Title Case, 2-4 words, descriptive
- [ ] `kind` is one of the 13 valid enum values
- [ ] `functional_kind` is one of the 11 valid values or NULL
- [ ] `rf_visual_type` is one of the 11 valid values (see "Setting rf_visual_type"; unlisted values fall back to `service`)
- [ ] If `is_container = true`: `rf_visual_type` MUST be `'container'`
- [ ] If `is_container = true`: `container_layer` MUST be set (4 valid values)
- [ ] If `is_container = true`: `container_style` MUST be set (2 valid values)
- [ ] If `is_container = true`: `can_contain` MUST be a non-empty array or rule object
- [ ] `palette_category` is EXACTLY one of the 13 valid values (see "How to Assign palette_category"; unlisted values sink to an ungrouped bucket)
- [ ] `sort_order` does not duplicate within the same palette_category
- [ ] `icon_name` is on the allowlist in "Choosing icon_name" (NOT any lucide.dev icon; unlisted names render as a box)
- [ ] `color` is valid hex, not purple/indigo unless brand-required
- [ ] `default_ports` items have valid `{name: string, direction: "in"|"out"}` format
- [ ] `suggested_contracts` items are valid interaction kind strings
- [ ] `capability_tags` uses lowercase terms
- [ ] If `provider` is set: matches a platform container ID (aws/gcp/azure/supabase/firebase/cloudflare)
- [ ] If `default_technology` is set: matching technology_catalog entry exists or is created in same migration
- [ ] `when_to_use` is clear, actionable guidance text

### Technology Validation

- [ ] `id` is lowercase kebab-case, unique across technology_catalog
- [ ] `name` uses official capitalization
- [ ] `brand_color` is the official brand color, valid hex
- [ ] `role_affinities` is a non-empty JSONB array
- [ ] Every role in `role_affinities` is a valid, non-deprecated node_roles.id
- [ ] `ai_context` has all 4 required fields: purpose, typicalTech, bestPractices, antiPatterns
- [ ] `ai_context.purpose` is a single sentence, under 100 characters
- [ ] `ai_context.typicalTech` has 3-8 entries
- [ ] `ai_context.bestPractices` has 4-8 items, imperative voice, specific to this technology
- [ ] `ai_context.antiPatterns` has 3-6 items, starts with gerunds
- [ ] All JSONB is syntactically valid
- [ ] Single quotes inside JSON strings are properly doubled (`''`)

### Platform Capability Validation

- [ ] `kind` is `'platform_capability'`
- [ ] `provider` is set to the parent platform ID
- [ ] `functional_kind` is set (not NULL)
- [ ] `palette_category` is `'Platform'`
- [ ] `palette_category_label` is `'Platforms'`
- [ ] `default_technology` references a valid technology_catalog entry
- [ ] Matching technology_catalog entry has role_affinities including this role
- [ ] Parent platform's `can_contain` is updated to include this role
- [ ] Update uses idempotency guard (`NOT ... @> ...`)

### Legacy Mapping Validation

- [ ] `legacy_type` follows `category.technology-name` dotted pattern
- [ ] `role_id` references an existing, non-deprecated node_roles.id
- [ ] `technology_id` references an existing technology_catalog.id (or is NULL)
- [ ] `deployment_target_id` is one of 13 valid targets (or is NULL)
- [ ] Uses `ON CONFLICT (legacy_type) DO NOTHING`

### Container Updates Validation

- [ ] Every new role that should be containable is added to appropriate parent containers
- [ ] Updates use proper format for target container (array format vs rule object)
- [ ] All updates include idempotency guards
- [ ] Does not accidentally remove existing entries from can_contain

### Migration File Validation

- [ ] Filename: `YYYYMMDDHHMMSS_descriptive_name.sql`
- [ ] Starts with detailed multi-line comment with numbered sections
- [ ] Uses `ON CONFLICT (id) DO NOTHING` for ALL inserts
- [ ] No `DROP`, `DELETE`, `TRUNCATE`, `BEGIN`, `COMMIT`, `ROLLBACK`
- [ ] All JSONB strings are valid and properly escaped
- [ ] Migration is fully idempotent (safe to run unlimited times)
- [ ] Cross-references are valid (all FKs exist or are created in same migration)

### Cross-Reference Integrity

- [ ] Every `default_technology` on a role -> has matching technology_catalog entry
- [ ] Every technology `role_affinities` -> only references valid role IDs
- [ ] Every `provider` on a role -> matches a platform container ID
- [ ] Platform `can_contain.roleIds` -> only references valid role IDs
- [ ] Legacy mapping `role_id` -> exists in node_roles
- [ ] Legacy mapping `technology_id` -> exists in technology_catalog (if not NULL)
- [ ] No circular containment (a role cannot contain itself)
- [ ] Deprecated roles are NEVER referenced in new entries
