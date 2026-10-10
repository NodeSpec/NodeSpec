// "Built for the people who answer for the code" (owner design 2026-10-07): your
// agents, your repository and NodeSpec, loosely coupled. Code goes from the agents
// straight to git; NodeSpec links to each of them, never sitting in the code path.
// One drawing for wide screens and one for phones; the stylesheet shows one.
import logo from '../../../assets/lightmode_nodal_450.webp';

export function ControlTriangleWide() {
  return (
    <div className="lp-tri lp-tri-wide">
      <div role="img" aria-label="Your agents commit code straight to your repository. NodeSpec links to both loosely: context and proposals with your agents over MCP, and its design files in git." style={{ "position": "relative", "width": "480px", "height": "440px", "maxWidth": "100%" }}>
      <div aria-hidden="true" style={{ "position": "absolute", "left": "90px", "top": "120px", "width": "300px", "height": "260px", "borderRadius": "50%", "background": "radial-gradient(circle, rgba(139,143,230,.16) 0%, transparent 68%)", "filter": "blur(10px)" }}></div>
      <div aria-hidden="true" style={{ "position": "absolute", "left": "140px", "top": "-10px", "width": "200px", "height": "170px", "borderRadius": "50%", "background": "radial-gradient(circle, rgba(251,191,36,.14) 0%, transparent 68%)", "filter": "blur(12px)" }}></div>
      <svg width="480" height="440" viewBox="0 0 480 440" aria-hidden="true" style={{ "position": "absolute", "inset": "0", "overflow": "visible" }}>
      <defs>
      <linearGradient id="tri-code" gradientUnits="userSpaceOnUse" x1="120" y1="288" x2="190" y2="136"><stop offset="0" stopColor="#8B8FE6"></stop><stop offset="1" stopColor="#fbbf24"></stop></linearGradient>
      <marker id="tri-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fbbf24"></path></marker>
      </defs>
      {/* the code path: agents to git, never through NodeSpec */}
      <path d="M120,286 C128,222 158,170 190,136" fill="none" stroke="url(#tri-code)" strokeWidth="3" strokeLinecap="round" markerEnd="url(#tri-arrow)"></path>
      <path d="M120,286 C128,222 158,170 190,136" fill="none" stroke="#fff7e0" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="4 116" style={{ "animation": "lp-flow 1.8s linear infinite" }}></path>
      <circle cx="120" cy="288" r="4.5" fill="#8B8FE6"></circle>
      {/* loose links: NodeSpec to git, NodeSpec to the agents */}
      <path d="M384,288 C374,224 330,170 292,136" fill="none" stroke="rgba(169,172,240,.55)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" style={{ "animation": "lp-flow 6s linear infinite" }}></path>
      <path d="M346,350 C300,370 240,372 188,356" fill="none" stroke="rgba(169,172,240,.55)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" style={{ "animation": "lp-flow 6s linear infinite" }}></path>
      <g fill="#0f1117" stroke="#a9acf0" strokeWidth="1.6"><circle cx="384" cy="288" r="4.5"></circle><circle cx="292" cy="136" r="4.5"></circle><circle cx="346" cy="350" r="4.5"></circle><circle cx="188" cy="356" r="4.5"></circle></g>
      </svg>

      {/* your repository, on top: the source of truth */}
      <span aria-hidden="true" style={{ "position": "absolute", "left": "140px", "top": "24px", "width": "200px", "height": "104px", "boxSizing": "border-box", "borderRadius": "14px", "border": "1.5px solid rgba(251,191,36,.6)", "animation": "lp-halo 3.2s ease-out infinite" }}></span>
      <div style={{ "position": "absolute", "left": "140px", "top": "24px", "width": "200px", "height": "104px", "boxSizing": "border-box", "borderRadius": "14px", "background": "linear-gradient(180deg, #2a2213, #17140d)", "border": "1.5px solid rgba(251,191,36,.75)", "boxShadow": "0 0 0 4px rgba(251,191,36,.08), 0 18px 40px rgba(0,0,0,.4), 0 0 46px rgba(251,191,36,.18)", "padding": "14px 16px", "display": "flex", "flexDirection": "column", "gap": "5px" }}>
      <div style={{ "display": "flex", "alignItems": "center", "gap": "8px" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M6 9v6"></path><circle cx="18" cy="8" r="3"></circle><path d="M18 11v1a4 4 0 0 1-4 4H9"></path></svg><span style={{ "fontSize": "14.5px", "fontWeight": "700", "color": "#fde68a" }}>Your repository</span></div>
      <span style={{ "fontSize": "12px", "color": "#c9b07a" }}>GitHub or GitLab</span>
      <span style={{ "alignSelf": "flex-start", "marginTop": "3px", "fontFamily": "'JetBrains Mono', ui-monospace, monospace", "fontSize": "10.5px", "fontWeight": "700", "letterSpacing": ".06em", "color": "#241b08", "background": "#fbbf24", "padding": "3px 8px", "borderRadius": "999px" }}>SOURCE OF TRUTH</span>
      </div>

      {/* your agents, one or many */}
      <div style={{ "position": "absolute", "left": "0", "top": "292px", "width": "182px", "boxSizing": "border-box", "borderRadius": "14px", "background": "#151823", "border": "1.5px solid rgba(139,143,230,.55)", "boxShadow": "0 18px 40px rgba(0,0,0,.35)", "padding": "12px", "display": "flex", "flexDirection": "column", "gap": "9px" }}>
      <div style={{ "display": "flex", "alignItems": "baseline", "justifyContent": "space-between", "gap": "8px" }}><span style={{ "fontSize": "14px", "fontWeight": "700" }}>Your agents</span><span style={{ "fontSize": "11.5px", "color": "#8a8f9e" }}>one or many</span></div>
      <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "5px" }}>
      <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "5px", "padding": "4px 8px", "borderRadius": "999px", "background": "#1f2333", "border": "1px solid #2f3448", "fontSize": "11.5px", "fontWeight": "600" }}><i style={{ "width": "6px", "height": "6px", "borderRadius": "50%", "background": "#4fc98f" }}></i>Claude Code</span>
      <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "5px", "padding": "4px 8px", "borderRadius": "999px", "background": "#1f2333", "border": "1px solid #2f3448", "fontSize": "11.5px", "fontWeight": "600" }}><i style={{ "width": "6px", "height": "6px", "borderRadius": "50%", "background": "#4fc98f" }}></i>Cursor</span>
      <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "5px", "padding": "4px 8px", "borderRadius": "999px", "background": "#1f2333", "border": "1px solid #2f3448", "fontSize": "11.5px", "fontWeight": "600" }}><i style={{ "width": "6px", "height": "6px", "borderRadius": "50%", "background": "#4fc98f" }}></i>Codex</span>
      <span style={{ "display": "inline-flex", "alignItems": "center", "padding": "4px 8px", "borderRadius": "999px", "border": "1px dashed #3a3f55", "color": "#8a8f9e", "fontSize": "11.5px", "fontWeight": "600" }}>Any MCP client</span>
      </div>
      </div>

      {/* NodeSpec, linked in, not in the way */}
      <div style={{ "position": "absolute", "left": "352px", "top": "292px", "width": "96px", "height": "96px", "boxSizing": "border-box", "borderRadius": "50%", "background": "radial-gradient(circle at 35% 30%, #2a2f4a, #141724)", "border": "1.5px solid rgba(167,139,250,.6)", "boxShadow": "0 0 40px rgba(139,143,230,.35)", "display": "grid", "placeItems": "center" }}><img src={logo} alt="" style={{ "width": "74px", "height": "auto", "filter": "brightness(1.6)" }} /></div>
      <div style={{ "position": "absolute", "left": "330px", "top": "396px", "width": "140px", "display": "flex", "flexDirection": "column", "alignItems": "center", "textAlign": "center" }}><span style={{ "fontSize": "14px", "fontWeight": "700" }}>NodeSpec</span><span style={{ "fontSize": "12px", "color": "#8a8f9e" }}>the model of your system</span></div>


        {/* what moves on each side */}
        <span style={{ "position": "absolute", "left": "10px", "top": "176px", "padding": "5px 10px", "borderRadius": "10px", "background": "rgba(42,34,19,.92)", "border": "1px solid rgba(251,191,36,.45)", "color": "#fde68a", "fontSize": "12px", "fontWeight": "650", "lineHeight": "1.35", "textAlign": "right" }}>Code goes<br />straight to git</span>
        <span style={{ "position": "absolute", "left": "362px", "top": "176px", "padding": "5px 10px", "borderRadius": "10px", "background": "rgba(26,29,38,.92)", "border": "1px dashed rgba(169,172,240,.5)", "color": "#c9cdd8", "fontSize": "12px", "fontWeight": "600", "lineHeight": "1.35" }}>Design files<br />in git</span>
        <span style={{ "position": "absolute", "left": "196px", "top": "300px", "width": "148px", "boxSizing": "border-box", "padding": "5px 10px", "borderRadius": "10px", "background": "rgba(26,29,38,.92)", "border": "1px dashed rgba(169,172,240,.5)", "color": "#c9cdd8", "fontSize": "12px", "fontWeight": "600", "lineHeight": "1.35", "textAlign": "center" }}>Context and proposals<br />over MCP</span>

      </div>
    </div>
  );
}

