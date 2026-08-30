interface GhostNode {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}

interface GhostConnection {
  from: [number, number];
  to: [number, number];
  opacity: number;
}

interface BlueprintGridProps {
  variant?: 'dark' | 'light';
  density?: 'sparse' | 'normal' | 'dense';
  showNodes?: boolean;
  showConnections?: boolean;
  showGrid?: boolean;
}

const TYPE_COLORS: [number, number, number][] = [
  [59, 130, 246],
  [139, 143, 230],
  [16, 185, 129],
  [251, 191, 36],
];

const NODE_SETS: Record<string, GhostNode[]> = {
  sparse: [
    { x: 8, y: 12, w: 140, h: 72, opacity: 0.18 },
    { x: 72, y: 62, w: 120, h: 64, opacity: 0.14 },
    { x: 52, y: 30, w: 130, h: 68, opacity: 0.16 },
  ],
  normal: [
    { x: 5, y: 8, w: 140, h: 72, opacity: 0.2 },
    { x: 68, y: 52, w: 130, h: 68, opacity: 0.16 },
    { x: 33, y: 32, w: 120, h: 64, opacity: 0.18 },
    { x: 78, y: 12, w: 135, h: 70, opacity: 0.14 },
    { x: 12, y: 68, w: 125, h: 66, opacity: 0.16 },
  ],
  dense: [
    { x: 3, y: 6, w: 140, h: 72, opacity: 0.22 },
    { x: 62, y: 48, w: 130, h: 68, opacity: 0.18 },
    { x: 28, y: 28, w: 120, h: 64, opacity: 0.16 },
    { x: 76, y: 10, w: 135, h: 70, opacity: 0.15 },
    { x: 8, y: 62, w: 125, h: 66, opacity: 0.18 },
    { x: 48, y: 78, w: 115, h: 60, opacity: 0.14 },
    { x: 85, y: 72, w: 120, h: 64, opacity: 0.16 },
  ],
};

const CONN_SETS: Record<string, GhostConnection[]> = {
  sparse: [
    { from: [128, 44], to: [550, 390], opacity: 0.15 },
  ],
  normal: [
    { from: [125, 42], to: [700, 350], opacity: 0.18 },
    { from: [460, 226], to: [800, 130], opacity: 0.14 },
  ],
  dense: [
    { from: [120, 40], to: [650, 320], opacity: 0.2 },
    { from: [430, 200], to: [780, 100], opacity: 0.16 },
    { from: [300, 170], to: [100, 420], opacity: 0.14 },
  ],
};

export function BlueprintGrid({
  variant = 'dark',
  density = 'normal',
  showNodes = true,
  showConnections = true,
  showGrid = true,
}: BlueprintGridProps) {
  const isDark = variant === 'dark';
  const strokeColor = isDark ? '139, 143, 230' : '99, 102, 141';
  const nodes = NODE_SETS[density] ?? NODE_SETS.normal;
  const connections = CONN_SETS[density] ?? CONN_SETS.normal;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <svg
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1000 600"
      >
        <defs>
          <radialGradient id={`bp-mask-${variant}-${density}`}>
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="50%" stopColor="white" stopOpacity="0.8" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id={`bp-fade-${variant}-${density}`}>
            <rect width="1000" height="600" fill={`url(#bp-mask-${variant}-${density})`} />
          </mask>
          {showGrid && (
            <pattern id={`bp-dots-${variant}-${density}`} width="32" height="32" patternUnits="userSpaceOnUse">
              <circle
                cx="16"
                cy="16"
                r="1"
                fill={`rgba(${strokeColor}, ${isDark ? 0.18 : 0.12})`}
              />
            </pattern>
          )}
        </defs>

        <g mask={`url(#bp-fade-${variant}-${density})`}>
          {showGrid && (
            <rect width="1000" height="600" fill={`url(#bp-dots-${variant}-${density})`} />
          )}

          {showNodes &&
            nodes.map((node, i) => {
              const tc = TYPE_COLORS[i % TYPE_COLORS.length];
              const op = node.opacity;
              return (
                <g key={i}>
                  <rect
                    x={node.x * 10}
                    y={node.y * 6}
                    width={node.w}
                    height={node.h}
                    rx={8}
                    fill={isDark ? `rgba(255,255,255,${op * 0.15})` : `rgba(0,0,0,${op * 0.08})`}
                    stroke={`rgba(${strokeColor}, ${op})`}
                    strokeWidth={1.5}
                  />
                  <rect
                    x={node.x * 10 + 8}
                    y={node.y * 6 + 8}
                    width={node.w - 16}
                    height={14}
                    rx={3}
                    fill={`rgba(${tc[0]},${tc[1]},${tc[2]},${op * 0.7})`}
                  />
                  <rect
                    x={node.x * 10 + 8}
                    y={node.y * 6 + 28}
                    width={(node.w - 16) * 0.7}
                    height={4}
                    rx={2}
                    fill={`rgba(${strokeColor}, ${op * 0.25})`}
                  />
                  <rect
                    x={node.x * 10 + 8}
                    y={node.y * 6 + 38}
                    width={(node.w - 16) * 0.5}
                    height={4}
                    rx={2}
                    fill={`rgba(${strokeColor}, ${op * 0.15})`}
                  />
                  <circle
                    cx={node.x * 10}
                    cy={node.y * 6 + node.h / 2}
                    r={4}
                    fill={`rgba(16,185,129,${op * 1.5})`}
                  />
                  <circle
                    cx={node.x * 10 + node.w}
                    cy={node.y * 6 + node.h / 2}
                    r={4}
                    fill={`rgba(251,191,36,${op * 1.5})`}
                  />
                </g>
              );
            })}

          {showConnections &&
            connections.map((conn, i) => {
              const dx = conn.to[0] - conn.from[0];
              const cp1x = conn.from[0] + dx * 0.5;
              const cp2x = conn.to[0] - dx * 0.5;
              return (
                <path
                  key={`c${i}`}
                  className="bp-connection-path"
                  d={`M${conn.from[0]},${conn.from[1]} C${cp1x},${conn.from[1]} ${cp2x},${conn.to[1]} ${conn.to[0]},${conn.to[1]}`}
                  fill="none"
                  stroke={`rgba(${strokeColor}, ${conn.opacity})`}
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                />
              );
            })}
        </g>
      </svg>
    </div>
  );
}
