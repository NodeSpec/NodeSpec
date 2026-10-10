// The hosted homepage below the hero (owner design 2026-10-07, the "Homepage
// Redesign" canvas): How it works, Use cases, Control, Where to start, Pricing,
// Questions, Open source, the closing call and the footer. The words come from
// landing-content.ts, which the prerender also writes into the served page; the
// layout and its breakpoints live in landing.css.
import { useState, type MouseEvent, type ReactNode } from 'react';
import logo from '../../../assets/lightmode_nodal_450.webp';
import {
  CATALOG, CONTROL, FAQ, FINAL_CTA, FOOTER, HOW, OPEN_SOURCE, PRICING, START_POINTS, USE_CASES,
  type LandingAction, type LandingLink,
} from './landing-content.js';
import { ControlTriangleNarrow, ControlTriangleWide } from './ControlTriangle.js';
import { HowBackdropNarrow, HowBackdropWide, HowConnectors } from './HowDecor.js';
import { DEVELOPER_VISUALS } from './UseCaseVisuals.js';

export type OnAction = (action: LandingAction) => void;
/** Keeps a plain click on an in-app page inside the app (AuthLandingPage.followLink). */
export type FollowLink = (e: MouseEvent, path: string) => void;

interface Wiring {
  onAction: OnAction;
  followLink: FollowLink;
}

/** A call to action as the page draws it: an in-app page or a section of this page is
 *  a link a crawler can follow, another site opens in a new tab, and an action
 *  (sign up, talk to us, the waitlist) is a button. */
export function Cta({ link, className, onAction, followLink, children }: Wiring & { link: LandingLink; className?: string; children?: ReactNode }) {
  const label = children ?? link.label;
  if (link.action) {
    const action = link.action;
    return <button type="button" className={className} onClick={() => onAction(action)}>{label}</button>;
  }
  const href = link.href ?? '#';
  if (/^https?:\/\//.test(href)) {
    return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
  }
  if (href.startsWith('/')) {
    return <a className={className} href={href} onClick={(e) => followLink(e, href)}>{label}</a>;
  }
  return <a className={className} href={href}>{label}</a>;
}

