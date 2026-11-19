import type { Suit } from '@engine/types';

interface CourtArtProps {
  rank: 'J' | 'Q' | 'K';
  suit: Suit;
}

/**
 * Lightweight, colorful royal court SVG illustrations for Jack, Queen, and King.
 * Palette adapts cleanly to red (♦♥) vs black (♣♠) suits.
 */
export function CourtArt({ rank, suit }: CourtArtProps) {
  const isRed = suit === 'D' || suit === 'H';
  const primary = isRed ? '#c92a2a' : '#243b55';
  const secondary = isRed ? '#2b4c7e' : '#b83227';
  const accent = isRed ? '#f0b429' : '#e5b84b';
  const trim = '#fff8e1';
  const skin = '#f7d6b5';
  const hair = isRed ? '#5c3317' : '#2c2520';

  if (rank === 'J') {
    return (
      <svg className="court-svg" viewBox="0 0 64 84" aria-hidden="true">
        {/* Ornate background arch */}
        <rect x="4" y="4" width="56" height="76" rx="8" fill={isRed ? '#fff3ed' : '#eef3f8'} stroke={accent} strokeWidth="1.5" />
        {/* Royal tunic shoulders */}
        <path d="M10 78 C12 58 22 54 32 54 C42 54 52 58 54 78 Z" fill={primary} />
        <path d="M22 55 L32 70 L42 55" fill={secondary} />
        <path d="M26 55 L32 64 L38 55" fill={trim} />
        {/* Golden collar trim */}
        <path d="M21 56 L32 72 L43 56" fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Neck & Face */}
        <rect x="28" y="46" width="8" height="9" rx="3" fill={skin} />
        <ellipse cx="32" cy="39" rx="11.5" ry="12" fill={skin} />
        {/* Hair fringe */}
        <path d="M20.5 36 C21 27 43 27 43.5 36 C39 32 25 32 20.5 36 Z" fill={hair} />
        {/* Eyes & confident smile */}
        <circle cx="28" cy="39.5" r="1.35" fill="#1e2229" />
        <circle cx="36" cy="39.5" r="1.35" fill="#1e2229" />
        <path d="M29 44.5 Q32 47 35 44.5" fill="none" stroke="#9e5a44" strokeWidth="1.5" strokeLinecap="round" />
        {/* Plumed Knave Beret */}
        <path d="M44 26 C52 17 56 20 51 28 C48 31 44 30 42 29 Z" fill={accent} />
        <path d="M18 32 C17 21 27 17 37 19 C44 20 47 26 45 32 Z" fill={secondary} />
        <rect x="19" y="29" width="26" height="4.5" rx="2.2" fill={accent} />
        <circle cx="32" cy="31.2" r="2" fill={primary} />
        {/* Mini emblem on chest */}
        <circle cx="32" cy="72" r="3.2" fill={accent} />
      </svg>
    );
  }

  if (rank === 'Q') {
    return (
      <svg className="court-svg" viewBox="0 0 64 84" aria-hidden="true">
        <rect x="4" y="4" width="56" height="76" rx="8" fill={isRed ? '#fff2f4' : '#f1f3fa'} stroke={accent} strokeWidth="1.5" />
        {/* Flowing hair behind shoulders */}
        <path d="M18 35 C15 48 16 62 20 68 L44 68 C48 62 49 48 46 35 Z" fill="#c98a3a" />
        {/* Royal gown */}
        <path d="M9 78 C12 58 21 54 32 54 C43 54 52 58 55 78 Z" fill={primary} />
        <path d="M22 55 Q32 66 42 55 L46 78 L18 78 Z" fill={secondary} />
        {/* Pearl necklace */}
        <path d="M23 55 Q32 63 41 55" fill="none" stroke={trim} strokeWidth="2.4" strokeDasharray="1.5 3.5" strokeLinecap="round" />
        {/* Neck & Face */}
        <rect x="28.5" y="47" width="7" height="8" rx="3" fill={skin} />
        <ellipse cx="32" cy="39.5" rx="11" ry="11.8" fill={skin} />
        {/* Hair bangs */}
        <path d="M21 37 C23 29 31 28 32 32 C33 28 41 29 43 37 C39 32 25 32 21 37 Z" fill="#d99b43" />
        {/* Eyes, rosy cheeks, smile */}
        <circle cx="28" cy="40" r="1.3" fill="#1e2229" />
        <circle cx="36" cy="40" r="1.3" fill="#1e2229" />
        <circle cx="25" cy="42.5" r="2" fill="#f29494" opacity="0.45" />
        <circle cx="39" cy="42.5" r="2" fill="#f29494" opacity="0.45" />
        <path d="M29.5 45 Q32 47.2 34.5 45" fill="none" stroke="#c44d56" strokeWidth="1.5" strokeLinecap="round" />
        {/* Jeweled Queen Tiara */}
        <path d="M21 30 L23 19 L28 24 L32 14 L36 24 L41 19 L43 30 Z" fill={accent} stroke="#b37f1c" strokeWidth="0.9" strokeLinejoin="round" />
        <circle cx="32" cy="23.5" r="2.3" fill={primary} />
        <circle cx="25.5" cy="26" r="1.5" fill="#38bdf8" />
        <circle cx="38.5" cy="26" r="1.5" fill="#38bdf8" />
        {/* Little rose accent */}
        <circle cx="46" cy="67" r="4" fill="#e63946" />
        <circle cx="46" cy="67" r="1.8" fill="#ffb4a2" />
      </svg>
    );
  }

  // King (K)
  return (
    <svg className="court-svg" viewBox="0 0 64 84" aria-hidden="true">
      <rect x="4" y="4" width="56" height="76" rx="8" fill={isRed ? '#fff6e8' : '#eef2f7'} stroke={accent} strokeWidth="1.5" />
      {/* Royal cloak & ermine mantle */}
      <path d="M8 78 C10 56 20 52 32 52 C44 52 54 56 56 78 Z" fill={primary} />
      <path d="M18 54 L26 78 L38 78 L46 54 Z" fill={secondary} />
      {/* Ermine trim strips */}
      <path d="M19 54 L24 78" stroke={trim} strokeWidth="4" strokeLinecap="round" />
      <path d="M45 54 L40 78" stroke={trim} strokeWidth="4" strokeLinecap="round" />
      <circle cx="21" cy="63" r="1" fill="#222" />
      <circle cx="22.5" cy="71" r="1" fill="#222" />
      <circle cx="43" cy="63" r="1" fill="#222" />
      <circle cx="41.5" cy="71" r="1" fill="#222" />
      {/* Gold medallion */}
      <circle cx="32" cy="65" r="4.5" fill={accent} stroke="#9c6c12" strokeWidth="1" />
      <circle cx="32" cy="65" r="2" fill={primary} />
      {/* Face */}
      <ellipse cx="32" cy="39" rx="11.5" ry="12" fill={skin} />
      {/* Regal beard & mustache */}
      <path d="M21 40 C21 51 27 56 32 56 C37 56 43 51 43 40 C40 44 37 46 32 46 C27 46 24 44 21 40 Z" fill={hair} />
      <path d="M25.5 44 Q29 42 32 44.5 Q35 42 38.5 44" fill="none" stroke={hair} strokeWidth="2.4" strokeLinecap="round" />
      {/* Eyes */}
      <circle cx="28" cy="38.5" r="1.4" fill="#1e2229" />
      <circle cx="36" cy="38.5" r="1.4" fill="#1e2229" />
      {/* 5-point Royal King Crown */}
      <path d="M18 30 L20 16 L26 23 L32 12 L38 23 L44 16 L46 30 Z" fill={accent} stroke="#9c6c12" strokeWidth="1" strokeLinejoin="round" />
      <rect x="18" y="27.5" width="28" height="4.5" rx="2" fill={primary} stroke={accent} strokeWidth="1" />
      <circle cx="32" cy="29.7" r="1.8" fill="#ffe1a0" />
      <circle cx="24" cy="29.7" r="1.3" fill="#34d399" />
      <circle cx="40" cy="29.7" r="1.3" fill="#34d399" />
      <circle cx="32" cy="11.5" r="2" fill={accent} />
    </svg>
  );
}
