# Planning Template & Topic Bank

## Plan format

Fill this out and present it for sign-off before writing anything. Keep it
skimmable — a paragraph per field at most, most fields are a line.

```
CONTENT PILLAR: [migration guide | reverse-engineering teardown | thought leadership | tutorial/comparison]
WORKING TITLE:
TARGET KEYWORD:
SECONDARY KEYWORDS: [2-4]
FUNNEL STAGE: [TOFU | MOFU | BOFU]
ICP / PERSONA: [e.g. "solo founder who shipped an MVP on Lovable and just hired engineer #1"]
ARTICLE TYPE: [tutorial | deep-dive | comparison | migration-guide | case-study | opinion | reverse-engineering-teardown]
ANGLE / THESIS: [the one-sentence point of the post]
OUTLINE:
  H2 — [section] — [one-line note on what it covers/argues]
  H2 — [section] — ...
  ...
COMPETITOR CONTENT GAP: [what's missing or wrong in what currently ranks/exists for this topic]
CTA: [matched to funnel stage — see conversion-framework.md]
TARGET LENGTH: [see the length-by-article-type table in conversion-framework.md]
YOUTUBE COMPANION: [yes/no — why]
```

## Topic bank

Starting points by pillar — pull from here when the user wants ideas rather
than bringing their own topic. Treat titles as working titles, not final copy;
sharpen them once the angle is locked.

### Migration / graduation guides

1. "Your Lovable App Works Until It Doesn't: What Breaks Past the First Three Engineers"
2. "Base44 Got You to a Working Product. Here's How to Get an Architecture Out of It."
3. "Bolt.new Prototypes Fast — Here's What to Do the Week After It Becomes Your Real Product"
4. "The Supabase Project With No Architecture Diagram: A Post-Mortem Format"
5. "Self-Hosting Supabase: What You Actually Need to Own vs. What You're Better Off Managing"
6. "Graduating an AI-Built App to a Spec-Driven One Without a Rewrite"

### Reverse-engineering teardown series

1. "We Reverse-Engineered [a well-known open-source SaaS starter] — Here's the Coupling Nobody Documented"
2. "What a 4-Phase Repo Import Finds That `git log` Doesn't"
3. "We Ran Repo Import on a 3-Year-Old Node Monolith. It Found a Contract That Doesn't Exist Anymore."
4. "Reverse-Engineering an Open-Source RAG Pipeline: Where the Vector DB Actually Sits"
5. "The Architecture Diagram vs. the README: A Reverse-Engineering Case Study"
6. "What Reverse-Engineering 10 Repos Taught Us About Where Docs Drift First"

### Spec-driven development / AI architecture thought leadership

1. "Spec-Driven Development Is Not Slower — It's Just Front-Loaded"
2. "AI Slop Has an Architecture Problem, Not Just a Code-Quality Problem"
3. "Configuration Drift Used to Be a DevOps Term. Now It's an AI Coding Agent Problem."
4. "What 'Governance' Actually Means for a Codebase Built Partly by Agents"
5. "System Design for Teams That Ship With AI Coding Agents"
6. "Drift Detection Should Be Infrastructure, Not a Code Review Habit"
7. "AI Design vs. AI Configuration: Two Different Problems People Conflate"

### Tutorials & comparisons (NodeSpec feature set)

1. "Connecting Claude Code to Real Architectural Context With MCP"
2. "Patch-Based Versioning for Architecture: What 'Git for Diagrams' Actually Means"
3. "Specification Traceability: Linking Requirements to the Nodes That Implement Them"
4. "NodeSpec Templates vs. Starting From a Blank Canvas: When Each Makes Sense"
5. "Branching an Architecture: How to Explore Two Designs Without Losing Either"
