import { useState, type CSSProperties } from 'react';
import { ArrowLeftRight, Play, Send, Trophy, X } from 'lucide-react';
import { RANKS, SUITS, SUIT_SYMBOLS, cardToString } from '@engine/cards';
import type {
  ActivityEntry,
  Card,
  ClientIntent,
  DiceShowdown,
  Rank,
  SanitizedRoomState,
  Suit,
} from '@engine/types';
import { Avatar } from './Avatar';
import { Confetti } from './Confetti';
import { PlayingCard } from './PlayingCard';

// ==================== DICE DUEL ====================

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, delay = 0 }: { value: number; delay?: number }) {
  const on = PIPS[value] ?? [];
  return (
    <div className="die" style={{ animationDelay: `${delay}ms` }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`die-pip${on.includes(i) ? ' is-on' : ''}`} />
      ))}
    </div>
  );
}

export function DiceDuelModal({ showdown, onDismiss }: { showdown: DiceShowdown; onDismiss: () => void }) {
  const aWins = showdown.winnerId === showdown.playerA.id;
  return (
    <div className="modal-backdrop">
      <div className="modal modal--center">
        <div className="eyebrow">3♦ tiebreaker</div>
        <h2 className="modal-title">Dice duel!</h2>
        <p className="modal-sub">Both of you hold 3♦ — highest roll leads the round.</p>

        <div className="duel">
          <div className={`duel-side${aWins ? ' is-winner' : ''}`}>
            <Avatar name={showdown.playerA.name} size="md" />
            <div className="duel-name">{showdown.playerA.name}</div>
            <Die value={showdown.playerA.roll} />
          </div>
          <div className="duel-vs">vs</div>
          <div className={`duel-side${!aWins ? ' is-winner' : ''}`}>
            <Avatar name={showdown.playerB.name} size="md" />
            <div className="duel-name">{showdown.playerB.name}</div>
            <Die value={showdown.playerB.roll} delay={120} />
          </div>
        </div>

        {showdown.rollsHistory.length > 1 && (
          <p className="fine-print">
            {showdown.rollsHistory.length - 1} tied roll{showdown.rollsHistory.length > 2 ? 's' : ''} before a winner.
          </p>
        )}

        <button type="button" className="btn btn-primary" onClick={onDismiss}>
          {showdown.winnerName} leads — let's go
        </button>
      </div>
    </div>
  );
}

// ==================== TRADE: REQUEST ====================

