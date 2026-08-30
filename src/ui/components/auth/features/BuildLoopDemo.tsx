import { useState, useEffect } from 'react';

/*
  GTM (owner direction 2026-08-11): the ONE combined "how NodeSpec works"
  diagram — replaces the five mechanism-level story panels that exposed
  structural internals. Four stages at business-value altitude, cycling
  highlight, no implementation detail: start anywhere → governed design →
  your AI builds → verified delivery, with the loop arrow closing back.
*/

const BRAND = '#8B8FE6';
const SURFACE = '#1a1d26';
const INK = '#e6e9ef';
const MUT = '#8a8f9e';
const OK = '#4ade80';
const AMBER = '#fbbf24';
const CLAUDE = '#D97757';

interface Stage {
  id: string;
  label: string;
  sub: string;
  value: string;
  color: string;
}

const STAGES: Stage[] = [
  {
    id: 'start',
    label: 'Start anywhere',
    sub: 'Import a repo · or a blank canvas',
    value: 'No migration project. NodeSpec meets your code where it is.',
    color: BRAND,
  },
  {
    id: 'design',
    label: 'Design, governed',
    sub: 'Architecture + requirements, in your repo',
    value: 'Your system design lives in your git history — reviewable, never lost in chat scrollback.',
    color: AMBER,
  },
  {
    id: 'build',
    label: 'Your AI builds',
    sub: 'Claude · Cursor · any agent, via MCP',
    value: 'The AI you already pay for, handed exactly the context each task needs. Less token burn, fewer wrong guesses.',
    color: CLAUDE,
  },
  {
    id: 'verify',
    label: 'Verified delivery',
    sub: 'Done = tested, with receipts',
    value: 'Nothing counts as finished until tests prove it. Ship with proof, not vibes.',
    color: OK,
  },
];

const STAGE_MS = 2600;

// Fixed geometry: four stages left→right, loop arrow returning under them.
const BOX_W = 168;
const BOX_H = 64;
const BOX_Y = 96;
const GAP = 36;
const START_X = 22;

export function BuildLoopDemo({ active }: { active: boolean }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!active) {
      setStage(0);
      return;
    }
    const timer = setInterval(() => setStage(s => (s + 1) % STAGES.length), STAGE_MS);
    return () => clearInterval(timer);
  }, [active]);

  const current = STAGES[stage];

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '28px 32px 20px' }}>
      <svg viewBox="0 0 880 260" style={{ width: '100%', flex: 1, minHeight: 0 }} role="img"
        aria-label="The NodeSpec loop: start anywhere, design governed architecture, your AI builds over MCP, delivery is verified — then iterate">
        {STAGES.map((s, i) => {
          const x = START_X + i * (BOX_W + GAP);
          const isActive = i === stage;
          return (
            <g key={s.id} style={{ transition: 'opacity 0.4s ease' }} opacity={isActive ? 1 : 0.55}>
              <rect x={x} y={BOX_Y} width={BOX_W} height={BOX_H} rx={14}
                fill={SURFACE}
                stroke={s.color}
                strokeWidth={isActive ? 2.2 : 1.2}
                style={{ transition: 'stroke-width 0.3s ease, filter 0.3s ease' }}
                filter={isActive ? `drop-shadow(0 0 10px ${s.color}66)` : undefined}
              />
              <text x={x + BOX_W / 2} y={BOX_Y + 27} textAnchor="middle" fontSize={15} fontWeight={700}
                fill={INK} fontFamily="system-ui, sans-serif">{s.label}</text>
              <text x={x + BOX_W / 2} y={BOX_Y + 46} textAnchor="middle" fontSize={10.5}
                fill={MUT} fontFamily="system-ui, sans-serif">{s.sub}</text>
              {/* stage dot above */}
              <circle cx={x + BOX_W / 2} cy={BOX_Y - 26} r={5}
                fill={isActive ? s.color : 'transparent'} stroke={s.color} strokeWidth={1.4}
                style={{ transition: 'fill 0.3s ease' }} />
            </g>
          );
        })}

        {/* forward arrows */}
        {[0, 1, 2].map(i => {
          const x1 = START_X + BOX_W + i * (BOX_W + GAP);
          const lit = stage > i;
          return (
            <g key={i} stroke={lit ? BRAND : 'rgba(139,143,230,0.3)'} strokeWidth={1.8} fill="none"
              strokeLinecap="round" style={{ transition: 'stroke 0.4s ease' }}>
              <line x1={x1 + 4} y1={BOX_Y + BOX_H / 2} x2={x1 + GAP - 6} y2={BOX_Y + BOX_H / 2} />
              <path d={`M ${x1 + GAP - 6} ${BOX_Y + BOX_H / 2} l -7 -4.5 M ${x1 + GAP - 6} ${BOX_Y + BOX_H / 2} l -7 4.5`} />
            </g>
          );
        })}

        {/* the loop back: verify → design (iterate safely) */}
        <g stroke={stage === 3 ? OK : 'rgba(74,222,128,0.25)'} strokeWidth={1.8} fill="none"
          strokeLinecap="round" style={{ transition: 'stroke 0.4s ease' }}>
          <path d={`M ${START_X + 3 * (BOX_W + GAP) + BOX_W / 2} ${BOX_Y + BOX_H + 12}
                    L ${START_X + 3 * (BOX_W + GAP) + BOX_W / 2} ${BOX_Y + BOX_H + 44}
                    L ${START_X + (BOX_W + GAP) + BOX_W / 2} ${BOX_Y + BOX_H + 44}
                    L ${START_X + (BOX_W + GAP) + BOX_W / 2} ${BOX_Y + BOX_H + 16}`} />
          <path d={`M ${START_X + (BOX_W + GAP) + BOX_W / 2} ${BOX_Y + BOX_H + 12} l -5 7 M ${START_X + (BOX_W + GAP) + BOX_W / 2} ${BOX_Y + BOX_H + 12} l 5 7`} />
        </g>
        <text x={START_X + 2 * (BOX_W + GAP) + BOX_W / 2 - GAP / 2} y={BOX_Y + BOX_H + 60}
          textAnchor="middle" fontSize={10.5} fill={stage === 3 ? OK : MUT}
          style={{ transition: 'fill 0.4s ease' }} fontFamily="system-ui, sans-serif">
          iterate — the design and the code move together
        </text>
      </svg>

      {/* the so-what line for the active stage */}
      <div style={{
        minHeight: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '0 24px',
      }}>
        <span key={current.id} style={{
          fontSize: '14.5px',
          color: INK,
          lineHeight: 1.5,
          fontFamily: 'system-ui, sans-serif',
          animation: 'fadeIn 0.4s ease',
        }}>
          <span style={{ color: current.color, fontWeight: 700 }}>{current.label}: </span>
          {current.value}
        </span>
      </div>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
