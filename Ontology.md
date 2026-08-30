# NodeSpec Ontology Reference (v8)

**Date:** 2026-07-31 · **Migration head:** `20260731200000` (M7)
**Supersedes:** v7.1, which documented the eight-axis model this version deletes.

This is the reference for what a node *is*, what an edge *means*, and what an AI receives
when it reads either. It describes the system as it stands after the M0–M7 arc; the defect
inventory that motivated that arc is `docs/ONTOLOGY_AUDIT.md`, and the migration plan with
per-task outcomes is `docs/NODE_REFERENCE.md`.

---

## Design Principles

Two rules decide every question below.

> **A role earns its existence only if it changes the task packet.**
> If two roles produce the same packet shape and differ only by which technology is bound,
> they are one role plus a field.

> **Generic-but-vague is acceptable; wrong-and-specific is not.**
> A user who cannot find their exact thing should land on an honest generic, never on a
> specific role that means something else.

Three more, load-bearing throughout:

- **Identity is open; behavior is closed.** New roles and technologies may be added without
  limit. The axes that drive behavior are a fixed, enumerated set — there is no axis for a
  node pack to invent.
- **Derived beats stored.** Anything that can be computed from the axes is computed. Stored
  duplicates drift; derivations cannot.
- **Silent defaults, explicit rebinding.** The system makes a defensible choice without
  interrupting the user, and puts the correction one click away in the inspector.

---

## 1. Core Data Model

```
node = ROLE (identity) + TECHNOLOGY (optional) + POSITION
```

A graph is nodes, edges, contracts, artifacts, and node groups. Edges carry no semantics of
their own — **there is no `edgeKind`**. What a connection *means* lives entirely on the
contract it points at.

### 1.1 Graph

| Field | Notes |
|---|---|
| `id`, `schemaVersion`, `version`, `hash` | `hash` is the content hash the patch chain verifies against |
| `nodes`, `edges`, `contracts`, `artifacts`, `nodeGroups` | keyed maps, not arrays |

Graphs mutate only through **patches**. `graph_patches` is append-only and **hash-chained**:
a patch is never rewritten after the fact. This single property drives several decisions
below — most visibly, why retired vocabulary still resolves at the read boundary (§2.7).

### 1.2 Node

```
id            uuid
type          string   -- ALWAYS a role id. Not a dotted grammar, not a legacy type.
label         string
technology    string?  -- technology_catalog id, bound via role_affinities
deploymentTarget string?
ports         Port[]?
artifacts     uuid[]?  -- artifact ids
data          object?
metadata      object?  -- rationale lives here
status        'suggested' | 'draft' | 'complete'
parentId      uuid?
placementKind 'contains' | 'hosts' | 'deployed_to' | 'scopes'
```

`node.type` is a role id in every code path — canvas, MCP, repo import, AI proposals. The
dotted grammar (`frontend.react`, `backend.nodejs`) is retired and the 429-row
`legacy_type_mappings` table is deleted. The read boundary still tolerates a dotted string by
taking its **last segment**, because a replayed hash-chained patch can carry one forever;
that is read-boundary tolerance, not a supported input format.

### 1.3 Edge

```
id, source, target   uuid
sourcePortId, targetPortId  uuid?
contractId           uuid    -- REQUIRED. An edge without a contract is invalid (rule 1).
label                string?
direction            'unidirectional' | 'bidirectional'    (optional)
criticality          'required' | 'optional' | 'fallback'  (optional)
metadata             object?
```

> **Correction from v7.1.** That version documented an `Edge.sourceArtifact` provenance
> field. No such field exists on `EdgeSchema`, on `NodeSchema`, or on either server mirror,
> and none ever did. Repo-import provenance is carried by the artifacts a node owns
> (`node.artifacts`) and by artifact metadata — not by a field on the edge.

### 1.4 Contract

```
id             uuid
kind           ContractKind        -- the wire shape (§2.1)
interactionKind InteractionKind?   -- what the interaction MEANS (§2.2)
transport      TransportKind?      -- how bytes move (§2.3)
specFormat     SpecFormat?         -- how it is described (§2.4)
name           string
schema         object?   |  schemaRef  uuid?   -- inline, or an artifact reference
status         'suggested' | 'draft' | 'complete'
```

Four descriptors, one concept. `kind` is the coarse label users pick from; the other three
carry the detail that code generation actually consumes.

### 1.5 Port

```
id, name, direction ('in' | 'out'), contractId?, metadata?
```

A port's kind comes from its connected edge's **contract** — the only truth. Port labels are
derived, never stored (§5.4).

### 1.6 Artifact

```
id, nodeId, kind (ArtifactKind), path, content, contentHash,
status ('suggested' | 'draft' | 'complete'), metadata, createdAt, updatedAt
```

`suggested` artifacts are proposals; promoting one to `draft` is what makes it visible to
task packets and MCP context.

---

