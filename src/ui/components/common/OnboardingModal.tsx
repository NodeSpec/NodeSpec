import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { useMcpConnection } from '../../hooks/useMcpConnection.js';
import { buildEdition } from '../../config/edition.js';
import { connectLaneFor } from './agent-connect.js';
import { mcpServerUrl } from '../../services/agent-connections.js';
import type { FeatureGate } from '../../hooks/useFeatureGate.js';
import type { ThemeColors } from '../../theme/index.js';
import {
  ChevronRight, ListChecks, Network, Lightbulb, FileText, Code, FlaskConical, GitCommitHorizontal,
} from 'lucide-react';
import {
  walkthroughStops, placeCard, WALKTHROUGH_LOOP,
  type Rect, type WalkthroughItem, type WalkthroughSurface,
} from './walkthrough.js';

// The walkthrough (owner 2026-09-30, over the 2026-08-13 five-step modal):
// one tour of the whole product in the order a project runs. The welcome,
// the AI connection and the start are cards in the middle of the window;
// every other stop switches the app to the surface it explains (Work and its
// tabs, Architecture) and spotlights the real control, with the card beside
// it. The stops come from walkthrough.ts, filtered by the project's plan, so
// nothing a plan does not carry is ever described. Connecting stays first
// and never blocks (owner 2026-08-29). The spotlight is a cutout: the dim is
// the ring's giant shadow, so the control itself stays at full brightness.
//
// AK.2 (owner 2026-10-01): connecting one agent and setting what it may do
// come right after the welcome, in the Agents panel itself (Connected, then
// Autonomy). Those stops are interactive: clicks reach the panel, the card
// says when the agent has called, and typing in the panel never moves the
// tour.

interface OnboardingModalProps {
  onClose: () => void;
  /** A new account's first run: the last button starts the project. */
  firstRun?: boolean;
  /** The project's plan (decision 1). Absent or loading: only what every plan carries. */
  featureGate?: FeatureGate;
  /** Switch the app to the surface a stop explains. */
  onSurface?: (surface: WalkthroughSurface) => void;
  /** AJ.6: over the account's example, the last button starts the account's
   *  own project (skipping, Escape and the close button only close). */
  onCreateProject?: () => void;
}

const CENTRED = new Set(['welcome', 'finish']);
const CARD_WIDTH = 380;
const LOOP_ICONS = [Lightbulb, ListChecks, Network, FileText, Code, FlaskConical, GitCommitHorizontal];
const LOOP_TINTS = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

const anchorEl = (anchor: string) => document.querySelector(`[data-tour="${anchor}"]`);

function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
}