function Eyebrow({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <span className={dark ? 'lp-eyebrow lp-eyebrow-dark' : 'lp-eyebrow'}><span aria-hidden="true" className="lp-eyebrow-dot" />{children}</span>;
}

/* ── How it works ───────────────────────────────────────────────────────── */

const STEP_TINTS = ['rgba(59,130,246,.12)', 'rgba(139,143,230,.16)', 'rgba(16,185,129,.14)', 'rgba(251,191,36,.16)'];

export function HowItWorksSection({ afterFrame }: { afterFrame: boolean }) {
  return (
    <section id={HOW.id} className={afterFrame ? 'lp-how lp-how-after-frame' : 'lp-how'} aria-labelledby="lp-how-title">
      <div className="lp-wide-only"><HowBackdropWide /></div>
      <div className="lp-narrow-only"><HowBackdropNarrow /></div>
      <div className="lp-container lp-how-inner">
        <Eyebrow>{HOW.eyebrow}</Eyebrow>
        <h2 id="lp-how-title" className="lp-h2">{HOW.heading[0]}<span className="lp-accent">{HOW.heading[1]}</span></h2>
        <p className="lp-sub">{HOW.sub}</p>
        <div className="lp-how-steps">
          <div className="lp-how-connectors"><HowConnectors /></div>
          <span aria-hidden="true" className="lp-how-line" />
          <span aria-hidden="true" className="lp-how-packet" />
          <ol className="lp-how-row">
            {HOW.steps.map((step, i) => (
              <li key={step.title} className={i % 2 ? 'lp-how-step lp-how-step-low' : 'lp-how-step'}>
                <span aria-hidden="true" className="lp-how-ring">{i + 1}</span>
                <div className="lp-how-card">
                  <div className="lp-how-strip" style={{ background: STEP_TINTS[i] }}>
                    <span aria-hidden="true" className="lp-how-strip-ring">{i + 1}</span>
                    <span>Step {i + 1}</span>
                  </div>
                  <div className="lp-how-body">
                    <h3>{step.title}</h3>
                    {step.body.map((para) => <p key={para}>{para}</p>)}
                  </div>
                  <span aria-hidden="true" className="lp-port lp-port-in" />
                  <span aria-hidden="true" className="lp-port lp-port-out" />
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** One canvas into the next: a thin edge with a node on it, no change of colour. */
export function SoftEdge() {
  return (
    <div aria-hidden="true" className="lp-soft-edge">
      <svg width="100%" height="100%" viewBox="0 0 1440 110" preserveAspectRatio="none">
        <defs>
          <linearGradient id="lp-soft-edge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8B8FE6" stopOpacity="0" />
            <stop offset=".3" stopColor="#8B8FE6" stopOpacity=".45" />
            <stop offset=".7" stopColor="#a78bfa" stopOpacity=".5" />
            <stop offset="1" stopColor="#8B8FE6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0,62 C240,104 480,84 720,52 C960,20 1200,96 1440,40" fill="none" stroke="url(#lp-soft-edge)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="lp-soft-edge-node" />
    </div>
  );
}

/* ── Use cases ──────────────────────────────────────────────────────────── */

export function UseCasesSection(w: Wiring) {
  const [mode, setMode] = useState<'developer' | 'strategic'>('developer');
  return (
    <section id={USE_CASES.id} className="lp-uc" aria-labelledby="lp-uc-title">
      <div aria-hidden="true" className="lp-uc-glow lp-uc-glow-a" />
      <div aria-hidden="true" className="lp-uc-glow lp-uc-glow-b" />
      <div className="lp-container lp-stack">
        <Eyebrow>{USE_CASES.eyebrow}</Eyebrow>
        <div className="lp-uc-head">
          <div className="lp-stack">
            <h2 id="lp-uc-title" className="lp-h2">{USE_CASES.heading}</h2>
            <p className="lp-sub lp-sub-light">{USE_CASES.sub}</p>
          </div>
          <div role="group" aria-label="Use case view" className="lp-pill">
            {USE_CASES.modes.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} className={mode === m.id ? 'lp-pill-on' : undefined} onClick={() => setMode(m.id)}>{m.label}</button>
            ))}
          </div>
        </div>

        {mode === 'developer' ? (
          <div className="lp-card-grid">
            {USE_CASES.developer.map((c, i) => (
              <article key={c.title} className="lp-card">
                <div className="lp-card-visual">{DEVELOPER_VISUALS[i]}</div>
                <div className="lp-card-text">
                  <span className="lp-card-eyebrow">{c.eyebrow}</span>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                  <span className="lp-grow" />
                  <div className="lp-card-foot">
                    <Cta {...w} link={c.link} className="lp-link" />
                    {'chip' in c && c.chip ? <span className="lp-chip">{c.chip}</span> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="lp-uc-groups">
            {USE_CASES.strategic.map((group) => (
              <div key={group.heading} className="lp-stack">
                <div className="lp-uc-group-head"><h3>{group.heading}</h3><span>{group.sub}</span></div>
                <div className="lp-card-grid">
                  {group.cases.map((c) => (
                    <article key={c.title} className="lp-card">
                      <div className="lp-card-visual lp-card-flow" aria-hidden="true">
                        {c.flow.map((f, i) => typeof f === 'string'
                          ? <span key={i} className="lp-flow-arrow">{f}</span>
                          : <span key={i} className={f.focus ? 'lp-flow-node lp-flow-focus' : 'lp-flow-node'}>{f.name}</span>)}
                      </div>
                      <div className="lp-card-text">
                        <h3>{c.title}</h3>
                        <p>{c.body}</p>
                        <span className="lp-grow" />
                        <div className="lp-card-foot">
                          <Cta {...w} link={c.link} className="lp-link" />
                          {'chip' in c && c.chip ? <span className="lp-chip">{c.chip}</span> : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Control ────────────────────────────────────────────────────────────── */

/** Light to dark: a slanted edge. */
export function SlantEdge() {
  return (
    <div aria-hidden="true" className="lp-slant">
      <svg width="100%" height="100%" viewBox="0 0 1440 90" preserveAspectRatio="none">
        <path d="M0,0 L1440,0 L1440,10 L0,86 Z" fill="#f7f7fc" />
        <path d="M0,86 L1440,10" fill="none" stroke="rgba(139,143,230,.5)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function ControlSection() {
  return (
    <section id={CONTROL.id} className="lp-control" aria-labelledby="lp-control-title">
      <div className="lp-container lp-control-row">
        <div className="lp-control-graphic">
          <div className="lp-wide-tri"><ControlTriangleWide /></div>
          <div className="lp-narrow-tri"><ControlTriangleNarrow /></div>
          <div className="lp-legend">
            <span><i aria-hidden="true" className="lp-legend-code" />{CONTROL.legend.code}</span>
            <span><i aria-hidden="true" className="lp-legend-loose" />{CONTROL.legend.loose}</span>
          </div>
        </div>
        <div className="lp-stack lp-control-text">
          <h2 id="lp-control-title" className="lp-h2">{CONTROL.heading}</h2>
          <p className="lp-sub lp-sub-dark">{CONTROL.sub}</p>
          <div className="lp-control-points">
            {CONTROL.points.map((p) => (
              <div key={p.title} className="lp-control-point"><h3>{p.title}</h3><p>{p.body}</p></div>
            ))}
          </div>
        </div>
      </div>
      <div className="lp-container lp-waits">
        <span className="lp-waits-label">{CONTROL.waitsLabel}</span>
        <ul>{CONTROL.waits.map((w) => <li key={w}>{w}</li>)}</ul>
      </div>
    </section>
  );
}

/** Dark to light: a wave rising the other way. */
export function WaveUp() {
  return (
    <div aria-hidden="true" className="lp-wave">
      <svg width="100%" height="100%" viewBox="0 0 1440 110" preserveAspectRatio="none">
        <path d="M0,0 L1440,0 L1440,70 C1180,20 900,104 600,60 C360,26 160,40 0,84 Z" fill="#0f1117" />
        <path d="M0,84 C160,40 360,26 600,60 C900,104 1180,20 1440,70" fill="none" stroke="rgba(139,143,230,.45)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/* ── Where to start ─────────────────────────────────────────────────────── */

export function StartPointsSection(w: Wiring) {
  return (
    <section id={START_POINTS.id} className="lp-start" aria-labelledby="lp-start-title">
      <div className="lp-container lp-stack lp-center">
        <Eyebrow>{START_POINTS.eyebrow}</Eyebrow>
        <h2 id="lp-start-title" className="lp-h2">{START_POINTS.heading}</h2>
        <div className="lp-start-cards">
          <div aria-hidden="true" className="lp-start-edge" />
          {START_POINTS.cards.map((c) => (
            <div key={c.title} className={c.featured ? 'lp-start-card lp-start-featured' : 'lp-start-card'}>
              <span aria-hidden="true" className="lp-start-port" />
              <h3>{c.title}</h3>
              <ul>{c.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
              <span className="lp-grow" />
              <Cta {...w} link={c.link} className="lp-link" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Pricing ────────────────────────────────────────────────────────────── */

export function LandingPricingSection(w: Wiring) {
  return (
    <section id={PRICING.id} className="lp-pricing" aria-labelledby="lp-pricing-title">
      <div aria-hidden="true" className="lp-pricing-glow" />
      <div className="lp-container lp-stack lp-center">
        <Eyebrow>{PRICING.eyebrow}</Eyebrow>
        <h2 id="lp-pricing-title" className="lp-h2">{PRICING.heading}</h2>
        <div className="lp-price-grid">
          {PRICING.cards.map((card) => (
            <div key={card.id} className={card.featured ? 'lp-price lp-price-featured' : 'lp-price'} data-plan={card.id}>
              <div className="lp-price-head">
                <h3>{card.name}</h3>
                {'badge' in card && card.badge ? <span className={card.featured ? 'lp-badge lp-badge-on' : 'lp-badge'}>{card.badge}</span> : null}
              </div>
              <div className="lp-price-amount">
                <span>{card.amount}</span>
                {'per' in card && card.per ? <span className="lp-price-per">{card.per}</span> : null}
              </div>
              <ul>{card.features.map((f) => <li key={f}>{f}</li>)}</ul>
              <span className="lp-grow" />
              <Cta {...w} link={card.cta} className={card.featured ? 'lp-btn lp-btn-primary lp-btn-block' : card.id === 'enterprise' ? 'lp-btn lp-btn-dark lp-btn-block' : 'lp-btn lp-btn-quiet lp-btn-block'} />
            </div>
          ))}
        </div>
        <Cta {...w} link={PRICING.compare} className="lp-link lp-compare" />
      </div>
    </section>
  );
}

/* ── Questions ──────────────────────────────────────────────────────────── */

export function FaqSection(w: Wiring) {
  return (
    <section id={FAQ.id} className="lp-faq" aria-labelledby="lp-faq-title">
      <div className="lp-container lp-faq-row">
        <div className="lp-faq-side">
          <Eyebrow>{FAQ.eyebrow}</Eyebrow>
          <h2 id="lp-faq-title" className="lp-h2 lp-h2-faq">{FAQ.heading}</h2>
          <div className="lp-faq-talk">
            <span className="lp-faq-talk-title">{FAQ.aside.title}</span>
            <span className="lp-faq-talk-body">{FAQ.aside.body}</span>
            <Cta {...w} link={FAQ.aside.cta} className="lp-btn lp-btn-primary lp-btn-small" />
          </div>
        </div>
        <div className="lp-faq-list">
          {FAQ.items.map((item, i) => (
            <details key={item.q} className="lp-faq-item" open={i === 0}>
              <summary><h3>{item.q}</h3><span aria-hidden="true" className="lp-faq-mark" /></summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Open source and the catalog ────────────────────────────────────────── */

export function OpenSourceSection() {
  return (
    <section className="lp-oss" aria-label="Open source and the technology catalog">
      <div className="lp-container lp-oss-grid">
        <div className="lp-oss-card">
          <div aria-hidden="true" className="lp-oss-ring" />
          <span className="lp-eyebrow-plain lp-eyebrow-dark-plain">{OPEN_SOURCE.eyebrow}</span>
          <h3>{OPEN_SOURCE.heading}</h3>
          <p>{OPEN_SOURCE.body}</p>
          <a className="lp-oss-repo" href={OPEN_SOURCE.repoUrl} target="_blank" rel="noopener noreferrer">{OPEN_SOURCE.repoLabel}</a>
        </div>
        <div className="lp-catalog-card">
          <span className="lp-eyebrow-plain">{CATALOG.eyebrow}</span>
          <h3>{CATALOG.heading}</h3>
          <p>{CATALOG.body}</p>
          <div className="lp-marquee" role="img" aria-label={`Examples: ${CATALOG.examples.join(', ')}`}>
            <div className="lp-marquee-track" aria-hidden="true">
              {[...CATALOG.examples, ...CATALOG.examples].map((name, i) => <span key={i}>{name}</span>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── The closing call ───────────────────────────────────────────────────── */

export function FinalCtaSection(w: Wiring) {
  return (
    <section className="lp-final" aria-label="Get started">
      <div aria-hidden="true" className="lp-final-graph">
        <svg width="1440" height="520" viewBox="0 0 1440 520">
          <path d="M180,120 C420,120 420,380 660,380" fill="none" stroke="rgba(139,143,230,.22)" strokeWidth="2" />
          <path d="M780,380 C1020,380 1020,140 1260,140" fill="none" stroke="rgba(139,143,230,.22)" strokeWidth="2" />
          <path d="M180,120 C420,120 420,380 660,380" fill="none" stroke="rgba(167,139,250,.7)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 116" className="lp-flowing" />
          <path d="M780,380 C1020,380 1020,140 1260,140" fill="none" stroke="rgba(167,139,250,.7)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 116" className="lp-flowing lp-flowing-late" />
        </svg>
        <span className="lp-final-node lp-final-node-a">Requirement</span>
        <span className="lp-final-node lp-final-node-b">Proven</span>
      </div>
      <div className="lp-container lp-final-inner">
        <p className="lp-final-line">{FINAL_CTA.line}</p>
        <div className="lp-cta-row">
          <Cta {...w} link={FINAL_CTA.primary} className="lp-btn lp-btn-primary lp-btn-glow" />
          <Cta {...w} link={FINAL_CTA.secondary} className="lp-btn lp-btn-ghost-dark" />
        </div>
        <p className="lp-final-note">{FINAL_CTA.note}</p>
      </div>
    </section>
  );
}

/* ── Footer ─────────────────────────────────────────────────────────────── */

const SOCIAL = [
  { label: 'NodeSpec on GitHub', href: OPEN_SOURCE.repoUrl, path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' },
  { label: 'NodeSpec on X', href: 'https://x.com/NodeSpec', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' },
  { label: 'NodeSpec on LinkedIn', href: 'https://www.linkedin.com/company/nodespec/', path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
];

export function LandingFooter(w: Wiring) {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <div className="lp-footer-top">
          <div className="lp-footer-brand">
            <span className="lp-footer-mark"><img src={logo} alt="" width={39} height={26} />NodeSpec</span>
            <p>{FOOTER.tagline}</p>
            <a href={`mailto:${FOOTER.email}`}>{FOOTER.email}</a>
            <div className="lp-social">
              {SOCIAL.map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={s.path} /></svg>
                </a>
              ))}
            </div>
          </div>
          {FOOTER.columns.map((col) => (
            <nav key={col.title} className="lp-footer-col" aria-label={col.title}>
              <span className="lp-footer-col-title">{col.title}</span>
              {col.links.map((l) => <Cta key={l.label} {...w} link={l} className="lp-footer-link" />)}
            </nav>
          ))}
        </div>
        <div className="lp-footer-bottom">
          <span>{FOOTER.copyright}</span>
          {FOOTER.legal.map((l) => <Cta key={l.label} {...w} link={l} className="lp-footer-link" />)}
        </div>
      </div>
    </footer>
  );
}
