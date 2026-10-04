// W (owner 2026-09-23): the Workflows space's 3D scene, ported from the
// approved mockup (workflow-space.html, v9) onto three.js. Imperative by
// nature: WorkflowsSpace mounts it into a div, hands it the model, and
// hears back what was picked. Only this module and its lazy parent import
// three, so the library ships in its own chunk and loads with the tab.
//
// What the mockup settled, kept here:
//   - a column per stage, its head ABOVE it (number in a ring toned by the
//     stage's state, then the name), so what you add to a stage appears
//     directly under the thing you clicked; an empty stage shows a dashed
//     "Add an outcome" slot where the outcome will land
//   - one flat plane per workflow; a stage's outcomes sit side by side, each
//     with its requirements fanned beneath; columns are as wide as they hold
//   - connectors are thin tubes (a GL line is one device pixel and reads as
//     a dark hairline), a smooth S from the parent's bottom port to the
//     child's top port, coloured from the parent's hue to the child's;
//     dashed where the chain is missing a link
//   - draw order, whatever the angle: every connector first, then every
//     card; a connector can pass behind a card, never across its face
//   - selecting anything keeps its own line at full strength and quiets the
//     rest; the camera settles on it
//   - the other workflows stand behind, faint, and a click on one's name
//     brings it forward
//   - the Constraints lens: a column per layer, its constraints stacked
//     under the layer's head, no connectors (a constraint has no chain)
import * as THREE from 'three';
import { MONO_FACE } from '../../ideation/typography.js';
import {
  BANDS, OUT_WORD, hues, toneOf, layerColor, outcomeEyebrow, alsoLine, reqAlsoLine,
  type SpaceJourney, type SpaceLayer, type SpaceStage, type SpaceMode, type SpaceHues,
} from './space-model.js';

export type ScenePick =
  | { kind: 'step'; stepId: string }
  | { kind: 'addout'; stepId: string }
  | { kind: 'outcome'; stepId: string; outcomeId: string }
  | { kind: 'req' | 'node' | 'artifact'; stepId: string; outcomeId: string; reqId: string }
  | { kind: 'wf'; wfId: string }
  | { kind: 'layer'; ctype: string }
  | { kind: 'constraint'; id: string };

/** What is selected, as the scene focuses it. */
export type SceneFocus =
  | { kind: 'step'; stepId: string }
  | { kind: 'outcome'; stepId: string; outcomeId: string }
  | { kind: 'req' | 'node' | 'artifact'; stepId: string; outcomeId: string; reqId: string }
  | { kind: 'layer'; ctype: string }
  | { kind: 'constraint'; id: string; ctype: string }
  | null;

export interface SceneModel {
  lens: 'journey' | 'layer';
  /** The workflow in front. */
  focused: SpaceJourney | null;
  /** The others, in order, standing behind. */
  ghosts: SpaceJourney[];
  layers: SpaceLayer[];
  /** Workflow id → name, for a constraint's scope line. */
  laneNames: ReadonlyMap<string, { name: string; color: string }>;
  team: boolean;
  /** X: the app's light or dark setting; the whole scene follows it. */
  mode: SpaceMode;
  /** AJ.6: false in the example below Workflows: an empty stage offers nothing to add. */
  editable?: boolean;
}

export interface SceneHandle {
  setModel(model: SceneModel): void;
  setFocus(focus: SceneFocus): void;
  /** Move the camera onto the selection (a head frames its column). */
  settle(focus: SceneFocus): void;
  /** Back to the home view of the whole plane. */
  home(): void;
  /** Look back at the middle of the plane, keeping the angle. */
  recenter(): void;
  dispose(): void;
}

type TraceKey = { stepId?: string; outcomeId?: string; reqId?: string; ctype?: string; id?: string } | null;

interface Traced { obj: THREE.Object3D & { material: THREE.Material }; key: TraceKey; base: number; line: boolean }

