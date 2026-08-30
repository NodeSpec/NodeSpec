# Brand Voice & Formatting

These rules come from NodeSpec's existing internal content guide — they're
battle-tested, hold to them closely rather than reinterpreting.

## Audience

Senior engineers, software architects, CTOs/VPEs, engineering leads who write
code. Do not explain what React or Postgres is. Assume deep technical knowledge
and zero patience for filler.

## Tone

- Write for builders, not managers. Direct and specific — avoid fluff, filler
  phrases, and hedging.
- Concrete examples over abstractions: "use Supabase RLS for row-level access
  control," not "implement proper security measures."
- Technical accuracy is non-negotiable. Never invent API names, flag names, or
  syntax — and never state a NodeSpec feature or price that isn't in
  `product-facts.md`.
- Reference real trade-offs. Great architecture content acknowledges what you
  give up, not just what you gain.
- Attribute design decisions to concrete reasons, not authority: "use Postgres
  here because you need ACID transactions across the checkout flow" is strong;
  "Postgres is battle-tested" is weak and says nothing.
- No hyperbole. Nothing is "revolutionary," "game-changing," or "magical." No
  purple prose, no marketing clichés.
- NodeSpec mentions must feel organic and earn their place. The post must stand
  alone as genuinely useful to a reader who never signs up — if you delete every
  NodeSpec mention and the post falls apart, it wasn't a real post.

## Worked example

Same fact, three ways — only the last one is publishable:

- **Too vague:** "NodeSpec provides robust drift detection to seamlessly keep
  your architecture in sync." *(banned words, says nothing concrete)*
- **Accurate but flat:** "NodeSpec has a feature that detects drift between
  your code and your architecture diagram." *(true, but a reader learns
  nothing they couldn't guess from the feature name)*
- **Publishable:** "When someone commits straight to git instead of going
  through NodeSpec, the drift sweep catches it and routes it back through the
  same approval queue as an in-app edit — so the diagram can't quietly go
  stale just because someone was in a hurry." *(specific mechanism, specific
  consequence, no banned words, reads like it was written by someone who
  understands the system)*

Aim for the third register throughout — specific enough that a skeptical
senior engineer would nod instead of skim past it.

## Phrases to avoid

Scan your own draft for these before calling it done — they're either vague,
overused, or filler that adds nothing:

- "seamlessly"
- "robust"
- "cutting-edge" / "state-of-the-art" / "next-generation"
- "leverage" (as a verb — use "use")
- "utilize" (use "use")
- "innovative solution"
- "in today's fast-paced world" (or any "in today's ... world" opener)
- "game-changer" / "revolutionary"
- "it's worth noting that"
- "as mentioned earlier"
- "In this article, we will..."
- Never close with "Happy coding!" or an equivalent sign-off.

## Formatting

Write in HTML for direct insertion into the NodeSpec Blog CMS (TinyMCE /
Supabase `blog_posts`), not Markdown:

- `<h2>` for major sections, `<h3>` for sub-sections. **No `<h1>`** — the title
  is stored separately in the database.
- `<p>` for paragraphs.
- `<pre><code class="language-[lang]">` for code blocks. Code examples must be
  real and runnable, not pseudocode or placeholders.
- `<ul>` / `<ol>` for lists.
- `<strong>` for key terms on first introduction.
- No inline styles.
- Lead with a one-sentence meta description as an HTML comment:
  `<!-- meta: Your meta description here -->`

## CMS fields (when asked to "ship" a post)

Output these alongside the HTML body:

- `title` — no H1 in the body, this carries it.
- `slug` — URL-safe, lowercase, hyphenated (e.g.
  `migrating-off-lovable-to-a-versioned-architecture`).
- `excerpt` — 1-2 sentences, max 200 characters, for list pages.
- `status` — `draft` unless the user says otherwise.
- `author_name` — "NodeSpec Team" unless told otherwise.
- `tags` — 5-10 lowercase strings.
- `reading_time_minutes` — word count / 200, rounded up.
- `meta_description` — max 155 characters, for search results.
- `category` — one of: Engineering, Architecture, AI & ML, Product Updates,
  Tutorials.
