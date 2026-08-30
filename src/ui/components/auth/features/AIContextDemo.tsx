import { useState, useEffect, useRef } from 'react';

const BRAND = '#8B8FE6';

const STREAMING_LINES = [
  { type: 'heading', text: '## Architecture Context for AI Agent' },
  { type: 'blank', text: '' },
  { type: 'meta', text: 'Project: E-Commerce Platform | 6 nodes | 5 contracts' },
  { type: 'blank', text: '' },
  { type: 'section', text: '### Node: API Gateway (Express)' },
  { type: 'detail', text: 'Role: api-server | Container: AWS Cloud' },
  { type: 'detail', text: 'Contracts: REST (React App), SQL (PostgreSQL), auth_flow (Auth)' },
  { type: 'detail', text: 'Technology: Express 4.x on Node.js' },
  { type: 'practice', text: 'Best practice: Use middleware for auth, validation, rate limiting' },
  { type: 'practice', text: 'Avoid: Synchronous blocking operations in request handlers' },
  { type: 'blank', text: '' },
  { type: 'section', text: '### Node: PostgreSQL (RDS)' },
  { type: 'detail', text: 'Role: database-server | Container: AWS Cloud' },
  { type: 'detail', text: 'Contracts: SQL (API Gateway), SQL (Auth Service)' },
  { type: 'practice', text: 'Best practice: Use connection pooling, prepared statements' },
  { type: 'practice', text: 'Suggested files: src/db/schema.sql, src/db/migrations/' },
  { type: 'blank', text: '' },
  { type: 'section', text: '### Container Hierarchy' },
  { type: 'detail', text: 'AWS Cloud (deployment/hosting)' },
  { type: 'tree', text: '  \u251C\u2500 React App (frontend)' },
  { type: 'tree', text: '  \u251C\u2500 API Gateway (api-server)' },
  { type: 'tree', text: '  \u251C\u2500 Auth Service (auth-provider)' },
  { type: 'tree', text: '  \u251C\u2500 PostgreSQL (database-server)' },
  { type: 'tree', text: '  \u2514\u2500 Redis Cache (cache-server)' },
];

const TYPE_COLORS: Record<string, string> = {
  heading: '#E6E9EF',
  section: '#8B8FE6',
  detail: '#c9cdd8',
  practice: '#10b981',
  meta: '#8a8f9e',
  tree: '#fbbf24',
  blank: 'transparent',
};

export function AIContextDemo({ active }: { active: boolean }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [cursorVisible, setCursorVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!active) {
      setVisibleLines(0);
      return;
    }

    let lineIndex = 0;
    intervalRef.current = setInterval(() => {
      lineIndex++;
      if (lineIndex >= STREAMING_LINES.length) {
        lineIndex = STREAMING_LINES.length;
        clearInterval(intervalRef.current);
      }
      setVisibleLines(lineIndex);
    }, 180);

    return () => clearInterval(intervalRef.current);
  }, [active]);

  useEffect(() => {
    const blink = setInterval(() => setCursorVisible(v => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines]);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      gap: '0',
    }}>
      <div style={{
        width: '200px',
        borderRight: '1px solid rgba(139, 143, 230, 0.08)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#8a8f9e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', padding: '4px 8px' }}>
          Context Sources
        </div>
        {[
          { label: 'Graph Nodes', count: 6, active: visibleLines > 2 },
          { label: 'Contracts', count: 5, active: visibleLines > 5 },
          { label: 'Technologies', count: 4, active: visibleLines > 8 },
          { label: 'Container Map', count: 1, active: visibleLines > 16 },
          { label: 'Best Practices', count: 8, active: visibleLines > 8 },
        ].map(item => (
          <div
            key={item.label}
            style={{
              padding: '8px 10px',
              borderRadius: '8px',
              background: item.active ? 'rgba(139, 143, 230, 0.08)' : 'transparent',
              border: `1px solid ${item.active ? 'rgba(139, 143, 230, 0.15)' : 'transparent'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              transition: 'all 0.4s ease',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 500, color: item.active ? '#E6E9EF' : '#5a5f78' }}>
              {item.label}
            </span>
            <span style={{
              fontSize: '10px',
              fontWeight: 700,
              color: item.active ? BRAND : '#3f4458',
              background: item.active ? 'rgba(139, 143, 230, 0.12)' : 'rgba(255,255,255,0.03)',
              padding: '2px 6px',
              borderRadius: '4px',
              transition: 'all 0.4s ease',
            }}>
              {item.count}
            </span>
          </div>
        ))}

        <div style={{ flex: 1 }} />

        <div style={{
          padding: '10px',
          borderRadius: '8px',
          background: 'rgba(16, 185, 129, 0.06)',
          border: '1px solid rgba(16, 185, 129, 0.12)',
          opacity: visibleLines >= STREAMING_LINES.length ? 1 : 0.3,
          transition: 'opacity 0.5s ease',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: '#10b981', marginBottom: '2px' }}>
            Context Ready
          </div>
          <div style={{ fontSize: '9px', color: '#8a8f9e' }}>
            {visibleLines >= STREAMING_LINES.length ? '24 sections compiled' : 'Building context...'}
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: '16px 20px',
          overflowY: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          fontSize: '11px',
          lineHeight: '1.8',
          scrollBehavior: 'smooth',
        }}
      >
        {STREAMING_LINES.slice(0, visibleLines).map((line, i) => (
          <div
            key={i}
            style={{
              color: TYPE_COLORS[line.type] || '#c9cdd8',
              fontWeight: line.type === 'heading' || line.type === 'section' ? 700 : 400,
              fontSize: line.type === 'heading' ? '13px' : line.type === 'section' ? '12px' : '11px',
              minHeight: line.type === 'blank' ? '12px' : 'auto',
              opacity: 0,
              animation: `fadeSlideIn 0.3s ease forwards`,
              animationDelay: '0ms',
            }}
          >
            {line.text}
          </div>
        ))}
        {visibleLines < STREAMING_LINES.length && (
          <span style={{
            display: 'inline-block',
            width: '7px',
            height: '14px',
            background: BRAND,
            opacity: cursorVisible ? 0.8 : 0,
            transition: 'opacity 0.1s',
            borderRadius: '1px',
            marginLeft: '2px',
            verticalAlign: 'middle',
          }} />
        )}
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