// ── layout, verbatim from the mockup ─────────────────────────────────────────
const CARD_W = 512, CARD_H = 168, PORT_PAD = 14;
const HEAD_W = 6.1, HEAD_FACE = 120;
const COL_MIN = 9.4, COL_PAD = 2.8, SUB_W = 4.5, SUB_GAP = 0.6, OUT_GAP = 0.9, Y_HEAD = 12.0;
const STEP_GAP = 10, Z_BACK = -34, LINK_R = 0.05;
const HOME_Y = 6.4;
const HOME = { r: 48, theta: 0.38, phi: 1.26 };
const RO = { line: 1, card: 3 };

/** X (owner 2026-09-23): what the scene paints, per mode. Dark is the
 *  mockup verbatim; light is the same design on the app's light ground:
 *  white cards with a hairline edge, ink text, deeper hues, a pale fog so
 *  the workflows behind fade into the ground rather than into black. */
interface ScenePalette {
  fog: number;
  cardFill: string; ghostFill: string; cardEdge: string; title: string; ghostTitle: string; muted: string;
  headFill: string; headEdge: string; headRing: string; headNum: string; headName: string;
  portFill: string; stageInk: string; ghostLabel: string; gapEdge: string;
  /** How strongly a card's own hue edges it, and how solid a connector draws. */
  edgeAlpha: number; linkAlpha: number; bandAlpha: number; ghostBar: number;
}
const SCENE_PALETTE: Record<SpaceMode, ScenePalette> = {
  dark: {
    fog: 0x0a0c13,
    cardFill: 'rgba(26,29,38,0.97)', ghostFill: 'rgba(22,25,34,0.78)', cardEdge: 'rgba(255,255,255,0.16)', title: '#E6E9EF', ghostTitle: '#c3c8e0', muted: '#8a8f9e',
    headFill: 'rgba(32,36,50,0.97)', headEdge: 'rgba(255,255,255,0.18)', headRing: 'rgba(255,255,255,0.06)', headNum: '#E6E9EF', headName: '#EEF0FF',
    portFill: '#12151d', stageInk: '#9aa2c0', ghostLabel: '#c9cdd8', gapEdge: 'rgba(139,147,179,0.5)',
    edgeAlpha: 0.42, linkAlpha: 0.62, bandAlpha: 0.6, ghostBar: 0.16,
  },
  light: {
    fog: 0xeef0f5,
    cardFill: 'rgba(255,255,255,0.98)', ghostFill: 'rgba(250,251,253,0.9)', cardEdge: 'rgba(31,41,55,0.16)', title: '#1f2937', ghostTitle: '#4b5563', muted: '#6b7280',
    headFill: 'rgba(255,255,255,0.99)', headEdge: 'rgba(31,41,55,0.18)', headRing: 'rgba(31,41,55,0.05)', headNum: '#1f2937', headName: '#111827',
    portFill: '#ffffff', stageInk: '#8b93ad', ghostLabel: '#4b5563', gapEdge: 'rgba(107,115,144,0.55)',
    edgeAlpha: 0.5, linkAlpha: 0.78, bandAlpha: 0.85, ghostBar: 0.12,
  },
};

/** "#rrggbb" at an alpha, for a card's edge in its own hue. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const MONO = MONO_FACE;
const UI = 'Inter, system-ui, sans-serif';

const cardH = (w: number) => (w * CARD_H) / CARD_W;
const headH = () => (HEAD_W * HEAD_FACE) / CARD_W;
const outW = (k: number) => (k > 1 ? 5.2 : 6.1);
const lane = (reqCount: number, k: number) => Math.max(outW(k), reqCount > 1 ? reqCount * SUB_W + (reqCount - 1) * SUB_GAP : 0);
const subX = (j: number, m: number) => (m <= 1 ? 0 : (j - (m - 1) / 2) * (SUB_W + SUB_GAP));

export function colWidth(stage: Pick<SpaceStage, 'outcomes'>): number {
  const k = stage.outcomes.length;
  const inner = stage.outcomes.reduce((a, o) => a + lane(o.reqs.length, k), 0) + Math.max(k - 1, 0) * OUT_GAP;
  return Math.max(COL_MIN, inner + COL_PAD);
}
/** Column centres and widths for a workflow, centred on 0. */
export function columns(j: Pick<SpaceJourney, 'stages'>): Array<{ x: number; w: number }> {
  const ws = j.stages.map(colWidth);
  let x = -ws.reduce((a, b) => a + b, 0) / 2;
  return ws.map((w) => { const c = x + w / 2; x += w; return { x: c, w }; });
}
/** x of each outcome under a stage centred on x. */
export function laneXs(stage: Pick<SpaceStage, 'outcomes'>, x: number): number[] {
  const k = stage.outcomes.length;
  const ws = stage.outcomes.map((o) => lane(o.reqs.length, k));
  let at = x - (ws.reduce((a, b) => a + b, 0) + Math.max(k - 1, 0) * OUT_GAP) / 2;
  return ws.map((w) => { const c = at + w / 2; at += w + OUT_GAP; return c; });
}

