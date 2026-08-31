import { useState, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';
import { MCPConnectStep } from './MCPConnectStep.js';
import type { ThemeColors } from '../../theme/index.js';
import {
  GitBranch, ChevronRight, FileUp, ListChecks, Network, Bot,
  Lightbulb, FileText, Code, FlaskConical, GitCommitHorizontal, MousePointerClick,
} from 'lucide-react';

// Owner walkthrough ruling 2026-08-13 (amended 2026-08-29): five steps, MCP
// connection FIRST but never a gate — the 2026-08-11 hold-until-connected
// behavior trapped users who wanted to look around first, so every step now
// navigates freely and connecting stays encouraged, not enforced.
//   1. Connect your AI (skippable; the header spotlight shows where it lives)
//   2. Connect a repository (recommended) — or document export + git later
//   3. The loop: vision → requirements → architecture → tasks → code →
//      tests → git provenance
//   4. Build it your way: by hand on the canvas, or through your AI over MCP
//   5. Know your header — each header control spotlighted and explained
// The spotlight is a true CUTOUT: the dimming layer is a giant box-shadow
// around the ring, so the highlighted control stays at full brightness
// instead of fading behind the backdrop (owner bug 2026-08-29).

interface OnboardingModalProps {
  onClose: () => void;
  /** First-run mode: nudges copy (final CTA) — no step ever blocks. */
  gateOnMcp?: boolean;
}

// Header tour targets (step 5). Anchored by [data-tour] attributes on the
// live TopBar controls; items whose control is absent in this build (edition
// gating, no repo connected) are filtered out at runtime.
const HEADER_TOUR_ITEMS: Array<{ key: string; title: string; text: string }> = [
  { key: 'mcp', title: 'MCP connection', text: 'Live status of your AI’s link — "MCP connected" the moment it works. Click it for connection instructions.' },
  { key: 'skills', title: 'Skills', text: 'Instructions your AI reads to learn the NodeSpec workflow. Copy one into your assistant, or download it as a .md file.' },
  { key: 'templates', title: 'Browse Templates', text: 'Start a project from a published architecture instead of a blank canvas.' },
  { key: 'changes', title: 'Changes', text: 'Proposals from your AI wait here for your review — nothing applies itself.' },
  { key: 'git', title: 'Git', text: 'Connect a repository: accepted changes commit with provenance, and outside commits surface as reviewable drift.' },
  { key: 'notifications', title: 'Notifications', text: 'Proposal activity, test results, and sync events as they happen.' },
  { key: 'account', title: 'Account', text: 'Your plan, profile, and integrations.' },
  { key: 'help', title: 'Help', text: 'Terminology, guides — and this walkthrough, any time you want it back.' },
];

export function OnboardingModal({ onClose, gateOnMcp = false }: OnboardingModalProps) {
  const { theme } = useTheme();
  const c = theme.colors;
  const isDark = theme.mode === 'dark';
  const [currentStep, setCurrentStep] = useState(0);
  const [mcpConnected, setMcpConnected] = useState(false);
  // Header tour (step 5): which header control is currently spotlighted, and
  // which controls exist in this build (edition gating trims some).
  const [tourKey, setTourKey] = useState<string | null>(null);
  const [tourItems, setTourItems] = useState<typeof HEADER_TOUR_ITEMS>([]);
  const TOUR_STEP = 4;
  useEffect(() => {
    if (currentStep !== TOUR_STEP) { setTourKey(null); return; }
    const available = HEADER_TOUR_ITEMS.filter((item) =>
      document.querySelector(`[data-tour="${item.key}"]`));
    setTourItems(available);
    setTourKey(available[0]?.key ?? null);
  }, [currentStep]);

  // Header callout (owner 2026-08-14): while the MCP step or the header tour
  // shows, spotlight the live header control so the user knows where the
  // thing LIVES after the walkthrough closes. Measured from the real element;
  // absent anchor (unexpected) simply renders no callout.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const selector = currentStep === 0
      ? '#nodespec-mcp-header-anchor'
      : currentStep === TOUR_STEP && tourKey
        ? `[data-tour="${tourKey}"]`
        : null;
    if (!selector) { setAnchorRect(null); return; }
    const measure = () => {
      const el = document.querySelector(selector);
      setAnchorRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [currentStep, tourKey]);

  const steps = [
    {
      title: 'Connect Your AI',
      subtitle: 'One connection powers everything that follows',
      content: <MCPConnectStep isDark={isDark} c={c as unknown as Record<string, string>} onConnectedChange={setMcpConnected} />,
    },
    {
      title: 'Connect a Repository',
      subtitle: 'Recommended — or export documents and add git later',
      content: <StepRepoConnection isDark={isDark} c={c} />,
    },
    {
      title: 'From Vision to Verified Code',
      subtitle: 'The loop every project runs',
      content: <StepTheLoop isDark={isDark} c={c} />,
    },
    {
      title: 'Build It Your Way',
      subtitle: 'By hand on the canvas, or through your AI',
      content: <StepBuildYourWay isDark={isDark} c={c} />,
    },
    {
      title: 'Know Your Header',
      subtitle: 'Every control, spotlighted where it lives',
      content: (
        <StepHeaderTour
          c={c}
          items={tourItems}
          activeKey={tourKey}
          onSelect={setTourKey}
        />
      ),
    },
  ];

  const step = steps[currentStep];
  // No gate (owner amendment 2026-08-29): the old hold-until-connected
  // behavior trapped first-run users behind the MCP step. Navigation is
  // always free; connecting stays step 1 and stays encouraged.

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        // While a header control is spotlighted, the dimming moves into the
        // ring's giant box-shadow CUTOUT below, so the control itself stays
        // at full brightness instead of fading behind this backdrop
        // (owner bug 2026-08-29). The blur is off then for the same reason.
        backgroundColor: anchorRect ? 'transparent' : 'rgba(0, 0, 0, 0.6)',
        backdropFilter: anchorRect ? undefined : 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        animation: 'onboardFadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      {anchorRect && (
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
          {/* spotlight ring; its outer 9999px shadow IS the dimming layer,
              leaving a clear window over the live control. On the connect
              step the modal is the main content, so the dim stays LIGHT and
              the pulse settles after three beats (owner 2026-09-02: the
              infinite pulse at 0.6 dim was overwhelming and darkened the
              popup); the header tour keeps the stronger focus dim. */}
          <div style={{
            position: 'fixed',
            top: anchorRect.top - 6,
            left: anchorRect.left - 6,
            width: anchorRect.width + 12,
            height: anchorRect.height + 12,
            borderRadius: '12px',
            border: `2px solid ${c.primary}`,
            boxShadow: `0 0 0 4px ${c.primary}40, 0 0 18px ${c.primary}80, 0 0 0 9999px rgba(0, 0, 0, ${currentStep === 0 ? 0.28 : 0.6})`,
            animation: currentStep === 0
              ? 'onboardPulse 2s ease-in-out 3'
              : 'onboardPulse 1.6s ease-in-out infinite',
          }} />
          {/* label under the ring */}
          <div style={{
            position: 'fixed',
            top: anchorRect.bottom + 14,
            left: Math.max(12, anchorRect.right - 260),
            width: '260px',
            backgroundColor: c.surface,
            border: `1px solid ${c.primary}`,
            borderRadius: '10px',
            padding: '10px 12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: c.text, marginBottom: '3px' }}>
              {currentStep === 0
                ? 'Your connection lives here'
                : HEADER_TOUR_ITEMS.find((i) => i.key === tourKey)?.title}
            </div>
            <div style={{ fontSize: '11.5px', color: c.textMuted, lineHeight: 1.5 }}>
              {currentStep === 0
                ? 'This turns to "MCP connected" the moment your AI links up — check it any time. The Skills button beside it holds instructions you can copy or download for your AI.'
                : HEADER_TOUR_ITEMS.find((i) => i.key === tourKey)?.text}
            </div>
          </div>
        </div>
      )}
      <div
        style={{
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: '16px',
          boxShadow: isDark
            ? '0 24px 48px rgba(0, 0, 0, 0.6)'
            : '0 24px 48px rgba(0, 0, 0, 0.2)',
          width: '90%',
          maxWidth: '680px',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          animation: 'onboardSlideUp 0.3s ease-out',
          position: 'relative',
          // Above the spotlight's dimming shadow (zIndex 1): the walkthrough
          // card itself must never be darkened by its own spotlight.
          zIndex: 2,
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: '24px 28px 0',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: c.primary,
              marginBottom: '6px',
            }}>
              Step {currentStep + 1} of {steps.length}
            </div>
            <div style={{
              fontSize: '22px',
              fontWeight: 700,
              color: c.text,
              lineHeight: 1.2,
            }}>
              {step.title}
            </div>
            <div style={{
              fontSize: '14px',
              color: c.textMuted,
              marginTop: '4px',
            }}>
              {step.subtitle}
            </div>
          </div>
          <button
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              color: c.textMuted,
              cursor: 'pointer',
              padding: '4px 8px',
              marginTop: '-4px',
            }}
            onClick={onClose}
            onMouseEnter={(e) => { e.currentTarget.style.color = c.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = c.textMuted; }}
          >
            x
          </button>
        </div>

        <div style={{
          padding: '20px 28px',
          overflowY: 'auto',
          flex: 1,
        }}>
          {step.content}
        </div>

        <div style={{
          padding: '16px 28px 20px',
          borderTop: `1px solid ${c.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {steps.map((_, index) => (
              <div
                key={index}
                style={{
                  width: index === currentStep ? '24px' : '8px',
                  height: '8px',
                  borderRadius: '4px',
                  backgroundColor: index === currentStep ? c.primary : c.border,
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                }}
                onClick={() => setCurrentStep(index)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {currentStep > 0 && (
              <button
                style={{
                  padding: '10px 20px',
                  backgroundColor: 'transparent',
                  border: `1px solid ${c.border}`,
                  borderRadius: '8px',
                  color: c.text,
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={handlePrev}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = c.surfaceHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                Back
              </button>
            )}
            <button
              style={{
                padding: '10px 24px',
                backgroundColor: c.primary,
                border: 'none',
                borderRadius: '8px',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onClick={handleNext}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
            >
              {currentStep === steps.length - 1
                ? (gateOnMcp ? 'Create Your First Project' : 'Get Started')
                : currentStep === 0 && gateOnMcp && !mcpConnected
                  ? 'Connect later — Next'
                  : 'Next'}
              {currentStep < steps.length - 1 && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>

      <style>
        {`
          @keyframes onboardFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes onboardSlideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes onboardPulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.06); opacity: 0.75; }
          }
        `}
      </style>
    </div>
  );
}

interface StepProps {
  isDark: boolean;
  c: ThemeColors;
}

function PathCard({ icon, tint, title, who, next, badge, isDark, c }: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  who: string;
  next: string;
  badge?: string;
  isDark: boolean;
  c: ThemeColors;
}) {
  return (
    <div style={{
      display: 'flex', gap: '14px', alignItems: 'flex-start',
      padding: '14px 16px',
      border: `1.5px solid ${badge ? tint + '66' : c.border}`,
      borderRadius: '12px',
      backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
    }}>
      <div style={{
        width: '44px', height: '44px', borderRadius: '10px',
        backgroundColor: tint + (isDark ? '20' : '15'),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: c.text }}>{title}</span>
          {badge && (
            <span style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
              color: tint, backgroundColor: tint + (isDark ? '22' : '18'),
              padding: '2px 7px', borderRadius: '99px',
            }}>
              {badge}
            </span>
          )}
        </div>
        <div style={{ fontSize: '12px', color: c.textSecondary, lineHeight: 1.5, marginBottom: '6px' }}>
          {who}
        </div>
        <div style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.5 }}>
          {next}
        </div>
      </div>
    </div>
  );
}

// ── Step 2: repo connection ──────────────────────────────────────────────────

function StepRepoConnection({ isDark, c }: StepProps) {
  return (
    <div>
      <div style={{ fontSize: '13px', color: c.textSecondary, lineHeight: 1.7, marginBottom: '16px' }}>
        NodeSpec is git-native: your architecture, task documents, and test plans can live in your
        repository as reviewable files — not only in this app. Two ways to get there:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <PathCard
          isDark={isDark} c={c}
          icon={<GitBranch size={22} color="#10b981" />}
          tint="#10b981"
          badge="Recommended"
          title="Connect a repository"
          who="Open the Git panel in the header and connect your GitHub repo."
          next="The model and per-node task documents commit to a .nodespec/ folder alongside your code. Accepted changes push automatically, commits made outside NodeSpec surface as reviewable change cards, and importing an existing codebase becomes one instruction to your AI."
        />
        <PathCard
          isDark={isDark} c={c}
          icon={<FileUp size={22} color="#3b82f6" />}
          tint="#3b82f6"
          title="No repo yet? Export documents"
          who="Everything still works without git — you just move the documents yourself."
          next="Export any node's context from the canvas and hand it to your tools. When the project is ready for a repository, set one up from the same Git panel and the documents start flowing automatically."
        />
      </div>
      <div style={{
        fontSize: '12px', color: c.textMuted, lineHeight: 1.6, marginTop: '12px',
        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        borderRadius: '8px', padding: '10px 12px',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
      }}>
        Already have code? After connecting the repo, tell your AI to import it — NodeSpec analyzes
        the codebase and proposes the architecture as one reviewable proposal.
      </div>
    </div>
  );
}

// ── Step 3: the loop ─────────────────────────────────────────────────────────

function StepTheLoop({ isDark, c }: StepProps) {
  const stages = [
    { icon: <Lightbulb size={15} />, tint: '#f59e0b', label: 'Vision', text: 'Your product intent, in your words. Everything downstream traces back to it.' },
    { icon: <ListChecks size={15} />, tint: '#10b981', label: 'Requirements', text: 'What must exist, each with acceptance criteria that define done. Criteria start unmet.' },
    { icon: <Network size={15} />, tint: '#3b82f6', label: 'Architecture', text: 'Components, connections, and typed contracts on the canvas — every requirement maps to the nodes serving it.' },
    { icon: <FileText size={15} />, tint: '#8b5cf6', label: 'Task documents', text: 'Each node gets a written brief: its role, its interfaces, its files, and the criteria it serves.' },
    { icon: <Code size={15} />, tint: '#ec4899', label: 'Code', text: 'Your AI builds from the brief in your own editor — scoped context, never a repo-wide guess.' },
    { icon: <FlaskConical size={15} />, tint: '#14b8a6', label: 'Tests', text: 'Test plans derive from the criteria. Reported results are the only thing that flips a criterion to met.' },
    { icon: <GitCommitHorizontal size={15} />, tint: '#64748b', label: 'Git provenance', text: 'With a repo connected: every accepted change commits, drift is detected, and the evidence trail lives in your history.' },
  ];
  return (
    <div>
      <div style={{ fontSize: '13px', color: c.textSecondary, lineHeight: 1.7, marginBottom: '14px' }}>
        Every project runs the same loop, and each stage feeds the next — so nothing is claimed
        that was not defined, and nothing is done that was not proven.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {stages.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: '8px', flexShrink: 0,
                backgroundColor: s.tint + (isDark ? '22' : '16'),
                color: s.tint,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {s.icon}
              </div>
              {i < stages.length - 1 && (
                <div style={{ width: '2px', flex: 1, minHeight: '10px', backgroundColor: c.border }} />
              )}
            </div>
            <div style={{ paddingBottom: i < stages.length - 1 ? '12px' : 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: c.text, lineHeight: '30px' }}>{s.label}</div>
              <div style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.5, marginTop: '-4px' }}>{s.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 4: build it your way ────────────────────────────────────────────────

function StepBuildYourWay({ isDark, c }: StepProps) {
  return (
    <div>
      <div style={{ fontSize: '13px', color: c.textSecondary, lineHeight: 1.7, marginBottom: '16px' }}>
        Both hands on the wheel, whenever you want them. Everything your AI can do, you can also do
        directly — and both roads produce the same governed, versioned model.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <PathCard
          isDark={isDark} c={c}
          icon={<MousePointerClick size={22} color="#3b82f6" />}
          tint="#3b82f6"
          title="Work by hand"
          who="Direct manipulation, no AI required."
          next="Add requirements in the Specification panel. Drag components from the palette onto the canvas, connect them by drawing edges — every connection gets a typed contract — and click any node for its actions."
        />
        <PathCard
          isDark={isDark} c={c}
          icon={<Bot size={22} color="#8b5cf6" />}
          tint="#8b5cf6"
          title="Work through your AI"
          who="The assistant you just connected can drive the whole loop over MCP."
          next="Describe what you want — requirements, architecture, an imported repo — and your AI proposes it. Every change lands as a proposal you review and apply; nothing writes to your model directly."
        />
      </div>
      <div style={{
        fontSize: '12px', color: c.textMuted, lineHeight: 1.6, marginTop: '12px',
        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        borderRadius: '8px', padding: '10px 12px',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}`,
      }}>
        Reopen this walkthrough anytime from the ? menu in the header. The Skills button next to it
        carries instructions you can copy — or download as .md files — so your AI knows the
        NodeSpec workflow.
      </div>
    </div>
  );
}

// ── Step 5: header tour ──────────────────────────────────────────────────────
// Click a row, and the matching header control lights up under the spotlight
// cutout — the same highlight the MCP step uses, one control at a time.

function StepHeaderTour({ c, items, activeKey, onSelect }: {
  c: ThemeColors;
  items: Array<{ key: string; title: string; text: string }>;
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: '13px', color: c.textSecondary, lineHeight: 1.7, marginBottom: '14px' }}>
        One last lap: everything in the header, explained. Click any row and the real control
        lights up above — so you know exactly where each one lives when you need it.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
                padding: '10px 12px', borderRadius: '9px',
                border: `1.5px solid ${active ? c.primary : c.border}`,
                backgroundColor: active ? `${c.primary}14` : 'transparent',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 600, color: active ? c.primary : c.text }}>
                {item.title}
              </div>
              <div style={{ fontSize: '12px', color: c.textMuted, lineHeight: 1.5, marginTop: '2px' }}>
                {item.text}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