## 2. Enumerated Types

Canonical definitions: `core/src/shared/enums.ts`, byte-mirrored at
`supabase/functions/_shared/enums.ts`.

### 2.1 ContractKind (12)

`rest` · `graphql` · `grpc` · `websocket` · `sse` · `kafka` · `amqp` · `sql` · `nosql` ·
`ipc` · `dependency` · `custom`

> **Correction from v7.1.** `README.md`, `SPECIFICATION.md` and `export-context.ts` all said
> "ContractKind (11 values)", omitting `dependency`. There are twelve, and `dependency` has
> its own colour and dash pattern.

### 2.2 InteractionKind (11)

`request_response` · `event` · `queue` · `data_read` · `data_write` · `data_sync` ·
`file_transfer` · `auth` · `telemetry` · `ipc` · `dependency`

### 2.3 TransportKind (23)

`http` · `graphql` · `grpc` · `websocket` · `sse` · `amqp` · `mqtt` · `kafka` · `nats` ·
`sqs` · `eventbridge` · `sql` · `redis` · `ipc` · `tcp` · `udp` · `i2c` · `spi` · `uart` ·
`can` · `dds` · `mavlink` · `none`

### 2.4 SpecFormat (16)

`openapi` · `graphql_schema` · `protobuf` · `asyncapi` · `json_schema` · `sql_ddl` · `avro` ·
`oauth_oidc` · `telemetry_schema` · `terraform_hcl` · `helm_chart` · `dockerfile` ·
`object_storage_contract` · `hardware_protocol_contract` · `custom` · `none`

### 2.5 PlacementKind (4)

`contains` · `hosts` · `deployed_to` · `scopes`

### 2.6 ArtifactKind (8) · EntityStatus (3)

`source` · `schema` · `doc` · `config` · `build` · `design` · `task` · `test-plan`
— and `suggested` · `draft` · `complete`.

### 2.7 One Contract Vocabulary

`core/src/shared/legacy-mappings.ts` (server mirror: `supabase/functions/_shared/`) is THE
vocabulary module. Kind → field defaults:

| kind | interactionKind | transport | specFormat |
|---|---|---|---|
| rest | request_response | http | openapi |
| graphql | request_response | graphql | graphql_schema |
| grpc | request_response | grpc | protobuf |
| websocket | event | websocket | json_schema |
| sse | event | sse | json_schema |
| kafka | event | kafka | asyncapi |
| amqp | queue | amqp | asyncapi |
| sql | data_read | sql | sql_ddl |
| nosql | data_read | http | json_schema |
| ipc | ipc | ipc | none |
| dependency | dependency | none | none |
| custom | request_response | http | none |

`resolveContractFields(value, transport?)` resolves **any** string token from any source —
DB seed, AI proposal, replayed patch — in this order:

1. Current InteractionKind → full fields
2. Current ContractKind → full defaults from the table above
3. Retired interaction kinds via `LEGACY_INTERACTION_KIND_MAP` (`realtime_channel`→event,
   `event_publish`/`event_subscribe`→event, `message_enqueue`/`message_consume`→queue,
   `data_access`→data_read, `auth_flow`/`authorization_check`→auth,
   `observability_signal`→telemetry, `hardware_io`→ipc)
4. `LEGACY_ALIAS_MAP` (`db`→sql, `rpc`→grpc, `realtime`→websocket, `pubsub`→kafka, …) —
   AI-input tolerance
5. Fallback: `custom` with full defaults

Steps 3 and 4 are **read-boundary tolerance, not backward compatibility.** The stored
`suggested_contracts` seeds were re-seeded onto the current vocabulary and a CHECK constraint
now forbids retired tokens (§7). What steps 3–4 still exist for is the hash chain: an
append-only patch from a year ago can carry `event_publish`, and the read boundary is the
only place that can resolve it.

**Interaction + transport → kind** is one table, `contractKindForInteraction`, in the same
module. It used to be two — a transport-blind client copy and a transport-aware server copy —
which meant the same edge became a different contract kind depending on which path created
it, and a hand-drawn edge could reach only 5 of the 12 kinds while an AI-created one reached
all 12. Unified onto the transport-aware behavior.

### 2.8 Contract Birth — Connect-Time Inference

A hand-drawn edge's contract is inferred from the **target role's `interface_kind`**. The
target decides what calling it *means*.

| Target `interface_kind` | Born interactionKind | Resulting contract |
|---|---|---|
| `data` | `data_read` | sql / sql / sql_ddl |
| `object_store` | `file_transfer` | custom / http / none |
| `queue` | `queue` | amqp / amqp / asyncapi |
| `event_bus` | `event` | kafka / kafka / asyncapi |
| `auth` | `auth` | rest / http / oauth_oidc |
| `telemetry` | `telemetry` | custom / http / telemetry_schema |
| `service`, or unknown / no catalog yet | `request_response` | rest / http / openapi |

