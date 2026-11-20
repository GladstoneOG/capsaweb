import type { CSSProperties } from 'react';

export interface TimerInfo {
  totalMs: number;
  remainingMs: number;
  key: number;
}

const CHIP_PALETTES: readonly [string, string][] = [
  ['#2f6fe4', '#1b3f96'], // Sapphire
  ['#d94646', '#8f1d28'], // Ruby
  ['#1f9d74', '#0f5c43'], // Emerald
  ['#d98a2b', '#8e4e11'], // Amber
  ['#8b5cf6', '#4c289e'], // Royal Plum
  ['#0ea5a3', '#0d5e63'], // Deep Teal
  ['#e05a7a', '#912344'], // Rose Garnet
  ['#5b6ee1', '#2c388f'], // Cobalt Indigo
];

function hashName(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

function BotGlyph({ variant }: { variant: number }) {
  switch (variant) {
    case 0:
      // Visor Bot
      return (
        <svg className="avatar-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v3" />
          <circle cx="12" cy="2.5" r="1" fill="currentColor" stroke="none" />
          <rect x="4" y="6" width="16" height="13" rx="5" />
          <rect x="7" y="10" width="10" height="4" rx="2" fill="currentColor" fillOpacity="0.22" />
          <circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 1:
      // Crowned Bot
      return (
        <svg className="avatar-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 8l2-4 3 2.5L15 4l2 4" />
          <rect x="5" y="8" width="14" height="12" rx="4" />
          <path d="M9 13h2M13 13h2M9.5 16.5h5" />
        </svg>
      );
    case 2:
      // Cat-Ear Bot
      return (
        <svg className="avatar-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 10V5l4 3h6l4-3v5a7 7 0 0 1-14 0z" />
          <circle cx="9.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
          <path d="M10.5 16l1.5 1 1.5-1" />
        </svg>
      );
    case 3:
      // Monocle Dealer Bot
      return (
        <svg className="avatar-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="6" width="16" height="13" rx="4" />
          <circle cx="15" cy="11.5" r="2.6" />
          <path d="M17.5 12.5l1.5 4M8.5 11.5h2M9.5 15.5h5" />
          <path d="M8 6l4-2.5L16 6" />
        </svg>
      );
    default:
      // Owl / Ace Bot
      return (
        <svg className="avatar-bot" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4.5" y="6.5" width="15" height="13" rx="6" />
          <path d="M7 6.5L5.5 4M17 6.5L18.5 4" />
          <circle cx="9.5" cy="12" r="2" />
          <circle cx="14.5" cy="12" r="2" />
          <path d="M12 14.5l-1 1.5h2l-1-1.5z" fill="currentColor" stroke="none" />
        </svg>
      );
  }
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
 * Curated casino-chip gradient avatar. When `active` with a `timer`, renders an SVG ring
 * that drains via a single CSS animation (no per-frame JS / React re-renders).
 */
export function Avatar({
  name,
  isBot = false,
  size = 'md',
  active = false,
  dimmed = false,
  timer = null,
}: AvatarProps) {
  const h = hashName(name);
  const [av1, av2] = CHIP_PALETTES[h % CHIP_PALETTES.length];
  const botVariant = (h >>> 3) % 5;

  return (
    <div
      className={`avatar avatar--${size}${active ? ' is-active' : ''}${dimmed ? ' is-dimmed' : ''}`}
      style={
        {
          '--hue': hueFromName(name),
          '--av-1': av1,
          '--av-2': av2,
        } as CSSProperties
      }
    >
      <div className="avatar-core">
        {isBot ? <BotGlyph variant={botVariant} /> : initials(name)}
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
                '--timer-dur': `${timer.totalMs}ms`,
                '--timer-delay': `-${Math.max(0, timer.totalMs - timer.remainingMs)}ms`,
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
