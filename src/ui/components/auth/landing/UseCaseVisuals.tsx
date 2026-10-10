// The little pictures on the Developer use-case cards (owner design 2026-10-07),
// in the order of USE_CASES.developer. Decorative: the card's text says it all.
import type { ReactNode } from 'react';

export const DEVELOPER_VISUALS: ReactNode[] = [
  (
    <div style={{ "background": "linear-gradient(135deg, #eef0fd, #f5f3ff)", "padding": "20px", "display": "flex", "flexDirection": "column", "gap": "10px", "minHeight": "150px", "justifyContent": "center" }}>
    <span style={{ "alignSelf": "flex-start", "fontFamily": "'JetBrains Mono', monospace", "fontSize": "12px", "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "7px", "padding": "5px 9px" }}>github.com/acme/storefront</span>
    <span style={{ "fontSize": "12px", "color": "#4b5563", "paddingLeft": "6px" }}>imported into</span>
    <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "6px" }}><span style={{ "fontSize": "12px", "fontWeight": "600", "background": "#ffffff", "border": "1.5px solid #8b8fe6", "borderRadius": "7px", "padding": "5px 9px" }}>api-gateway</span><span style={{ "fontSize": "12px", "fontWeight": "600", "background": "#ffffff", "border": "1.5px solid #8b8fe6", "borderRadius": "7px", "padding": "5px 9px" }}>orders-service</span><span style={{ "fontSize": "12px", "fontWeight": "600", "background": "#ffffff", "border": "1.5px solid #8b8fe6", "borderRadius": "7px", "padding": "5px 9px" }}>orders-db</span><span style={{ "fontSize": "12px", "color": "#4b5563", "padding": "5px 4px" }}>+ 9 more</span></div>
    </div>
  ),
  (
    <div style={{ "background": "linear-gradient(135deg, #eef0fd, #f5f3ff)", "padding": "20px", "display": "flex", "flexDirection": "column", "gap": "8px", "minHeight": "150px", "justifyContent": "center" }}>
    <div style={{ "display": "flex", "gap": "10px", "alignItems": "center", "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "9px", "padding": "8px 11px", "fontSize": "13px" }}><span style={{ "fontWeight": "700", "color": "#4b50c0", "fontSize": "12px" }}>Set 1</span><span style={{ "fontWeight": "600" }}>payments-db</span><span style={{ "fontSize": "11.5px", "color": "#4b5563", "marginLeft": "auto" }}>schema, migrations</span></div>
    <div style={{ "display": "flex", "gap": "10px", "alignItems": "center", "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "9px", "padding": "8px 11px", "fontSize": "13px" }}><span style={{ "fontWeight": "700", "color": "#4b50c0", "fontSize": "12px" }}>Set 2</span><span style={{ "fontWeight": "600" }}>payments-api</span><span style={{ "fontSize": "11.5px", "color": "#4b5563", "marginLeft": "auto" }}>refund endpoints</span></div>
    <div style={{ "display": "flex", "gap": "10px", "alignItems": "center", "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "9px", "padding": "8px 11px", "fontSize": "13px" }}><span style={{ "fontWeight": "700", "color": "#4b50c0", "fontSize": "12px" }}>Set 3</span><span style={{ "fontWeight": "600" }}>storefront-web</span><span style={{ "fontSize": "11.5px", "color": "#4b5563", "marginLeft": "auto" }}>refund form</span></div>
    </div>
  ),
  (
    <div style={{ "background": "linear-gradient(135deg, #eef0fd, #f5f3ff)", "padding": "20px", "display": "flex", "flexDirection": "column", "gap": "8px", "minHeight": "150px", "justifyContent": "center" }}>
    <div style={{ "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "10px", "padding": "11px 12px", "display": "flex", "flexDirection": "column", "gap": "7px" }}>
    <div style={{ "fontSize": "12px", "color": "#4b5563" }}><b style={{ "color": "#1f2937" }}>claude-code</b> proposes</div>
    <div style={{ "fontSize": "13.5px", "fontWeight": "700" }}>Add refund.created event</div>
    <div style={{ "display": "flex", "flexWrap": "wrap", "gap": "5px", "fontSize": "11.5px" }}><span style={{ "background": "#eeeffc", "color": "#4b50c0", "borderRadius": "999px", "padding": "2px 8px", "fontWeight": "600" }}>payments-api</span><span style={{ "background": "#eeeffc", "color": "#4b50c0", "borderRadius": "999px", "padding": "2px 8px", "fontWeight": "600" }}>payment-events</span><span style={{ "background": "#e7f6ec", "color": "#14773a", "borderRadius": "999px", "padding": "2px 8px", "fontWeight": "600" }}>serves REQ-002</span></div>
    </div>
    </div>
  ),
  (
    <div style={{ "background": "linear-gradient(135deg, #eef0fd, #f5f3ff)", "padding": "20px", "display": "flex", "flexDirection": "column", "gap": "8px", "minHeight": "150px", "justifyContent": "center" }}>
    <div style={{ "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "10px", "padding": "11px 12px", "display": "flex", "flexDirection": "column", "gap": "6px", "fontSize": "12.5px" }}>
    <div style={{ "fontSize": "13.5px", "fontWeight": "700" }}>payments-api <span style={{ "fontWeight": "500", "color": "#4b5563", "fontSize": "12px" }}>backend-service · ecs fargate</span></div>
    <div style={{ "display": "flex", "justifyContent": "space-between", "borderTop": "1px solid #f0f1f5", "paddingTop": "6px" }}><span style={{ "color": "#4b5563" }}>Contracts</span><span style={{ "fontFamily": "'JetBrains Mono', monospace", "fontSize": "11.5px" }}>POST /refunds</span></div>
    <div style={{ "display": "flex", "justifyContent": "space-between" }}><span style={{ "color": "#4b5563" }}>Work here</span><span>REQ-001, REQ-002, REQ-005</span></div>
    <div style={{ "display": "flex", "justifyContent": "space-between" }}><span style={{ "color": "#4b5563" }}>Proven</span><span>7 of 9</span></div>
    </div>
    </div>
  ),
  (
    <div style={{ "background": "linear-gradient(135deg, #eef0fd, #f5f3ff)", "padding": "20px", "display": "flex", "flexDirection": "column", "gap": "7px", "minHeight": "150px", "justifyContent": "center", "fontSize": "13px" }}>
    <div style={{ "display": "flex", "gap": "9px", "alignItems": "center", "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "9px", "padding": "8px 11px" }}><span style={{ "width": "8px", "height": "8px", "borderRadius": "50%", "background": "#15803d" }}></span><span>Refund stays within the charge</span><span style={{ "marginLeft": "auto", "fontFamily": "'JetBrains Mono', monospace", "fontSize": "11px", "color": "#15803d" }}>TC-004</span></div>
    <div style={{ "display": "flex", "gap": "9px", "alignItems": "center", "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "9px", "padding": "8px 11px" }}><span style={{ "width": "8px", "height": "8px", "borderRadius": "50%", "background": "#15803d" }}></span><span>Retrying refunds once</span><span style={{ "marginLeft": "auto", "fontFamily": "'JetBrains Mono', monospace", "fontSize": "11px", "color": "#15803d" }}>a41c88e</span></div>
    <div style={{ "display": "flex", "gap": "9px", "alignItems": "center", "background": "#ffffff", "border": "1px solid #dfe1f3", "borderRadius": "9px", "padding": "8px 11px" }}><span style={{ "width": "8px", "height": "8px", "borderRadius": "50%", "border": "1.5px solid #6b7280", "boxSizing": "border-box" }}></span><span>Day 91 is refused</span><span style={{ "marginLeft": "auto", "fontSize": "11.5px", "color": "#4b50c0" }}>running</span></div>
    </div>
  ),
  (
    <div style={{ "background": "linear-gradient(135deg, #eef0fd, #f5f3ff)", "padding": "20px", "display": "flex", "flexDirection": "column", "gap": "8px", "minHeight": "150px", "justifyContent": "center" }}>
    <div style={{ "background": "#ffffff", "border": "1px solid #f3d9b8", "borderRadius": "10px", "padding": "11px 12px", "display": "flex", "flexDirection": "column", "gap": "6px", "fontSize": "12.5px" }}>
    <div style={{ "fontSize": "12px", "fontWeight": "700", "color": "#b45309" }}>Changed outside NodeSpec</div>
    <div style={{ "fontFamily": "'JetBrains Mono', monospace", "fontSize": "11.5px" }}>7f3a91c · services/ledger/handler.go</div>
    <div style={{ "color": "#4b5563" }}>ledger-worker · <b style={{ "color": "#1f2937" }}>model update proposed</b></div>
    </div>
    </div>
  ),
];
