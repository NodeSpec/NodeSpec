---
name: technology-catalog
description: Add or improve rows in NodeSpec's technology_catalog and file their role_affinities correctly. Use when adding a technology/framework/managed service/database to the catalog, fixing a mis-filed or dangling affinity, enriching ai_context (purpose, bestPractices, antiPatterns, configMode), authoring a metadata_schema, or writing the migration that ships any of it. Also use when a technology is invisible in the palette, drops nothing on the canvas, or produces the wrong task packet.
---

# Adding and improving technology_catalog rows

## The model, in one line

```
node = ROLE (what it is, architecturally) + TECHNOLOGY (what it's built with) + POSITION
```

A technology is **never** a role. `aws-lambda`, `postgresql`, `react` are technology rows
bound to generic roles (`serverless-function`, `database`, `frontend-app`) via
`role_affinities`. The capability-role layer was fully retired in M1b/M7 — do not re-create
it by adding a role for a product.

Ground truth: `Ontology.md` (v8) · `docs/NODE_REFERENCE.md` (the axis model) ·
`docs/N8_4_ENRICHMENT_TRACKER.md` (per-family history and prior rulings).

Two rules decide most questions:

> **A role earns its existence only if it changes the task packet.**
> **Generic-but-vague is acceptable; wrong-and-specific is not.**

---

## Step 0 — three checks before writing anything

Skipping these is how the catalog accumulated duplicates and dead products.

**1. Does it already exist under another name?** Three duplicate pairs shipped before
someone checked (`cosmosdb`/`azure-cosmos-db`, `azure-ad-b2c`/`azure-entra-id`, and a
Fabric/OneLake overlap). Vendors rebrand: EventStoreDB→KurrentDB, Cognitive
Services→Azure AI Services, AutoGen→Microsoft Agent Framework.

```sql
SELECT id, name, display_name, role_affinities FROM technology_catalog
WHERE id ILIKE '%<stem>%' OR name ILIKE '%<stem>%' OR display_name ILIKE '%<stem>%';
```

**2. Is the product actually alive?** Do not add a dead or license-poisoned product just
because it is famous. Precedents: **MinIO community** not added (archived 2026-02),
**HashiCorp Vault** not added (BSL, unresolved OpenBao fork). If a row exists and the
product died, keep it and add a `migrationTarget` field pointing at successors — that is
what happened to TorchServe.

**3. Does the right role exist?** If the honest answer is "no role fits", **stop and raise
it** — do not file it under a role that means something else. The mis-filings that cost the
most (`aws-ecr`/`azure-container-registry` filed `object-storage`; `aws-efs` filed
`object-storage`; `gcp-cloud-kms` filed `auth-provider`) all came from someone guessing
rather than flagging a missing role. Six roles were eventually created for exactly this
queue. A new role is a `node_roles` change and goes through `validateCatalogFiling`.

---

## 1. role_affinities — the highest-consequence field

This is the field that decides whether the row is reachable, what it drops as, and what an
edge into it means. Get it wrong and the failures are **silent**.

### Order matters

`role_affinities[0]` is the primary. It drives the palette caption, the technology's
default role, and relevance scoring. `nodejs` filed `[worker, backend-service]` presented
Node.js as a background worker until it was re-ordered.

### Count matters — every extra live leaf is a drop-time picker

`liveDropAffinities()` (`src/ui/utils/palette-list.ts`) resolves affinities, drops
deprecated ones, and **prefers leaves** (containers only if there are no live leaves).
Then `Canvas.tsx`:

| live leaf affinities | what the user gets on drop |
|---|---|
| 0 | **nothing happens** — the row is invisible in the palette and inert on drop |
| 1 | silent, correct drop (the goal) |
| 2+ | a "how are you using this?" picker, every single time |

So: **one affinity unless a second is genuinely a different architecture.** GitHub Actions
pointing at both `ci-pipeline` and `cd-pipeline` forced a picker with no right answer —
which is why M3 merged those roles. Live distribution is 211 of 297 rows on exactly one.

Legitimate multi-affinity: `postgresql` → `[database, vector-database]` (pgvector really is
a different node). Illegitimate: listing every role the product *could* serve.

### The silent-invisibility failure

A technology whose affinities do not resolve **vanishes** from the palette. No error, no
log, and the row looks perfect in the table. `quartz`, `deno-edge` and `vercel-edge` sat
unplaceable this way until M0 found them.

Since M5 the database refuses this: `assert_role_affinities_resolve()` raises on INSERT or
UPDATE. `validateTechnologyFiling()` (`core/src/catalog-schemas.ts`) is the same check at
the write boundary. **Never write an affinity you have not confirmed exists.**

### Affinity smell test

Ask: *"if a user drops this and gets this role with no further questions, is that right?"*
If not, the affinity list is wrong — not the picker.

