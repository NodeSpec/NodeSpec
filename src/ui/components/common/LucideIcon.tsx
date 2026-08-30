import { memo } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideProps } from 'lucide-react';

type IconComponent = React.ComponentType<LucideProps>;

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

const iconRegistry = LucideIcons as unknown as Record<string, IconComponent>;

function resolveIcon(name: string): IconComponent | null {
  if (iconRegistry[name] && typeof iconRegistry[name] === 'function') return iconRegistry[name];
  const pascal = toPascalCase(name);
  if (iconRegistry[pascal] && typeof iconRegistry[pascal] === 'function') return iconRegistry[pascal];
  return null;
}

interface LucideIconProps {
  name: string | undefined | null;
  size?: number;
  color?: string;
  className?: string;
}

function LucideIconComponent({ name, size = 24, color, className }: LucideIconProps) {
  if (!name) return null;
  const Icon = resolveIcon(name);
  if (!Icon) return null;
  return <Icon size={size} color={color} className={className} />;
}

export const LucideIcon = memo(LucideIconComponent);

export function isLucideIconName(value: string | undefined | null): boolean {
  if (!value) return false;
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) return false;
  return resolveIcon(value) !== null;
}
