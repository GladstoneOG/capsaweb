import { memo } from 'react';
import type { Suit } from '@engine/types';

interface CourtArtProps {
  rank: 'J' | 'Q' | 'K';
  suit: Suit;
}

interface SuitTheme {
  bg: string;
  primary: string;
  secondary: string;
  accent: string;
  trim: string;
  hair: string;
}

const SUIT_THEMES: Record<Suit, SuitTheme> = {
  H: {
    bg: '#fff2f4',
    primary: '#c91d2b',
    secondary: '#6d1b36',
    accent: '#eab308',
    trim: '#fff8e6',
    hair: '#4a2518',
  },
  D: {
    bg: '#fff7ec',
    primary: '#d9480f',
    secondary: '#1e3a5f',
    accent: '#f59e0b',
    trim: '#fff9eb',
    hair: '#5e3419',
  },
  S: {
    bg: '#f1f5f9',
    primary: '#172030',
    secondary: '#3b4a62',
    accent: '#e5b84b',
    trim: '#f8fafc',
    hair: '#1f242d',
  },
  C: {
    bg: '#eef7f3',
    primary: '#114232',
    secondary: '#25604d',
    accent: '#dfb047',
    trim: '#f5fbf8',
    hair: '#242a26',
  },
};

function MiniSuitMark({ suit, x, y, scale = 1, fill }: { suit: Suit; x: number; y: number; scale?: number; fill: string }) {
  const transform = `translate(${x} ${y}) scale(${scale})`;
  switch (suit) {
    case 'D':
      return <path transform={transform} fill={fill} d="M0-6 L5 0 L0 6 L-5 0 Z" />;
    case 'H':
      return (
        <path
          transform={transform}
          fill={fill}
          d="M0 5.5 C-3.2 2.9 -5.5 1 -5.5-1.6 C-5.5-3.4 -4.1-4.8 -2.4-4.8 C-1.3-4.8 -0.4-4.1 0-3.2 C0.4-4.1 1.3-4.8 2.4-4.8 C4.1-4.8 5.5-3.4 5.5-1.6 C5.5 1 3.2 2.9 0 5.5 Z"
        />
      );
    case 'S':
      return (
        <path
          transform={transform}
          fill={fill}
          d="M0-5.8 C-1.8-3.2 -5.2-1.2 -5.2 1.4 C-5.2 3 -3.9 4.1 -2.4 4.1 C-1.5 4.1 -0.8 3.6 -0.4 3 L-1.4 5.8 L1.4 5.8 L0.4 3 C0.8 3.6 1.5 4.1 2.4 4.1 C3.9 4.1 5.2 3 5.2 1.4 C5.2-1.2 1.8-3.2 0-5.8 Z"
        />
      );
    case 'C':
      return (
        <g transform={transform} fill={fill}>
          <circle cx="0" cy="-2.7" r="2.2" />
          <circle cx="-2.6" cy="0.6" r="2.2" />
          <circle cx="2.6" cy="0.6" r="2.2" />
          <path d="M-0.7 0.6h1.4c0.15 2 0.7 3.6 1.7 5H-2.4c1-1.4 1.55-3 1.7-5z" />
        </g>
      );
  }
}

/**
 * Geometric heraldic court SVG art for Jack, Queen, and King.
 * Each rank has an unmistakable silhouette and each suit carries its own color pairing and crest.
 */