- **Silent by design.** No picker at draw time; the inspector's Connection Type select is the
  rebind surface.
- **The fallback is rest/request_response, never sql.** This covers the pre-hydration case
  (no catalog registered yet) as well as `service` roles.
- This makes `interface_kind` load-bearing: a mis-filed role produces a wrongly-*born*
  contract, not merely a mis-grouped palette entry. §7's filing gate exists for that reason.

### 2.9 Connection-Oriented Ordering Exception

`websocket` and `sse` carry `interactionKind: event` — the payload semantics *are* async
events. For **dependency ordering** they follow the transport instead: you connect TO the
server, so the target of an outgoing websocket/sse edge must exist before this node starts.
The task packet lists it under *must-be-available* rather than as a consumer. `kafka`/`amqp`
targets remain async consumers. Checked on the contract KIND before any interaction
classification (`CONNECTION_ORIENTED_KINDS`, `task-document-generator.ts`) — it does not
re-label the interaction.

---

## 3. Node Role Ontology

### 3.1 The four axes

A role's behavior is **four stored axes**, down from eight. Everything else about a role is
identity (`id`, `label`, `description`, `when_to_use`, `icon_name`, `color`) or display.

| Axis | Values | Drives |
|---|---|---|
| **`nature`** | `build` · `integrate` · `host` · `engine` · `call` | ownership, deliverable class, palette chip, zoom exemption |
| **`interface_kind`** | `service` · `data` · `object_store` · `queue` · `event_bus` · `auth` · `telemetry` | connect-time contract birth (§2.8), layout column |
| **containment** | `is_container` + `container_style` (`hosting` \| `logical-boundary`) + `can_contain` | nesting, collapse, provisioning-vs-no deliverable |
| **`provider`** | `aws` · `azure` · `gcp` · `supabase` · `cloudflare` · … · `null` | cross-provider refusal, auto-nesting under the platform |

**`nature`** answers *who runs this, and do you author its internals*:

| value | meaning | you author it? |
|---|---|---|
| `build` | you write its code | yes |
| `integrate` | a provider-operated capability you configure | no |
| `host` | it runs other nodes | n/a — it IS the boundary |
| `engine` | a system you wire but never author (n8n, Airflow) | no |
| `call` | someone else's system, consumed over a contract | no |

> **Naming.** The managed-capability nature is **`integrate`**. The earlier internal term
> `rent` is retired everywhere, including `OwnershipMode`. (`interface` was rejected — it
> collides with `interface_kind`.)

**Deleted axes**, each verified against the live catalog to change no output before removal:
`kind` (13 values, only 4 ever read; `app_service` alone was 51 of 109 roles) ·
`treatment_mode` (a pure function of kind + containment) · `altitude` (its only reader tested
a band deliberately left empty) · `functional_kind`'s five silent values (70 of 109 roles all
resolved to the same fallback) · `palette_category_label` · `container_layer` · `sort_order`
as an axis · `technology_catalog.node_shape` (zero readers; held a value outside its own
declared union).

**Demoted to non-ontology:** `rf_visual_type` (a render hint) and `capability_tags` (search
terms). Both still exist; neither classifies anything.

### 3.2 Why four axes cover every altitude of node

The catalog contains things that are not the same *kind of thing at all* — a language, a
managed service, an entire cloud, a physical sensor. They file cleanly:

| The thing | `nature` | containment | `interface_kind` |
|---|---|---|---|
| Language / framework (Node.js, React) | build | leaf | service |
| Managed service (Lambda, S3) | integrate | leaf | service / object_store |
| Platform (AWS, Vercel, Supabase) | host | hosting container | service |
| Engine you wire, never author (n8n, Airflow) | engine | leaf | service |
| System boundary (bounded context, module) | build | logical container | service |
| Third-party API (Stripe, GitHub) | call | leaf | service |
| Physical device (sensor, robot) | build | leaf / hosting | service |

### 3.3 Derived values — never stored

| Derivation | From | Where |
|---|---|---|
| **Treatment** (`leaf` \| `container` \| `boundary`) | `nature` + `is_container`; a boundary-engine technology can raise `build`→`boundary` per node | `core/src/ontology.ts` |
| **Ownership** (`build` \| `integrate` \| `host` \| `call`) | role `nature`, then structure — a `hosts`/`deployed_to` placement or a `host` parent makes it `integrate` | `deriveOwnership` |
| **Deliverable class** | `configMode` → containment → treatment → ownership (§3.4) | `classifyNodeDeliverable` |
| **Palette chip** | `build`→Build · `integrate`/`call`/`engine`→Connect · `host`→Host · logical container→none | `node-nature.ts` |
| **Contract birth** | target role's `interface_kind` (§2.8) | `inferConnectContract` |
| **Zoom banding** | viewport state; leaves demote to icons, containers collapse to a summary chip, `engine` nodes never demote | `semantic-zoom.ts` |

