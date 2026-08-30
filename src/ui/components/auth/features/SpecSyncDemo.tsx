import { useState, useEffect, useRef } from 'react';

const BRAND = '#8B8FE6';

interface Requirement {
  id: string;
  name: string;
  feature: string;
  nodeIds: string[];
  delay: number;
}

interface MiniNode {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

const MINI_NODES: MiniNode[] = [
  { id: 'n1', label: 'React App', x: 24, y: 30, color: '#3b82f6' },
  { id: 'n2', label: 'API Gateway', x: 24, y: 100, color: BRAND },
  { id: 'n3', label: 'Auth Service', x: 24, y: 170, color: '#f472b6' },
  { id: 'n4', label: 'PostgreSQL', x: 24, y: 240, color: '#10b981' },
  { id: 'n5', label: 'Redis', x: 160, y: 100, color: '#fbbf24' },
  { id: 'n6', label: 'Queue', x: 160, y: 170, color: '#f97316' },
];

const REQUIREMENTS: Requirement[] = [
  { id: 'r1', name: 'User authentication flow', feature: 'Authentication', nodeIds: ['n1', 'n2', 'n3', 'n4'], delay: 600 },
  { id: 'r2', name: 'Product catalog display', feature: 'Catalog', nodeIds: ['n1', 'n2', 'n4'], delay: 1800 },
  { id: 'r3', name: 'Session caching', feature: 'Performance', nodeIds: ['n2', 'n5'], delay: 3000 },
  { id: 'r4', name: 'Order processing pipeline', feature: 'Orders', nodeIds: ['n2', 'n4', 'n6'], delay: 4200 },
  { id: 'r5', name: 'Real-time notifications', feature: 'Notifications', nodeIds: ['n1', 'n6'], delay: 5400 },
];

const FEATURE_COLORS: Record<string, string> = {
  Authentication: '#f472b6',
  Catalog: '#3b82f6',
  Performance: '#fbbf24',
  Orders: '#f97316',
  Notifications: '#10b981',
};

export function SpecSyncDemo({ active }: { active: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [hoveredReq, setHoveredReq] = useState<string | null>(null);
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

  const activeReqs = REQUIREMENTS.filter(r => elapsed >= r.delay);
  const currentReq = hoveredReq
    ? REQUIREMENTS.find(r => r.id === hoveredReq)
    : activeReqs[activeReqs.length - 1] ?? null;
  const highlightedNodes = new Set(currentReq?.nodeIds ?? []);
  const mappedNodes = new Set(activeReqs.flatMap(r => r.nodeIds));

  const completedCount = activeReqs.length;
  const totalCount = REQUIREMENTS.length;
  const progressPct = (completedCount / totalCount) * 100;

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      gap: '0',
    }}>
      <div style={{
        width: '300px',
        borderRight: '1px solid rgba(139, 143, 230, 0.08)',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px 10px',
        }}>
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#8a8f9e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Requirements
          </span>
          <span style={{ fontSize: '10px', fontWeight: 600, color: BRAND }}>
            {completedCount}/{totalCount} mapped
          </span>
        </div>

        <div style={{
          height: '3px',
          borderRadius: '2px',
          background: 'rgba(139, 143, 230, 0.1)',
          marginBottom: '12px',
          marginLeft: '8px',
          marginRight: '8px',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPct}%`,
            background: `linear-gradient(90deg, ${BRAND}, #a78bfa)`,
            borderRadius: '2px',
            transition: 'width 0.5s ease',
          }} />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {REQUIREMENTS.map(req => {
            const isActive = elapsed >= req.delay;
            const isCurrent = currentReq?.id === req.id;
            const featureColor = FEATURE_COLORS[req.feature] || BRAND;

            return (
              <div
                key={req.id}
                onMouseEnter={() => isActive && setHoveredReq(req.id)}
                onMouseLeave={() => setHoveredReq(null)}
                style={{
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${isCurrent ? 'rgba(139, 143, 230, 0.25)' : 'transparent'}`,
                  background: isCurrent ? 'rgba(139, 143, 230, 0.06)' : 'transparent',
                  opacity: isActive ? 1 : 0.25,
                  transform: isActive ? 'translateX(0)' : 'translateX(-12px)',
                  transition: 'all 0.5s ease',
                  cursor: isActive ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    border: `1.5px solid ${isActive ? '#10b981' : '#3f4458'}`,
                    background: isActive ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease',
                    flexShrink: 0,
                  }}>
                    {isActive && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: isActive ? '#E6E9EF' : '#5a5f78',
                  }}>
                    {req.name}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '24px' }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '2px',
                    background: isActive ? featureColor : '#3f4458',
                    transition: 'background 0.3s ease',
                  }} />
                  <span style={{ fontSize: '9px', color: isActive ? '#8a8f9e' : '#3f4458', fontWeight: 500 }}>
                    {req.feature}
                  </span>
                  <span style={{ fontSize: '9px', color: '#3f4458' }}>
                    {req.nodeIds.length} nodes
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{
        flex: 1,
        position: 'relative',
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

        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {MINI_NODES.map(node => {
            const isHighlighted = highlightedNodes.has(node.id);
            const isMapped = mappedNodes.has(node.id);

            return (
              <div
                key={node.id}
                style={{
                  position: 'absolute',
                  left: node.x,
                  top: node.y,
                  width: '120px',
                  height: '46px',
                  borderRadius: '8px',
                  border: `1.5px solid ${isHighlighted ? node.color : isMapped ? 'rgba(139, 143, 230, 0.2)' : 'rgba(63, 68, 88, 0.3)'}`,
                  background: isHighlighted
                    ? `rgba(${hexToRgb(node.color)}, 0.1)`
                    : 'rgba(26, 29, 38, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '0 10px',
                  transition: 'all 0.4s ease',
                  boxShadow: isHighlighted
                    ? `0 0 20px rgba(${hexToRgb(node.color)}, 0.2)`
                    : 'none',
                  zIndex: isHighlighted ? 2 : 1,
                }}
              >
                <div style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: isHighlighted || isMapped ? node.color : '#3f4458',
                  boxShadow: isHighlighted ? `0 0 8px ${node.color}` : 'none',
                  transition: 'all 0.4s ease',
                  flexShrink: 0,
                }} />
                <span style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: isHighlighted ? '#E6E9EF' : isMapped ? '#c9cdd8' : '#5a5f78',
                  transition: 'color 0.4s ease',
                }}>
                  {node.label}
                </span>
              </div>
            );
          })}

          {currentReq && (
            <div style={{
              position: 'absolute',
              bottom: '8px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '8px 16px',
              borderRadius: '8px',
              background: 'rgba(139, 143, 230, 0.08)',
              border: '1px solid rgba(139, 143, 230, 0.15)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap',
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={BRAND} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span style={{ fontSize: '10px', fontWeight: 600, color: '#E6E9EF' }}>
                {currentReq.name}
              </span>
              <span style={{ fontSize: '10px', color: '#8a8f9e' }}>
                mapped to {currentReq.nodeIds.length} nodes
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '139, 143, 230';
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}