export function ControlTriangleNarrow() {
  return (
    <div className="lp-tri lp-tri-narrow">
      <div role="img" aria-label="Your agents commit code straight to your repository. NodeSpec links to both loosely: context with your agents over MCP, and its design files in git." style={{ "position": "relative", "width": "350px", "height": "352px", "alignSelf": "center", "marginBottom": "4px" }}>
      <div aria-hidden="true" style={{ "position": "absolute", "left": "70px", "top": "90px", "width": "220px", "height": "200px", "borderRadius": "50%", "background": "radial-gradient(circle, rgba(139,143,230,.16) 0%, transparent 68%)", "filter": "blur(8px)" }}></div>
      <div aria-hidden="true" style={{ "position": "absolute", "left": "100px", "top": "-8px", "width": "150px", "height": "130px", "borderRadius": "50%", "background": "radial-gradient(circle, rgba(251,191,36,.14) 0%, transparent 68%)", "filter": "blur(10px)" }}></div>
      <svg width="350" height="352" viewBox="0 0 350 352" aria-hidden="true" style={{ "position": "absolute", "inset": "0", "overflow": "visible" }}>
      <defs>
      <linearGradient id="mtri-code" gradientUnits="userSpaceOnUse" x1="104" y1="232" x2="152" y2="108"><stop offset="0" stopColor="#8B8FE6"></stop><stop offset="1" stopColor="#fbbf24"></stop></linearGradient>
      <marker id="mtri-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fbbf24"></path></marker>
      </defs>
      <path d="M104,230 C110,180 128,140 152,108" fill="none" stroke="url(#mtri-code)" strokeWidth="3" strokeLinecap="round" markerEnd="url(#mtri-arrow)"></path>
      <path d="M104,230 C110,180 128,140 152,108" fill="none" stroke="#fff7e0" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="4 116" style={{ "animation": "lp-flow 1.8s linear infinite" }}></path>
      <circle cx="104" cy="232" r="4" fill="#8B8FE6"></circle>
      <path d="M278,232 C270,184 236,140 204,108" fill="none" stroke="rgba(169,172,240,.55)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" style={{ "animation": "lp-flow 6s linear infinite" }}></path>
      <path d="M250,288 C222,302 194,304 166,294" fill="none" stroke="rgba(169,172,240,.55)" strokeWidth="2" strokeDasharray="6 6" strokeLinecap="round" style={{ "animation": "lp-flow 6s linear infinite" }}></path>
      <g fill="#0f1117" stroke="#a9acf0" strokeWidth="1.5"><circle cx="278" cy="232" r="4"></circle><circle cx="204" cy="108" r="4"></circle><circle cx="250" cy="288" r="4"></circle><circle cx="166" cy="294" r="4"></circle></g>
      </svg>

      <span aria-hidden="true" style={{ "position": "absolute", "left": "95px", "top": "12px", "width": "160px", "height": "92px", "boxSizing": "border-box", "borderRadius": "12px", "border": "1.5px solid rgba(251,191,36,.6)", "animation": "lp-halo 3.2s ease-out infinite" }}></span>
      <div style={{ "position": "absolute", "left": "95px", "top": "12px", "width": "160px", "height": "92px", "boxSizing": "border-box", "borderRadius": "12px", "background": "linear-gradient(180deg, #2a2213, #17140d)", "border": "1.5px solid rgba(251,191,36,.75)", "boxShadow": "0 0 0 3px rgba(251,191,36,.08), 0 14px 30px rgba(0,0,0,.4), 0 0 36px rgba(251,191,36,.18)", "padding": "11px 12px", "display": "flex", "flexDirection": "column", "gap": "4px" }}>
      <div style={{ "display": "flex", "alignItems": "center", "gap": "7px" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M6 9v6"></path><circle cx="18" cy="8" r="3"></circle><path d="M18 11v1a4 4 0 0 1-4 4H9"></path></svg><span style={{ "fontSize": "13px", "fontWeight": "700", "color": "#fde68a" }}>Your repository</span></div>
      <span style={{ "fontSize": "11px", "color": "#c9b07a" }}>GitHub or GitLab</span>
      <span style={{ "alignSelf": "flex-start", "marginTop": "2px", "fontFamily": "'JetBrains Mono', ui-monospace, monospace", "fontSize": "9.5px", "fontWeight": "700", "letterSpacing": ".06em", "color": "#241b08", "background": "#fbbf24", "padding": "2px 7px", "borderRadius": "999px" }}>SOURCE OF TRUTH</span>
      </div>

      <div style={{ "position": "absolute", "left": "0", "top": "236px", "width": "160px", "boxSizing": "border-box", "borderRadius": "12px", "background": "#151823", "border": "1.5px solid rgba(139,143,230,.55)", "boxShadow": "0 14px 30px rgba(0,0,0,.35)", "padding": "10px", "display": "flex", "flexDirection": "column", "gap": "7px" }}>
      <div style={{ "display": "flex", "alignItems": "baseline", "justifyContent": "space-between", "gap": "6px" }}><span style={{ "fontSize": "13px", "fontWeight": "700" }}>Your agents</span><span style={{ "fontSize": "10.5px", "color": "#8a8f9e" }}>one or many</span></div>
      <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "4px" }}>
      <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "4px", "padding": "3px 7px", "borderRadius": "999px", "background": "#1f2333", "border": "1px solid #2f3448", "fontSize": "10.5px", "fontWeight": "600" }}><i style={{ "width": "5px", "height": "5px", "borderRadius": "50%", "background": "#4fc98f" }}></i>Claude Code</span>
      <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "4px", "padding": "3px 7px", "borderRadius": "999px", "background": "#1f2333", "border": "1px solid #2f3448", "fontSize": "10.5px", "fontWeight": "600" }}><i style={{ "width": "5px", "height": "5px", "borderRadius": "50%", "background": "#4fc98f" }}></i>Cursor</span>
      <span style={{ "display": "inline-flex", "alignItems": "center", "gap": "4px", "padding": "3px 7px", "borderRadius": "999px", "background": "#1f2333", "border": "1px solid #2f3448", "fontSize": "10.5px", "fontWeight": "600" }}><i style={{ "width": "5px", "height": "5px", "borderRadius": "50%", "background": "#4fc98f" }}></i>Codex</span>
      <span style={{ "display": "inline-flex", "alignItems": "center", "padding": "3px 7px", "borderRadius": "999px", "border": "1px dashed #3a3f55", "color": "#8a8f9e", "fontSize": "10.5px", "fontWeight": "600" }}>Any MCP client</span>
      </div>
      </div>

      <div style={{ "position": "absolute", "left": "252px", "top": "238px", "width": "76px", "height": "76px", "boxSizing": "border-box", "borderRadius": "50%", "background": "radial-gradient(circle at 35% 30%, #2a2f4a, #141724)", "border": "1.5px solid rgba(167,139,250,.6)", "boxShadow": "0 0 30px rgba(139,143,230,.35)", "display": "grid", "placeItems": "center" }}><img src={logo} alt="" style={{ "width": "58px", "height": "auto", "filter": "brightness(1.6)" }} /></div>
      <div style={{ "position": "absolute", "left": "236px", "top": "318px", "width": "108px", "display": "flex", "flexDirection": "column", "alignItems": "center", "textAlign": "center", "lineHeight": "1.3" }}><span style={{ "fontSize": "13px", "fontWeight": "700" }}>NodeSpec</span><span style={{ "fontSize": "10.5px", "color": "#8a8f9e" }}>the model of your system</span></div>

      <span style={{ "position": "absolute", "left": "0", "top": "136px", "padding": "4px 8px", "borderRadius": "9px", "background": "rgba(42,34,19,.92)", "border": "1px solid rgba(251,191,36,.45)", "color": "#fde68a", "fontSize": "10.5px", "fontWeight": "650", "lineHeight": "1.35", "textAlign": "right" }}>Code goes<br />straight to git</span>
      <span style={{ "position": "absolute", "left": "262px", "top": "136px", "padding": "4px 8px", "borderRadius": "9px", "background": "rgba(26,29,38,.92)", "border": "1px dashed rgba(169,172,240,.5)", "color": "#c9cdd8", "fontSize": "10.5px", "fontWeight": "600", "lineHeight": "1.35" }}>Design files<br />in git</span>
      <span style={{ "position": "absolute", "left": "170px", "top": "238px", "padding": "4px 8px", "borderRadius": "9px", "background": "rgba(26,29,38,.92)", "border": "1px dashed rgba(169,172,240,.5)", "color": "#c9cdd8", "fontSize": "10.5px", "fontWeight": "600", "lineHeight": "1.35", "textAlign": "center" }}>Context<br />over MCP</span>
      </div>
    </div>
  );
}
