import { useCallback, useEffect, useRef } from 'react';
import imgLogoMark from '../../assets/lightmode_nodal.png';
import imgAws from '../../assets/AWS.png';
import imgElastic from '../../assets/elastic_search.png';
import imgK8s from '../../assets/kubernetes.png';
import imgS3 from '../../assets/Simple-Storage-Service.png';
import imgGo from '../../assets/go.png';
import imgKafka from '../../assets/Apache_Kafka.png';
import imgNextjs from '../../assets/nextjs_icon.png';
import imgNodejs from '../../assets/nodejs.svg';
import imgOpenai from '../../assets/chatgpt-icon.png';
import imgPostgres from '../../assets/PostgresSQL.png';
import imgReact from '../../assets/react.png';

/*
  Government-page product tour (owner direction 2026-08-12): the SAME animated
  clickthrough as the landing page, re-themed as a fire-control data
  integration — VMF (MIL-STD-6017) call-for-fire ingest, Link 16 correlation,
  provenance logging, and an ACAS scan export flowing out of the restricted
  subnet to a compliance vault. Layout, stage machine, and geometry are the
  landing tour's; only content differs, and no commercial-model names appear
  in the AI connection surfaces. Derived from ProductTourSection.tsx — keep
  structural fixes in sync between the two.
*/

const STAGES: Array<{ view: string; overlay: string | null; label: string }> = [
  { view: 'spec', overlay: null, label: 'Spec · requirements and acceptance criteria' },
  { view: 'decomposition', overlay: null, label: 'Decomposition · every requirement traced to a node' },
  { view: 'architecture', overlay: null, label: 'Architecture · the live system canvas' },
  { view: 'architecture', overlay: 'inspector', label: 'Scoped context · one node, one slice' },
  { view: 'architecture', overlay: 'mcp', label: 'MCP first · your AI, your IDE' },
  { view: 'architecture', overlay: 'git', label: 'Git native · architecture in your repo' },
  { view: 'decomposition', overlay: 'tests', label: 'Tests · verified results flow back upstream' },
];

const FRAME_NATURAL_WIDTH = 1176;   // 1240 max-width minus 2 × 32px padding
const FRAME_NATURAL_HEIGHT = 510;   // 56px chrome + 452px workspace + border

const TOUR_CSS = `
@keyframes ns-flow { from { stroke-dashoffset: 120; } to { stroke-dashoffset: 0; } }
@keyframes ns-flow-up { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 120; } }
@keyframes ns-drift { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -40px; } }
.ns-fcard:hover { transform: translateY(-4px); }
@media (max-width: 900px) {
  .ns-tour-cards { grid-template-columns: 1fr 1fr !important; }
  .ns-tour-h2 { font-size: 30px !important; }
}
@media (max-width: 640px) {
  .ns-tour-cards { grid-template-columns: 1fr !important; }
}
`;


