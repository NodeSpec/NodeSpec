import { useState, useEffect, useRef } from 'react';

const BRAND = '#8B8FE6';
const NODE_COLORS: Record<string, { bg: string; border: string; accent: string }> = {
  frontend: { bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)', accent: '#3b82f6' },
  backend: { bg: 'rgba(139, 143, 230, 0.12)', border: 'rgba(139, 143, 230, 0.35)', accent: BRAND },
  database: { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.35)', accent: '#10b981' },
  cache: { bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)', accent: '#fbbf24' },
  auth: { bg: 'rgba(244, 114, 182, 0.12)', border: 'rgba(244, 114, 182, 0.35)', accent: '#f472b6' },
  container: { bg: 'rgba(139, 143, 230, 0.04)', border: 'rgba(139, 143, 230, 0.15)', accent: BRAND },
};

interface DemoNode {
  id: string;
  label: string;
  tech: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  delay: number;
  parentId?: string;
}

interface DemoEdge {
  from: string;
  to: string;
  delay: number;
  label?: string;
}

const NODES: DemoNode[] = [
  { id: 'aws', label: 'AWS Cloud', tech: '', type: 'container', x: 18, y: 12, width: 550, height: 340, delay: 0 },
  { id: 'react', label: 'React App', tech: 'React 18', type: 'frontend', x: 40, y: 65, width: 130, height: 62, delay: 300, parentId: 'aws' },
  { id: 'api', label: 'API Gateway', tech: 'Express', type: 'backend', x: 210, y: 55, width: 130, height: 62, delay: 500, parentId: 'aws' },
  { id: 'auth', label: 'Auth Service', tech: 'Supabase Auth', type: 'auth', x: 210, y: 155, width: 130, height: 62, delay: 700, parentId: 'aws' },
  { id: 'pg', label: 'PostgreSQL', tech: 'RDS', type: 'database', x: 400, y: 55, width: 130, height: 62, delay: 900, parentId: 'aws' },
  { id: 'redis', label: 'Redis Cache', tech: 'ElastiCache', type: 'cache', x: 400, y: 155, width: 130, height: 62, delay: 1100, parentId: 'aws' },
];

const EDGES: DemoEdge[] = [
  { from: 'react', to: 'api', delay: 1400, label: 'REST' },
  { from: 'api', to: 'auth', delay: 1600, label: 'auth' },
  { from: 'api', to: 'pg', delay: 1800, label: 'SQL' },
  { from: 'api', to: 'redis', delay: 2000, label: 'cache' },
  { from: 'auth', to: 'pg', delay: 2200 },
];

export function ArchitectureDemo({ active }: { active: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      setElapsed(ts - startRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: `radial-gradient(ellipse at 30% 50%, rgba(139, 143, 230, 0.04) 0%, transparent 60%)`,
      position: 'relative',
      overflow: 'hidden',
      padding: '16px',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(139, 143, 230, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(139, 143, 230, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: '24px 24px',
      }} />

      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {EDGES.map((edge) => {
          const progress = Math.min(1, Math.max(0, (elapsed - edge.delay) / 500));
          if (progress <= 0) return null;
          const from = NODES.find(n => n.id === edge.from)!;
          const to = NODES.find(n => n.id === edge.to)!;
          const sx = from.x + from.width;
          const sy = from.y + from.height / 2;
          const ex = to.x;
          const ey = to.y + to.height / 2;
          const cpx1 = sx + (ex - sx) * 0.5;
          const cpy1 = sy;
          const cpx2 = ex - (ex - sx) * 0.5;
          const cpy2 = ey;

          return (
            <g key={`${edge.from}-${edge.to}`} opacity={progress}>
              <path
                d={`M ${sx} ${sy} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${ex} ${ey}`}
                fill="none"
                stroke={`rgba(139, 143, 230, 0.25)`}
                strokeWidth="1.5"
                strokeDasharray={progress < 1 ? '6 4' : 'none'}
              />
              <circle r="3" fill={BRAND} opacity={0.6}>
                <animateMotion
                  dur="3s"
                  repeatCount="indefinite"
                  path={`M ${sx} ${sy} C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${ex} ${ey}`}
                />
              </circle>
              {edge.label && progress >= 1 && (
                <text
                  x={(sx + ex) / 2}
                  y={(sy + ey) / 2 - 8}
                  textAnchor="middle"
                  fill="rgba(139, 143, 230, 0.5)"
                  fontSize="9"
                  fontWeight="600"
                  fontFamily="Inter, system-ui"
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {NODES.map(node => {
        const progress = Math.min(1, Math.max(0, (elapsed - node.delay) / 400));
        if (progress <= 0) return null;

        const colors = NODE_COLORS[node.type] || NODE_COLORS.backend;
        const isContainer = node.type === 'container';
        const isHovered = hoveredNode === node.id;

        return (
          <div
            key={node.id}
            onMouseEnter={() => setHoveredNode(node.id)}
            onMouseLeave={() => setHoveredNode(null)}
            style={{
              position: 'absolute',
              left: node.x,
              top: node.y,
              width: isContainer ? node.width : node.width,
              height: isContainer ? node.height : node.height,
              borderRadius: isContainer ? '14px' : '10px',
              border: `1.5px ${isContainer ? 'dashed' : 'solid'} ${isHovered ? colors.accent : colors.border}`,
              background: colors.bg,
              opacity: progress,
              transform: `scale(${0.92 + progress * 0.08})`,
              transition: 'border-color 0.2s, box-shadow 0.2s',
              boxShadow: isHovered && !isContainer
                ? `0 4px 20px rgba(139, 143, 230, 0.15)`
                : 'none',
              zIndex: isContainer ? 0 : 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: isContainer ? 'flex-start' : 'center',
              padding: isContainer ? '10px 14px' : '8px 12px',
            }}
          >
            {isContainer ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CloudIcon color={colors.accent} />
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(139, 143, 230, 0.6)', letterSpacing: '0.03em' }}>
                  {node.label}
                </span>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: colors.accent,
                    boxShadow: `0 0 6px ${colors.accent}`,
                  }} />
                  <span style={{ fontSize: '11px', fontWeight: 700, color: '#E6E9EF', letterSpacing: '-0.01em' }}>
                    {node.label}
                  </span>
                </div>
                <span style={{ fontSize: '9px', color: '#8a8f9e', fontWeight: 500, paddingLeft: '12px' }}>
                  {node.tech}
                </span>

                <div style={{
                  position: 'absolute',
                  left: '-4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  border: `1.5px solid ${colors.accent}`,
                  background: '#1a1d26',
                }} />
                <div style={{
                  position: 'absolute',
                  right: '-4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  border: `1.5px solid ${colors.accent}`,
                  background: '#1a1d26',
                }} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CloudIcon({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}
