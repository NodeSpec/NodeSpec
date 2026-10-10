// The decoration behind "How it works" (owner design 2026-10-07): the hero's canvas
// carries on under the product frame, and the four steps sit on one edge. The
// step cards themselves are text and live in LandingSections.

/** The grid, glow and two faint nodes the hero's background continues into. */
export function HowBackdropWide() {
  return (
    <div aria-hidden="true" style={{ "position": "absolute", "inset": "0", "overflow": "hidden", "pointerEvents": "none" }}>
    <div style={{ "position": "absolute", "left": "0", "right": "0", "top": "240px", "bottom": "0", "backgroundImage": "linear-gradient(rgba(139,143,230,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,143,230,.07) 1px, transparent 1px)", "backgroundSize": "52px 52px", "maskImage": "radial-gradient(ellipse 75% 60% at 50% 50%, #000 25%, transparent 78%)", "WebkitMaskImage": "radial-gradient(ellipse 75% 60% at 50% 50%, #000 25%, transparent 78%)" }}></div>
    <div style={{ "position": "absolute", "left": "50%", "top": "380px", "width": "960px", "height": "560px", "transform": "translateX(-50%)", "background": "radial-gradient(ellipse at center, rgba(139,143,230,.14) 0%, transparent 68%)", "filter": "blur(30px)" }}></div>
    <div style={{ "position": "absolute", "left": "50%", "top": "0", "width": "1440px", "height": "360px", "marginLeft": "-720px", "animation": "lp-drift 24s ease-in-out infinite" }}>
    <svg width="1440" height="360" viewBox="0 0 1440 360" style={{ "position": "absolute", "inset": "0" }}>
    <path d="M100,210 C420,210 420,120 720,120" fill="none" stroke="rgba(139,143,230,.18)" strokeWidth="2"></path>
    <path d="M1350,130 C1040,130 1040,240 720,240" fill="none" stroke="rgba(139,143,230,.18)" strokeWidth="2"></path>
    <path d="M100,210 C420,210 420,120 720,120" fill="none" stroke="rgba(139,143,230,.5)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 116" style={{ "animation": "lp-flow 4s linear infinite" }}></path>
    <path d="M1350,130 C1040,130 1040,240 720,240" fill="none" stroke="rgba(139,143,230,.5)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 116" style={{ "animation": "lp-flow 4s linear 1.6s infinite" }}></path>
    </svg>
    <div style={{ "position": "absolute", "left": "-40px", "top": "170px", "width": "140px", "height": "80px", "boxSizing": "border-box", "border": "2px solid rgba(139,143,230,.28)", "borderRadius": "8px", "background": "rgba(255,255,255,.55)", "display": "flex", "flexDirection": "column" }}><span style={{ "margin": "6px 6px 0", "height": "22px", "borderRadius": "3px", "background": "rgba(139,143,230,.16)" }}></span><span style={{ "flex": "1", "display": "grid", "placeItems": "center", "fontSize": "12px", "fontWeight": "600", "color": "rgba(31,41,55,.42)" }}>Worker</span><span style={{ "position": "absolute", "right": "-6px", "top": "34px", "width": "10px", "height": "10px", "borderRadius": "50%", "background": "rgba(251,191,36,.45)" }}></span></div>
    <div style={{ "position": "absolute", "left": "1350px", "top": "90px", "width": "140px", "height": "80px", "boxSizing": "border-box", "border": "2px solid rgba(139,143,230,.28)", "borderRadius": "8px", "background": "rgba(255,255,255,.55)", "display": "flex", "flexDirection": "column" }}><span style={{ "margin": "6px 6px 0", "height": "22px", "borderRadius": "3px", "background": "rgba(59,130,246,.12)" }}></span><span style={{ "flex": "1", "display": "grid", "placeItems": "center", "fontSize": "12px", "fontWeight": "600", "color": "rgba(31,41,55,.42)" }}>Object Storage</span><span style={{ "position": "absolute", "left": "-6px", "top": "34px", "width": "10px", "height": "10px", "borderRadius": "50%", "background": "rgba(16,185,129,.4)" }}></span></div>
    </div>
    </div>

  );
}