Ownership is derived and not stored because the same technology shifts ownership per project
— self-hosted Airflow is `build`, Cloud Composer is `integrate` — and multi-domain products
like Supabase make any single stored value wrong somewhere.

### 3.4 Deliverable classification

What a node's task packet demands. One axis-pure classifier, never per-technology logic:

1. `ai_context.configMode` on the bound technology (authoritative catalog data):
   `none` → no task doc at all · `code` → managed runtime hosting user-authored code
   (Lambda-class) · `definition-as-code` / `declarative` / `external` → as named
2. **Container?** `logical-boundary` → `none` (organizational, no deliverable);
   any hosting container → `declarative` (a VPC, cluster or compose file owns real
   provisioning)
3. **Treatment `boundary`** → `config`
4. **Ownership**: `call` → `connection-only` · `integrate` → see below · else `code`

`integrate` splits by *source*, which matters and was a live bug once: integrate-by-**identity**
(the node IS a managed capability, or its technology is provider-branded) → `declarative`
provisioning IaC; integrate-by-**placement** (a user-authored technology merely hosted on
rented infrastructure — React on S3, Express on EC2) → `code`. Placement changes who runs the
runtime, never what the user authors.

### 3.5 Palette categories — 14, display only

`Services` · `Database` · `Networking` · `AI & ML` · `Messaging` · `Infrastructure` ·
`Platform` · `Automation` · `External` · `Observability` · `Hardware` · `Game Development` ·
`Logical` · `requirements`

> **Correction from v7.1.** That version said "13 groups" and the live column held 15 values
> including a dead `Process` singleton. There are fourteen, they are pinned by a Zod enum and
> a DB CHECK, and they carry **zero semantics** — nothing branches on a category.

Categories are a **filing and reporting axis, not the browse taxonomy.** The sidebar has been
three sections since N4.7 — Structure / Technology A–Z / Functional Node Types — and that is
what users actually navigate. v7.1 presented the category list as the palette structure; it
never was, and treating it as such is what produced the "too many parent categories" feeling.

The separate `palette_categories` *table* is deleted. It carried pre-v3 ids (`Frontend`,
`Backend`) that no role had matched since the v3 restructure, so every join through it
returned zero rows — silently dropping all 15 Services roles from archetype relevance
filtering, from `lookup_catalog`, and from prompt category ordering.

### 3.6 The role catalog — 87 roles

57 leaves + 30 containers. Deprecated roles are **deleted**, not flagged: backward
compatibility is explicitly not required for V2.

| Category | Roles |
|---|---|
| **Services** (7) | backend-service · frontend-app *(absorbed static-site)* · worker · mobile-app · realtime-service · desktop-app · serverless-function *(hidden)* |
| **Database** (10) | database · cache · data-warehouse · search-engine · time-series-db · graph-db · vector-database · event-store · object-storage *(hidden)* · file-share |
| **Networking** (12) | api-gateway · load-balancer · auth-provider · dns · waf · secret-manager · certificate-manager · cdn *(hidden)* · network-firewall · key-management · config-store · **service-mesh** |
| **AI & ML** (5) | inference-service · ai-agent-service · ml-pipeline *(absorbed data-prep + evaluation via a `stage` field)* · feature-store · model-registry |
| **Messaging** (3) | message-broker · queue · event-stream *(absorbed topic)* |
| **Automation** (3) | ci-cd-pipeline *(merged ci + cd, `stages` multiselect)* · iac-workflow · scheduled-trigger |
| **External** (5) | external-service · external-data · webhook-handler · cli-tool · bi-analytics |
| **Observability** (2) | monitoring · logging *(hidden)* |
| **Hardware** (8) | sensor · actuator · microcontroller · embedded-device · firmware-service · ros2-node · **gateway-device · robot** |
| **Game Development** (3) | game-client · game-server · **game-engine-project** |
| **Logical** (6) | shared-library · **application-module · bounded-context · software-layer · microservice-boundary · embedded-system** |
| **Infrastructure** (12) | container-registry · **vpc · subnet · k8s-cluster · k8s-namespace · docker-container · docker-compose · docker-swarm · ecs-cluster · hypervisor · virtual-machine · mobile-device** |
| **Platform** (10) | **aws · azure · gcp · cloudflare · supabase · vercel · netlify · railway · render · fly-io** |
| **requirements** (1) | requirement |

**Bold** = container. *(hidden)* = resolvable and AI-proposable, but not browsable — see
§3.7. The five Logical containers collapse to **one "Group" row** in browse; the flavors stay
reachable by search.

**Merged by the packet test:** ci-pipeline + cd-pipeline → ci-cd-pipeline (one
`.github/workflows/` file is one deliverable) · data-prep-pipeline + evaluation-pipeline →
ml-pipeline · topic → event-stream · static-site → frontend-app.

