// W: the Workflows space's stylesheet, carried over from the approved
// mockup (workflow-space.html, v9) and scoped under .ns-ws. X (owner
// 2026-09-23): the space follows the app's light or dark setting. Every
// colour below is a variable; the two blocks at the top set them per mode
// (the root carries data-mode), so the rules are written once. Dark is the
// mockup verbatim; light is the same design on the app's light ground.
import { MONO_FACE } from '../../ideation/typography.js';

const DARK = `
  --ws-ground:radial-gradient(120% 90% at 50% 4%, #141a2e 0%, #0a0c13 56%, #07080d 100%);
  --ws-vignette:inset 0 0 200px 46px rgba(0,0,0,.66);
  --ws-glass:rgba(17,20,31,.82); --ws-glass-line:rgba(255,255,255,.09);
  --ws-text:#E6E9EF; --ws-text-strong:#eef0ff; --ws-text-2:#c3c8e0; --ws-text-3:#9aa2c0; --ws-text-4:#8b93b3; --ws-text-5:#6b7398; --ws-hover-text:#d7dbf0;
  --ws-tint-1:rgba(255,255,255,.028); --ws-tint-2:rgba(255,255,255,.035); --ws-tint-3:rgba(255,255,255,.05); --ws-tint-4:rgba(255,255,255,.07); --ws-tint-5:rgba(255,255,255,.1); --ws-tint-6:rgba(255,255,255,.2);
  --ws-line-1:rgba(255,255,255,.055); --ws-line-2:rgba(255,255,255,.075); --ws-line-3:rgba(255,255,255,.09); --ws-line-4:rgba(255,255,255,.1); --ws-line-5:rgba(255,255,255,.22);
  --ws-accent:#8B8FE6; --ws-accent-on:#fff; --ws-accent-pill:rgba(139,143,230,.9); --ws-accent-bg:rgba(139,143,230,.18); --ws-accent-soft:rgba(139,143,230,.16); --ws-accent-line:rgba(139,143,230,.5); --ws-accent-line-2:rgba(139,143,230,.45); --ws-accent-text:#cdd0f8; --ws-accent-hover:#c7c9f5;
  --ws-bad:#f87171; --ws-bad-bg:rgba(248,113,113,.09); --ws-bad-bg-2:rgba(248,113,113,.12); --ws-bad-line:rgba(248,113,113,.5); --ws-bad-line-2:rgba(248,113,113,.3); --ws-bad-line-3:rgba(248,113,113,.55); --ws-bad-text:#e08b8b; --ws-bad-soft:#f0b3b3; --ws-bad-name:#f9b4b4; --ws-bad-hover:rgba(248,113,113,.3); --ws-bad-hover-text:#ffd4d4;
  --ws-ok:#4ade80; --ws-ok-bg:rgba(74,222,128,.1); --ws-ok-line:rgba(74,222,128,.35); --ws-ok-soft:#a7e6c0;
  --ws-warn:#fbbf24; --ws-warn-line:rgba(251,191,36,.5); --ws-warn-on:#1a1d26;
  --ws-sacts:rgba(20,23,35,.96); --ws-scroll:#3f4458; --ws-strip-scroll:rgba(255,255,255,.14);
  --ws-input:rgba(255,255,255,.05); --ws-input-line:rgba(255,255,255,.1); --ws-input-text:#eef0ff; --ws-placeholder:#5f6784; --ws-option-bg:#1a1d26;
  --ws-toast:#1a1d26; --ws-toast-line:#3f4458; --ws-toast-text:#c9cdd8;
  --ws-avatar-ink:#12151f; --ws-empty-text:#9aa2c0; --ws-empty-strong:#E6E9EF;
`;