/** Whether a traced thing belongs to the selection's own line. */
export function focusMatch(k: TraceKey, d: SceneFocus): boolean {
  if (!d || !k) return true;
  if (d.kind === 'layer') return k.ctype === d.ctype;
  if (d.kind === 'constraint') return k.id != null ? k.id === d.id : k.ctype === d.ctype;
  if (k.stepId == null) return true;
  if (k.stepId !== d.stepId) return false;
  if (d.kind === 'step' || k.outcomeId == null) return true;
  if (k.outcomeId !== d.outcomeId) return false;
  if (d.kind === 'outcome' || k.reqId == null) return true;
  return k.reqId === d.reqId;
}

// ── canvas drawing ───────────────────────────────────────────────────────────
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrapTxt(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number, maxLines: number) {
  const words = String(text).split(' ');
  let line = ''; const lines: string[] = [];
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  lines.forEach((l, i) => g.fillText(l, x, y + i * lh));
}
function clipTxt(g: CanvasRenderingContext2D, s: string, max: number) {
  let t = s;
  while (g.measureText(`${t}…`).width > max && t.length > 1) t = t.slice(0, -1);
  return t.length < s.length ? `${t}…` : s;
}
function portDot(g: CanvasRenderingContext2D, x: number, y: number, color: string, fill: string) {
  g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
  g.lineWidth = 4; g.strokeStyle = color; g.stroke();
}

interface CardSpec {
  eyebrow: string; title: string; accent: string; border?: string; dashed?: boolean; ghost?: boolean;
  state?: string | null; stateColor?: string; sub?: string | null; w?: number;
  portTop?: string | null; portBottom?: string | null;
}