**Kept, explicitly, despite looking redundant:** `worker` vs `backend-service` (a worker has
no inbound HTTP surface and has a trigger — different packet) · `message-broker` vs `queue`
(exchange/binding semantics generate materially different code) · `ai-agent-service` vs
`inference-service` (an agent-loop packet is not an inference-endpoint packet).

**Provider capabilities are not roles.** `aws-lambda`, `azure-functions`, `gcp-cloud-run` and
their ~20 siblings are **technology rows** bound to generic roles. They were roles once, on
two different filings (`platform_capability` for AWS/Cloudflare/Supabase, `app_service` for
Azure/GCP) — and the split meant Azure Functions derived ownership `build` while AWS Lambda
derived `integrate`, so the same architectural fact produced two different task packets. The
technology row carries the capability's label for all 297 technologies, uniformly, which is
why the role layer could go.

### 3.7 Palette visibility rules

The **Functional Node Types** list (the leaf section) shows a role only if dropping it
generically would give the user a real choice. It starts from non-deprecated, non-container,
non-`integrate`, non-`requirements` roles, then applies two hide rules:

- **RULE A** — the role has at least one live technology and **zero** non-provider ones. A
  generic drop could only ask "which platform?", so the role is reached through its platform
  instead. Catches `cdn`, `object-storage`, `serverless-function`, `logging`, and the
  provider-only networking roles.
- **RULE B** — the role has **zero** live technologies at all, so a generic drop dead-ends
  with no choice to make. Exempt: `nature` `call` (external concepts are legitimately
  technology-less) and `engine`, plus the whole `Hardware` category (a sensor is a physical
  concept, not a technology binding).

Containers do not go through either rule — the **Structure** section builds from
`is_container` directly, which is why platforms and the Logical group always appear.

Hidden roles remain fully **resolvable**: AI proposals land on them, existing graphs render
them, search finds them, and they appear as drop targets when the relevant platform is on the
canvas. Hiding is a browse decision, not a capability one.

**One rule, one place.** `liveDropAffinities` is exported precisely because the canvas drop
handler must use the same predicate as the list. It once had its own copy that filtered
`!isContainer`, so `aws-vpc` / `azure-vnet` / `gcp-vpc` listed in the palette and then
silently produced nothing on drop — the list said yes and the drop said no.

### 3.8 Containment

`can_contain` accepts two shapes: a plain array of role ids, or a rule object
`{ roleIds?, natures?, interfaceKinds?, providers? }`. The rule object is what the cloud
platforms and hosting containers use — listing 60 role ids would be unmaintainable and would
silently exclude every future role.

Two invariants, enforced at the write boundary and by DB CHECK:

- A **container must declare its style.** `hosting` owns a provisioning deliverable;
  `logical-boundary` owns none. Nothing else can tell them apart.
- `nature = 'host'` implies `is_container`; `call` and `engine` can never be containers —
  you do not author their internals, so there is nothing to nest.

**Platform coexistence:** two different providers' platforms may sit on one canvas, but a
provider-branded node may not nest inside a *different* provider's platform. Provider
inference is by id prefix plus a small registered-alias table (`aurora`→aws,
`cosmosdb`→azure), with `firebase-*` resolving to **`gcp`** — N4.7 merged the Firebase family
into Google Cloud, and a copy of this table that lacked the merge caused two separate
defects before the table was unified.

---

## 4. Edge Visual Encoding

Four independent channels, so an edge can say four things at once. All tables live once, in
`src/ui/components/panels/inspector/kind-maps.ts`; labels live in
`core/src/contract-labels.ts`, typed against the enum so an unlabelled kind is a compile
error.

### 4.1 Colour — from `contract.kind` (12, theme-aware)

| kind | dark | light |
|---|---|---|
| rest | `#38bdf8` | `#0284c7` |
| graphql | `#e879f9` | `#a21caf` |
| grpc | `#34d399` | `#059669` |
| websocket | `#fbbf24` | `#d97706` |
| sse | `#fb923c` | `#c2410c` |
| kafka | `#a78bfa` | `#6d28d9` |
| amqp | `#f472b6` | `#be185d` |
| sql | `#60a5fa` | `#2563eb` |
| nosql | `#2dd4bf` | `#0d9488` |
| ipc | `#94a3b8` | `#64748b` |
| dependency | `#d97706` | `#92400e` |
| custom | `#cbd5e1` | `#475569` |

### 4.2 Dash — from `contract.interactionKind` (all 11; consumers must not subset it)

| interactionKind | dash | | interactionKind | dash |
|---|---|---|---|---|
| request_response | solid | | file_transfer | `10,6` |
| event | `8,4` | | auth | `2,4` |
| queue | `4,4` | | telemetry | `4,8` |
| data_read | `12,4,4,4` | | ipc | solid |
| data_write | `12,4,4,4` | | dependency | `2,2` |
| data_sync | `6,3` | | | |

