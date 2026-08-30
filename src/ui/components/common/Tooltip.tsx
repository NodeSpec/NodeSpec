import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../../theme/ThemeContext.js';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({ content, children, position = 'top', delay = 400 }: TooltipProps) {
  const { theme } = useTheme();
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const tooltipStyles: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: theme.mode === 'dark' ? '#1f2937' : '#374151',
    color: '#ffffff',
    padding: '6px 10px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '1.4',
    whiteSpace: 'nowrap',
    maxWidth: '240px',
    boxShadow: theme.mode === 'dark'
      ? '0 4px 12px rgba(0, 0, 0, 0.4)'
      : '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: 10001,
    pointerEvents: 'none',
    opacity: isVisible ? 1 : 0,
    transition: 'opacity 0.15s ease',
    ...getPositionStyles(position),
  };

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && (
        <div style={tooltipStyles}>
          {content}
          <div style={getArrowStyles(position, theme.mode === 'dark')} />
        </div>
      )}
    </div>
  );
}

function getPositionStyles(position: string): React.CSSProperties {
  switch (position) {
    case 'top':
      return {
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: '8px',
      };
    case 'bottom':
      return {
        top: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginTop: '8px',
      };
    case 'left':
      return {
        right: '100%',
        top: '50%',
        transform: 'translateY(-50%)',
        marginRight: '8px',
      };
    case 'right':
      return {
        left: '100%',
        top: '50%',
        transform: 'translateY(-50%)',
        marginLeft: '8px',
      };
    default:
      return {};
  }
}

function getArrowStyles(position: string, isDark: boolean): React.CSSProperties {
  const color = isDark ? '#1f2937' : '#374151';
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    borderStyle: 'solid',
  };

  switch (position) {
    case 'top':
      return {
        ...base,
        top: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        borderWidth: '6px 6px 0 6px',
        borderColor: `${color} transparent transparent transparent`,
      };
    case 'bottom':
      return {
        ...base,
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        borderWidth: '0 6px 6px 6px',
        borderColor: `transparent transparent ${color} transparent`,
      };
    case 'left':
      return {
        ...base,
        left: '100%',
        top: '50%',
        transform: 'translateY(-50%)',
        borderWidth: '6px 0 6px 6px',
        borderColor: `transparent transparent transparent ${color}`,
      };
    case 'right':
      return {
        ...base,
        right: '100%',
        top: '50%',
        transform: 'translateY(-50%)',
        borderWidth: '6px 6px 6px 0',
        borderColor: `transparent ${color} transparent transparent`,
      };
    default:
      return base;
  }
}