export const CourtArt = memo(function CourtArt({ rank, suit }: CourtArtProps) {
  const t = SUIT_THEMES[suit];
  const skin = '#f4d1ae';
  const skinShade = '#dfb38a';

  if (rank === 'J') {
    return (
      <svg className="court-svg" viewBox="0 0 64 84" aria-hidden="true">
        {/* Framed court card inner panel */}
        <rect x="3" y="3" width="58" height="78" rx="7" fill={t.bg} stroke={t.accent} strokeWidth="1.6" />
        <rect x="6" y="6" width="52" height="72" rx="5" fill="none" stroke={t.primary} strokeOpacity="0.16" strokeWidth="1" />

        {/* Heraldic diagonal sash & tunic */}
        <path d="M9 78 C11 57 21 53 32 53 C43 53 53 57 55 78 Z" fill={t.primary} />
        <path d="M14 78 L42 54 L51 58 L28 78 Z" fill={t.secondary} />
        <path d="M18 78 L45 55" stroke={t.accent} strokeWidth="2.4" strokeLinecap="round" />
        {/* High V-collar */}
        <path d="M22 54 L32 66 L42 54 Z" fill={t.trim} />

        {/* Neck & Chiseled Head */}
        <rect x="27.5" y="45" width="9" height="10" rx="3" fill={skinShade} />
        <path d="M21 37 C21 29 43 29 43 37 L42 44 C41 49 36 52 32 52 C28 52 23 49 22 44 Z" fill={skin} />
        <path d="M32 32 L42 36 L41 45 C39 49 35 51 32 52 Z" fill={skinShade} opacity="0.32" />

        {/* Crisp brow & eyes (no cartoon smile) */}
        <path d="M24.5 37 L29.5 38" stroke={t.hair} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M39.5 37 L34.5 38" stroke={t.hair} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="27.2" cy="40" r="1.3" fill="#171a21" />
        <circle cx="36.8" cy="40" r="1.3" fill="#171a21" />
        <path d="M32 40 L31.2 44 L33 44.3" fill="none" stroke="#b67d56" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M29.5 47 L34.5 47" stroke="#9d5c42" strokeWidth="1.4" strokeLinecap="round" />

        {/* Sweeping Plumed Knave Beret (distinct J silhouette) */}
        <path d="M39 25 C46 17 56 20 53 27 C49 31 43 29 39 28 Z" fill={t.accent} />
        <path d="M16 32 C15 20 26 16 38 18 C45 19 48 25 45 31 Z" fill={t.secondary} />
        <rect x="17" y="28.5" width="30" height="4.8" rx="2.4" fill={t.accent} />

        {/* Suit Crest in top-right corner & cap pin */}
        <MiniSuitMark suit={suit} x={51} y={13} scale={0.78} fill={t.primary} />
        <MiniSuitMark suit={suit} x={45} y={70} scale={0.95} fill={t.accent} />
      </svg>
    );
  }

  if (rank === 'Q') {
    return (
      <svg className="court-svg" viewBox="0 0 64 84" aria-hidden="true">
        <rect x="3" y="3" width="58" height="78" rx="7" fill={t.bg} stroke={t.accent} strokeWidth="1.6" />
        <rect x="6" y="6" width="52" height="72" rx="5" fill="none" stroke={t.primary} strokeOpacity="0.16" strokeWidth="1" />

        {/* Draped Royal Veil / Hair */}
        <path d="M16 34 C13 48 15 64 20 71 L44 71 C49 64 51 48 48 34 Z" fill={t.hair} />

        {/* Sculpted Gown & Raised Royal Collar */}
        <path d="M9 78 C12 57 20 53 32 53 C44 53 52 57 55 78 Z" fill={t.primary} />
        <path d="M21 54 L32 76 L43 54 Z" fill={t.secondary} />
        <path d="M22 54 Q32 62 42 54" fill="none" stroke={t.accent} strokeWidth="2.2" strokeLinecap="round" />

        {/* Neck & Sculpted Face */}
        <rect x="28.5" y="46" width="7" height="9" rx="3" fill={skinShade} />
        <ellipse cx="32" cy="39.5" rx="10.8" ry="11.5" fill={skin} />
        <path d="M21 37 C23 28 31 28 32 32 C33 28 41 28 43 37 C39 32 25 32 21 37 Z" fill={t.hair} />

        {/* Poised brow & eyes */}
        <path d="M24.5 37.5 Q27.2 36.2 29.5 37.8" fill="none" stroke={t.hair} strokeWidth="1.4" strokeLinecap="round" />
        <path d="M34.5 37.8 Q36.8 36.2 39.5 37.5" fill="none" stroke={t.hair} strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="27.5" cy="40.2" r="1.25" fill="#171a21" />
        <circle cx="36.5" cy="40.2" r="1.25" fill="#171a21" />
        <path d="M29.6 46 Q32 47.4 34.4 46" fill="none" stroke={t.primary} strokeWidth="1.5" strokeLinecap="round" />

        {/* Tall 3-Peak Queen Diadem (distinct Q silhouette) */}
        <path d="M20 30 L22 18 L27.5 24 L32 12 L36.5 24 L42 18 L44 30 Z" fill={t.accent} stroke="#9c6c12" strokeWidth="0.9" strokeLinejoin="round" />
        <polygon points="32,17 34.8,21.5 32,26 29.2,21.5" fill={t.primary} />
        <circle cx="24" cy="25.5" r="1.6" fill={t.trim} />
        <circle cx="40" cy="25.5" r="1.6" fill={t.trim} />

        {/* Suit Crest in top-right corner & royal chest brooch */}
        <MiniSuitMark suit={suit} x={51} y={13} scale={0.78} fill={t.primary} />
        <MiniSuitMark suit={suit} x={32} y={66} scale={1.0} fill={t.accent} />
      </svg>
    );
  }

  // King (K)
  return (
    <svg className="court-svg" viewBox="0 0 64 84" aria-hidden="true">
      <rect x="3" y="3" width="58" height="78" rx="7" fill={t.bg} stroke={t.accent} strokeWidth="1.6" />
      <rect x="6" y="6" width="52" height="72" rx="5" fill="none" stroke={t.primary} strokeOpacity="0.16" strokeWidth="1" />

      {/* Broad Regal Mantle & Vertical Ermine Trim */}
      <path d="M7 78 C9 55 19 51 32 51 C45 51 55 55 57 78 Z" fill={t.primary} />
      <path d="M18 53 L25 78 L39 78 L46 53 Z" fill={t.secondary} />
      <path d="M19 53 L24 78" stroke={t.trim} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M45 53 L40 78" stroke={t.trim} strokeWidth="4.2" strokeLinecap="round" />

      {/* Face & Geometric Royal Beard */}
      <ellipse cx="32" cy="39" rx="11.2" ry="11.8" fill={skin} />
      <path d="M21 40 C21 51 27 57 32 57 C37 57 43 51 43 40 L38.5 45 L32 47 L25.5 45 Z" fill={t.hair} />
      <path d="M25.5 43.5 Q29 41.5 32 43.8 Q35 41.5 38.5 43.5" fill="none" stroke={t.hair} strokeWidth="2.4" strokeLinecap="round" />

      {/* Commanding brow & eyes */}
      <path d="M24.5 36.2 L30 37.2" stroke={t.hair} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M39.5 36.2 L34 37.2" stroke={t.hair} strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="27.5" cy="39" r="1.35" fill="#171a21" />
      <circle cx="36.5" cy="39" r="1.35" fill="#171a21" />

      {/* Heavy 5-Point Sovereign Crown (distinct K silhouette) */}
      <path d="M16 30 L18 15 L25 22 L32 11 L39 22 L46 15 L48 30 Z" fill={t.accent} stroke="#8f620f" strokeWidth="1" strokeLinejoin="round" />
      <rect x="16" y="27" width="32" height="5" rx="2" fill={t.primary} stroke={t.accent} strokeWidth="1.1" />
      <circle cx="32" cy="10.5" r="2.1" fill={t.accent} />

      {/* Suit Crest in top-right corner & gold chest medallion */}
      <MiniSuitMark suit={suit} x={51} y={13} scale={0.78} fill={t.primary} />
      <circle cx="32" cy="66.5" r="7" fill={t.accent} stroke="#8f620f" strokeWidth="1" />
      <MiniSuitMark suit={suit} x={32} y={66.5} scale={0.82} fill={t.primary} />
    </svg>
  );
});