Past corrections worth pattern-matching: `azure-dns` `cdn`→`dns` (plain wrong) ·
`azure-key-vault` `auth-provider`→`secret-manager` · `azure-event-grid`
`event-stream`→`message-broker` (routing, not a log) · `azure-application-gateway`
`api-gateway`→`load-balancer` · `synapse` `database`→`data-warehouse` · react/vue/angular
**dropped** `desktop-app` (a React desktop app is one Electron node with `uiFramework:
react`, not two nodes for one UI).

---

## 2. ai_context — what the AI actually reads

JSONB. Three keys are on all 297 rows and are effectively required.

```jsonc
{
  "purpose":       "2–4 sentences: what it is, WHEN to choose it, and when NOT to.",
  "bestPractices": ["...", "..."],   // architecture-level, 5–8
  "antiPatterns":  ["...", "..."],   // what goes wrong, 5–8
  "typicalTech":   ["..."],          // 275/297 — co-occurring technologies
  "configMode":    "declarative",    // see the table below — drives the TASK PACKET
  "provenance":    { "method": "live-docs", "verifiedAt": "YYYY-MM-DD",
                     "sources": ["https://..."], "notes": "what was verified" }
}
```

Optional, use when they earn their place: `sdkInitPattern` (107) · `securityGuidance` (70)
· `integrationPatterns` (61) · `commonApiPatterns` (60) · `configurationTemplate` (60) ·
`setupInstructions` (42) · `apiReference` (27) · `freshnessNote` (23) ·
`treatmentOverride` (2, see below).

**`purpose` must include the negative case.** "Use X when… Do not use X when…" is the shape
that stops an AI reaching for the wrong tool. A purpose that only praises the product is
not finished.

**`bestPractices` are architecture, not tutorial.** "Keep functions small and
single-purpose" ✅. "Run `npm install`" ❌.

### configMode — the field that decides the task packet

Read by `classifyNodeDeliverable` (`supabase/functions/_shared/task-document-generator.ts`).
Getting this wrong tells the user's AI to write the wrong *kind* of thing.

| value | meaning | typical rows |
|---|---|---|
| *(unset)* | classify via the ownership path | **frameworks** — react, express, django |
| `code` | managed runtime hosting **user-authored** code | aws-lambda, azure-functions, gcp-cloud-functions |
| `definition-as-code` | the deliverable is a config file in the repo | nginx, k8s, airflow, dbt, terraform-ish tools |
| `declarative` | provisioned infrastructure, IaC deliverable | managed DBs, brokers, platforms, stores |
| `external` | third-party SaaS you configure in their console | — |
| `none` | account-access only, **no task doc at all** | — |

**Leave it UNSET for frameworks.** This is a deliberate standing rule from 4d-1, not an
omission: frameworks classify as working code through the ownership path, and stamping
`code` blurs the Lambda-class semantic (`code` means *someone else's runtime, your
handler*). ~96 rows are legitimately unset. Do not "fix" them in bulk.

`treatmentOverride: "boundary"` is separate and rare (n8n, apache-nifi): an engine you wire
but never author the internals of. It raises a `build` role to `boundary` for that node.

### provenance — be honest

`method` is `live-docs` (you actually fetched vendor docs) or `model-knowledge` (you did
not). 164 rows say `model-knowledge` and that is fine — what is not fine is labelling
recalled knowledge as verified. Include `sources` only for `live-docs`.

Live-docs checks have repeatedly caught things that would have shipped wrong: Next.js
Turbopack now default, Angular zoneless default, Memorystore defaulting users toward
deprecated Memcached, Kafka 4.x being KRaft-only (`zookeeper.connect` is dead
architecture). **For any fast-moving product, fetch the docs.**

---

## 3. metadata_schema — the wrong-altitude test

Fields the user fills in the inspector. Shape:

```jsonc
{ "<fieldName>": { "type": "enum" | "multiselect" | "boolean" | "number" | "string",
                   "label": "Human Label",
                   "options": ["a","b"],       // enum + multiselect only
                   "default": "a",             // omit for multiselect
                   "description": "what this decides" } }   // optional but usually earned
```

**Use `enum`, not `string`-with-options.** Live usage across the catalog: `enum` 417 ·
`boolean` 273 · `string` 157 (free text, no options) · `multiselect` 98 · `number` 75.
`multiselect` is the right type when each choice is separately-enabled setup work —
prometheus's `scrapeTargets` and trivy's `scanTargets` are the pattern.

**The altitude test — the single most common authoring mistake.** A field belongs here only
if it is an **architecture decision**. Two failure classes, both caught in review before:

- **Too low (connection strings).** kafka/rabbitmq/nats "had schemas" that were
  host/port/broker-address arrays with localhost defaults. Deployment detail, not
  architecture. Replaced with `messagingModel`, `queueType`, `persistence`.
- **Too low (request knobs).** Inference rows carrying `temperature`/`maxTokens`. Those are
  per-call parameters, not node configuration.

**No version enums.** Versions rot faster than anything else in the catalog. Where a version
boundary genuinely *is* the choice, name the **model**, not the number: `runes`,
`interactive-auto`, `flex-consumption`, `quorum`. Enums that named versions have all gone
stale.

**Check enum currency against live docs.** Four enums were stale on inspection and one was
actively harmful (Memorystore steering users to deprecated Memcached). Also watch for enums
that conflate different things — Cloud Run's `executionMode: service|job|function` listed
three *different resources* as modes of one, and had to be split into `resourceKind`.

---

## 4. The remaining columns

| column | notes |
|---|---|
| `id` | **Provider rows MUST carry the prefix**: `aws-`, `azure-`, `gcp-`, `supabase-`, `firebase-`, `cloudflare-`. Pre-prefix strays (`aurora`, `dynamodb`, `ec2`, `cosmosdb`) are registered in `core/src/provider-inference.ts` — do not create new ones. `firebase-*` resolves to provider **`gcp`** (N4.7 merge). |
| `name` | Official product name. `display_name` only when it differs meaningfully ("Swift (iOS)"). |
| `brand_color` / `secondary_color` | Real brand hex. Drives the node chip. |
| `icon_url` | Optional. **Absent means no logo** — the row still works, it just renders generically. |
| `suggested_files` | `[{kind, path}]`, `kind` ∈ the 8 ArtifactKinds. Optional `priority`/`description` are tolerated. Paths should be idiomatic for the technology. |
| `common_connections` | Prefer the canonical `[{id, reason}]` shape. Plain `["id"]` and `{targetRole, contractKind}` also exist in live data; do not add more of the third. |
| `node_shape` | Effectively dead — no reader. Use `rounded`. |
| `is_user_contributed` | `false` for catalog rows. `true` requires `project_id`; a CHECK enforces the pairing. |
| `search_vector` | **Generated. Never write it by hand.** |

---

## 5. Ship it as a migration

Never hand-edit production rows. Follow the repo pattern — see
`reference/migration-template.sql`, and `supabase/migrations/20260731120000_m0_*.sql` for a
worked example.

Non-negotiables, learned the hard way:

1. **`DO $$ … RAISE EXCEPTION` verification at the end.** A migration must abort rather than
   half-apply. Every M-series migration does this.
2. **Simulate against real data first.** Export the live rows and check your UPDATE in
   Python/SQL before writing it. An M0 repoint would have created a *new* two-option picker
   for celery-beat; it was caught only by simulating.
3. **Verify affinities resolve** in the same migration — the M5 trigger will raise anyway,
   but a named error beats a constraint violation.
4. **Timestamp after the current head** (`ls supabase/migrations | tail -1`). If another
   branch is also adding migrations, make replay order match merge order.

---

## 6. Verify

`reference/audit-queries.sql` has the full set. The minimum after any catalog change:

```bash
npx tsc --noEmit                                   # client
deno check supabase/functions/**/*.ts              # server — NOT covered by tsc
npx vitest run src/tests/catalog-schema-gate-m5.test.ts
supabase db reset                                  # replays every migration in order
```

Then the four questions the audit queries answer:

1. Does every affinity resolve? (else: invisible row)
2. Does any row have zero affinities and `is_user_contributed = false`? (else: unplaceable)
3. How many live **leaf** affinities does it have? (2+ = you added a picker)
4. Is `configMode` right for its class? (else: wrong task packet)

And one thing a query cannot answer — **drop the node on the canvas.** Confirm it lands as
the role you intended, with no picker you did not intend.

---

## Failure modes seen before

Match against these before shipping; each one shipped at least once.

| Symptom | Cause |
|---|---|
| Row invisible in palette | affinity does not resolve, or all affinities deprecated |
| Drops nothing on the canvas | zero **live leaf** affinities (container-only affinities) |
| Unwanted picker on every drop | 2+ live leaf affinities |
| Presented as the wrong thing | `role_affinities[0]` is not the primary use |
| AI told to write code for a managed service | `configMode` unset or wrong |
| AI writes IaC for a framework | `configMode` stamped `code`/`declarative` on a framework |
| Node refused inside its own platform | provider prefix missing, or a `firebase-*` id expected to resolve to `firebase` rather than `gcp` |
| Config fields users cannot answer | wrong-altitude schema (connection strings, request knobs) |
| Guidance stale within months | version enums, or `model-knowledge` on a fast-moving product |
| Two rows for one product | skipped the Step 0 duplicate check |