const LIGHT = `
  --ws-ground:radial-gradient(120% 90% at 50% 4%, #ffffff 0%, #f3f4f8 56%, #e8eaf1 100%);
  --ws-vignette:inset 0 0 160px 30px rgba(31,41,55,.07);
  --ws-glass:rgba(255,255,255,.86); --ws-glass-line:rgba(31,41,55,.1);
  --ws-text:#1f2937; --ws-text-strong:#111827; --ws-text-2:#374151; --ws-text-3:#4b5563; --ws-text-4:#5b6475; --ws-text-5:#6b7280; --ws-hover-text:#111827;
  --ws-tint-1:rgba(31,41,55,.025); --ws-tint-2:rgba(31,41,55,.03); --ws-tint-3:rgba(31,41,55,.04); --ws-tint-4:rgba(31,41,55,.06); --ws-tint-5:rgba(31,41,55,.08); --ws-tint-6:rgba(31,41,55,.14);
  --ws-line-1:rgba(31,41,55,.08); --ws-line-2:rgba(31,41,55,.1); --ws-line-3:rgba(31,41,55,.12); --ws-line-4:rgba(31,41,55,.14); --ws-line-5:rgba(31,41,55,.26);
  --ws-accent:#5a5fd0; --ws-accent-on:#fff; --ws-accent-pill:#6f73db; --ws-accent-bg:rgba(111,115,219,.12); --ws-accent-soft:rgba(111,115,219,.1); --ws-accent-line:rgba(90,95,208,.45); --ws-accent-line-2:rgba(90,95,208,.4); --ws-accent-text:#4b4fb8; --ws-accent-hover:#4b4fb8;
  --ws-bad:#a93b43; --ws-bad-bg:rgba(169,59,67,.06); --ws-bad-bg-2:rgba(169,59,67,.09); --ws-bad-line:rgba(169,59,67,.45); --ws-bad-line-2:rgba(169,59,67,.3); --ws-bad-line-3:rgba(169,59,67,.45); --ws-bad-text:#a93b43; --ws-bad-soft:#8f3038; --ws-bad-name:#a93b43; --ws-bad-hover:rgba(169,59,67,.14); --ws-bad-hover-text:#7f2a31;
  --ws-ok:#1f7d52; --ws-ok-bg:rgba(31,125,82,.07); --ws-ok-line:rgba(31,125,82,.3); --ws-ok-soft:#1f6b47;
  --ws-warn:#8a5a12; --ws-warn-line:rgba(138,90,18,.45); --ws-warn-on:#fff;
  --ws-sacts:rgba(255,255,255,.97); --ws-scroll:#d1d5db; --ws-strip-scroll:rgba(31,41,55,.18);
  --ws-input:#ffffff; --ws-input-line:rgba(31,41,55,.16); --ws-input-text:#111827; --ws-placeholder:#9ca3af; --ws-option-bg:#ffffff;
  --ws-toast:#ffffff; --ws-toast-line:#e5e7eb; --ws-toast-text:#374151;
  --ws-avatar-ink:#12151f; --ws-empty-text:#4b5563; --ws-empty-strong:#111827;
`;