export function HowBackdropNarrow() {
  return (
    <div aria-hidden="true" style={{ "position": "absolute", "inset": "0", "overflow": "hidden", "pointerEvents": "none" }}>
    <div style={{ "position": "absolute", "left": "0", "right": "0", "top": "200px", "bottom": "0", "backgroundImage": "linear-gradient(rgba(139,143,230,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(139,143,230,.07) 1px, transparent 1px)", "backgroundSize": "40px 40px", "maskImage": "radial-gradient(ellipse 90% 55% at 50% 45%, #000 25%, transparent 78%)", "WebkitMaskImage": "radial-gradient(ellipse 90% 55% at 50% 45%, #000 25%, transparent 78%)" }}></div>
    <div style={{ "position": "absolute", "left": "50%", "top": "260px", "width": "440px", "height": "520px", "transform": "translateX(-50%)", "background": "radial-gradient(ellipse at center, rgba(139,143,230,.16) 0%, transparent 68%)", "filter": "blur(24px)" }}></div>
    <div style={{ "position": "absolute", "left": "0", "top": "0", "width": "390px", "height": "260px", "animation": "lp-drift 20s ease-in-out infinite" }}>
    <svg width="390" height="260" viewBox="0 0 390 260" style={{ "position": "absolute", "inset": "0" }}>
    <path d="M60,214 C200,214 200,150 330,150" fill="none" stroke="rgba(139,143,230,.16)" strokeWidth="2"></path>
    <path d="M60,214 C200,214 200,150 330,150" fill="none" stroke="rgba(139,143,230,.45)" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 116" style={{ "animation": "lp-flow 4s linear infinite" }}></path>
    </svg>
    <div style={{ "position": "absolute", "left": "-76px", "top": "188px", "width": "136px", "height": "56px", "boxSizing": "border-box", "border": "2px solid rgba(139,143,230,.26)", "borderRadius": "8px", "background": "rgba(255,255,255,.55)", "display": "flex", "flexDirection": "column" }}><span style={{ "margin": "5px 5px 0", "height": "14px", "borderRadius": "3px", "background": "rgba(139,143,230,.16)" }}></span><span style={{ "flex": "1", "display": "grid", "placeItems": "center", "fontSize": "11px", "fontWeight": "600", "color": "rgba(31,41,55,.38)" }}>Worker</span></div>
    </div>
    </div>

  );
}

/** The edges between the four step nodes, port to port, with the dashes moving. */
export function HowConnectors() {
  return (
    <svg width="1120" height="140" viewBox="0 0 1120 140" aria-hidden="true" style={{ "position": "absolute", "left": "0", "top": "0", "overflow": "visible", "zIndex": "0" }}>
    <defs>
    <marker id="hw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="rgba(95,100,204,.7)"></path></marker>
    <linearGradient id="hw-in" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8B8FE6" stopOpacity="0"></stop><stop offset="1" stopColor="#8B8FE6" stopOpacity=".7"></stop></linearGradient>
    <linearGradient id="hw-out" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8B8FE6" stopOpacity=".7"></stop><stop offset="1" stopColor="#8B8FE6" stopOpacity="0"></stop></linearGradient>
    </defs>
    <path d="M-150,94 C-75,94 -75,30 2,30" fill="none" stroke="url(#hw-in)" strokeWidth="2"></path>
    <path d="M224,30 C258,30 258,78 292,78" fill="none" stroke="rgba(139,143,230,.6)" strokeWidth="2" markerEnd="url(#hw-arrow)"></path>
    <path d="M522,78 C556,78 556,30 588,30" fill="none" stroke="rgba(139,143,230,.6)" strokeWidth="2" markerEnd="url(#hw-arrow)"></path>
    <path d="M820,30 C854,30 854,78 886,78" fill="none" stroke="rgba(139,143,230,.6)" strokeWidth="2" markerEnd="url(#hw-arrow)"></path>
    <path d="M1118,78 C1195,78 1195,14 1270,14" fill="none" stroke="url(#hw-out)" strokeWidth="2"></path>
    <g fill="none" stroke="#5f64cc" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="4 116">
    <path d="M-150,94 C-75,94 -75,30 2,30" style={{ "animation": "lp-flow 3s linear infinite" }}></path>
    <path d="M224,30 C258,30 258,78 292,78" style={{ "animation": "lp-flow 3s linear .6s infinite" }}></path>
    <path d="M522,78 C556,78 556,30 588,30" style={{ "animation": "lp-flow 3s linear 1.2s infinite" }}></path>
    <path d="M820,30 C854,30 854,78 886,78" style={{ "animation": "lp-flow 3s linear 1.8s infinite" }}></path>
    <path d="M1118,78 C1195,78 1195,14 1270,14" style={{ "animation": "lp-flow 3s linear 2.4s infinite" }}></path>
    </g>
    </svg>
  );
}
