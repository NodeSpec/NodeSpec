// The homepage's words as plain HTML, for a crawler that runs no script (owner
// 2026-10-07: "ensure maximum SEO"). Many AI and search crawlers read the served
// HTML and never run the app, and the app's root is empty until it does. The build
// writes this into the homepage only (scripts/prerender.ts), inside <noscript>, so
// a visitor whose browser runs the app sees the app and never this twice. It is
// built from landing-content.ts, the same words the page renders.
import {
  CATALOG, CONTROL, FAQ, FINAL_CTA, FOOTER, HERO, HOW, NAV_LINKS, OPEN_SOURCE, PRICING, START_POINTS, USE_CASES,
  type LandingLink,
} from '../ui/components/auth/landing/landing-content.js';
import { escapeAttr, escapeHtml } from './page-head.ts';

const t = escapeHtml;

/** A link a crawler can follow; an action the app performs becomes the contact address
 *  when it is "talk to us", and is left out otherwise (it needs the app). */
function link(l: LandingLink): string {
  if (l.href) {
    const external = /^https?:\/\//.test(l.href) ? ' rel="noopener"' : '';
    return `<a href="${escapeAttr(l.href)}"${external}>${t(l.label)}</a>`;
  }
  if (l.action === 'talk') return `<a href="mailto:${escapeAttr(FOOTER.email)}">${t(l.label)}</a>`;
  return '';
}

function paragraphs(texts: readonly string[]): string {
  return texts.map((p) => `<p>${t(p)}</p>`).join('');
}

export function landingSnapshotHtml(): string {
  const parts: string[] = [];
  parts.push(`<header><nav aria-label="Main"><a href="/">NodeSpec</a> ${NAV_LINKS.map(link).join(' ')}</nav></header>`);
  parts.push('<main>');

  parts.push(
    `<section><h1>${t(HERO.title)}</h1>`
    + `<p>${t(HERO.slogan.map(([a, b]) => a + b).join(''))}</p>`
    + `<p>${t(HERO.description)}</p>`
    + `<p>${link(HERO.secondary)}</p></section>`,
  );

  parts.push(
    `<section id="${HOW.id}"><h2>${t(HOW.heading.join(''))}</h2><p>${t(HOW.sub)}</p><ol>`
    + HOW.steps.map((s) => `<li><h3>${t(s.title)}</h3>${paragraphs(s.body)}</li>`).join('')
    + '</ol></section>',
  );

  parts.push(
    `<section id="${USE_CASES.id}"><h2>${t(USE_CASES.heading)}</h2><p>${t(USE_CASES.sub)}</p>`
    + `<h3>${t(USE_CASES.modes[0].label)}</h3>`
    + USE_CASES.developer.map((c) => `<article><h4>${t(c.title)}</h4><p>${t(c.eyebrow)}. ${t(c.body)}</p></article>`).join('')
    + `<h3>${t(USE_CASES.modes[1].label)}</h3>`
    + USE_CASES.strategic.map((g) => `<h4>${t(g.heading)}</h4><p>${t(g.sub)}</p>`
      + g.cases.map((c) => `<article><h5>${t(c.title)}</h5><p>${t(c.body)}</p>${c.link.href ? `<p>${link(c.link)}</p>` : ''}</article>`).join('')).join('')
    + '</section>',
  );

  parts.push(
    `<section id="${CONTROL.id}"><h2>${t(CONTROL.heading)}</h2><p>${t(CONTROL.sub)}</p>`
    + `<p>${t(CONTROL.legend.code)}. ${t(CONTROL.legend.loose)}.</p><ul>`
    + CONTROL.points.map((p) => `<li><h3>${t(p.title)}</h3><p>${t(p.body)}</p></li>`).join('')
    + `</ul><p>${t(CONTROL.waitsLabel)} ${t(CONTROL.waits.join(', '))}.</p></section>`,
  );

  parts.push(
    `<section id="${START_POINTS.id}"><h2>${t(START_POINTS.heading)}</h2>`
    + START_POINTS.cards.map((c) => `<article><h3>${t(c.title)}</h3><ul>${c.bullets.map((b) => `<li>${t(b)}</li>`).join('')}</ul>${link(c.link) ? `<p>${link(c.link)}</p>` : ''}</article>`).join('')
    + '</section>',
  );

  parts.push(
    `<section id="${PRICING.id}"><h2>${t(PRICING.heading)}</h2>`
    + PRICING.cards.map((c) => `<article><h3>${t(c.name)}</h3><p>${t(c.amount)}${'per' in c && c.per ? ` ${t(c.per)}` : ''}</p><ul>${c.features.map((f) => `<li>${t(f)}</li>`).join('')}</ul></article>`).join('')
    + `<p>${link(PRICING.compare)}</p></section>`,
  );

  parts.push(
    `<section id="${FAQ.id}"><h2>${t(FAQ.heading)}</h2>`
    + FAQ.items.map((i) => `<h3>${t(i.q)}</h3><p>${t(i.a)}</p>`).join('')
    + '</section>',
  );

  parts.push(
    `<section><h3>${t(OPEN_SOURCE.heading)}</h3><p>${t(OPEN_SOURCE.body)}</p><p>${link({ label: OPEN_SOURCE.repoLabel, href: OPEN_SOURCE.repoUrl })}</p>`
    + `<h3>${t(CATALOG.heading)}</h3><p>${t(CATALOG.body)} ${t(CATALOG.examples.join(', '))}.</p></section>`,
  );

  parts.push(`<section><p>${t(FINAL_CTA.line)}</p><p>${link(FINAL_CTA.secondary)}</p></section>`);
  parts.push('</main>');

  parts.push(
    `<footer><p>${t(FOOTER.tagline)}</p><p><a href="mailto:${escapeAttr(FOOTER.email)}">${t(FOOTER.email)}</a></p>`
    + FOOTER.columns.map((c) => `<nav aria-label="${escapeAttr(c.title)}">${c.links.map(link).filter(Boolean).join(' ')}</nav>`).join('')
    + `<p>${FOOTER.legal.map(link).join(' ')} ${t(FOOTER.copyright)}</p></footer>`,
  );
  return parts.join('\n');
}
