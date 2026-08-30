# YouTube Companion Outlines

This produces a script *outline*, not a finished script or video — the goal is
to hand the reader-turned-viewer a structure that a human can record from, not
to fully automate production. Write this after the blog post is finalized, not
before — the video maps onto the post's actual `<h2>` structure, so it needs the
finished draft, not the plan.

## When a companion is warranted

Not every post needs one. Good candidates:

- Reverse-engineering teardowns — visual by nature, the canvas demo is the
  payoff.
- Tutorials with a clear step-by-step flow that benefits from screen capture.
- Migration guides where seeing the before/after architecture lands harder than
  reading it.

Weaker candidates: pure opinion/thought-leadership posts with no visual
artifact to show — these can still get one if the user wants a talking-head
companion, but don't default to producing an outline for every post.

## Outline structure

```
TITLE: [optimized for YouTube search/click, can differ from the blog title]
HOOK (first 15 seconds): [the specific claim or visual that stops the scroll —
  should restate the post's angle/thesis in one punchy line, not a generic
  "in this video" intro]

CHAPTERS (map 1:1 to the post's H2s unless a merge/split makes sense on screen):
  00:00 — [Hook]
  0:XX — [Chapter title matching first H2] — [what's said + what's shown]
  0:XX — [Chapter title matching next H2] — [what's said + what's shown]
  ...
  [final chapter] — CTA — [matches the post's CTA, spoken, not just on-screen]

ON-SCREEN DEMO BEATS: [call out specifically where a live NodeSpec canvas demo
  belongs — e.g. "here, switch to screen capture and run repo import live on
  the repo being discussed" — don't manufacture a demo beat if the section is
  purely conceptual]

DESCRIPTION TEMPLATE:
  [1-2 sentence summary, same angle as the post's meta description]

  Full write-up: [link back to the blog post]

  Chapters:
  0:00 [chapter]
  0:XX [chapter]
  ...

  [CTA line matching the post's CTA]
```

## Rules

- The hook must earn attention on its own — it should work even for someone who
  hasn't read the post.
- Keep the same banned-phrase discipline as the written post (see
  `brand-voice.md`) — spoken filler like "let's dive in" or "without further
  ado" is the video equivalent of "seamlessly."
- The CTA in the description must match the post's CTA and funnel stage from
  the plan — don't introduce a different ask for the video.