export function OnboardingModal({ onClose, firstRun = false, featureGate, onSurface, onCreateProject }: OnboardingModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const ready = !!featureGate && !featureGate.loading;
  const can = (f: Parameters<FeatureGate['can']>[0]) => ready && featureGate!.can(f);
  const example = ready && !!featureGate!.example;
  const viewOnly = (f: Parameters<FeatureGate['can']>[0]) => example && !!featureGate!.viewOnly?.(f);
  const stops = useMemo(
    () => walkthroughStops({
      workflows: can('workflow_space'), plan: can('priority_board'), repoImport: can('repo_import'), team: can('team_lanes'),
      example,
      viewOnly: { workflows: viewOnly('workflow_space'), plan: viewOnly('priority_board'), repoImport: viewOnly('repo_import'), team: viewOnly('team_lanes') },
      connect: connectLaneFor(buildEdition, mcpServerUrl()),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, featureGate],
  );
  const [index, setIndex] = useState(0);
  const stop = stops[Math.min(index, stops.length - 1)];
  const last = index >= stops.length - 1;
  // The connect stop says when the agent has called: the header's own
  // evidence (has_mcp_connection), asked often while the person connects.
  const mcp = useMcpConnection();
  const mcpConnected = mcp.state === 'connected';
  useEffect(() => {
    if (stop.id !== 'connect' || mcpConnected) return;
    const t = window.setInterval(mcp.refresh, 5000);
    return () => window.clearInterval(t);
  }, [stop.id, mcpConnected, mcp.refresh]);

  // A list stop spotlights one of its controls at a time; controls this
  // build does not draw drop out.
  const [items, setItems] = useState<WalkthroughItem[]>([]);
  const [itemAnchor, setItemAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (!stop.items) { setItems([]); setItemAnchor(null); return; }
    const present = stop.items.filter((i) => anchorEl(i.anchor));
    setItems(present);
    setItemAnchor(present[0]?.anchor ?? null);
  }, [stop]);

  // Take the app to the stop's surface before spotlighting it.
  const surfaceKey = stop.surface ? JSON.stringify(stop.surface) : '';
  useEffect(() => {
    if (stop.surface) onSurface?.(stop.surface);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop.id, surfaceKey]);

  // The anchor is measured until it settles: a surface the stop just opened
  // (a lazily loaded tab) draws after this renders.
  const anchor = stop.items ? itemAnchor : stop.anchor ?? null;
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!anchor) { setAnchorRect(null); return; }
    const measure = () => {
      const next = rectOf(anchorEl(anchor));
      setAnchorRect((prev) => (prev && next && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const timer = window.setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => { window.clearInterval(timer); window.removeEventListener('resize', measure); };
  }, [anchor]);

  // Over the example the last button is the account's own project.
  const createsProject = example && !!onCreateProject;
  const next = useCallback(() => {
    if (!last) { setIndex((i) => i + 1); return; }
    if (createsProject) onCreateProject!(); else onClose();
  }, [last, onClose, createsProject, onCreateProject]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in a panel the tour left open (a key's name) is not navigation.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, next, back]);

  const centred = CENTRED.has(stop.id);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(260);
  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight || 260);
  }, [stop.id, items.length, anchorRect]);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const phone = viewport.width < 640;
  const place = centred ? null : placeCard(anchorRect, { width: CARD_WIDTH, height: cardHeight }, viewport);

  // A control stop dims the rest; a surface stop only rings its surface.
  const dim = !anchorRect ? 0 : stop.focus === 'surface' ? 0 : 0.55;
  const buttonLabel = last ? (createsProject ? 'Create your own project' : firstRun ? 'Start my project' : 'Done') : stop.id === 'connect' && !mcpConnected ? 'Connect later' : 'Next';

  const body = (
    <>
      {stop.body.map((p) => (
        <p key={p} style={{ fontSize: centred ? '13.5px' : '13px', color: c.textSecondary, lineHeight: 1.65, margin: '0 0 10px' }}>{p}</p>
      ))}
      {stop.id === 'welcome' && <Loop isDark={isDark} c={c} />}
      {stop.id === 'connect' && (
        <div
          data-testid="walkthrough-connect-status"
          data-connected={mcpConnected ? 'true' : 'false'}
          style={{
            fontSize: '12.5px', fontWeight: 600, padding: '8px 12px', borderRadius: '8px',
            border: `1px solid ${mcpConnected ? '#15803d' : c.border}`,
            backgroundColor: mcpConnected ? 'rgba(21,128,61,0.1)' : 'transparent',
            color: mcpConnected ? '#15803d' : c.textMuted,
          }}
        >
          {mcpConnected ? 'Your agent has called NodeSpec. Next, set what it may do.' : 'Waiting for your agent\'s first call.'}
        </div>
      )}
      {stop.items && <ItemList c={c} items={items} active={itemAnchor} onSelect={setItemAnchor} />}
    </>
  );

  return (
    <div
      data-testid="walkthrough"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        // Clicks never fall through to the app mid-tour, and never close it
        // by accident, except on a stop that asks the person to act there.
        pointerEvents: stop.interactive ? 'none' : undefined,
        backgroundColor: !anchorRect && centred ? 'rgba(0, 0, 0, 0.6)' : 'transparent',
        backdropFilter: !anchorRect && centred ? 'blur(4px)' : undefined,
        display: centred ? 'flex' : 'block', alignItems: 'center', justifyContent: 'center',
        animation: 'onboardFadeIn 0.2s ease-out',
      }}
    >
      {anchorRect && (
        <div
          data-testid="walkthrough-spotlight"
          data-anchor={anchor ?? ''}
          style={{
            position: 'fixed', pointerEvents: 'none', zIndex: 1,
            top: anchorRect.top - 6, left: anchorRect.left - 6, width: anchorRect.width + 12, height: anchorRect.height + 12,
            borderRadius: '12px', border: `2px solid ${c.primary}`,
            boxShadow: `0 0 0 4px ${c.primary}40, 0 0 18px ${c.primary}80${dim ? `, 0 0 0 9999px rgba(0, 0, 0, ${dim})` : ''}`,
            animation: stop.focus === 'surface' ? undefined : stop.id === 'connect' ? 'onboardPulse 2s ease-in-out 3' : 'onboardPulse 1.6s ease-in-out infinite',
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="walkthrough-title"
        data-testid="walkthrough-card"
        data-stop={stop.id}
        style={{
          backgroundColor: c.surface, border: `1px solid ${c.border}`, borderRadius: centred ? '16px' : '12px',
          boxShadow: isDark ? '0 24px 48px rgba(0, 0, 0, 0.6)' : '0 24px 48px rgba(0, 0, 0, 0.2)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 2, pointerEvents: 'auto',
          ...(centred
            ? { position: 'relative', width: phone ? 'calc(100% - 24px)' : '90%', maxWidth: '680px', maxHeight: '88vh', animation: 'onboardSlideUp 0.3s ease-out' }
            : { position: 'fixed', top: place!.top, left: place!.left, width: place!.width, maxHeight: `calc(100vh - 32px)` }),
        }}
      >
        <div style={{ padding: centred && !phone ? '24px 28px 0' : '16px 18px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: c.primary, marginBottom: '6px' }}>
              {stop.chapter} · {index + 1} of {stops.length}
            </div>
            <div id="walkthrough-title" style={{ fontSize: centred ? '22px' : '17px', fontWeight: 700, color: c.text, lineHeight: 1.2 }}>
              {stop.title}
            </div>
          </div>
          <button
            aria-label="Close the walkthrough"
            style={{ background: 'none', border: 'none', fontSize: '20px', color: c.textMuted, cursor: 'pointer', padding: '4px 8px', marginTop: '-4px' }}
            onClick={onClose}
          >
            x
          </button>
        </div>

        <div style={{ padding: centred && !phone ? '16px 28px 20px' : '12px 18px 14px', overflowY: 'auto', flex: 1 }}>
          {body}
        </div>

        <div style={{ padding: centred && !phone ? '16px 28px 20px' : '12px 18px 14px', borderTop: `1px solid ${c.border}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {centred && !phone && (
              <div style={{ display: 'flex', gap: '5px' }} aria-hidden="true">
                {stops.map((s, i) => (
                  <div key={s.id} style={{ width: i === index ? '20px' : '7px', height: '7px', borderRadius: '4px', backgroundColor: i === index ? c.primary : c.border, transition: 'all 0.3s ease' }} />
                ))}
              </div>
            )}
            {!last && (
              <button
                style={{ background: 'none', border: 'none', color: c.textMuted, fontSize: '12.5px', cursor: 'pointer', padding: 0 }}
                onClick={onClose}
              >
                Skip tour
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {index > 0 && (
              <button
                style={{ padding: '9px 16px', backgroundColor: 'transparent', border: `1px solid ${c.border}`, borderRadius: '8px', color: c.text, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                onClick={back}
              >
                Back
              </button>
            )}
            <button
              style={{ padding: '9px 20px', backgroundColor: c.primary, border: 'none', borderRadius: '8px', color: '#ffffff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={next}
            >
              {buttonLabel}
              {!last && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes onboardFadeIn { from { opacity: 0; } to { opacity: 1; } }
          @keyframes onboardSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes onboardPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.06); opacity: 0.75; } }
        `}
      </style>
    </div>
  );
}

/** The loop every project runs, stage by stage. */
function Loop({ isDark, c }: { isDark: boolean; c: ThemeColors }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: '4px' }}>
      {WALKTHROUGH_LOOP.map((s, i) => {
        const Icon = LOOP_ICONS[i] ?? Lightbulb;
        const tint = LOOP_TINTS[i] ?? c.primary;
        return (
          <div key={s.label} style={{ display: 'flex', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0, backgroundColor: tint + (isDark ? '22' : '16'), color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={14} />
              </div>
              {i < WALKTHROUGH_LOOP.length - 1 && <div style={{ width: '2px', flex: 1, minHeight: '8px', backgroundColor: c.border }} />}
            </div>
            <div style={{ paddingBottom: i < WALKTHROUGH_LOOP.length - 1 ? '10px' : 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: c.text, lineHeight: '28px' }}>{s.label}</div>
              <div style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.5, marginTop: '-4px' }}>{s.text}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A list of controls; the one clicked lights up where it lives. */
function ItemList({ c, items, active, onSelect }: { c: ThemeColors; items: WalkthroughItem[]; active: string | null; onSelect: (anchor: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map((item) => {
        const on = item.anchor === active;
        return (
          <button
            key={item.anchor}
            aria-pressed={on}
            onClick={() => onSelect(item.anchor)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', padding: '9px 11px', borderRadius: '9px',
              border: `1.5px solid ${on ? c.primary : c.border}`, backgroundColor: on ? `${c.primary}14` : 'transparent',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 600, color: on ? c.primary : c.text }}>{item.title}</div>
            <div style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.5, marginTop: '2px' }}>{item.text}</div>
          </button>
        );
      })}
    </div>
  );
}

