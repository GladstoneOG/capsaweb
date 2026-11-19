import type { CSSProperties } from 'react';
import { Bot } from 'lucide-react';

export interface TimerInfo {
  totalMs: number;
  remainingMs: number;
  key: number;
}

export function hueFromName(name: string): number {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? '?').slice(0, 2).toUpperCase();
}

const R = 46;
const C = 2 * Math.PI * R;

interface AvatarProps {
  name: string;
  isBot?: boolean;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  dimmed?: boolean;
  timer?: TimerInfo | null;
}

/**
 * Gradient avatar. When `active` with a `timer`, renders an SVG ring that drains via a
 * single CSS animation (no per-frame JS / React re-renders).
 */
export function Avatar({
  name,
  isBot = false,
  size = 'md',
  active = false,
  dimmed = false,
  timer = null,
}: AvatarProps) {
  return (
    <div
      className={`avatar avatar--${size}${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}`}
      style={{ '--hue': hueFromName(name) } as CSSProperties}
    >
      <div className="avatar-core">
        {isBot ? <Bot className="avatar-bot" strokeWidth={2.2} /> : initials(name)}
      </div>
      {active && timer && timer.totalMs > 0 && (
        <svg key={timer.key} className="avatar-timer" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="avatar-timer-track" cx="50" cy="50" r={R} />
          <circle
            className="avatar-timer-bar"
            cx="50"
            cy="50"
            r={R}
            style={
              {
                strokeDasharray: `${C}px`,
                '--c': `${C}px`,
                animationDuration: `${timer.totalMs}ms`,
                animationDelay: `-${Math.max(0, timer.totalMs - timer.remainingMs)}ms`,
              } as CSSProperties
            }
          />
        </svg>
      )}
    </div>
  );
}