export const SPACE_CSS = `
.ns-ws[data-mode="dark"]{${DARK}}
.ns-ws[data-mode="light"]{${LIGHT}}
.ns-ws{position:relative;flex:1;min-height:560px;border-radius:14px;overflow:hidden;isolation:isolate;
  background:var(--ws-ground);color:var(--ws-text);font-size:13px;--mono:${MONO_FACE}}
.ns-ws[data-mode="light"]{border:1px solid var(--ws-line-2)}
.ns-ws [hidden]{display:none!important}
.ns-ws button{font-family:inherit;cursor:pointer}
.ns-ws .b{transition:background .14s,border-color .14s,color .14s}
.ns-ws :focus-visible{outline:2px solid var(--ws-accent);outline-offset:2px;border-radius:6px}
.ns-ws-scene{position:absolute;inset:0;z-index:0}
.ns-ws-vignette{position:absolute;inset:0;z-index:1;pointer-events:none;box-shadow:var(--ws-vignette)}
.ns-ws .glass{background:var(--ws-glass);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--ws-glass-line)}
.ns-ws[data-mode="light"] .glass{box-shadow:0 1px 2px rgba(31,41,55,.04),0 4px 16px rgba(31,41,55,.06)}
.ns-ws .scroll::-webkit-scrollbar{width:7px;height:7px}
.ns-ws .scroll::-webkit-scrollbar-thumb{background:var(--ws-scroll);border-radius:4px}
.ns-ws-top{position:absolute;top:12px;left:0;right:0;z-index:8;display:flex;flex-direction:column;align-items:center;gap:7px;padding:0 14px;pointer-events:none}
.ns-ws-top > *{pointer-events:auto;max-width:100%}
.ns-ws .pills{display:flex;gap:3px;padding:4px;border-radius:12px}
.ns-ws .pills button{border:none;border-radius:9px;padding:7px 15px;font-size:11.5px;font-weight:650;background:transparent;color:var(--ws-text-3);white-space:nowrap}
.ns-ws .pills button:hover{color:var(--ws-hover-text)}
.ns-ws .pills button[aria-pressed="true"]{background:var(--ws-accent-pill);color:var(--ws-accent-on)}
.ns-ws .pills.small{align-items:center;gap:4px;flex-wrap:wrap;justify-content:center}
.ns-ws .pills.small button{padding:6px 10px;font-size:11px;display:flex;align-items:center;gap:6px}
.ns-ws .pills input{background:var(--ws-tint-4);border:1px solid var(--ws-accent-line);border-radius:7px;padding:5px 8px;color:var(--ws-input-text);font:inherit;font-size:11px;font-weight:650;width:150px}
.ns-ws .pills input:focus{outline:none}
.ns-ws .av{width:15px;height:15px;border-radius:50%;font-size:7px;font-weight:700;color:var(--ws-avatar-ink);display:grid;place-items:center;flex-shrink:0}
.ns-ws .addpill{width:24px;height:24px;border-radius:8px;border:1px dashed var(--ws-line-5);background:transparent;color:var(--ws-text-3);font-size:13px;line-height:1;flex-shrink:0;padding:0!important;justify-content:center}
.ns-ws .rmpill{width:20px;height:20px;border-radius:7px;border:none;background:var(--ws-tint-5);color:var(--ws-text-3);font-size:12px;line-height:1;flex-shrink:0;padding:0!important;justify-content:center;margin-left:-2px}
.ns-ws .rmpill:hover{background:var(--ws-bad-hover);color:var(--ws-bad-hover-text)}
.ns-ws-hint{font-size:11px;font-weight:500;color:var(--ws-text-5);text-align:center}
.ns-ws-strip{display:flex;align-items:stretch;gap:7px;padding:7px;border-radius:14px;overflow-x:auto}
.ns-ws-strip::-webkit-scrollbar{height:6px}
.ns-ws-strip::-webkit-scrollbar-thumb{background:var(--ws-strip-scroll);border-radius:3px}
.ns-ws .sbox{position:relative;flex-shrink:0;width:190px;text-align:left;display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:11px;background:var(--ws-tint-2);border:1px solid var(--ws-line-2);color:var(--ws-text-2)}
.ns-ws .sbox:hover{background:var(--ws-tint-4)}
.ns-ws .sbox[aria-pressed="true"]{background:var(--ws-accent-bg);border-color:var(--ws-accent-line)}
.ns-ws .sbox .r1{display:flex;align-items:center;gap:6px}
.ns-ws .sbox .num{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--ws-text-5);flex-shrink:0}
.ns-ws .sbox .nm{flex:1;min-width:0;font-size:12.5px;font-weight:650;letter-spacing:-.005em;color:var(--ws-text-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-ws .sbox .chain{display:flex;gap:3px}
.ns-ws .sbox .chain i{flex:1;height:3px;border-radius:2px;background:var(--ws-tint-5)}
.ns-ws .sbox .lbl{font-size:11px;font-weight:500;color:var(--ws-text-4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-ws .sbox.loud{border-color:var(--ws-bad-line-3);background:var(--ws-bad-bg)}
.ns-ws .sbox.loud .nm{color:var(--ws-bad-name)}
.ns-ws .sacts{position:absolute;bottom:4px;right:4px;display:flex;gap:2px;opacity:0;transition:opacity .12s;background:linear-gradient(90deg,transparent,var(--ws-sacts) 20%);padding-left:16px;border-radius:7px}
.ns-ws .sbox:hover .sacts,.ns-ws .sbox:focus-within .sacts{opacity:1}
.ns-ws .sacts button{width:18px;height:18px;border-radius:6px;border:none;background:var(--ws-tint-5);color:var(--ws-text-3);font-size:10px;line-height:1;padding:0}
.ns-ws .sacts button:hover{background:var(--ws-tint-6);color:var(--ws-text-strong)}
.ns-ws .sacts button.rm:hover{background:var(--ws-bad-hover);color:var(--ws-bad-hover-text)}
.ns-ws .sbox input.nm{background:var(--ws-tint-4);border:1px solid var(--ws-accent-line);border-radius:5px;padding:1px 4px;font-family:inherit;font-size:12.5px;font-weight:650;color:var(--ws-input-text);width:100%;min-width:0}
.ns-ws .sbox input.nm:focus{outline:none}
.ns-ws .addbox{flex-shrink:0;width:54px;border-radius:11px;border:1px dashed var(--ws-line-5);background:transparent;color:var(--ws-text-3);font-size:17px;line-height:1;display:grid;place-items:center}
.ns-ws .addbox:hover{border-color:var(--ws-accent-line);color:var(--ws-accent-hover)}
.ns-ws .addbox.wide{width:156px;padding:8px 9px;display:flex;align-items:center;border-color:var(--ws-accent-line)}
.ns-ws .addbox.wide input{width:100%;background:transparent;border:none;color:var(--ws-input-text);font-family:inherit;font-size:12.5px;font-weight:650}
.ns-ws .addbox.wide input:focus{outline:none}
.ns-ws .dotlive{width:7px;height:7px;border-radius:50%;background:var(--ws-ok);flex-shrink:0}
.ns-ws-insp{position:absolute;right:14px;top:200px;z-index:7;width:300px;border-radius:13px;overflow:hidden;max-height:calc(100% - 234px);display:flex;flex-direction:column}
.ns-ws-insp .cap{height:3px;flex-shrink:0}
.ns-ws-insp .ibody{padding:13px;overflow-y:auto}
.ns-ws .ihead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.ns-ws .eyebrow{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;line-height:1.2}
.ns-ws .ix{width:22px;height:22px;border-radius:6px;border:1px solid var(--ws-line-3);background:var(--ws-tint-3);color:var(--ws-text-4);font-size:12px;line-height:1;flex-shrink:0;padding:0}
.ns-ws .ititle{font-size:15px;font-weight:650;line-height:1.3;color:var(--ws-text-strong);margin:0 0 6px;text-wrap:balance}
.ns-ws .inote{font-size:12.5px;font-weight:450;line-height:1.55;color:var(--ws-text-4);margin:0 0 12px}
.ns-ws .chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.ns-ws .chip{font-size:11.5px;font-weight:500;padding:4px 8px;border-radius:6px;border:1px solid var(--ws-line-3);background:var(--ws-tint-3);color:var(--ws-text-2)}
.ns-ws .sec{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ws-text-5);margin:0 0 7px}
.ns-ws .lnk{width:100%;text-align:left;display:flex;align-items:center;gap:8px;padding:7px 9px;margin-bottom:4px;border-radius:8px;border:1px solid var(--ws-line-1);background:var(--ws-tint-1);color:var(--ws-text-2)}
.ns-ws .lnk:hover{background:var(--ws-tint-4)}
.ns-ws .lnk:disabled{opacity:.5;cursor:default}
.ns-ws .lnk .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.ns-ws .lnk .t{flex:1;min-width:0;font-size:11.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ns-ws .lnk .g{font-family:var(--mono);font-size:11px;font-weight:700;flex-shrink:0}
.ns-ws .crit{display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--ws-line-1);font-size:11.5px;line-height:1.5;color:var(--ws-text-2)}
.ns-ws .crit .tick{font-size:11px;flex-shrink:0;margin-top:1px;font-weight:700}
.ns-ws .crit .bind{font-family:var(--mono);font-size:11px;font-weight:700;color:var(--ws-text-5);flex-shrink:0;margin-left:auto}
.ns-ws .crit .sub{color:var(--ws-text-5);font-size:11px}
.ns-ws .kv{display:flex;align-items:baseline;gap:10px;padding:6px 0;border-bottom:1px solid var(--ws-line-1)}
.ns-ws .kv .k{width:78px;flex-shrink:0;font-size:11px;font-weight:500;color:var(--ws-text-5)}
.ns-ws .kv .v{flex:1;min-width:0;font-family:var(--mono);font-size:11px;font-weight:700;color:var(--ws-text-2);overflow-wrap:anywhere}
.ns-ws .kv .v.plain{font-family:inherit;font-weight:500;font-size:11.5px}
.ns-ws .fixit{width:100%;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px;border-radius:9px;font-size:11.5px;font-weight:600;margin-top:12px;border:1px solid var(--ws-accent-line-2);background:var(--ws-accent-soft);color:var(--ws-accent-text)}
.ns-ws .fixit.quiet{border-color:var(--ws-line-4);background:var(--ws-tint-3);color:var(--ws-text-3);margin-top:14px}
.ns-ws .fixit.danger{border-color:var(--ws-bad-line-2);background:transparent;color:var(--ws-bad-text);margin-top:6px}
.ns-ws .fixit.danger:hover{background:var(--ws-bad-bg-2)}
.ns-ws .fixit:disabled{opacity:.55;cursor:default}
.ns-ws .deadend{padding:10px 11px;border-radius:9px;margin:2px 0 12px;font-size:11.5px;line-height:1.5;border:1px dashed var(--ws-bad-line);background:var(--ws-bad-bg);color:var(--ws-bad-soft)}
.ns-ws .deadend b{color:var(--ws-bad);font-weight:700}
.ns-ws .covered{padding:10px 11px;border-radius:9px;margin:10px 0 0;font-size:11.5px;line-height:1.5;border:1px solid var(--ws-ok-line);background:var(--ws-ok-bg);color:var(--ws-ok-soft)}
.ns-ws .covered b{color:var(--ws-ok);font-weight:700}
.ns-ws .attrib{display:flex;align-items:center;gap:7px;padding:7px 9px;border-radius:8px;background:var(--ws-tint-2);border:1px solid var(--ws-line-1);margin-bottom:12px;font-size:11.5px;color:var(--ws-text-2)}
.ns-ws .attrib.warn{border-color:var(--ws-bad-line-2)}
.ns-ws .attrib .ix.bad{color:var(--ws-bad-text)}
.ns-ws .fld{display:block;margin-bottom:10px}
.ns-ws .fld > span{display:block;font-size:11px;font-weight:600;color:var(--ws-text-4);margin-bottom:5px}
.ns-ws .fld input,.ns-ws .fld textarea,.ns-ws .fld select{width:100%;box-sizing:border-box;background:var(--ws-input);border:1px solid var(--ws-input-line);border-radius:8px;padding:8px 9px;color:var(--ws-input-text);font-size:12px;font-family:inherit;line-height:1.5;resize:vertical}
.ns-ws .fld select option{background:var(--ws-option-bg);color:var(--ws-input-text)}
.ns-ws .fld input:focus,.ns-ws .fld textarea:focus,.ns-ws .fld select:focus{outline:none;border-color:var(--ws-accent-line)}
.ns-ws .fld textarea::placeholder,.ns-ws .fld input::placeholder{color:var(--ws-placeholder)}
.ns-ws .formacts{display:flex;gap:7px;margin-top:13px}
.ns-ws .formacts button{padding:9px 12px;border-radius:8px;font-size:11.5px;font-weight:650;white-space:nowrap}
.ns-ws .formacts .save{flex:1.6;border:none;background:var(--ws-accent-pill);color:var(--ws-accent-on)}
.ns-ws .formacts .cancel{flex:1;border:1px solid var(--ws-line-4);background:var(--ws-tint-3);color:var(--ws-text-3)}
.ns-ws-empty{position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);z-index:5;padding:14px 18px;border-radius:12px;font-size:12.5px;line-height:1.55;color:var(--ws-empty-text);text-align:center;max-width:360px}
.ns-ws-empty b{color:var(--ws-empty-strong);font-weight:650}
.ns-ws-toast{position:absolute;left:50%;transform:translateX(-50%);bottom:28px;z-index:14;border-radius:9px;padding:9px 13px;font-size:11.5px;font-weight:500;background:var(--ws-toast);border:1px solid var(--ws-toast-line);color:var(--ws-toast-text);display:flex;align-items:center;gap:8px;max-width:calc(100% - 28px)}
.ns-ws-toast.warn{border-color:var(--ws-warn-line)}
.ns-ws-toast.warn .dotlive{background:var(--ws-warn)}
@media (max-width:980px){ .ns-ws-insp{width:264px} }
@media (max-width:700px){
  .ns-ws-insp{left:14px;right:14px;width:auto;top:auto;bottom:18px;max-height:44%}
  .ns-ws .sbox{width:150px}
}
@media (prefers-reduced-motion:reduce){ .ns-ws *{transition:none!important} }
`;
