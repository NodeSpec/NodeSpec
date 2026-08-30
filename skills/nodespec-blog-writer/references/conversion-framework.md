# Conversion Framework

Structure, CTA, and SEO guidance by article type, plus the pre-publish
self-check. The goal of every post is the same: be worth reading even to
someone who never converts, while making the next step obvious to the reader
who's ready for it.

## Structures by article type

### Tutorial
1. Opening — the problem this solves, 2-3 paragraphs, no throat-clearing intro.
2. Prerequisites / what you'll need.
3. Core implementation sections, one `<h2>` per major step.
4. Common pitfalls / gotchas.
5. Closing — what you built and where to go next.

### Deep-dive
1. Opening — the question this answers.
2. Background / why this matters now.
3. Core analysis sections.
4. Comparison table, if applicable.
5. Recommendation / conclusion.

### Comparison
1. Frame the decision — who needs to make this choice and why.
2. Option A analysis.
3. Option B analysis.
4. Side-by-side comparison table.
5. When to choose what.

### Migration / graduation guide
This is the primary structure for the Base44/Bolt.new/Lovable/Supabase content
pillar. It has to be symptom-led — start from the reader's actual pain, not from
NodeSpec's feature list:
1. **Symptom-led opening.** Name the moment it breaks — "your Lovable app works
   until three people are editing the same flow and nobody can say what changed
   or why," or "your Supabase schema has forty tables and the only record of
   why RLS is shaped that way is a Slack thread from four months ago." Be
   specific to the platform being discussed.
2. **What's actually missing, architecturally.** Not "you should use NodeSpec"
   — diagnose the real gap: no persistent architecture diagram, no versioned
   spec, no drift detection, tribal knowledge instead of documented decisions.
3. **The extraction/graduation path, step by step.** How to pull a real
   architecture out of an app that was built without one — this section should
   be useful even to a reader who does it by hand with a whiteboard, not just
   with NodeSpec.
4. **Where NodeSpec fits.** Concretely: repo import to reconstruct the diagram
   from existing code, the specification system to capture what's implicit,
   drift detection to keep it honest going forward.
5. **What you keep control of.** Address the fear directly — self-hosted/managed
   options, BYOK, data residency where relevant. Graduating off a vibe-coded app
   shouldn't mean trading one black box for another.

### Reverse-engineering teardown ("we reverse-engineered a repo")
1. **Pick the repo and say why.** A real reason — it's a common architecture
   pattern, it's instructive about a specific failure mode, it's a well-known
   open-source project readers will recognize.
2. **Run the 4-phase import conceptually.** Walk Discovery → Grouping →
   Relationships → Validation as a narrative, not a feature list — what does
   each phase actually surface about this specific repo.
3. **What the diagram reveals that reading the code alone wouldn't.** This is
   the payoff section — hidden coupling, a missing contract, drift between docs
   and what's actually deployed, a dependency that shouldn't exist.
4. **The architecture lesson.** Generalize it — what should a reader check for
   in their own system.
5. **CTA to try repo import on their own repo.**

## CTA and funnel mapping

One clear CTA per post, matched to funnel stage — stacking multiple CTAs dilutes
all of them. There's no separate "trial" product for paid tiers (see
`product-facts.md`) — a BOFU CTA is an upgrade ask, not a trial ask:

- **TOFU** (thought-leadership, general architecture content) → newsletter
  signup or follow, not a product pitch.
- **MOFU** (reverse-engineering teardowns, tutorials) → point at `/templates`
  or invite the reader to run repo import on their own repo — repo import is
  an Architect-tier feature, but Free is the door-opener for signup.
- **BOFU** (migration guides, direct comparisons) → "start on Architect" or
  "upgrade to Architect," linking to `/pricing` — don't invent a `/signup` or
  other deep link that doesn't exist in the app.

## Length by article type

| Article type | Target length |
|---|---|
| Tutorial | 1,500-2,500 words |
| Deep-dive | 1,500-2,500 words (2,500-4,000 if the comparison table and analysis genuinely need the room) |
| Comparison | 1,200-2,000 words |
| Migration/graduation guide | 1,800-2,800 words — the extraction-path section needs room to be genuinely step-by-step |
| Reverse-engineering teardown | 1,500-2,500 words |

Treat these as a target range, not a hard floor — hitting the low end with a
tight, complete post beats padding to the middle of the range.

## SEO basics

- Put the target keyword in the title and the meta description naturally — if
  it doesn't fit without sounding forced, don't force it.
- One keyword focus per post; secondary keywords can appear in subheadings
  where they fit the content, not as a checklist to satisfy.
- Internal linking: reference other NodeSpec posts where genuinely relevant
  (e.g. a migration guide linking to a reverse-engineering teardown that shows
  the import pipeline in action) — don't manufacture a link that isn't useful
  to the reader.

## Pre-publish self-check

Run this against your own draft before presenting it as finished. Fix issues
silently and report only the parts you had to adjust — the user doesn't need a
narrated clean bill of health.

1. **Banned-phrase scan** — search the draft against the list in
   `brand-voice.md`. Any hit gets rewritten.
2. **Claim-accuracy scan** — every NodeSpec feature, pricing, or capability
   claim traces to `product-facts.md`. Anything that doesn't, cut or soften.
3. **One-CTA check** — exactly one clear call to action, matched to the plan's
   funnel stage.
4. **Heading scan** — no `<h1>`, logical `<h2>`/`<h3>` hierarchy, no orphan
   sections.
5. **Code-example realism check** — every code block is real, runnable syntax
   for the language/framework named, not pseudocode.
