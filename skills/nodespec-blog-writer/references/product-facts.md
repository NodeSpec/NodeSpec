# NodeSpec Product Facts

This is the only source of truth for product claims in blog content. If a claim
you want to make isn't backed by something here, don't make it — ask the user or
soften the language to something you can actually support. Getting a technical
detail wrong in front of the exact audience (architects, senior engineers) who
will notice costs more credibility than the post was worth.

**Always call the product "NodeSpec."** An older internal doc used the name
"Nodal" during a rename — never use it in published content.

## Positioning

- **Site:** nodespec.io
- **Tagline:** "AI Architecture Context for Cursor, Claude & Agents"
- **Category:** version-controlled, collaborative system architecture editor
  with AI-assisted design.
- **Core value prop:** NodeSpec turns system architecture from a whiteboard
  exercise into a living, version-controlled, AI-powered specification that
  stays in sync with what you actually build.
- **Audience:** software architects, senior engineers, product-minded
  developers, CTOs/VPEs, engineering leads.

### What NodeSpec is not

Useful for positioning and migration content — say what it isn't, not just what
it is:

- Not a generic diagramming tool (Lucidchart, Miro) — every node and edge is
  typed, versioned, and semantically meaningful, not just a shape on a canvas.
- Not a project management tool (Jira, Linear).
- Not a pure infrastructure-as-code tool (Terraform, Pulumi) — though a graph
  can export toward that direction.

## How it works

- **Role + technology separation.** The core mechanic: a node's `type` is its
  architectural *role* (what it is — e.g. `database`), and `technology` is the
  implementation (how it's built — e.g. `postgresql`). This is the fix for
  diagrams that conflate "what this component does" with "what framework it
  happens to use today."
- **Patch-based versioning.** Every change to a graph is an immutable, atomic
  patch with an audit trail — the architecture equivalent of Git. Branches let
  teams explore parallel architectural directions without clobbering shared
  work.
- **Two directions, one ontology:**
  - **Forward = spec-driven development.** Design the architecture greenfield
    on the canvas, then export context for AI code generation.
  - **Reverse = code-driven discovery.** Point NodeSpec at an existing repo and
    a 4-phase AI pipeline — **Discovery → Grouping → Relationships →
    Validation** — reconstructs the architecture graph from the actual code.
    This is the mechanism behind "repo import" and the reverse-engineering
    content pillar.
- **Drift detection as infrastructure.** Out-of-band changes — someone commits
  directly to git instead of going through NodeSpec — get caught by a drift
  sweep and routed back through the same proposal/approval pipeline as an
  in-app edit. This is the concrete mechanism worth citing in any post about
  configuration drift, AI slop, or code sprawl: the point isn't "AI agents are
  bad," it's that unsupervised changes need a place to surface and get
  reconciled instead of silently diverging from the documented architecture.
- **Specification system.** Structured requirements, features, acceptance
  criteria, and test cases, with bidirectional traceability to the architecture
  nodes that implement them — so "what does this system do" and "how is it
  built" stay linked instead of drifting apart in separate docs.
- **MCP server** at `mcp.nodespec.io` — OAuth 2.0 with PKCE, JSON-RPC 2.0.
  External AI coding agents (Claude Code, Cursor, Copilot) connect to it to get
  real architectural context instead of inferring structure from a partial
  checkout of the repo.
- **Template marketplace** — pre-built architecture graphs: AWS Full-Stack, GCP
  Full-Stack, Next.js + Supabase + Stripe SaaS, AI RAG Pipeline, with more being
  added. Useful as starting points and as recognizable reference architectures
  to compare a reader's stack against.

## Pricing (verify against `src/ui/components/pricing/pricing-data.ts` before
quoting a number — this table is a snapshot and pricing can change)

If that file isn't in reach in your current context, don't quote a specific
dollar figure — describe tiers qualitatively instead (e.g., "the Architect plan
unlocks repo import") and note that pricing may have moved on since this
reference was written.

| Plan | Price | What it unlocks |
|---|---|---|
| **Free** | $0 | 1 project, canvas access, 600K one-time trial tokens. No GitHub integration, no repo import. |
| **Solo** | $15/mo ($12/mo billed annually) | Unlimited projects, full canvas, BYOK. Still no GitHub integration or repo import. |
| **Architect** | $50/mo ($40/mo annually) | Everything in Solo + GitHub export + **repo import & reverse architect** — this is the tier that unlocks the reverse-engineering feature, worth calling out explicitly in that content pillar. |
| **Pro** | $79/mo ($65/mo annually) | Everything in Architect + MCP server / agent connectivity + priority support. |
| **Enterprise** | Custom | Local or managed/hosted deployment, custom model API connection, data residency, dedicated support — the landing tier for "graduate off a hosted AI app builder to something you control." |
| **Government** | Custom | Deployed into compliant government cloud enclaves, compliance package builder, works with any foundation or open-weight model. |

All non-free tiers are **BYOK-primary** — users bring their own model API key;
platform tokens are a trial allowance, not the ongoing metering mechanism. Get
this right in any pricing-adjacent content; it's a common point of confusion
with fully-metered competitors.

**"Trial" only describes the Free tier's 600K one-time tokens.** There is no
separate "Architect trial" or "Pro trial" product — a paid tier is something a
reader signs up for or upgrades to, not something they trial. So CTA copy
should say "start on Architect" / "upgrade to Architect," never "start an
Architect trial" or "try Architect free." Real routes to point a CTA at:
`/pricing` (plan comparison + upgrade), `/templates` (template marketplace,
good MOFU link), `/blog` (internal linking to other posts). There's no
dedicated `/signup` route — signup happens inside the app at `/app`, so for a
BOFU CTA, link to `/pricing` and let the reader choose a plan there rather than
inventing a deep link.

## Competitors / migration-from targets

For the migration/graduation content pillar, these are the platforms readers are
likely moving off of:

- **Base44, Bolt.new, Lovable** — AI app builders optimized for going from
  prompt to working app fast. Strong at what they do; the gap is durability —
  no persistent architecture diagram, no versioned specification, no drift
  detection as the app grows past the point one person can hold the whole thing
  in their head. Write about this gap honestly: these tools aren't "wrong," they
  solve a different problem (0-to-prototype) than NodeSpec does (prototype-to-
  maintained-system).
- **Plain/unmanaged Supabase.** Supabase itself is fine and is often part of the
  target architecture too — the gap is that a Supabase project with no
  architecture layer on top has no record of *why* the schema, RLS policies, and
  edge functions are shaped the way they are, and no automated way to catch
  drift between what's documented and what's deployed. The self-hosted escape
  hatch is real: Supabase's own stack (Postgres + RLS, GoTrue, PostgREST,
  Realtime) can be self-hosted, which is the technical basis for NodeSpec
  Enterprise's "local or managed/hosted deployment" option — a reader isn't
  being asked to trust a black box, they're being offered a governance layer
  over infrastructure they can still run themselves.

Never claim a specific limitation of these tools that you can't verify (exact
pricing, exact feature list) — describe the general architectural gap
(no diagram, no spec, no drift detection) rather than a specific claim you'd
have to fact-check.