export function TradeRequestModal({
  myCards,
  onRequest,
  onClose,
}: {
  myCards: Card[];
  onRequest: (rank: Rank, suit: Suit) => void;
  onClose: () => void;
}) {
  const held = new Set(myCards.map((c) => `${c.rank}_${c.suit}`));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <div className="eyebrow">
          <ArrowLeftRight size={12} /> Card trade
        </div>
        <h2 className="modal-title">Which card do you want?</h2>
        <p className="modal-sub">
          Whoever holds it can say no — or hand it over along with one card they don't want.
        </p>
        <div className="trade-board">
          {SUITS.map((suit) => (
            <div key={suit} className="trade-row">
              {RANKS.map((rank) => (
                <button
                  key={`${rank}_${suit}`}
                  type="button"
                  disabled={held.has(`${rank}_${suit}`)}
                  className={`trade-cell ${suit === 'D' || suit === 'H' ? 'is-red' : 'is-black'}`}
                  onClick={() => onRequest(rank, suit)}
                >
                  {rank}
                  <small>{SUIT_SYMBOLS[suit]}</small>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== TRADE: RESPOND ====================

export function TradeRespondModal({
  requesterName,
  requestedCard,
  myCards,
  onFulfill,
  onDecline,
}: {
  requesterName: string;
  requestedCard: Card;
  myCards: Card[];
  onFulfill: (extraCardId: string) => void;
  onDecline: () => void;
}) {
  const [extraId, setExtraId] = useState<string | null>(null);
  const candidates = myCards.filter((c) => !(c.rank === requestedCard.rank && c.suit === requestedCard.suit));

  return (
    <div className="modal-backdrop">
      <div className="modal modal--wide">
        <div className="eyebrow">
          <ArrowLeftRight size={12} /> Incoming trade
        </div>
        <h2 className="modal-title">
          {requesterName} wants your <span className="gold">{cardToString(requestedCard)}</span>
        </h2>
        <p className="modal-sub">Pick one card to dump on them as part of the deal — or just say no.</p>

        <div className="trade-pick">
          {candidates.map((card) => (
            <PlayingCard
              key={card.id}
              card={card}
              size="sm"
              interactive
              selected={extraId === card.id}
              onClick={() => setExtraId((prev) => (prev === card.id ? null : card.id))}
            />
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onDecline}>
            No thanks
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!extraId}
            onClick={() => extraId && onFulfill(extraId)}
          >
            Send both cards
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== SCOREBOARD ====================

export function ScoreboardModal({
  room,
  isHost,
  onIntent,
  onLeave,
}: {
  room: SanitizedRoomState;
  isHost: boolean;
  onIntent: (intent: ClientIntent) => void;
  onLeave: () => void;
}) {
  const isGameOver = room.gameState === 'gameover';
  const sorted = [...room.players].sort((a, b) =>
    isGameOver ? b.score - a.score : (a.finishRank ?? 99) - (b.finishRank ?? 99)
  );
  const top = sorted[0];
  const me = room.players.find((p) => p.id === room.viewerId);
  const iWon = isGameOver ? top?.id === room.viewerId : me?.finishRank === 1;
  const headline = isGameOver
    ? iWon
      ? 'You won the match!'
      : `${top?.name} takes the match`
    : iWon
      ? 'You went out first!'
      : `${top?.name} wins round ${room.roundNumber}`;

  return (
    <div className="modal-backdrop">
      {iWon && <Confetti />}
      <div className="modal">
        <div className="score-hero">
          <div className="trophy">
            <Trophy size={26} />
          </div>
          <div>
            <div className="eyebrow">{isGameOver ? 'Match over' : `Round ${room.roundNumber}`}</div>
            <h2 className="modal-title">{headline}</h2>
          </div>
        </div>

        <ol className="standings">
          {sorted.map((p, idx) => {
            const pct = Math.min(100, (p.score / Math.max(1, room.rules.pointsToWin)) * 100);
            const place = isGameOver ? idx + 1 : (p.finishRank ?? idx + 1);
            return (
              <li
                key={p.id}
                className={`standing${p.id === room.viewerId ? ' is-me' : ''}`}
                style={{ '--d': `${idx * 70}ms` } as CSSProperties}
              >
                <span className={`medal medal--${place}`}>{place}</span>
                <Avatar name={p.name} isBot={p.isBot} size="sm" />
                <div className="standing-main">
                  <div className="standing-name">
                    {p.name}
                    {p.id === room.viewerId && <span className="you-tag">you</span>}
                  </div>
                  <div className="standing-bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="standing-gain">+{p.roundPoints}</span>
                <span className="standing-total">{p.score}</span>
              </li>
            );
          })}
        </ol>
        <p className="fine-print">
          +3 / +2 / +1 / 0 per round · first to {room.rules.pointsToWin} wins
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onLeave}>
            Leave table
          </button>
          {isHost ? (
            <button type="button" className="btn btn-primary" onClick={() => onIntent({ type: 'NEXT_ROUND' })}>
              <Play size={15} />
              {isGameOver ? 'Rematch' : 'Deal next round'}
            </button>
          ) : (
            <span className="waiting-dots">Waiting for host</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== CHAT DRAWER ====================

export function ActivityDrawer({
  entries,
  onSendChat,
  onClose,
}: {
  entries: ActivityEntry[];
  onSendChat: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const ordered = [...entries].reverse();

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <strong>Table talk</strong>
          <button type="button" className="icon-btn icon-btn--sm" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form
          className="drawer-form"
          onSubmit={(e) => {
            e.preventDefault();
            const clean = text.trim();
            if (!clean) return;
            onSendChat(clean);
            setText('');
          }}
        >
          <input
            className="input"
            type="text"
            maxLength={200}
            placeholder="Talk some trash…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="icon-btn icon-btn--gold" aria-label="Send" disabled={!text.trim()}>
            <Send size={15} />
          </button>
        </form>

        <div className="drawer-feed">
          {ordered.length === 0 && <div className="drawer-empty">Quiet table so far.</div>}
          {ordered.map((entry) =>
            entry.system ? (
              <div key={entry.id} className="feed-sys">
                {entry.text}
              </div>
            ) : (
              <div key={entry.id} className="feed-msg">
                <Avatar name={entry.senderName} size="sm" />
                <div>
                  <div className="feed-who">{entry.senderName}</div>
                  <div className="feed-text">{entry.text}</div>
                </div>
              </div>
            )
          )}
        </div>
      </aside>
    </div>
  );
}