`data_read` and `data_write` share a pattern, so the two are not visually distinguishable on
the canvas — the distinction is real in the contract and in the port labels, just not in the
stroke. Noted rather than silently tolerated.

### 4.3 Width — from `edge.criticality`
`required` 2.2 · `optional` 1.4 · `fallback` 1.0. No criticality set → 1.8, i.e. an
unspecified edge draws *heavier* than an explicitly optional one.

### 4.4 Arrow — from `edge.direction`
`unidirectional` → single arrowhead · `bidirectional` → both ends

---

## 5. Inspector Layout

Three sections. This structure works and is deliberately stable.

### 5.1 Identity
Label (editable) · role + technology · rationale (editable, `metadata.rationale`) · the
nature line and Build/Connect/Host chip, read directly from `nature`.

> There is no **kind chip**. It rendered a 10-value vocabulary against a 13-value column, so
> every AWS/Azure/GCP container and every managed capability showed a raw snake_case token in
> fallback grey. It died with the `kind` column.

### 5.2 Technology + Config
Technology binding, config fields from the technology's `metadata_schema`, and the role's
own metadata schema.

### 5.3 Connections
In-ports and out-ports with derived labels and connection state; the Connection Type select
is the contract rebind surface.

### 5.4 Port Label Derivation

Derived from `interactionKind` + `port.direction`, never stored
(`src/ui/adapters/derive-labels.ts`). An **out** port takes the source phrasing, an **in**
port the target phrasing:

| interactionKind | out (source) | in (target) |
|---|---|---|
| request_response | Calls | Serves |
| event | Publishes | Subscribes |
| queue | Enqueues | Consumes |
| data_read | Reads from | Provides data |
| data_write | Writes to | Accepts writes |
| data_sync | Syncs to | Syncs from |
| file_transfer | Uploads to | Stores for |
| auth | Authenticates via | Validates for |
| telemetry | Reports to | Monitors |
| ipc | Sends to | Receives from |
| dependency | Depends on | Used by |

> **Correction from v7.1.** That version printed a different table entirely — "Receives
> requests / Calls", "Subscribes to / Publishes", and so on, with the columns transposed
> against the code. The table above is the one that actually renders.

Unknown interaction kinds fall back to `request_response` phrasing rather than to a raw
token — the one place in the system where a fallback label is preferable to the enum value,
because a port label is prose the user reads, not a value they act on.

---

## 6. What AI Receives

Five assembly formats, by consumer.

| Format | Consumer | Contents |
|---|---|---|
| **MCP context** | external coding tools (Claude Code, Cursor) | richest: role + technology `ai_context` (purpose, best practices, anti-patterns), inherited scopes, contracts with schemas, artifacts, ownership sentence, deliverable class, readiness gaps |
| **Agent loop — compact graph** | in-app agent, ≤15 nodes | nodes as `label (role/technology)`, edges as `source →kind target` |
| **Agent loop — `get_node`** | in-app agent, on demand | one node in full, plus its contracts and immediate neighbours |
| **Scaffold prompt** | UI-triggered generation | node + technology guidance + contracts + existing artifacts |
| **Export context** | external tools / RAG | whole-graph markdown, contract vocabulary, agent rules |

### 6.1 What actually matters for code generation

In descending order of impact on output quality: the **contract schemas** on a node's edges ·
the bound **technology's `ai_context`** · the **deliverable class** (it decides whether the
AI writes code, IaC, or nothing) · **inherited scopes** from container parents · the node's
**rationale**. Role identity alone is the weakest signal — which is the empirical case for
keeping the role set small and the contract detail rich.

### 6.2 Capability equivalence

A provider-branded technology inside its provider's platform gets an explicit note: *"This
node is a managed AWS service … Treat it as provider-operated for spec generation, code
scaffolding, and architecture decisions — you configure it, you do not author its
internals."* Sourced from the **technology row**, so it fires for all 297 technologies rather
than only the ~23 that once had a matching capability role.

---

## 7. Validation and the Filing Gate

### 7.1 Graph validation (11 rules)

`edge-has-contract` · `contract-has-schema` · `schema-ref-valid` · `node-has-required-ports` ·
`port-matches-node-type-template` · `artifact-implements-contract` ·
`config-artifact-staleness` · `edge-port-direction-valid` · `containment-mismatch` ·
`orphaned-platform-capability` · `task-document-staleness`

Rules carry **fixes**, not just findings — each violation offers an action (add a contract,
create a schema artifact, unparent a node, run AI validation).

> **`orphaned-platform-capability` was re-keyed by M7.** It asked whether the *role* was a
> managed capability, and after the capability-role retirement no role is — so its primary
> path could never fire again. Its fallback path was worse: a hardcoded set naming nine roles
> that no longer exist plus four (`dns`, `waf`, `secret-manager`, `certificate-manager`) that
> are ordinary `build` roles, on which it raised **false errors** whenever the catalog had
> not loaded. It now asks the question of the **technology** — the axis that carries the fact
> — through the same provider table everything else uses. The check itself is unchanged: a
> managed provider service needs a platform parent, of the matching provider family.