export function createSpaceScene(host: HTMLElement, onPick: (p: ScenePick | null) => void): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
  renderer.domElement.style.display = 'block';
  renderer.domElement.setAttribute('data-testid', 'space-canvas');
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(SCENE_PALETTE.dark.fog, 46, 118);
  scene.fog = fog;
  // The palette and the hues of the mode the model was last built in.
  let P: ScenePalette = SCENE_PALETTE.dark;
  let C: SpaceHues = hues('dark');
  const camera = new THREE.PerspectiveCamera(44, (host.clientWidth || 1) / (host.clientHeight || 1), 0.1, 400);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));

  let groups: THREE.Group[] = [];
  let pickable: THREE.Sprite[] = [];
  let traced: Traced[] = [];
  let disposables: Array<{ dispose(): void }> = [];
  let model: SceneModel | null = null;
  let focus: SceneFocus = null;
  let focusedGroupZ = 0;

  const tgt = { x: 0, y: HOME_Y, z: 0, tx: 0, ty: HOME_Y, tz: 0 };
  const orb = { r: HOME.r, theta: HOME.theta, phi: HOME.phi, tr: HOME.r, tth: HOME.theta, tph: HOME.phi };

  const own = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };
  const trace = <T extends THREE.Object3D & { material: THREE.Material }>(obj: T, key: TraceKey, base = 1, line = false): T => {
    traced.push({ obj, key, base, line }); return obj;
  };
  const texture = (cv: HTMLCanvasElement) => {
    const t = own(new THREE.CanvasTexture(cv));
    t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  };

  function cardTexture(o: CardSpec) {
    const W = CARD_W, H = CARD_H, pad = 20;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H + PORT_PAD * 2;
    const g = cv.getContext('2d')!;
    g.translate(0, PORT_PAD);
    rr(g, 3, 3, W - 6, H - 6, 22); g.fillStyle = o.ghost ? P.ghostFill : P.cardFill; g.fill();
    g.lineWidth = o.dashed ? 5 : 3; g.strokeStyle = o.border ?? P.cardEdge;
    if (o.dashed) g.setLineDash([16, 11]);
    g.stroke(); g.setLineDash([]);
    rr(g, 3, 3, 9, H - 6, 5); g.fillStyle = o.accent; g.fill();
    g.font = `700 20px ${MONO}`; g.fillStyle = o.accent; g.textBaseline = 'top';
    g.fillText(o.eyebrow, pad + 12, pad);
    if (o.state) {
      g.font = `650 19px ${UI}`; g.textAlign = 'right';
      g.fillStyle = o.stateColor ?? P.muted; g.fillText(o.state, W - pad - 4, pad + 1); g.textAlign = 'left';
    }
    g.font = `650 27px ${UI}`; g.fillStyle = o.ghost ? P.ghostTitle : P.title;
    wrapTxt(g, o.title, pad + 12, pad + 38, W - pad * 2 - 20, 33, 2);
    if (o.sub) { g.font = `700 20px ${MONO}`; g.fillStyle = P.muted; g.fillText(clipTxt(g, o.sub, W - pad * 2 - 20), pad + 12, H - pad - 20); }
    if (o.portTop) portDot(g, W / 2, 3, o.portTop, P.portFill);
    if (o.portBottom) portDot(g, W / 2, H - 3, o.portBottom, P.portFill);
    return texture(cv);
  }

  function makeCard(o: CardSpec, pos: THREE.Vector3, pick: ScenePick | null, key: TraceKey) {
    const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: cardTexture(o), transparent: true, depthWrite: false })));
    const w = o.w ?? 6.1;
    sp.scale.set(w, (w * (CARD_H + PORT_PAD * 2)) / CARD_W, 1); sp.position.copy(pos);
    sp.userData = { pick }; sp.renderOrder = RO.card;
    trace(sp, key);
    if (pick) pickable.push(sp);
    return sp;
  }

  function textSprite(text: string, color: string, size: number, opacity: number, align: CanvasTextAlign = 'center') {
    const W = 512, H = 96, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!;
    g.font = `700 ${size}px ${UI}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'middle';
    g.fillText(text, align === 'right' ? W - 6 : W / 2, H / 2);
    const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: texture(cv), transparent: true, opacity, depthWrite: false })));
    sp.scale.set(7.2, 1.35, 1); sp.renderOrder = RO.card;
    return sp;
  }

  /** A column's head: its number in a ring toned by the column's state, then its name. */
  function columnHead(num: number, name: string, tone: string, port: boolean) {
    const W = CARD_W, H = HEAD_FACE, cv = document.createElement('canvas'); cv.width = W; cv.height = H + PORT_PAD * 2;
    const g = cv.getContext('2d')!;
    g.translate(0, PORT_PAD);
    rr(g, 3, 3, W - 6, H - 6, 26); g.fillStyle = P.headFill; g.fill();
    g.lineWidth = 3; g.strokeStyle = P.headEdge; g.stroke();
    g.beginPath(); g.arc(58, H / 2, 27, 0, Math.PI * 2); g.fillStyle = P.headRing; g.fill();
    g.lineWidth = 5; g.strokeStyle = tone; g.stroke();
    g.font = `700 26px ${MONO}`; g.fillStyle = P.headNum; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), 58, H / 2 + 1);
    g.textAlign = 'left'; g.font = `650 34px ${UI}`; g.fillStyle = P.headName;
    g.fillText(clipTxt(g, name, W - 110 - 28), 106, H / 2 + 1);
    if (port) portDot(g, W / 2, H - 3, P.stageInk, P.portFill);
    const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: texture(cv), transparent: true, depthWrite: false })));
    sp.scale.set(HEAD_W, (HEAD_W * (H + PORT_PAD * 2)) / W, 1); sp.renderOrder = RO.card;
    return sp;
  }

  function dashRanges(curve: THREE.Curve<THREE.Vector3>, dash: number, gap: number): Array<[number, number]> {
    const L = curve.getLength(); const out: Array<[number, number]> = [];
    for (let at = 0; at < L; at += dash + gap) out.push([at / L, Math.min(at + dash, L) / L]);
    return out;
  }

  /** A connector from one card's bottom port to the next card's top port. */
  function link(a: THREE.Vector3, b: THREE.Vector3, from: string, to: string, base: number, key: TraceKey, dashed = false) {
    const dy = Math.max(Math.abs(a.y - b.y) * 0.55, 0.9);
    const curve = new THREE.CubicBezierCurve3(a, new THREE.Vector3(a.x, a.y - dy, a.z), new THREE.Vector3(b.x, b.y + dy, b.z), b);
    const ca = new THREE.Color(from), cb = new THREE.Color(to), c = new THREE.Color();
    const g = new THREE.Group();
    const ranges: Array<[number, number]> = dashed ? dashRanges(curve, 0.42, 0.3) : [[0, 1]];
    for (const r of ranges) {
      const part = dashed
        ? new THREE.CatmullRomCurve3([curve.getPointAt(r[0]), curve.getPointAt((r[0] + r[1]) / 2), curve.getPointAt(r[1])])
        : curve;
      const seg = dashed ? 4 : 48, rad = 8;
      const geo = own(new THREE.TubeGeometry(part, seg, LINK_R, rad, false));
      const n = geo.attributes.position.count; const col = new Float32Array(n * 3);
      for (let i = 0; i <= seg; i++) {
        c.copy(ca).lerp(cb, r[0] + (r[1] - r[0]) * (i / seg));
        for (let j = 0; j <= rad; j++) {
          const v = (i * (rad + 1) + j) * 3;
          if (v + 2 < col.length) { col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b; }
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(geo, own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: base, depthWrite: false })));
      m.renderOrder = RO.line;
      trace(m, key, base, true);
      g.add(m);
    }
    return g;
  }

  function buildFocused(j: SpaceJourney, team: boolean) {
    const g = new THREE.Group();
    const cols = columns(j);
    const left = cols.length ? cols[0].x - cols[0].w / 2 : 0;
    for (const b of BANDS) {
      const bandHue = C[({ outcome: 'outcome', req: 'requirement', node: 'node', artifact: 'artifact' } as const)[b.key]];
      const lab = textSprite(b.label, bandHue, 24, P.bandAlpha, 'right'); lab.scale.set(6.2, 1.16, 1);
      lab.position.set(left - 0.4 - 3.1, b.y, 0);
      trace(lab, null, P.bandAlpha); g.add(lab);
    }
    j.stages.forEach((s, i) => {
      const x = cols[i].x, K = s.outcomes.length;
      const hd = columnHead(i + 1, s.name, toneOf(s.state, model!.mode), true);
      hd.position.set(x, Y_HEAD, 0); hd.userData = { pick: { kind: 'step', stepId: s.id } satisfies ScenePick };
      pickable.push(hd); trace(hd, { stepId: s.id }); g.add(hd);
      const from = new THREE.Vector3(x, Y_HEAD - headH() / 2, 0);
      const H6 = cardH(6.1) / 2;

      if (!K) {
        // the empty slot sits where the outcome will, and adds it
        g.add(link(from, new THREE.Vector3(x, BANDS[0].y + H6, 0), P.stageInk, C.gap, P.linkAlpha * 0.9, { stepId: s.id }, true));
        const adds = model!.editable !== false;
        g.add(makeCard({ eyebrow: 'OUTCOME', title: adds ? 'Add an outcome' : 'No outcome yet', accent: C.gap, ghost: true, dashed: true, border: P.gapEdge, state: 'none yet', stateColor: C.gap, portTop: C.gap },
          new THREE.Vector3(x, BANDS[0].y, 0), adds ? { kind: 'addout', stepId: s.id } : { kind: 'step', stepId: s.id }, { stepId: s.id }));
        return;
      }

      const xs = laneXs(s, x), ow = outW(K), OH = cardH(ow) / 2;
      s.outcomes.forEach((o, k) => {
        const ox = xs[k], ok = { stepId: s.id, outcomeId: o.id };
        const oTop = new THREE.Vector3(ox, BANDS[0].y + OH, 0), oBot = new THREE.Vector3(ox, BANDS[0].y - OH, 0);
        g.add(link(from, oTop, P.stageInk, C.outcome, P.linkAlpha, ok));
        const m = o.reqs.length, tone = toneOf(o.state, model!.mode);
        g.add(makeCard({
          eyebrow: outcomeEyebrow(o, team), title: o.name, accent: C.outcome,
          border: o.state === 'unimpl' ? withAlpha(C.bad, 0.85) : withAlpha(C.outcome, P.edgeAlpha),
          dashed: o.state === 'unimpl', state: OUT_WORD[o.state], stateColor: tone,
          sub: alsoLine(o), w: ow,
          portTop: C.outcome, portBottom: m ? C.outcome : C.bad,
        }, new THREE.Vector3(ox, BANDS[0].y, 0), { kind: 'outcome', stepId: s.id, outcomeId: o.id }, ok));

        if (!m) {
          // the missing link, drawn where the requirement would be
          g.add(link(oBot, new THREE.Vector3(ox, BANDS[1].y + OH, 0), C.bad, C.bad, Math.min(1, P.linkAlpha + 0.18), ok, true));
          g.add(makeCard({ eyebrow: 'REQUIREMENT', title: 'Nothing builds this', accent: C.bad, ghost: true, dashed: true, border: withAlpha(C.bad, 0.6), portTop: C.bad, w: ow },
            new THREE.Vector3(ox, BANDS[1].y, 0), { kind: 'outcome', stepId: s.id, outcomeId: o.id }, ok));
          return;
        }

        o.reqs.forEach((r, jx) => {
          const rx = ox + subX(jx, m), sc = m > 1 ? SUB_W : ow, hh = cardH(sc) / 2;
          const rk = { stepId: s.id, outcomeId: o.id, reqId: r.id };
          const pick = (kind: 'req' | 'node' | 'artifact'): ScenePick => ({ kind, stepId: s.id, outcomeId: o.id, reqId: r.id });
          g.add(link(oBot, new THREE.Vector3(rx, BANDS[1].y + hh, 0), C.outcome, C.requirement, P.linkAlpha, rk));
          g.add(makeCard({
            eyebrow: r.ref, title: r.name, accent: C.requirement, border: withAlpha(C.requirement, P.edgeAlpha),
            sub: r.locked ? 'locked' : r.confirmed ? 'confirmed' : 'open', w: sc,
            // AL.13: a requirement shared with other outcomes says so
            state: reqAlsoLine(r), stateColor: withAlpha(C.outcome, 0.9),
            portTop: C.requirement, portBottom: r.node || r.artifact ? C.requirement : null,
          }, new THREE.Vector3(rx, BANDS[1].y, 0), pick('req'), rk));
          let above: { y: number; color: string } = { y: BANDS[1].y, color: C.requirement };
          if (r.node) {
            const dn = r.node.tasks.filter((t) => t.done).length;
            g.add(link(new THREE.Vector3(rx, above.y - hh, 0), new THREE.Vector3(rx, BANDS[2].y + hh, 0), above.color, C.node, P.linkAlpha, rk));
            g.add(makeCard({
              eyebrow: 'ARCHITECTURE', title: r.node.label, sub: r.node.tech || null, accent: C.node, border: withAlpha(C.node, P.edgeAlpha),
              state: `${dn}/${r.node.tasks.length} tasks`, stateColor: dn === r.node.tasks.length ? C.proven : C.open, w: sc,
              portTop: C.node, portBottom: r.artifact ? C.node : null,
            }, new THREE.Vector3(rx, BANDS[2].y, 0), pick('node'), rk));
            above = { y: BANDS[2].y, color: C.node };
          }
          if (r.artifact) {
            g.add(link(new THREE.Vector3(rx, above.y - hh, 0), new THREE.Vector3(rx, BANDS[3].y + hh, 0), above.color, C.artifact, P.linkAlpha, rk));
            g.add(makeCard({
              eyebrow: 'CODE', title: r.artifact.file, sub: r.artifact.dir || null, accent: C.artifact, border: withAlpha(C.artifact, P.edgeAlpha),
              state: r.artifact.sha, stateColor: C.artifact, w: sc, portTop: C.artifact,
            }, new THREE.Vector3(rx, BANDS[3].y, 0), pick('artifact'), rk));
          }
        });
      });
    });
    return g;
  }

  function buildGhost(j: SpaceJourney, depth: number) {
    const g = new THREE.Group();
    const cols = columns(j), op = depth === 1 ? 0.3 : 0.16;
    const nm = textSprite(j.name, j.color, 30, op + 0.25);
    nm.scale.set(11, 1.6, 1); nm.position.set((cols[0]?.x ?? 0) - (cols[0]?.w ?? 0) / 2 - 3.4, Y_HEAD, 0);
    nm.userData = { pick: { kind: 'wf', wfId: j.id } satisfies ScenePick }; pickable.push(nm); g.add(nm);
    j.stages.forEach((s, i) => {
      const bar = new THREE.Mesh(own(new THREE.BoxGeometry(cols[i].w - 2.6, 22.4, 0.08)),
        own(new THREE.MeshBasicMaterial({ color: new THREE.Color(j.color), transparent: true, opacity: op * P.ghostBar, depthWrite: false })));
      bar.position.set(cols[i].x, 1.4, -0.6); g.add(bar);
      const lab = textSprite(s.name, P.ghostLabel, 26, op + 0.3);
      lab.scale.set(5.6, 1.05, 1); lab.position.set(cols[i].x, Y_HEAD, 0); g.add(lab);
    });
    return g;
  }

  function buildLayers(layers: SpaceLayer[], names: SceneModel['laneNames']) {
    const g = new THREE.Group();
    const n = layers.length;
    layers.forEach(({ layer, rows }, i) => {
      const x = (i - (n - 1) / 2) * STEP_GAP;
      const hue = layerColor(layer, model!.mode);
      const hd = columnHead(i + 1, layer.label, hue, false);
      hd.position.set(x, Y_HEAD, 0); hd.userData = { pick: { kind: 'layer', ctype: layer.ctype } satisfies ScenePick };
      pickable.push(hd); trace(hd, { ctype: layer.ctype }); g.add(hd);
      rows.forEach((c, jx) => {
        const scoped = c.workflow_id ? names.get(c.workflow_id) ?? null : null;
        g.add(makeCard({
          eyebrow: layer.eyebrow, title: c.title || c.description, accent: hue, border: P.cardEdge,
          sub: scoped ? `only ${scoped.name}` : 'the whole project',
          state: scoped ? 'workflow' : 'global', stateColor: scoped ? scoped.color : P.muted,
        }, new THREE.Vector3(x, BANDS[0].y - jx * 4.2, 0), { kind: 'constraint', id: c.id }, { ctype: layer.ctype, id: c.id }));
      });
    });
    return g;
  }

  function clear() {
    for (const g of groups) scene.remove(g);
    for (const d of disposables) d.dispose();
    groups = []; pickable = []; traced = []; disposables = [];
  }

  function build() {
    clear();
    if (!model) return;
    P = SCENE_PALETTE[model.mode];
    C = hues(model.mode);
    fog.color.set(P.fog);
    if (model.lens === 'layer') {
      const lg = buildLayers(model.layers, model.laneNames); groups.push(lg); scene.add(lg);
      focusedGroupZ = 0;
    } else {
      if (model.focused) {
        const order = [model.focused, ...model.ghosts];
        order.forEach((j, depth) => {
          const g = depth === 0 ? buildFocused(j, model!.team) : buildGhost(j, depth);
          g.position.z = depth * Z_BACK; groups.push(g); scene.add(g);
        });
      }
      focusedGroupZ = 0;
    }
    applyFocus();
  }

  function applyFocus() {
    for (const t of traced) {
      const f = focusMatch(t.key, focus) ? 1 : t.line ? 0.2 : 0.3;
      t.obj.material.opacity = t.base * f;
    }
  }

  function lookAt(p: { x: number; y: number; z: number }) { tgt.tx = p.x; tgt.ty = p.y; tgt.tz = p.z; }
  function home() { lookAt({ x: 0, y: HOME_Y, z: 0 }); orb.tth = HOME.theta; orb.tph = HOME.phi; orb.tr = HOME.r; }

  /** Where the camera settles for a picked thing: a column head frames its
   *  whole column, anything else sits a little low of centre (the strip and
   *  the lens pills cover the top of the canvas). */
  function settleOn(o: THREE.Object3D) {
    const pick = (o.userData as { pick?: ScenePick }).pick;
    const head = pick?.kind === 'step' || pick?.kind === 'layer';
    lookAt({ x: o.position.x, y: head ? HOME_Y : o.position.y + 3, z: o.position.z + focusedGroupZ });
    const cap = head ? 40 : 34;
    if (orb.tr > cap) orb.tr = cap;
  }

  function matchesFocus(p: ScenePick | undefined, d: SceneFocus): boolean {
    if (!p || !d) return false;
    if (d.kind === 'layer') return p.kind === 'layer' && p.ctype === d.ctype;
    if (d.kind === 'constraint') return p.kind === 'constraint' && p.id === d.id;
    if (p.kind !== d.kind) return false;
    if (d.kind === 'step') return (p as { stepId: string }).stepId === d.stepId;
    if (d.kind === 'outcome') return (p as { outcomeId: string }).outcomeId === d.outcomeId && (p as { stepId: string }).stepId === d.stepId;
    return (p as { reqId: string; outcomeId: string }).reqId === d.reqId && (p as { outcomeId: string }).outcomeId === d.outcomeId;
  }

  // ── pointer: orbit, wheel, hover, pick ──────────────────────────────────────
  const el = renderer.domElement;
  el.style.cursor = 'grab';
  el.style.touchAction = 'none';
  let down = false, lx = 0, ly = 0, moved = 0;
  function hitAt(e: PointerEvent) {
    const r = el.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1; pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickable, false);
  }
  const onDown = (e: PointerEvent) => { down = true; moved = 0; lx = e.clientX; ly = e.clientY; el.style.cursor = 'grabbing'; try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ } };
  const onMove = (e: PointerEvent) => {
    if (!down) { el.style.cursor = hitAt(e).length ? 'pointer' : 'grab'; return; }
    const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    orb.tth -= dx * 0.005; orb.tph = Math.max(0.55, Math.min(2.05, orb.tph - dy * 0.004));
  };
  const onUp = (e: PointerEvent) => {
    down = false; el.style.cursor = 'grab';
    if (moved >= 6) return;
    const hit = hitAt(e);
    if (!hit.length) { onPick(null); return; }
    const o = hit[0].object;
    const pick = (o.userData as { pick?: ScenePick }).pick ?? null;
    onPick(pick);
    if (pick && pick.kind !== 'wf') settleOn(o);
  };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); orb.tr = Math.max(16, Math.min(92, orb.tr + e.deltaY * 0.045)); };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });

  const resize = () => {
    const w = Math.max(host.clientWidth, 1), h = Math.max(host.clientHeight, 1);
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  window.addEventListener('resize', resize);

  let raf = 0;
  const animate = () => {
    raf = requestAnimationFrame(animate);
    orb.r += (orb.tr - orb.r) * 0.09; orb.theta += (orb.tth - orb.theta) * 0.11; orb.phi += (orb.tph - orb.phi) * 0.11;
    tgt.x += (tgt.tx - tgt.x) * 0.1; tgt.y += (tgt.ty - tgt.y) * 0.1; tgt.z += (tgt.tz - tgt.z) * 0.1;
    camera.position.set(
      tgt.x + orb.r * Math.sin(orb.phi) * Math.sin(orb.theta),
      tgt.y + orb.r * Math.cos(orb.phi),
      tgt.z + orb.r * Math.sin(orb.phi) * Math.cos(orb.theta),
    );
    camera.lookAt(tgt.x, tgt.y, tgt.z);
    if (!document.hidden) renderer.render(scene, camera);
  };
  animate();

  return {
    setModel(next) { model = next; build(); },
    setFocus(next) { focus = next; applyFocus(); },
    settle(d) {
      const hit = pickable.find((p) => matchesFocus((p.userData as { pick?: ScenePick }).pick, d));
      if (hit) settleOn(hit);
    },
    home,
    recenter() { lookAt({ x: 0, y: HOME_Y, z: 0 }); },
    dispose() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', onWheel);
      clear();
      renderer.dispose();
      el.remove();
    },
  };
}
