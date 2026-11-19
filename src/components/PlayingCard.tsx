import type { Card, Suit } from '@engine/types';

function SuitGlyph({ suit, className }: { suit: Suit; className?: string }) {
  switch (suit) {
    case 'D':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 2L20.5 12L12 22L3.5 12Z" />
        </svg>
      );
    case 'C':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <circle cx="12" cy="7.5" r="4.1" />
          <circle cx="7.4" cy="13.2" r="4.1" />
          <circle cx="16.6" cy="13.2" r="4.1" />
          <path d="M10.4 14.5h3.2l1.6 7H8.8z" />
        </svg>
      );
    case 'H':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      );
    case 'S':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
          <path d="M12 2C9 6.5 3.5 9.8 3.5 14c0 2.9 2.2 4.8 4.8 4.8 1.5 0 2.6-.7 3.2-1.6L10 22h4l-1.5-4.8c.6.9 1.7 1.6 3.2 1.6 2.6 0 4.8-1.9 4.8-4.8C20.5 9.8 15 6.5 12 2z" />
        </svg>
      );
  }
}

interface PlayingCardProps {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  interactive?: boolean;
  highlightStarting?: boolean;
  onClick?: () => void;
}

export function PlayingCard({
  card,
  size = 'md',
  selected = false,
  interactive = false,
  highlightStarting = false,
  onClick,
}: PlayingCardProps) {
  const isRed = card.suit === 'D' || card.suit === 'H';
  const classes = [
    'playing-card',
    size !== 'md' ? size : '',
    isRed ? 'red' : 'black',
    interactive ? 'interactive' : '',
    selected ? 'selected' : '',
    highlightStarting ? 'starting-highlight' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const Tag = interactive ? 'button' : 'div';

  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={classes}
      onClick={onClick}
      aria-pressed={interactive ? selected : undefined}
      aria-label={`${card.rank} of ${
        card.suit === 'D'
          ? 'Diamonds'
          : card.suit === 'C'
            ? 'Clubs'
            : card.suit === 'H'
              ? 'Hearts'
              : 'Spades'
      }`}
    >
      <div className="card-corner">
        <span className="card-rank">{card.rank}</span>
        <SuitGlyph suit={card.suit} className="card-corner-suit" />
      </div>

      <div className="card-center-suit">
        <SuitGlyph suit={card.suit} />
      </div>

      <div className="card-corner bottom">
        <span className="card-rank">{card.rank}</span>
        <SuitGlyph suit={card.suit} className="card-corner-suit" />
      </div>

      {highlightStarting && <span className="card-start-dot" title="Starting card" />}
    </Tag>
  );
}