### 7.2 The catalog gate — three layers

The catalog was, until M5, not schema-guarded at all: rows were read with a raw `as` cast and
six DB CHECKs were the only enforcement anywhere. That is why the vocabulary columns drifted.
Three layers now guard it, from **one definition per runtime pair**:

| Layer | Where | Posture |
|---|---|---|
| **READ** | `core/src/catalog-schemas.ts` + server mirror, in `loadCatalog()` | **Lenient** — an invalid row is skipped and reported, never thrown. One bad row must not blank the canvas. |
| **WRITE** | `validateCatalogFiling` / `validateTechnologyFiling` | **Strict** — the insert-time gate for node packs and user-defined roles |
| **DB** | CHECKs + triggers | the backstop nothing can route around |

`validateCatalogFiling` is the filing question, in full: *is this row a coherent
`(nature, containment, interface_kind)` triple whose references all resolve?* It refuses a
non-container `host`, a `call`/`engine` container, a container with no declared style, a
hosting container that admits nothing, a `can_contain` pointing at a role that does not
exist, and any `suggested_contracts` token outside the current vocabulary.

Two failure modes are enforced by **trigger**, because a CHECK cannot span tables and both
fail *silently*:

- A technology whose `role_affinities` do not resolve simply **vanishes** from the palette —
  no error anywhere, and the row looks fine in the table. Three technologies sat invisible
  and unplaceable this way.
- A dead `can_contain` id makes a container refuse a child it was configured to admit.

### 7.3 Adding a node pack

A pack author adds **identity** freely and cannot drift the ontology, because there is no
axis to invent. A new role is three questions in vocabulary the palette already shows:

1. **Who runs it?** → Build / Connect / Host → `nature`
2. **Does it hold other nodes?** → `is_container` + `container_style`
3. **What does calling it mean?** → `interface_kind`

5 × 3 × 7 = 105 valid shapes, each producing a correct task packet and a correctly-born edge
contract. The "none of these roles is my thing" dead end is a generic role plus a technology,
not a taxonomy request.

---

## 8. Architectural Decisions

**8.1 Role + Technology is the core abstraction.** Roles answer *what is this, architecturally*;
technologies answer *built with what*. Keeping them orthogonal is what lets ~87 roles cover
297 technologies without combinatorial explosion.

**8.2 Requirements are not architecture nodes.** They live in a separate decomposition view,
route to their own inspector, and are filtered from every architecture picker.

**8.3 Platform capabilities are technologies, not roles.** See §3.6. The role layer for
provider capabilities is fully retired — on both filings.

**8.4 Edges are born inferred, silently.** No picker interrupts a draw; the inspector rebinds.
See §2.8.

**8.5 Ownership is derived from structure, never stored.** See §3.3.

**8.6 Containers are not merely organizational.** A hosting container owns a real provisioning
deliverable; only `logical-boundary` containers own none. This distinction is the whole reason
`container_style` is mandatory.

**8.7 One UI framework per app node.** A frontend framework inside an app is a `uiFramework`
field, not a node. Likewise: build targets are a multiselect, a language's web framework is
not separate from the language, pipeline security tools are pipeline config, and the device OS
under a mobile app is not a node.

**8.8 Dead fields are deleted, not deprecated.** V2 has no backward-compatibility obligation,
and a deprecated-but-present field is indistinguishable from a live one to anyone reading the
schema.

---

## 9. Reverse-Engineering Pipeline

Reconstructs an architectural graph from an existing codebase.

1. **Tree scan** — classify repo files into four importance tiers
2. **Budget allocation** — decide which files to fetch content for
3. **File classification** — role, language, framework, artifact kind, from import headers only
4. **Pre-computation** (deterministic, server-side) — directory summaries, cross-directory
   import graph, grouping hypotheses, deterministic edges, deployment topology, package
   fingerprints
5. **AI discovery** — architectural hypotheses from the pre-computed evidence
6. **AI grouping** — pre-computed hypotheses ≥ 0.85 confidence are accepted unmodified
7. **AI relationships** — deterministic edges from static analysis are confirmed without
   re-verification
8. **Patch generation** — validated role ids, ports, contracts, artifacts

Repo import emits **role ids**. The dotted grammar it used to produce is gone.

**Confidence tiers:** ≥0.85 deterministic/accepted · 0.6–0.85 AI-proposed, user-reviewable ·
<0.6 suggested only. Nodes and edges land as `status: 'suggested'` until promoted.

---

## 10. Known Issues and Debt

Honest list. Everything above this line describes the system as built.

