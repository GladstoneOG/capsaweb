import type { CSSProperties } from 'react';
import type { Card, Suit } from '@engine/types';
import { CourtArt } from './CourtArt';

export function SuitGlyph({ suit, className }: { suit: Suit; className?: string }) {
  switch (suit) {
    case 'D':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 1.8c2.2 3.4 4.9 6.6 8.2 10.2-3.3 3.6-6 6.8-8.2 10.2C9.8 18.8 7.1 15.6 3.8 12 7.1 8.4 9.8 5.2 12 1.8z" />
        </svg>
      );
    case 'C':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <circle cx="12" cy="7.2" r="4.3" />
          <circle cx="7" cy="13.4" r="4.3" />
          <circle cx="17" cy="13.4" r="4.3" />
          <path d="M11 13h2c.2 3.4 1.2 6.2 3 8.6H8c1.8-2.4 2.8-5.2 3-8.6z" />
        </svg>
      );
    case 'H':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 21.6C6.2 16.9 2 13.3 2 8.6 2 5.5 4.4 3.2 7.3 3.2c1.9 0 3.6 1 4.7 2.6 1.1-1.6 2.8-2.6 4.7-2.6 2.9 0 5.3 2.3 5.3 5.4 0 4.7-4.2 8.3-10 13z" />
        </svg>
      );
    case 'S':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 1.6c-2.6 3.9-8.6 7.4-8.6 11.9 0 2.8 2.1 4.8 4.7 4.8 1.4 0 2.6-.6 3.3-1.6-.2 2-1 3.6-2.4 5.3h6c-1.4-1.7-2.2-3.3-2.4-5.3.7 1 1.9 1.6 3.3 1.6 2.6 0 4.7-2 4.7-4.8 0-4.5-6-8-8.6-11.9z" />
        </svg>
      );
  }
}

const SUIT_NAMES: Record<Suit, string> = { D: 'Diamonds', C: 'Clubs', H: 'Hearts', S: 'Spades' };

type PipCoord = readonly [x: number, y: number, flip?: boolean];

const PIP_LAYOUTS: Record<string, readonly PipCoord[]> = {
  '2': [
    [50, 14],
    [50, 86, true],
  ],
  '3': [
    [50, 14],
    [50, 50],
    [50, 86, true],
  ],
  '4': [
    [25, 14],
    [75, 14],
    [25, 86, true],
    [75, 86, true],
  ],
  '5': [
    [25, 14],
    [75, 14],
    [50, 50],
    [25, 86, true],
    [75, 86, true],
  ],
  '6': [
    [25, 14],
    [75, 14],
    [25, 50],
    [75, 50],
    [25, 86, true],
    [75, 86, true],
  ],
  '7': [
    [25, 14],
    [75, 14],
    [50, 32],
    [25, 50],
    [75, 50],
    [25, 86, true],
    [75, 86, true],
  ],
  '8': [
    [25, 14],
    [75, 14],
    [50, 32],
    [25, 50],
    [75, 50],
    [50, 68, true],
    [25, 86, true],
    [75, 86, true],
  ],
  '9': [
    [27, 10],
    [73, 10],
    [27, 36.5],
    [73, 36.5],
    [50, 50],
    [27, 63.5, true],
    [73, 63.5, true],
    [27, 90, true],
    [73, 90, true],
  ],
  '10': [
    [27, 10],
    [73, 10],
    [50, 23.25],
    [27, 36.5],
    [73, 36.5],
    [27, 63.5, true],
    [73, 63.5, true],
    [50, 76.75, true],
    [27, 90, true],
    [73, 90, true],
  ],
};

function pipTierClass(rank: string): string {
  if (rank === '2' || rank === '3') return 'pcard-pips--t1';
  if (rank === '4' || rank === '5' || rank === '6') return 'pcard-pips--t2';
  if (rank === '7' || rank === '8') return 'pcard-pips--t3';
  return 'pcard-pips--t4';
}

interface PlayingCardProps {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  interactive?: boolean;
  highlightStarting?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export function PlayingCard({
  card,
  size = 'md',
  selected = false,
  interactive = false,
  highlightStarting = false,
  onClick,
  onPointerDown,
  onKeyDown,
}: PlayingCardProps) {
  const isRed = card.suit === 'D' || card.suit === 'H';
  const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
  const isAce = card.rank === 'A';
  const isDeuce = card.rank === '2';
  const pipLayout = size !== 'sm' ? PIP_LAYOUTS[card.rank] : undefined;

  const classes = [
    'pcard',
    `pcard--${size}`,
    isRed ? 'is-red' : 'is-black',
    isFace ? 'is-court' : '',
    isAce ? 'is-ace' : '',
    isDeuce ? 'is-deuce' : '',
    interactive ? 'is-interactive' : '',
    selected ? 'is-selected' : '',
    highlightStarting ? 'is-start' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const inner = (
    <>
      <span className="pcard-frame" aria-hidden="true" />
      <span className="pcard-idx">
        <span className={`pcard-rank${card.rank === '10' ? ' is-ten' : ''}`}>{card.rank}</span>
        <SuitGlyph suit={card.suit} />
      </span>
      <span className="pcard-center">
        {isFace ? (
          <span className="pcard-court">
            <CourtArt rank={card.rank as 'J' | 'Q' | 'K'} suit={card.suit} />
          </span>
        ) : pipLayout ? (
          <>
            <span
              className={`pcard-pips ${pipTierClass(card.rank)}${isDeuce ? ' is-deuce-pips' : ''}`}
              aria-hidden="true"
            >
              {pipLayout.map(([x, y, flip], idx) => (
                <span
                  key={idx}
                  className={`pcard-pip-cell${flip ? ' is-flip' : ''}`}
                  style={{ '--px': `${x}%`, '--py': `${y}%` } as CSSProperties}
                >
                  <SuitGlyph suit={card.suit} />
                </span>
              ))}
            </span>
            <SuitGlyph
              suit={card.suit}
              className={`pcard-pip pcard-pip--mobile-fallback${isDeuce ? ' is-big' : ''}`}
            />
          </>
        ) : isAce ? (
          <span className={`pcard-ace-emblem${card.suit === 'S' ? ' is-spade-ace' : ''}`}>
            <SuitGlyph suit={card.suit} className="pcard-pip is-big" />
          </span>
        ) : (
          <SuitGlyph
            suit={card.suit}
            className={`pcard-pip${isDeuce ? ' is-big' : ''}`}
          />
        )}
      </span>
      <span className="pcard-idx is-br">
        <span className={`pcard-rank${card.rank === '10' ? ' is-ten' : ''}`}>{card.rank}</span>
        <SuitGlyph suit={card.suit} />
      </span>
    </>
  );

  const label = `${card.rank} of ${SUIT_NAMES[card.suit]}`;

  if (interactive) {
    return (
      <button
        type="button"
        className={classes}
        draggable={false}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        aria-pressed={selected}
        aria-label={label}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={classes} role="img" aria-label={label}>
      {inner}
    </div>
  );
}

export function CardBack({ className = '' }: { className?: string }) {
  return <span className={`card-back ${className}`} aria-hidden="true" />;
}