export function GovFiresTourSection() {
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef(0);
  const userPickedRef = useRef(false);
  const frameVisibleRef = useRef(false);
  const reducedRef = useRef(false);

  const setView = useCallback((id: string, overlay: string | null, label: string) => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-viewpanel]').forEach(p => {
      const on = p.getAttribute('data-viewpanel') === id;
      p.style.opacity = on ? '1' : '0';
      p.style.pointerEvents = on ? 'auto' : 'none';
      const zoom = on && overlay === 'inspector';
      p.style.transformOrigin = '30% 26%';
      p.style.transform = on ? (zoom ? 'scale(1.28) translateX(-198px)' : 'scale(1)') : 'scale(.985)';
    });
    root.querySelectorAll<HTMLElement>('[data-overlay]').forEach(o => {
      const on = o.getAttribute('data-overlay') === overlay;
      o.style.opacity = on ? '1' : '0';
      o.style.pointerEvents = 'none';
      if (o.getAttribute('data-overlay') === 'inspector') o.style.transform = on ? 'none' : 'translateX(20px)';
      if (o.getAttribute('data-overlay') === 'git') o.style.transform = on ? 'none' : 'translateY(-10px)';
      const card = o.querySelector<HTMLElement>('[data-overlay-card]');
      if (card) card.style.transform = on ? 'scale(1)' : 'scale(.96)';
    });
    const git = root.querySelector<HTMLElement>('[data-el="git"]');
    if (git) {
      const on = overlay === 'git';
      git.style.color = on ? '#b45309' : '#6b7280';
      git.style.backgroundColor = on ? '#fffbeb' : '#fafbfc';
      git.style.borderColor = on ? '#f59e0b' : '#e5e7eb';
    }
    const cap = root.querySelector<HTMLElement>('[data-stage-label]');
    if (cap && label) cap.textContent = label;
    const met = overlay === 'tests';
    root.querySelectorAll<HTMLElement>('[data-test-chip]').forEach(chip => {
      const open = chip.hasAttribute('data-test-open');
      const pass = met || !open;
      const mark = chip.querySelector<HTMLElement>('[data-test-mark]');
      chip.style.borderColor = met ? '#22c55e' : '#e5e7eb';
      chip.style.backgroundColor = met ? 'rgba(34,197,94,.06)' : '#fff';
      if (mark) {
        mark.style.color = pass ? '#22c55e' : '#d97706';
        mark.textContent = pass ? '\u2713' : '\u2022';
      }
    });
    const key = overlay || id;
    root.querySelectorAll<HTMLElement>('[data-card]').forEach(c => {
      const on = (c.getAttribute('data-card') || '').split(' ').indexOf(key) > -1;
      c.style.borderColor = on ? 'rgba(139,143,230,.55)' : 'rgba(139,143,230,.12)';
      c.style.backgroundColor = on ? 'rgba(139,143,230,.09)' : 'rgba(26,29,38,.7)';
      c.style.boxShadow = on ? '0 16px 40px rgba(0,0,0,.34)' : 'none';
      const dot = c.querySelector<HTMLElement>('[data-card-dot]');
      if (dot) {
        dot.style.backgroundColor = on ? '#8B8FE6' : 'rgba(139,143,230,.35)';
        dot.style.boxShadow = on ? '0 0 0 4px rgba(139,143,230,.16)' : 'none';
      }
    });
    root.querySelectorAll<HTMLElement>('[data-view]').forEach(b => {
      const on = b.getAttribute('data-view') === id;
      b.style.cursor = 'pointer';
      b.style.color = on ? '#ffffff' : '#1f2937';
      b.style.backgroundColor = on ? '#8B8FE6' : 'transparent';
      b.style.boxShadow = on ? '0 2px 8px rgba(0,0,0,.15)' : 'none';
    });
    const sbActive = id === 'spec' ? 'spec' : 'nodes';
    root.querySelectorAll<HTMLElement>('[data-sbtab]').forEach(t => {
      const on = t.getAttribute('data-sbtab') === sbActive;
      t.style.color = on ? '#111827' : '#6b7280';
      t.style.fontWeight = on ? '600' : '500';
      t.style.backgroundColor = on ? '#ffffff' : 'transparent';
      t.style.borderBottom = on ? '2px solid #8B8FE6' : '2px solid transparent';
    });
  }, []);

  const applyStage = useCallback(() => {
    const s = STAGES[stageRef.current] ?? STAGES[0];
    setView(s.view, s.overlay, s.label);
  }, [setView]);

  // Restore imperative stage styling after ANY re-render of the parent tree.
  useEffect(() => { applyStage(); });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── manual view picks ─────────────────────────────────────────────────
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('[data-view]');
      if (!btn || !root.contains(btn)) return;
      userPickedRef.current = true;
      const v = btn.getAttribute('data-view');
      const i = STAGES.findIndex(s => s.view === v && !s.overlay);
      stageRef.current = i < 0 ? 0 : i;
      applyStage();
    };
    root.addEventListener('click', onClick);

    // ── auto-rotation, paused while the frame is off-screen ───────────────
    const frame = root.querySelector('[data-hero-shot]');
    let frameIo: IntersectionObserver | null = null;
    if (frame) {
      frameIo = new IntersectionObserver(entries => {
        entries.forEach(en => { frameVisibleRef.current = en.isIntersecting; });
      }, { threshold: 0.35 });
      frameIo.observe(frame);
    }
    let rotate: ReturnType<typeof setInterval> | null = null;
    if (!reducedRef.current) {
      rotate = setInterval(() => {
        if (userPickedRef.current || !frameVisibleRef.current) return;
        stageRef.current = (stageRef.current + 1) % STAGES.length;
        applyStage();
      }, 5000);
    }

    // ── scroll reveals ────────────────────────────────────────────────────
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!reducedRef.current) {
      els.forEach(el => {
        const d = parseInt(el.getAttribute('data-reveal-delay') || '0', 10);
        el.style.opacity = '0';
        el.style.transform = 'translate3d(0,26px,0)';
        el.style.transition = `opacity 820ms cubic-bezier(.16,1,.3,1) ${d}ms, transform 820ms cubic-bezier(.16,1,.3,1) ${d}ms`;
      });
    }
    const show = (el: HTMLElement) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    };
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        show(en.target as HTMLElement);
        io.unobserve(en.target);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => io.observe(el));
    const fallback = setTimeout(() => els.forEach(show), 3200);

    // ── responsive frame: scale the fixed-geometry mock to the viewport ───
    const inner = root.querySelector<HTMLElement>('[data-hero-shot-inner]');
    const shot = inner?.parentElement ?? null;
    const applyScale = () => {
      if (!inner || !shot) return;
      const available = shot.clientWidth
        - parseFloat(getComputedStyle(shot).paddingLeft || '0')
        - parseFloat(getComputedStyle(shot).paddingRight || '0');
      if (available >= FRAME_NATURAL_WIDTH || available <= 0) {
        inner.style.width = '';
        inner.style.transform = '';
        inner.style.transformOrigin = '';
        inner.style.marginBottom = '';
        return;
      }
      const s = available / FRAME_NATURAL_WIDTH;
      inner.style.width = `${FRAME_NATURAL_WIDTH}px`;
      inner.style.transformOrigin = 'top left';
      inner.style.transform = `scale(${s})`;
      inner.style.marginBottom = `${-FRAME_NATURAL_HEIGHT * (1 - s)}px`;
    };
    applyScale();
    const ro = new ResizeObserver(applyScale);
    if (shot) ro.observe(shot);

    return () => {
      root.removeEventListener('click', onClick);
      if (frameIo) frameIo.disconnect();
      if (rotate) clearInterval(rotate);
      io.disconnect();
      clearTimeout(fallback);
      ro.disconnect();
    };
  }, [applyStage]);

  return (
    <>
      <style>{TOUR_CSS}</style>
      <section id="gov-tour" ref={rootRef} style={{ width: "100%", background: "#0f1117", borderTop: "1px solid rgba(139,143,230,.06)", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "relative", zIndex: "1", maxWidth: "1080px", margin: "0 auto", padding: "88px 40px 0", textAlign: "center" }}>
            <h2 className="ns-tour-h2" data-reveal="" style={{ margin: "0 0 14px", fontSize: "40px", fontWeight: "800", color: "#E6E9EF", letterSpacing: "-.04em", lineHeight: "1.14" }}>Design Governance for Mission Systems</h2>
            <p data-reveal="" data-reveal-delay="90" style={{ margin: "0 auto", fontSize: "17px", color: "#8a8f9e", maxWidth: "580px", lineHeight: "1.65" }}>From written spec to decomposed plan to live architecture. One model your integrators and your approved AI share.</p>
          </div>

          <div data-hero-shot="" data-reveal="" style={{ position: "relative", zIndex: "2", maxWidth: "1240px", margin: "44px auto 0", boxSizing: "border-box", padding: "0 32px" }}>
            <div style={{ position: "absolute", left: "12%", right: "12%", top: "12%", bottom: "12%", background: "radial-gradient(ellipse at center, rgba(139,143,230,.16) 0%, transparent 70%)", filter: "blur(56px)", pointerEvents: "none" }}></div>
            <div data-hero-shot-inner="" style={{ position: "relative", borderRadius: "14px", overflow: "hidden", background: "#ffffff", border: "1px solid rgba(139,143,230,.28)", boxShadow: "0 34px 80px rgba(0,0,0,.5), 0 0 60px rgba(139,143,230,.12)" }}>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "56px", padding: "0 16px", borderBottom: "1px solid #e5e7eb", background: "#ffffff", boxSizing: "border-box" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <img src={imgLogoMark} alt="NodeSpec" style={{ display: "block", width: "30px", height: "30px", objectFit: "contain", flexShrink: "0" }} />
                  <span style={{ fontSize: "14.5px", fontWeight: "700", color: "#1f2937", letterSpacing: "-.01em" }}>fires-integration</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "16px", background: "#fafbfc", fontSize: "12px", color: "#6b7280" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="5" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="9" r="2"></circle><path d="M6 7v10"></path><path d="M18 11c0 3-4 3-6 5"></path></svg>
                    main
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ position: "relative", width: "36px", height: "36px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fafbfc", color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h13l-3-3"></path><path d="M20 16H7l3 3"></path></svg>
                    <span style={{ position: "absolute", top: "-5px", right: "-5px", width: "16px", height: "16px", borderRadius: "50%", background: "#2563eb", color: "#fff", fontSize: "9.5px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center" }}>2</span>
                  </span>
                  <span data-el="git" style={{ width: "36px", height: "36px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fafbfc", color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", transition: "color .3s ease, border-color .3s ease, background-color .3s ease" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="5" r="2"></circle><circle cx="6" cy="19" r="2"></circle><circle cx="18" cy="9" r="2"></circle><path d="M6 7v10"></path><path d="M18 11c0 3-4 3-6 5"></path></svg>
                  </span>
                  <span style={{ width: "36px", height: "36px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fafbfc", color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 3v2"></path><path d="M12 19v2"></path><path d="M3 12h2"></path><path d="M19 12h2"></path></svg>
                  </span>
                  <span style={{ width: "32px", height: "32px", borderRadius: "50%", background: "linear-gradient(135deg, #8B8FE6, #a78bfa)" }}></span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", height: "452px" }}>
                <div style={{ borderRight: "1px solid #e5e7eb", background: "#ffffff", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid #e5e7eb", background: "#fafafa" }}>
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", color: "#9ca3af", fontSize: "11px" }}>◀</span>
                    <span data-sbtab="files" style={{ flex: "1", display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", fontSize: "13px", fontWeight: "500", color: "#6b7280", padding: "13px 8px", borderBottom: "2px solid transparent", transition: "color .3s ease, border-color .3s ease, background-color .3s ease" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h6l2 2h10v12H3z"></path></svg>Files
                    </span>
                    <span data-sbtab="nodes" style={{ flex: "1", display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", fontSize: "13px", fontWeight: "500", color: "#6b7280", padding: "13px 8px", borderBottom: "2px solid transparent", transition: "color .3s ease, border-color .3s ease, background-color .3s ease" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="6" height="6" rx="1"></rect><rect x="15" y="15" width="6" height="6" rx="1"></rect><path d="M9 6h6a3 3 0 0 1 3 3v6"></path></svg>Nodes
                    </span>
                    <span data-sbtab="spec" style={{ flex: "1", display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", fontSize: "13px", fontWeight: "600", color: "#111827", background: "#fff", padding: "13px 8px", borderBottom: "2px solid #8B8FE6", transition: "color .3s ease, border-color .3s ease, background-color .3s ease" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h9l4 4v14H6z"></path><path d="M9 12h7"></path><path d="M9 16h5"></path></svg>Spec
                    </span>
                  </div>
                  <div style={{ padding: "12px 12px 8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 11px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fafbfc", fontSize: "12px", color: "#9ca3af" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M16 16l4 4"></path></svg>Search 300+ technologies</div>
                  </div>
                  <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", letterSpacing: ".1em", color: "#9ca3af", padding: "6px 2px 2px" }}>FRONTEND</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "7px 9px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff" }}><img src={imgReact} alt="React" style={{ width: "17px", height: "17px", objectFit: "contain" }} /><span style={{ fontSize: "11.5px", color: "#374151", fontWeight: "600" }}>React</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "7px 9px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff" }}><img src={imgNextjs} alt="Next.js" style={{ width: "17px", height: "17px", objectFit: "contain" }} /><span style={{ fontSize: "11.5px", color: "#374151", fontWeight: "600" }}>Next.js</span></div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", letterSpacing: ".1em", color: "#9ca3af", padding: "8px 2px 2px" }}>SERVICE</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "7px 9px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff" }}><img src={imgNodejs} alt="Node.js" style={{ width: "17px", height: "17px", objectFit: "contain" }} /><span style={{ fontSize: "11.5px", color: "#374151", fontWeight: "600" }}>Node.js</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "7px 9px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff" }}><img src={imgGo} alt="Go" style={{ width: "17px", height: "17px", objectFit: "contain" }} /><span style={{ fontSize: "11.5px", color: "#374151", fontWeight: "600" }}>Go</span></div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", letterSpacing: ".1em", color: "#9ca3af", padding: "8px 2px 2px" }}>DATASTORE</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "7px 9px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff" }}><img src={imgPostgres} alt="PostgreSQL" style={{ width: "17px", height: "17px", objectFit: "contain" }} /><span style={{ fontSize: "11.5px", color: "#374151", fontWeight: "600" }}>PostgreSQL</span></div>
                    <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "7px 9px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "#fff" }}><img src={imgElastic} alt="Elasticsearch" style={{ width: "17px", height: "17px", objectFit: "contain" }} /><span style={{ fontSize: "11.5px", color: "#374151", fontWeight: "600" }}>Elasticsearch</span></div>
                  </div>
                </div>

                <div style={{ position: "relative", overflow: "hidden", background: "#fafbfc" }}>

                  <div style={{ position: "absolute", top: "12px", right: "12px", zIndex: "6", display: "flex", gap: "3px", padding: "5px", borderRadius: "11px", background: "#ffffff", boxShadow: "0 4px 16px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.08)" }}>
                    <span data-view="spec" style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11.5px", fontWeight: "600", color: "#1f2937", padding: "6px 9px", borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap", transition: "background-color .3s ease, color .3s ease" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h9l4 4v14H6z"></path><path d="M9 12h7"></path><path d="M9 16h5"></path></svg>Specification
                    </span>
                    <span data-view="decomposition" style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11.5px", fontWeight: "600", color: "#1f2937", padding: "6px 9px", borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap", transition: "background-color .3s ease, color .3s ease" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="5" height="16" rx="1"></rect><rect x="10" y="4" width="5" height="16" rx="1"></rect><rect x="17" y="4" width="4" height="16" rx="1"></rect></svg>Decomposition
                    </span>
                    <span data-view="architecture" style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11.5px", fontWeight: "600", color: "#1f2937", padding: "6px 9px", borderRadius: "8px", cursor: "pointer", whiteSpace: "nowrap", transition: "background-color .3s ease, color .3s ease" }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="6" height="6" rx="1"></rect><rect x="15" y="3" width="6" height="6" rx="1"></rect><rect x="9" y="15" width="6" height="6" rx="1"></rect><path d="M6 9v3c0 1 1 2 2 2h2"></path><path d="M18 9v3c0 1-1 2-2 2h-2"></path></svg>Architecture
                    </span>
                  </div>

                  <div data-viewpanel="spec" style={{ position: "absolute", inset: "0", opacity: "1", transform: "scale(1)", transition: "opacity .5s ease, transform .5s cubic-bezier(.16,1,.3,1)", background: "#fff", overflow: "hidden" }}>
                    <div style={{ maxWidth: "600px", margin: "0 auto", padding: "42px 34px 12px", textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", color: "#9ca3af", marginBottom: "12px" }}>
                        <span>specification.md</span><span>·</span><span style={{ color: "#22c55e" }}>synced to main</span>
                      </div>
                      <div style={{ fontSize: "21px", fontWeight: "800", color: "#111827", letterSpacing: "-.03em", marginBottom: "4px" }}>Fire Control Data Integration</div>
                      <p style={{ margin: "0 0 11px", fontSize: "12.5px", color: "#6b7280", lineHeight: "1.5" }}>An integration layer for digital fires: call-for-fire ingest over tactical data links, mission correlation, and compliance telemetry for the enclave. Requirements below decompose into the architecture on the canvas.</p>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", letterSpacing: ".1em", color: "#9ca3af", marginBottom: "8px" }}>REQUIREMENTS</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                        <div style={{ padding: "10px 13px", borderRadius: "9px", border: "1px solid #eef0f4", background: "#fafbfc", display: "flex", gap: "10px", alignItems: "baseline" }}>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: "700", color: "#6366f1", flexShrink: "0" }}>R-01</span>
                          <span style={{ fontSize: "12.5px", color: "#374151" }}>Call-for-fire messages are ingested over VMF (MIL-STD-6017).</span>
                          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#22c55e", flexShrink: "0" }}>4/4 met</span>
                        </div>
                        <div style={{ padding: "12px 13px", borderRadius: "9px", border: "1.5px solid rgba(99,102,241,.4)", background: "rgba(99,102,241,.03)" }}>
                          <div style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: "700", color: "#6366f1", flexShrink: "0" }}>R-02</span>
                            <span style={{ fontSize: "12.5px", color: "#111827", fontWeight: "600" }}>Fire missions are correlated across VMF and Link 16 tracks.</span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "3px", marginTop: "6px", paddingLeft: "38px" }}>
                            <div style={{ display: "flex", gap: "8px", fontSize: "11.5px", color: "#4b5563" }}><span style={{ color: "#22c55e" }}>✓</span>AC-1 K02.4 parses to a canonical mission record</div>
                            <div style={{ display: "flex", gap: "8px", fontSize: "11.5px", color: "#4b5563" }}><span style={{ color: "#22c55e" }}>✓</span>AC-2 duplicate missions deduplicate on retransmit</div>
                            <div style={{ display: "flex", gap: "8px", fontSize: "11.5px", color: "#4b5563" }}><span style={{ color: "#d97706" }}>•</span>AC-3 J3.2 correlation window respected</div>
                          </div>
                        </div>
                        <div style={{ padding: "10px 13px", borderRadius: "9px", border: "1px solid #eef0f4", background: "#fafbfc", display: "flex", gap: "10px", alignItems: "baseline" }}>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: "700", color: "#6366f1", flexShrink: "0" }}>R-03</span>
                          <span style={{ fontSize: "12.5px", color: "#374151" }}>Every message transit is logged with provenance.</span>
                          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#22c55e", flexShrink: "0" }}>3/3 met</span>
                        </div>
                        <div style={{ padding: "10px 13px", borderRadius: "9px", border: "1px solid #eef0f4", background: "#fafbfc", display: "flex", gap: "10px", alignItems: "baseline" }}>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", fontWeight: "700", color: "#6366f1", flexShrink: "0" }}>R-04</span>
                          <span style={{ fontSize: "12.5px", color: "#374151" }}>ACAS scan results are exported to the compliance vault.</span>
                          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#9ca3af", flexShrink: "0" }}>draft</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div data-viewpanel="decomposition" style={{ position: "absolute", inset: "0", opacity: "0", transform: "scale(.985)", pointerEvents: "none", transition: "opacity .5s ease, transform .5s cubic-bezier(.16,1,.3,1)", backgroundColor: "#fafbfc", backgroundImage: "radial-gradient(#dfe2ea 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 30px minmax(0, 1fr) 30px minmax(0, 1fr) 30px minmax(0, 1fr)", alignItems: "stretch", padding: "56px 16px 62px", height: "100%", boxSizing: "border-box" }}>

                    <div style={{ border: "1.5px solid rgba(99,102,241,.28)", background: "rgba(99,102,241,.03)", borderRadius: "10px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#4f46e5" }}>Requirements</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#9ca3af" }}>5</span>
                      </div>
                      <div style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6366f1" }}>R-01</div>
                        <div style={{ fontSize: "11px", color: "#374151", fontWeight: "600", marginTop: "2px" }}>VMF ingest</div>
                      </div>
                      <div data-live-chip="" style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1.5px solid #6366f1", boxShadow: "0 0 0 3px rgba(99,102,241,.10)" }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6366f1" }}>R-02</div>
                        <div style={{ fontSize: "11px", color: "#111827", fontWeight: "700", marginTop: "2px" }}>Mission correlation</div>
                      </div>
                      <div style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6366f1" }}>R-03</div>
                        <div style={{ fontSize: "11px", color: "#374151", fontWeight: "600", marginTop: "2px" }}>Message provenance</div>
                      </div>
                      <div style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6366f1" }}>R-04</div>
                        <div style={{ fontSize: "11px", color: "#374151", fontWeight: "600", marginTop: "2px" }}>ACAS export</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 30 200" preserveAspectRatio="none" style={{ width: "30px", height: "100%" }}>
                        <path d="M0 60 C 15 60, 15 78, 30 78" fill="none" stroke="#c7cbd8" strokeWidth="1.4"></path>
                        <path d="M0 100 C 15 100, 15 78, 30 78" fill="none" stroke="#c7cbd8" strokeWidth="1.4"></path>
                        <path d="M0 100 C 15 100, 15 130, 30 130" fill="none" stroke="#c7cbd8" strokeWidth="1.4"></path>
                        <path data-flow="" d="M0 100 C 15 100, 15 78, 30 78" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 115" style={{ animation: "ns-flow 2.4s linear infinite" }}></path>
                        <path data-flow="" d="M0 100 C 15 100, 15 130, 30 130" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 115" style={{ animation: "ns-flow 2.4s linear .6s infinite" }}></path>
                      </svg>
                    </div>

                    <div style={{ border: "1.5px solid rgba(34,197,94,.30)", background: "rgba(34,197,94,.03)", borderRadius: "10px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#16a34a" }}>Architecture</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#9ca3af" }}>12 nodes</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1.5px solid #22c55e", boxShadow: "0 0 0 3px rgba(34,197,94,.10)" }}>
                        <img src={imgGo} alt="Go" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "700", color: "#111827" }}>mission-processor</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6b7280" }}>service</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <img src={imgNodejs} alt="Node.js worker" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#374151" }}>provenance-logger</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6b7280" }}>worker · node</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <img src={imgPostgres} alt="PostgreSQL" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#374151" }}>missions-db</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6b7280" }}>rds postgres</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <img src={imgS3} alt="Object store" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#374151" }}>scan-vault</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6b7280" }}>object store</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 30 200" preserveAspectRatio="none" style={{ width: "30px", height: "100%" }}>
                        <path d="M0 70 C 15 70, 15 62, 30 62" fill="none" stroke="#c7cbd8" strokeWidth="1.4"></path>
                        <path d="M0 110 C 15 110, 15 104, 30 104" fill="none" stroke="#c7cbd8" strokeWidth="1.4"></path>
                        <path data-flow="" d="M0 70 C 15 70, 15 62, 30 62" fill="none" stroke="#a855f7" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 115" style={{ animation: "ns-flow 2.4s linear .3s infinite" }}></path>
                      </svg>
                    </div>

                    <div style={{ border: "1.5px solid rgba(168,85,247,.28)", background: "rgba(168,85,247,.03)", borderRadius: "10px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#9333ea" }}>Deployment</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#9ca3af" }}>aws</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <img src={imgAws} alt="AWS" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#374151" }}>govcloud · il5</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6b7280" }}>us-gov-west</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <img src={imgPostgres} alt="RDS" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#374151" }}>rds postgres</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6b7280" }}>multi az · private</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb" }}>
                        <img src={imgK8s} alt="EKS" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                        <div>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#374151" }}>eks cluster</div>
                          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#6b7280" }}>stig baseline</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 30 200" preserveAspectRatio="none" style={{ width: "30px", height: "100%" }}>
                        <path d="M0 62 C 15 62, 15 70, 30 70" fill="none" stroke="#c7cbd8" strokeWidth="1.4"></path>
                        <path d="M0 104 C 15 104, 15 112, 30 112" fill="none" stroke="#c7cbd8" strokeWidth="1.4"></path>
                        <path data-flow="" d="M0 62 C 15 62, 15 70, 30 70" fill="none" stroke="#06b6d4" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 115" style={{ animation: "ns-flow 2.4s linear .9s infinite" }}></path>
                        <path data-flow="" d="M0 104 C 15 104, 15 112, 30 112" fill="none" stroke="#06b6d4" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="5 115" style={{ animation: "ns-flow 2.4s linear 1.4s infinite" }}></path>
                      </svg>
                    </div>

                    <div style={{ border: "1.5px solid rgba(6,182,212,.28)", background: "rgba(6,182,212,.03)", borderRadius: "10px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#0891b2" }}>Tests</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#9ca3af" }}>6</span>
                      </div>
                      <div data-test-chip="" style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "7px", transition: "border-color .4s ease, background-color .4s ease" }}>
                        <span data-test-mark="" style={{ color: "#22c55e", fontSize: "11px", transition: "color .4s ease" }}>✓</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#374151", overflowWrap: "anywhere" }}>mission.k024_parse</span>
                      </div>
                      <div data-test-chip="" data-test-open="" style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "7px", transition: "border-color .4s ease, background-color .4s ease" }}>
                        <span data-test-mark="" style={{ color: "#d97706", fontSize: "11px", transition: "color .4s ease" }}>•</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#374151", overflowWrap: "anywhere" }}>mission.dedup</span>
                      </div>
                      <div data-test-chip="" data-test-open="" style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "7px", transition: "border-color .4s ease, background-color .4s ease" }}>
                        <span data-test-mark="" style={{ color: "#d97706", fontSize: "11px", transition: "color .4s ease" }}>•</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#374151", overflowWrap: "anywhere" }}>track.correlate</span>
                      </div>
                      <div data-test-chip="" data-test-open="" style={{ padding: "8px 9px", borderRadius: "8px", background: "#fff", border: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: "7px", transition: "border-color .4s ease, background-color .4s ease" }}>
                        <span data-test-mark="" style={{ color: "#d97706", fontSize: "11px", transition: "color .4s ease" }}>•</span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#374151", overflowWrap: "anywhere" }}>acas.export</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ position: "absolute", left: "50%", bottom: "20px", transform: "translateX(-50%)", zIndex: "5", display: "flex", alignItems: "center", borderRadius: "12px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 6px 22px rgba(0,0,0,.12)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "2px", padding: "6px 8px" }}>
                      <span style={{ width: "24px", height: "24px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", color: "#6b7280" }}>+</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", fontWeight: "600", color: "#6b7280", minWidth: "38px", textAlign: "center" }}>100%</span>
                      <span style={{ width: "24px", height: "24px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", color: "#6b7280" }}>−</span>
                    </div>
                    <div style={{ width: "1px", alignSelf: "stretch", background: "#eef0f3", margin: "6px 0" }}></div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: "600", color: "#8B8FE6", background: "rgba(139,143,230,.12)", borderRadius: "7px", padding: "5px 9px" }}>Requirements</span>
                      <span style={{ fontSize: "11px", fontWeight: "600", color: "#8B8FE6", background: "rgba(139,143,230,.12)", borderRadius: "7px", padding: "5px 9px" }}>Architecture</span>
                      <span style={{ fontSize: "11px", fontWeight: "600", color: "#8B8FE6", background: "rgba(139,143,230,.12)", borderRadius: "7px", padding: "5px 9px" }}>Deployment</span>
                      <span style={{ fontSize: "11px", fontWeight: "600", color: "#8B8FE6", background: "rgba(139,143,230,.12)", borderRadius: "7px", padding: "5px 9px" }}>Tests</span>
                    </div>
                  </div>

                  <div style={{ position: "absolute", right: "12px", bottom: "78px", width: "104px", height: "60px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "rgba(255,255,255,.95)", padding: "6px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px" }}>
                    <span style={{ background: "rgba(99,102,241,.35)", borderRadius: "2px" }}></span>
                    <span style={{ background: "rgba(34,197,94,.35)", borderRadius: "2px" }}></span>
                    <span style={{ background: "rgba(168,85,247,.35)", borderRadius: "2px" }}></span>
                    <span style={{ background: "rgba(6,182,212,.35)", borderRadius: "2px" }}></span>
                  </div>
                  </div>

                  <div data-viewpanel="architecture" style={{ position: "absolute", inset: "0", opacity: "0", transform: "scale(.985)", pointerEvents: "none", transition: "opacity .5s ease, transform .5s cubic-bezier(.16,1,.3,1)", backgroundColor: "#fafbfc", backgroundImage: "radial-gradient(#dfe2ea 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                    {/*
                      Edge geometry is derived from the node-port positions, not eyeballed.
                      Canvas cell = 934px wide (1176 frame − 2px border − 240px sidebar) and
                      452px tall; the viewBox is 1000×452 with preserveAspectRatio="none",
                      so svgX = cssX × 1000/934 and svgY = cssY. Each node wrapper sits at
                      (L%, T%) with a 56×56 box whose side-port dots centre 1px outside the
                      box edge and 28px below its top. That yields:
                        afatds R(101,182) · fires-gateway L(169,182) R(231,182)
                        cds-guard L(349,164) R(411,164) · mission-processor L(499,164) R(561,164) B(530,193)
                        fires-bus L(349,308) R(411,308) T(380,280)
                        provenance-logger L(499,308) R(561,308)
                        missions-db L(679,173) · scan-vault L(679,299)
                      Verticals route through the empty corridor between the service column
                      (ends x≈561) and the private-subnet border (starts x≈640).
                    */}
                    <svg viewBox="0 0 1000 452" preserveAspectRatio="none" style={{ position: "absolute", inset: "0", width: "100%", height: "100%" }}>
                      <defs>
                        <marker id="ns-edge-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                          <path d="M0,1 L8,5 L0,9 Z" fill="#9aa1b5"></path>
                        </marker>
                      </defs>
                      {/* afatds → fires-gateway (VMF uplink) */}
                      <path d="M101 182 L163 182" fill="none" stroke="#b3b9cb" strokeWidth="1.8" strokeLinecap="round" markerEnd="url(#ns-edge-arrow)"></path>
                      {/* fires-gateway → cds-guard */}
                      <path d="M231 182 C 282 182, 292 164, 343 164" fill="none" stroke="#b3b9cb" strokeWidth="1.8" strokeLinecap="round" markerEnd="url(#ns-edge-arrow)"></path>
                      {/* cds-guard → mission-processor */}
                      <path d="M411 164 L493 164" fill="none" stroke="#b3b9cb" strokeWidth="1.8" strokeLinecap="round" markerEnd="url(#ns-edge-arrow)"></path>
                      {/* mission-processor → missions-db */}
                      <path d="M561 164 C 615 164, 620 173, 673 173" fill="none" stroke="#b3b9cb" strokeWidth="1.8" strokeLinecap="round" markerEnd="url(#ns-edge-arrow)"></path>
                      {/* ACAS scan export: leaves the restricted zone for the
                          compliance vault — dashed amber, externally bound */}
                      <path d="M561 164 C 599 164, 598 202, 598 231 C 598 268, 622 299, 673 299" fill="none" stroke="#d97706" strokeOpacity=".8" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="5 5" markerEnd="url(#ns-edge-arrow)" style={{ animation: "ns-drift 8s linear infinite" }}></path>
                      {/* mission-processor ⇢ fires-bus (async publish, bottom port → top port) */}
                      <path d="M530 197 C 526 235, 452 258, 389 271" fill="none" stroke="#b3b9cb" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="5 5" markerEnd="url(#ns-edge-arrow)" style={{ animation: "ns-drift 9s linear infinite" }}></path>
                      {/* fires-bus → provenance-logger */}
                      <path d="M411 308 L493 308" fill="none" stroke="#b3b9cb" strokeWidth="1.8" strokeLinecap="round" markerEnd="url(#ns-edge-arrow)"></path>
                      {/* provenance-logger → missions-db, up the corridor */}
                      <path d="M561 308 C 606 308, 613 268, 613 232 C 613 199, 630 177, 672 176" fill="none" stroke="#b3b9cb" strokeWidth="1.8" strokeLinecap="round" markerEnd="url(#ns-edge-arrow)"></path>
                      {/* traffic pulses ride the exact same geometry */}
                      <path data-flow="" d="M231 182 C 282 182, 292 164, 343 164" fill="none" stroke="#d97706" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 460" style={{ animation: "ns-flow 2.4s linear infinite" }}></path>
                      <path data-flow="" d="M411 164 L493 164" fill="none" stroke="#8B8FE6" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 460" style={{ animation: "ns-flow 2.4s linear .5s infinite" }}></path>
                      <path data-flow="" d="M561 164 C 615 164, 620 173, 673 173" fill="none" stroke="#336791" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 460" style={{ animation: "ns-flow 2.4s linear .9s infinite" }}></path>
                      <path data-flow="" d="M411 308 L493 308" fill="none" stroke="#231f20" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 460" style={{ animation: "ns-flow 2.4s linear 1.4s infinite" }}></path>
                    </svg>

                    <div style={{ position: "absolute", left: "29%", top: "13%", right: "3%", bottom: "9%", borderRadius: "12px", border: "1.5px dashed rgba(255,153,0,.5)", background: "rgba(255,153,0,.03)" }}>
                      <span style={{ position: "absolute", top: "-9px", left: "14px", display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#b45309", background: "#fafbfc", padding: "1px 8px", borderRadius: "4px", border: "1px solid rgba(255,153,0,.3)" }}><img src={imgAws} alt="AWS GovCloud" style={{ width: "12px", height: "12px", objectFit: "contain" }} />govcloud · il5 enclave</span>
                    </div>
                    <div style={{ position: "absolute", left: "32%", top: "21%", right: "5.5%", bottom: "15%", borderRadius: "10px", border: "1.5px solid rgba(139,143,230,.35)", background: "rgba(139,143,230,.03)" }}>
                      <span style={{ position: "absolute", top: "-9px", left: "12px", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#6d70c9", background: "#fafbfc", padding: "1px 8px", borderRadius: "4px", border: "1px solid rgba(139,143,230,.25)" }}>mission vpc · 10.0.0.0/16</span>
                    </div>
                    <div style={{ position: "absolute", left: "64%", top: "25%", right: "8%", bottom: "45%", borderRadius: "10px", border: "1.5px dashed rgba(51,103,145,.4)", background: "rgba(51,103,145,.03)" }}>
                      <span style={{ position: "absolute", top: "-9px", left: "12px", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#336791", background: "#fafbfc", padding: "1px 8px", borderRadius: "4px", border: "1px solid rgba(51,103,145,.25)" }}>restricted subnet</span>
                    </div>

                    <div style={{ position: "absolute", left: "4%", top: "34%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #111827", boxShadow: "0 3px 12px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#111827" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="7"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><circle cx="12" cy="12" r="1.5" fill="#111827"></circle></svg>
                        <span style={{ position: "absolute", right: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #111827", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap" }}>afatds</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>external · fires c2</span>
                    </div>
                    <div style={{ position: "absolute", left: "17%", top: "34%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #d97706", boxShadow: "0 3px 12px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="1.8" strokeLinecap="round"><path d="M12 10v12"></path><path d="M9 22h6"></path><circle cx="12" cy="7" r="2.2"></circle><path d="M7.6 4.4a6.4 6.4 0 0 0 0 5.2"></path><path d="M16.4 4.4a6.4 6.4 0 0 1 0 5.2"></path><path d="M4.9 1.9a10.6 10.6 0 0 0 0 10.2"></path><path d="M19.1 1.9a10.6 10.6 0 0 1 0 10.2"></path></svg>
                        <span style={{ position: "absolute", left: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #d97706", boxSizing: "border-box" }}></span>
                        <span style={{ position: "absolute", right: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #d97706", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap" }}>fires-gateway</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>vmf · mil-std-6017</span>
                    </div>
                    <div style={{ position: "absolute", left: "35%", top: "30%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #475569", boxShadow: "0 3px 12px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5z"></path><path d="M8.5 12l2.5 2.5 4.5-4.5"></path></svg>
                        <span style={{ position: "absolute", left: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #475569", boxSizing: "border-box" }}></span>
                        <span style={{ position: "absolute", right: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #475569", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap" }}>cds-guard</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>cross-domain guard</span>
                    </div>
                    <div style={{ position: "absolute", left: "50%", top: "30%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #8B8FE6", boxShadow: "0 0 0 3px rgba(139,143,230,.22), 0 4px 16px rgba(0,0,0,.14)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={imgGo} alt="mission-processor" style={{ width: "30px", height: "30px", objectFit: "contain" }} />
                        <span style={{ position: "absolute", left: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #8B8FE6", boxSizing: "border-box" }}></span>
                        <span style={{ position: "absolute", right: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #8B8FE6", boxSizing: "border-box" }}></span>
                        <span style={{ position: "absolute", bottom: "-5px", left: "50%", marginLeft: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #8B8FE6", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "700", color: "#111827", whiteSpace: "nowrap" }}>mission-processor</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>k8s · go</span>
                    </div>
                    <div style={{ position: "absolute", left: "35%", top: "62%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #231f20", boxShadow: "0 3px 12px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={imgKafka} alt="fires-bus" style={{ width: "30px", height: "30px", objectFit: "contain" }} />
                        <span style={{ position: "absolute", left: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #231f20", boxSizing: "border-box" }}></span>
                        <span style={{ position: "absolute", right: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #231f20", boxSizing: "border-box" }}></span>
                        <span style={{ position: "absolute", top: "-5px", left: "50%", marginLeft: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #231f20", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap" }}>fires-bus</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>kafka · missions</span>
                    </div>
                    <div style={{ position: "absolute", left: "50%", top: "62%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #00add8", boxShadow: "0 3px 12px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={imgNodejs} alt="provenance-logger" style={{ width: "30px", height: "30px", objectFit: "contain" }} />
                        <span style={{ position: "absolute", left: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #00add8", boxSizing: "border-box" }}></span>
                        <span style={{ position: "absolute", right: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #00add8", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap" }}>provenance-logger</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>worker · node</span>
                    </div>
                    <div style={{ position: "absolute", left: "68%", top: "32%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #336791", boxShadow: "0 3px 12px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={imgPostgres} alt="missions-db" style={{ width: "30px", height: "30px", objectFit: "contain" }} />
                        <span style={{ position: "absolute", left: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #336791", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap" }}>missions-db</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>rds postgres</span>
                    </div>
                    <div style={{ position: "absolute", left: "68%", top: "60%", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "56px" }}>
                      <div style={{ position: "relative", width: "56px", height: "56px", borderRadius: "14px", background: "#fff", border: "2.5px solid #d97706", boxShadow: "0 3px 12px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <img src={imgS3} alt="scan-vault" style={{ width: "30px", height: "30px", objectFit: "contain" }} />
                        <span style={{ position: "absolute", left: "-5px", top: "50%", marginTop: "-4px", width: "8px", height: "8px", borderRadius: "50%", background: "#fff", border: "2px solid #d97706", boxSizing: "border-box" }}></span>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: "600", color: "#374151", whiteSpace: "nowrap" }}>scan-vault</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "8.5px", color: "#9ca3af", whiteSpace: "nowrap", marginTop: "-3px" }}>external · scan archive</span>
                    </div>

                    <div style={{ position: "absolute", left: "10px", bottom: "84px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      <span style={{ width: "26px", height: "26px", borderRadius: "4px", border: "1px solid #e5e7eb", background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="6" height="6" rx="1"></rect><rect x="15" y="3" width="6" height="6" rx="1"></rect><rect x="9" y="15" width="6" height="6" rx="1"></rect><path d="M6 9v3c0 1 1 2 2 2h2"></path><path d="M18 9v3c0 1-1 2-2 2h-2"></path></svg>
                      </span>
                      <span style={{ width: "26px", height: "26px", borderRadius: "4px", border: "1px solid #e5e7eb", background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#374151" }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="2" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="22"></line><line x1="2" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="22" y2="12"></line></svg>
                      </span>
                    </div>
                    <div style={{ position: "absolute", left: "50%", bottom: "20px", transform: "translateX(-50%)", zIndex: "5", display: "flex", alignItems: "center", borderRadius: "12px", background: "#ffffff", border: "1px solid #e5e7eb", boxShadow: "0 6px 22px rgba(0,0,0,.12)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "2px", padding: "6px 8px" }}>
                      <span style={{ width: "24px", height: "24px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", color: "#6b7280" }}>+</span>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", fontWeight: "600", color: "#6b7280", minWidth: "38px", textAlign: "center" }}>100%</span>
                      <span style={{ width: "24px", height: "24px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", color: "#6b7280" }}>−</span>
                    </div>
                    <div style={{ width: "1px", alignSelf: "stretch", background: "#eef0f3", margin: "6px 0" }}></div>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "6px 8px" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "600", color: "#8B8FE6", background: "rgba(139,143,230,.12)", borderRadius: "7px", padding: "5px 9px" }}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="2" y1="4" x2="14" y2="4"></line><line x1="2" y1="8" x2="14" y2="8"></line><line x1="2" y1="12" x2="14" y2="12"></line></svg>Functional
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", fontWeight: "600", color: "#6b7280", borderRadius: "7px", padding: "5px 9px" }}>
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="1.5" width="13" height="13" rx="2"></rect><rect x="4.5" y="4.5" width="7" height="7" rx="1"></rect></svg>Nested
                        </span>
                      </div>
                    </div>
                    <div style={{ position: "absolute", right: "12px", bottom: "14px", width: "104px", height: "60px", borderRadius: "7px", border: "1px solid #e5e7eb", background: "rgba(255,255,255,.95)" }}>
                      <span style={{ position: "absolute", left: "8px", top: "22px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(17,24,39,.4)" }}></span>
                      <span style={{ position: "absolute", left: "22px", top: "22px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(243,128,32,.5)" }}></span>
                      <span style={{ position: "absolute", left: "40px", top: "18px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(255,153,0,.5)" }}></span>
                      <span style={{ position: "absolute", left: "55px", top: "18px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(139,143,230,.65)" }}></span>
                      <span style={{ position: "absolute", left: "40px", top: "38px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(35,31,32,.4)" }}></span>
                      <span style={{ position: "absolute", left: "55px", top: "38px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(0,173,216,.5)" }}></span>
                      <span style={{ position: "absolute", left: "76px", top: "20px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(51,103,145,.5)" }}></span>
                      <span style={{ position: "absolute", left: "76px", top: "36px", width: "9px", height: "9px", borderRadius: "2px", background: "rgba(220,56,45,.45)" }}></span>
                      <span style={{ position: "absolute", inset: "6px 30px 6px 6px", border: "1px solid rgba(139,143,230,.4)", borderRadius: "3px" }}></span>
                    </div>
                  </div>

                  <div data-overlay="inspector" style={{ position: "absolute", top: "76px", right: "0", bottom: "0", width: "244px", zIndex: "4", opacity: "0", transform: "translateX(20px)", pointerEvents: "none", transition: "opacity .45s ease, transform .5s cubic-bezier(.16,1,.3,1)", background: "#ffffff", borderLeft: "1px solid #e5e7eb", boxShadow: "-12px 0 30px rgba(24,26,44,.10)", padding: "16px 16px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", letterSpacing: ".12em", color: "#9ca3af" }}>INSPECTOR</span>
                      <span style={{ fontSize: "12px", color: "#9ca3af" }}>×</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingBottom: "12px", borderBottom: "1px solid #eef0f4" }}>
                      <span style={{ width: "34px", height: "34px", borderRadius: "10px", background: "#fff", border: "2px solid #8B8FE6", display: "flex", alignItems: "center", justifyContent: "center" }}><img src={imgGo} alt="mission-processor" style={{ width: "19px", height: "19px", objectFit: "contain" }} /></span>
                      <div>
                        <div style={{ fontSize: "12.5px", fontWeight: "700", color: "#111827" }}>mission-processor</div>
                        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#6b7280" }}>service · k8s enclave</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                      <div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: ".1em", color: "#9ca3af", marginBottom: "3px" }}>TECHNOLOGY</div><div style={{ fontSize: "11.5px", color: "#374151" }}>go 1.22 · vmf codec · k8s</div></div>
                      <div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: ".1em", color: "#9ca3af", marginBottom: "3px" }}>CONTRACTS</div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", color: "#374151", lineHeight: "1.6" }}>K02.4 CFF · MIL-STD-6017<br />J3.2 Track · MIL-STD-6016<br />mission.created → fires-bus</div></div>
                      <div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: ".1em", color: "#9ca3af", marginBottom: "3px" }}>CRITERIA</div><div style={{ fontSize: "11.5px", color: "#374151" }}>4 linked, 1 open</div></div>
                      <div><div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", letterSpacing: ".1em", color: "#9ca3af", marginBottom: "3px" }}>SECURITY</div><div style={{ fontSize: "11.5px", color: "#374151" }}>stig baseline · acas scanned</div></div>
                    </div>
                    <div style={{ marginTop: "auto", padding: "9px 11px", borderRadius: "9px", background: "rgba(139,143,230,.08)", border: "1px solid rgba(139,143,230,.22)", fontSize: "11px", color: "#4b5563", lineHeight: "1.5" }}>Task packet carries this slice only.</div>
                  </div>

                  <div data-overlay="mcp" style={{ position: "absolute", inset: "0", zIndex: "5", opacity: "0", pointerEvents: "none", transition: "opacity .45s ease", background: "rgba(15,17,23,.28)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div data-overlay-card="" style={{ width: "320px", borderRadius: "14px", background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 24px 60px rgba(24,26,44,.28)", padding: "20px", transform: "scale(.96)", transition: "transform .5s cubic-bezier(.16,1,.3,1)" }}>
                      <div style={{ fontSize: "15px", fontWeight: "800", color: "#111827", letterSpacing: "-.02em" }}>Connect your AI</div>
                      <div style={{ fontSize: "11.5px", color: "#6b7280", marginTop: "4px" }}>NodeSpec serves context over MCP. No model of its own.</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 11px", borderRadius: "9px", border: "1.5px solid #22c55e", background: "rgba(34,197,94,.05)" }}>
                          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="7" rx="2"></rect><rect x="3" y="13" width="18" height="7" rx="2"></rect><line x1="7" y1="7.5" x2="7" y2="7.5"></line><line x1="7" y1="16.5" x2="7" y2="16.5"></line></svg>
                          <span style={{ fontSize: "12px", fontWeight: "600", color: "#111827" }}>Self-hosted model</span>
                          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#16a34a" }}>connected</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 11px", borderRadius: "9px", border: "1px solid #e5e7eb" }}>
                          <span style={{ width: "19px", height: "19px", borderRadius: "5px", background: "#111827", color: "#fff", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", justifyContent: "center" }}>C</span>
                          <span style={{ fontSize: "12px", fontWeight: "600", color: "#374151" }}>Cursor</span>
                          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#8B8FE6" }}>connect</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 11px", borderRadius: "9px", border: "1px solid #e5e7eb" }}>
                          <img src={imgOpenai} alt="Codex" style={{ width: "19px", height: "19px", objectFit: "contain" }} />
                          <span style={{ fontSize: "12px", fontWeight: "600", color: "#374151" }}>Codex</span>
                          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#8B8FE6" }}>connect</span>
                        </div>
                      </div>
                      <div style={{ marginTop: "14px", padding: "9px 11px", borderRadius: "8px", background: "#fafbfc", border: "1px solid #eef0f4", fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#6b7280" }}>enclave endpoint /mcp · read and propose</div>
                    </div>
                  </div>

                  <div data-overlay="git" style={{ position: "absolute", right: "16px", top: "82px", width: "264px", zIndex: "5", opacity: "0", transform: "translateY(-10px)", pointerEvents: "none", transition: "opacity .45s ease, transform .5s cubic-bezier(.16,1,.3,1)", borderRadius: "12px", background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 18px 44px rgba(24,26,44,.2)", padding: "15px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e" }}></span>
                      <span style={{ fontSize: "12.5px", fontWeight: "700", color: "#111827" }}>Pushed to your repo</span>
                    </div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "#6b7280", marginTop: "10px", display: "flex", flexDirection: "column", gap: "5px" }}>
                      <div style={{ display: "flex", gap: "7px" }}><span style={{ color: "#22c55e" }}>+</span>model.json</div>
                      <div style={{ display: "flex", gap: "7px" }}><span style={{ color: "#22c55e" }}>+</span>tasks/mission-processor.md</div>
                      <div style={{ display: "flex", gap: "7px" }}><span style={{ color: "#22c55e" }}>+</span>test-plans/mission.md</div>
                    </div>
                    <div style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #eef0f4", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#9ca3af" }}>
                      <span>main · commit 7f3a91c</span><span style={{ color: "#16a34a" }}>no drift</span>
                    </div>
                  </div>

                  <div data-overlay="tests" style={{ position: "absolute", inset: "0", zIndex: "4", opacity: "0", pointerEvents: "none", transition: "opacity .45s ease" }}>
                    <svg viewBox="0 0 1000 452" preserveAspectRatio="none" style={{ position: "absolute", inset: "0", width: "100%", height: "100%" }}>
                      <path data-flow-up="" d="M840 130 C 700 130, 700 160, 580 160" fill="none" stroke="#06b6d4" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="7 113" style={{ animation: "ns-flow-up 2.2s linear infinite" }}></path>
                      <path data-flow-up="" d="M580 160 C 460 160, 460 190, 340 190" fill="none" stroke="#a855f7" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="7 113" style={{ animation: "ns-flow-up 2.2s linear .45s infinite" }}></path>
                      <path data-flow-up="" d="M340 190 C 230 190, 230 220, 120 220" fill="none" stroke="#22c55e" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="7 113" style={{ animation: "ns-flow-up 2.2s linear .9s infinite" }}></path>
                    </svg>
                    <div style={{ position: "absolute", left: "4%", top: "18px", padding: "6px 11px", borderRadius: "8px", background: "#fff", border: "1.5px solid #22c55e", boxShadow: "0 6px 18px rgba(24,26,44,.14)", fontSize: "11px", fontWeight: "700", color: "#16a34a" }}>R-02 met · 3/3</div>
                    <div style={{ position: "absolute", left: "14px", bottom: "76px", width: "224px", padding: "11px 13px", borderRadius: "11px", background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 14px 36px rgba(24,26,44,.16)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e" }}></span>
                        <span style={{ fontSize: "12px", fontWeight: "700", color: "#111827" }}>Evidence committed</span>
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "9.5px", color: "#6b7280", marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", gap: "6px" }}><span style={{ color: "#22c55e" }}>+</span>test-plans/mission.md</div>
                        <div style={{ display: "flex", gap: "6px" }}><span style={{ color: "#22c55e" }}>+</span>results/mission.run.json</div>
                      </div>
                      <div style={{ marginTop: "9px", paddingTop: "8px", borderTop: "1px solid #eef0f4", fontFamily: "'JetBrains Mono', monospace", fontSize: "9px", color: "#9ca3af" }}>main · commit a41c88e</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
              <span data-stage-label="" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11.5px", color: "#8a8f9e", padding: "7px 14px", borderRadius: "999px", border: "1px solid rgba(139,143,230,.18)", background: "rgba(26,29,38,.6)", transition: "opacity .3s ease" }}>Spec · requirements and acceptance criteria</span>
            </div>
          </div>

          <div style={{ position: "relative", zIndex: "1", maxWidth: "1080px", margin: "0 auto", padding: "56px 40px 96px" }}>

            <div className="ns-tour-cards" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
              <div className="ns-fcard" data-card="spec decomposition" data-reveal="" style={{ padding: "24px 22px", borderRadius: "14px", border: "1px solid rgba(139,143,230,.12)", background: "rgba(26,29,38,.7)", transition: "transform .45s cubic-bezier(.16,1,.3,1), border-color .35s ease, background-color .35s ease, box-shadow .35s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "11px" }}>
                  <span data-card-dot="" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(139,143,230,.35)", transition: "background-color .35s ease, box-shadow .35s ease" }}></span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", fontWeight: "600", color: "#8B8FE6", letterSpacing: ".1em", textTransform: "uppercase" }}>Spec driven</span>
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: "18.5px", fontWeight: "700", color: "#E6E9EF", letterSpacing: "-.025em" }}>Requirements traced to nodes</h3>
                <p style={{ margin: "0", fontSize: "13.5px", color: "#8a8f9e", lineHeight: "1.6" }}>Write the spec once. NodeSpec decomposes it into criteria, then traces every one to the node that satisfies it.</p>
              </div>
              <div className="ns-fcard" data-card="architecture" data-reveal="" data-reveal-delay="80" style={{ padding: "24px 22px", borderRadius: "14px", border: "1px solid rgba(139,143,230,.12)", background: "rgba(26,29,38,.7)", transition: "transform .45s cubic-bezier(.16,1,.3,1), border-color .35s ease, background-color .35s ease, box-shadow .35s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "11px" }}>
                  <span data-card-dot="" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(139,143,230,.35)", transition: "background-color .35s ease, box-shadow .35s ease" }}></span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", fontWeight: "600", color: "#8B8FE6", letterSpacing: ".1em", textTransform: "uppercase" }}>Architecture-as-Code</span>
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: "18.5px", fontWeight: "700", color: "#E6E9EF", letterSpacing: "-.025em" }}>Context the AI can build from</h3>
                <p style={{ margin: "0", fontSize: "13.5px", color: "#8a8f9e", lineHeight: "1.6" }}>The canvas includes node-specific configuration information so an AI can immediately reference and build the correct, contextual structure rather than guess it.</p>
              </div>
              <div className="ns-fcard" data-card="inspector" data-reveal="" data-reveal-delay="160" style={{ padding: "24px 22px", borderRadius: "14px", border: "1px solid rgba(139,143,230,.12)", background: "rgba(26,29,38,.7)", transition: "transform .45s cubic-bezier(.16,1,.3,1), border-color .35s ease, background-color .35s ease, box-shadow .35s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "11px" }}>
                  <span data-card-dot="" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(139,143,230,.35)", transition: "background-color .35s ease, box-shadow .35s ease" }}></span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", fontWeight: "600", color: "#8B8FE6", letterSpacing: ".1em", textTransform: "uppercase" }}>Scoped context</span>
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: "18.5px", fontWeight: "700", color: "#E6E9EF", letterSpacing: "-.025em" }}>One slice per node</h3>
                <p style={{ margin: "0", fontSize: "13.5px", color: "#8a8f9e", lineHeight: "1.6" }}>Each packet carries a node role, contracts, criteria and security posture. Nothing else, so accuracy and cost both improve.</p>
              </div>
              <div className="ns-fcard" data-card="mcp" data-reveal="" data-reveal-delay="40" style={{ padding: "24px 22px", borderRadius: "14px", border: "1px solid rgba(139,143,230,.12)", background: "rgba(26,29,38,.7)", transition: "transform .45s cubic-bezier(.16,1,.3,1), border-color .35s ease, background-color .35s ease, box-shadow .35s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "11px" }}>
                  <span data-card-dot="" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(139,143,230,.35)", transition: "background-color .35s ease, box-shadow .35s ease" }}></span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", fontWeight: "600", color: "#8B8FE6", letterSpacing: ".1em", textTransform: "uppercase" }}>MCP first</span>
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: "18.5px", fontWeight: "700", color: "#E6E9EF", letterSpacing: "-.025em" }}>Your AI, your IDE</h3>
                <p style={{ margin: "0", fontSize: "13.5px", color: "#8a8f9e", lineHeight: "1.6" }}>Approved foundation or open-weight models connect over MCP. NodeSpec runs no model of its own and every write is proposed for review.</p>
              </div>
              <div className="ns-fcard" data-card="git" data-reveal="" data-reveal-delay="120" style={{ padding: "24px 22px", borderRadius: "14px", border: "1px solid rgba(139,143,230,.12)", background: "rgba(26,29,38,.7)", transition: "transform .45s cubic-bezier(.16,1,.3,1), border-color .35s ease, background-color .35s ease, box-shadow .35s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "11px" }}>
                  <span data-card-dot="" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(139,143,230,.35)", transition: "background-color .35s ease, box-shadow .35s ease" }}></span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", fontWeight: "600", color: "#8B8FE6", letterSpacing: ".1em", textTransform: "uppercase" }}>GitOps Integrated</span>
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: "18.5px", fontWeight: "700", color: "#E6E9EF", letterSpacing: "-.025em" }}>More than just markdown</h3>
                <p style={{ margin: "0", fontSize: "13.5px", color: "#8a8f9e", lineHeight: "1.6" }}>Detecting, pushing, and pulling from Git to infer or allow the user to determine where commits directly from or outside of NodeSpec belong for consistent tracking and prevention of drift.</p>
              </div>
              <div className="ns-fcard" data-card="tests" data-reveal="" data-reveal-delay="200" style={{ padding: "24px 22px", borderRadius: "14px", border: "1px solid rgba(139,143,230,.12)", background: "rgba(26,29,38,.7)", transition: "transform .45s cubic-bezier(.16,1,.3,1), border-color .35s ease, background-color .35s ease, box-shadow .35s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "11px" }}>
                  <span data-card-dot="" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "rgba(139,143,230,.35)", transition: "background-color .35s ease, box-shadow .35s ease" }}></span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10.5px", fontWeight: "600", color: "#8B8FE6", letterSpacing: ".1em", textTransform: "uppercase" }}>Verified upstream</span>
                </div>
                <h3 style={{ margin: "0 0 8px", fontSize: "18.5px", fontWeight: "700", color: "#E6E9EF", letterSpacing: "-.025em" }}>Results with receipts</h3>
                <p style={{ margin: "0", fontSize: "13.5px", color: "#8a8f9e", lineHeight: "1.6" }}>Build and track smaller, scoped test plans for your AI implementation, with detection flowing back upstream.</p>
              </div>
            </div>
          </div>
        </section>


    </>
  );
}
