import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  label: string;
  opacity: number;
  type: 'frontend' | 'backend' | 'database' | 'service';
}

interface Connection {
  from: number;
  to: number;
}

export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const connectionsRef = useRef<Connection[]>([]);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const nodes = [
      { label: 'React App', type: 'frontend' as const },
      { label: 'API Gateway', type: 'backend' as const },
      { label: 'Auth Service', type: 'service' as const },
      { label: 'PostgreSQL', type: 'database' as const },
      { label: 'Redis Cache', type: 'service' as const },
      { label: 'RabbitMQ', type: 'service' as const },
    ];

    nodesRef.current = nodes.map((node) => ({
      x: Math.random() * (canvas.width - 200) + 100,
      y: Math.random() * (canvas.height - 200) + 100,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      width: 140,
      height: 80,
      label: node.label,
      type: node.type,
      opacity: 0.12 + Math.random() * 0.08,
    }));

    connectionsRef.current = [
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 1, to: 3 },
      { from: 1, to: 4 },
      { from: 1, to: 5 },
      { from: 2, to: 3 },
    ];

    const drawNode = (node: Node) => {
      ctx.save();

      ctx.fillStyle = `rgba(255, 255, 255, ${node.opacity * 0.8})`;
      ctx.strokeStyle = `rgba(139, 143, 230, ${node.opacity})`;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.roundRect(node.x, node.y, node.width, node.height, 8);
      ctx.fill();
      ctx.stroke();

      const handleRadius = 5;
      ctx.fillStyle = `rgba(16, 185, 129, ${node.opacity * 1.2})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y + node.height / 2, handleRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(251, 191, 36, ${node.opacity * 1.2})`;
      ctx.beginPath();
      ctx.arc(node.x + node.width, node.y + node.height / 2, handleRadius, 0, Math.PI * 2);
      ctx.fill();

      const typeColors: Record<Node['type'], string> = {
        frontend: 'rgba(59, 130, 246, opacity)',
        backend: 'rgba(139, 143, 230, opacity)',
        database: 'rgba(16, 185, 129, opacity)',
        service: 'rgba(251, 191, 36, opacity)',
      };

      const typeColor = typeColors[node.type].replace('opacity', String(node.opacity * 0.15));
      ctx.fillStyle = typeColor;
      ctx.fillRect(node.x + 8, node.y + 8, node.width - 16, 24);

      ctx.fillStyle = `rgba(31, 41, 55, ${node.opacity})`;
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.label, node.x + node.width / 2, node.y + node.height / 2);

      ctx.restore();
    };

    const drawConnection = (from: Node, to: Node, opacity: number) => {
      const startX = from.x + from.width;
      const startY = from.y + from.height / 2;
      const endX = to.x;
      const endY = to.y + to.height / 2;

      const dx = endX - startX;
      const cp1x = startX + dx * 0.5;
      const cp1y = startY;
      const cp2x = endX - dx * 0.5;
      const cp2y = endY;

      ctx.strokeStyle = `rgba(139, 143, 230, ${opacity * 0.3})`;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
      ctx.stroke();

      const arrowSize = 6;
      const angle = Math.atan2(endY - cp2y, endX - cp2x);

      ctx.fillStyle = `rgba(139, 143, 230, ${opacity * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(
        endX - arrowSize * Math.cos(angle - Math.PI / 6),
        endY - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        endX - arrowSize * Math.cos(angle + Math.PI / 6),
        endY - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      nodesRef.current.forEach((node) => {
        node.x += node.vx;
        node.y += node.vy;

        if (node.x < 50 || node.x > canvas.width - node.width - 50) node.vx *= -1;
        if (node.y < 50 || node.y > canvas.height - node.height - 50) node.vy *= -1;

        node.x = Math.max(50, Math.min(canvas.width - node.width - 50, node.x));
        node.y = Math.max(50, Math.min(canvas.height - node.height - 50, node.y));
      });

      connectionsRef.current.forEach((conn) => {
        const fromNode = nodesRef.current[conn.from];
        const toNode = nodesRef.current[conn.to];
        if (fromNode && toNode) {
          const avgOpacity = (fromNode.opacity + toNode.opacity) / 2;
          drawConnection(fromNode, toNode, avgOpacity);
        }
      });

      nodesRef.current.forEach((node) => {
        drawNode(node);
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const canvasStyles: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  };

  return <canvas ref={canvasRef} style={canvasStyles} />;
}
