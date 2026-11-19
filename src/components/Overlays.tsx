import { useState } from 'react';
import { ArrowLeftRight, Dices, Play, Send, Trophy, X } from 'lucide-react';
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
import { PlayingCard } from './PlayingCard';

// ==================== DICE DUEL MODAL ====================

export function DiceDuelModal({
  showdown,
  onDismiss,
}: {
  showdown: DiceShowdown;
  onDismiss: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="panel modal-box" style={{ textAlign: 'center' }}>
        <div className="brand-emblem" style={{ marginBottom: 8 }}>
          <Dices size={14} />
          <span>3♦ Tiebreaker Duel</span>
        </div>
        <h2 className="modal-title">{showdown.winnerName} Leads the Round!</h2>
        <p className="modal-sub">{showdown.reason}</p>

        <div className="dice-arena">
          <div className={`dice-box ${showdown.winnerId === showdown.playerA.id ? 'winner' : ''}`}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{showdown.playerA.name}</div>
            <div className="dice-num">{showdown.playerA.roll}</div>
            {showdown.winnerId === showdown.playerA.id && (
              <span className="pill pill-gold">Winner</span>
            )}
          </div>

          <div style={{ fontWeight: 800, color: 'var(--text-muted)', fontSize: '0.9rem' }}>VS</div>

          <div className={`dice-box ${showdown.winnerId === showdown.playerB.id ? 'winner' : ''}`}>
            <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{showdown.playerB.name}</div>
            <div className="dice-num">{showdown.playerB.roll}</div>
            {showdown.winnerId === showdown.playerB.id && (
              <span className="pill pill-gold">Winner</span>
            )}
          </div>
        </div>

        {showdown.rollsHistory.length > 1 && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
            Rerolled {showdown.rollsHistory.length - 1} tie
            {showdown.rollsHistory.length > 2 ? 's' : ''} before deciding.
          </p>
        )}

        <button type="button" className="btn btn-primary" onClick={onDismiss}>
          Continue to Table
        </button>
      </div>
    </div>
  );
}

// ==================== TRADE REQUEST PICKER MODAL ====================

export function TradeRequestModal({
  myCards,
  onRequest,
  onClose,
}: {
  myCards: Card[];
  onRequest: (rank: Rank, suit: Suit) => void;
  onClose: () => void;
}) {
  const heldSet = new Set(myCards.map((c) => `${c.rank}_${c.suit}`));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel modal-box" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ArrowLeftRight size={18} /> Request a Card
          </h2>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className="modal-sub">
          Pick a card you do not hold. Whoever holds it may decline, or send it to you along with 1 extra card of their choice.
        </p>

        {SUITS.map((suit) => {
          const isRed = suit === 'D' || suit === 'H';
          return (
            <div key={suit} className="trade-grid">
              {RANKS.map((rank) => {
                const owned = heldSet.has(`${rank}_${suit}`);
                return (
                  <button
                    key={`${rank}_${suit}`}
                    type="button"
                    disabled={owned}
                    className={`trade-cell ${isRed ? 'red' : 'black'}`}
                    onClick={() => onRequest(rank, suit)}
                  >
                    {rank}
                    {SUIT_SYMBOLS[suit]}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ==================== INCOMING TRADE FULFILL MODAL ====================

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
  const candidates = myCards.filter(
    (c) => !(c.rank === requestedCard.rank && c.suit === requestedCard.suit)
  );

  return (
    <div className="modal-backdrop">
      <div className="panel modal-box" style={{ maxWidth: 620 }}>
        <h2 className="modal-title">Incoming Trade Request</h2>
        <p className="modal-sub">
          <strong>{requesterName}</strong> wants your{' '}
          <strong style={{ color: 'var(--gold-bright)' }}>{cardToString(requestedCard)}</strong>.
          Accept by picking 1 extra unwanted card to send with it, or decline.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', margin: '14px 0 18px' }}>
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

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-danger" onClick={onDecline}>
            Decline
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!extraId}
            onClick={() => extraId && onFulfill(extraId)}
          >
            Fulfill Trade (Send 2 Cards)
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== ROUND OVER / GAME OVER MODAL ====================

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
  const sorted = [...room.players].sort((a, b) => {
    if (isGameOver) return b.score - a.score;
    return (a.finishRank ?? 99) - (b.finishRank ?? 99);
  });
  const champion = sorted[0];

  return (
    <div className="modal-backdrop">
      <div className="panel modal-box">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Trophy size={24} color="var(--gold-bright)" />
          <h2 className="modal-title" style={{ margin: 0 }}>
            {isGameOver
              ? `${champion?.name} Wins the Match!`
              : `Round ${room.roundNumber} Complete`}
          </h2>
        </div>
        <p className="modal-sub">
          {isGameOver
            ? `Reached target of ${room.rules.pointsToWin} points.`
            : `First to ${room.rules.pointsToWin} points wins the match.`}
        </p>

        <table className="score-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Round</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, idx) => (
              <tr key={p.id} className={idx === 0 ? 'winner-row' : ''}>
                <td>
                  <span className={`pill ${p.finishRank === 1 ? 'pill-gold' : ''}`}>
                    #{p.finishRank ?? idx + 1}
                  </span>
                </td>
                <td style={{ fontWeight: 700 }}>
                  {p.name} {p.id === room.viewerId ? '(You)' : ''}
                </td>
                <td>
                  <span className="pill pill-green">+{p.roundPoints}</span>
                </td>
                <td style={{ fontWeight: 800, color: 'var(--gold-bright)' }}>
                  {p.score} / {room.rules.pointsToWin}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <button type="button" className="btn btn-secondary" onClick={onLeave}>
            Leave Table
          </button>
          {isHost ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onIntent({ type: 'NEXT_ROUND' })}
            >
              <Play size={16} />
              {isGameOver ? 'Play New Match' : `Deal Round ${room.roundNumber + 1}`}
            </button>
          ) : (
            <span className="pill" style={{ padding: '8px 14px' }}>
              Waiting for Host…
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== ACTIVITY & CHAT DRAWER ====================

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

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <strong style={{ fontSize: '0.92rem', color: 'var(--gold-bright)' }}>
            Table Log &amp; Chat
          </strong>
          <button type="button" className="btn-icon" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="drawer-feed">
          {entries.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center', marginTop: 20 }}>
              No activity yet.
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className={`feed-item ${entry.system ? 'system' : ''}`}>
              {!entry.system && (
                <strong style={{ color: 'var(--gold-bright)', marginRight: 6 }}>
                  {entry.senderName}:
                </strong>
              )}
              <span>{entry.text}</span>
            </div>
          ))}
        </div>

        <form
          className="drawer-input"
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
            placeholder="Say something…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