| # | Item | Impact |
|---|---|---|
| 1 | `ConnectionDetails` force-overwrites `interactionKind`/`transport`/`specFormat` on every Connection Type change. No entry produces `data_write` or `data_sync`, so those two interaction kinds — and their dash patterns — are **destroyed the moment a user touches the select**, unrestorably. Same for `file_transfer`/`auth`/`telemetry` born from connect-time inference. | User-visible data loss |
| 2 | The transport select offers 22 of 23 (missing `none`, so a `dependency` contract's honest transport is unrestorable); the spec-format select offers 9 of 16, missing exactly `oauth_oidc` and `telemetry_schema` — the two values the system auto-fills. | Same class as #1 |
| 3 | `CanvasDock`'s `INTERACTION_LABELS` covers 8 of 11 (missing `data_write`, `data_sync`, `ipc`) and mislabels `data_read` as "Data Read/Write". Unknown kinds fall through to the raw enum token. | Legend incomplete |
| 4 | `PlacementKind.deployed_to` is unreachable — neither inference path produces it, and it has no visual encoding. It still *reads* correctly (`deriveOwnership` treats it as hosted), so it is inert rather than wrong. | Dead enum value |
| 4b | `derive-labels.ts` handles a `bidirectional` port direction, but `PortDirection` is `'in' \| 'out'` — the branch is unreachable from a schema-valid port. | Dead branch |
| 5 | `add_edge` (MCP) has no `direction`/`criticality` parameter, though `propose_patches` does. | API asymmetry |
| 6 | `supabase/schema/prod_schema_dump.sql` is stale relative to the migration head. | Doc drift |
| 7 | 24 test files carry pre-existing failures unrelated to the ontology (129 assertions), largely AI-generation and template-routing suites. | Test debt |

Items 1–3 are one bench-checked inspector pass; they were deliberately excluded from the M6
deletion work because they change inspector *behavior*, and the inspector is the surface the
owner asked not to break.

---

## 11. File Locations

| Concern | File |
|---|---|
| **Node identity model (`nature`, treatment, ownership)** | `core/src/ontology.ts` (mirror: `supabase/functions/_shared/ontology.ts`) |
| **Catalog read/write schemas + filing gate** | `core/src/catalog-schemas.ts` (+ server mirror) |
| Enum definitions | `core/src/shared/enums.ts` (+ server mirror) |
| **Contract vocabulary — defaults, retired kinds, aliases, interaction→kind** | `core/src/shared/legacy-mappings.ts` (+ server mirror) |
| **Contract resolution + connect-time inference** | `core/src/interaction-resolution.ts` |
| **Contract-kind display labels** | `core/src/contract-labels.ts` |
| **Provider inference (prefix + family + aliases)** | `core/src/provider-inference.ts` (+ server mirror) |
| Palette category list | `core/src/palette-categories.ts` (+ server mirror) |
| Node/Edge/Contract Zod schemas | `core/src/schemas.ts` · server: `supabase/functions/_shared/graph-schema.ts` |
| Container types + static data | `core/src/container-types.ts` · `core/src/container-type-data.ts` |
| Validation rules / engine | `core/src/validation/rules.ts` · `engine.ts` |
| Catalog repository (`NodeRole` interface) | `src/persistence/supabase/catalog-repository.ts` |
| Palette builder · nature/chip derivation | `src/ui/utils/palette-roles.ts` · `src/ui/utils/node-nature.ts` |
| Zoom banding | `src/ui/utils/semantic-zoom.ts` |
| Edge visual encoding + picker structure | `src/ui/components/panels/inspector/kind-maps.ts` · `edges/CustomEdge.tsx` |
| Inspector | `src/ui/components/panels/SimplifiedInspector.tsx` · `inspector/ConnectionDetails.tsx` |
| Connect adapter (edge/contract birth) | `src/ui/adapters/interaction-to-patch.ts` |
| Graph→ReactFlow adapter | `src/ui/adapters/graph-to-reactflow.ts` |
| MCP context assembly | `supabase/functions/_shared/mcp-context-assembly.ts` |
| Task packet + deliverable classifier | `supabase/functions/_shared/task-document-generator.ts` |
| Role validation + auto-correction | `supabase/functions/_shared/role-registry.ts` |
| Agent loop | `supabase/functions/_shared/agent-loop-v4.ts` |
| Repo import (client) | `core/src/repo-import/` |
| Repo import (server) | `supabase/functions/analyze-repo-import-v4/` · `_shared/import-patch-generator.ts` |
| Export context | `src/ui/utils/export-context.ts` |

**Client/server mirrors.** `ontology.ts`, `enums.ts`, `legacy-mappings.ts`,
`catalog-schemas.ts`, `palette-categories.ts` and `provider-inference.ts` exist on both
runtimes and must stay identical in values; only the import specifier differs (Node vs Deno).
`ontology.ts` is additionally pinned across runtimes by a golden fixture
(`supabase/functions/tests/fixtures/ontology-golden.json`) — change one side and the other
side's suite fails.
