import { useEffect, useId, useState, type CSSProperties } from 'react';
import { ArrowLeftRight, Award, Play, Send, Trophy, X } from 'lucide-react';
import { COMBO_LABELS, RANKS, SUITS, SUIT_SYMBOLS, cardToString } from '@engine/cards';
import type {
  ActivityEntry,
  Card,
  ClientIntent,
  DiceShowdown,
  Rank,
  SanitizedRoomState,
  Suit,
} from '@engine/types';
import { prefersReducedMotion } from '../utils/motion';
import { sfx } from '../utils/sfx';
import { Avatar } from './Avatar';
import { Confetti } from './Confetti';
import { Modal } from './Modal';
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

function Die({
  value,
  delay = 0,
  rolling = false,
  landed = false,
}: {
  value: number;
  delay?: number;
  rolling?: boolean;
  landed?: boolean;
}) {
  const on = PIPS[value] ?? [];
  return (
    <div
      className={`die${rolling ? ' is-rolling' : ''}${landed ? ' is-landed' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`die-pip${on.includes(i) ? ' is-on' : ''}`} />
      ))}
    </div>
  );
}

export function DiceDuelModal({ showdown, onDismiss }: { showdown: DiceShowdown; onDismiss: () => void }) {
  const titleId = useId();
  const aWins = showdown.winnerId === showdown.playerA.id;
  const reduced = prefersReducedMotion();
  const [phase, setPhase] = useState<'rolling' | 'landed' | 'revealed'>(() =>
    reduced ? 'revealed' : 'rolling'
  );
  const [displayA, setDisplayA] = useState<number>(() =>
    reduced ? showdown.playerA.roll : ((showdown.playerA.roll + 2) % 6) + 1
  );
  const [displayB, setDisplayB] = useState<number>(() =>
    reduced ? showdown.playerB.roll : ((showdown.playerB.roll + 4) % 6) + 1
  );

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplayA(showdown.playerA.roll);
      setDisplayB(showdown.playerB.roll);
      setPhase('revealed');
      return;
    }

    const timers: number[] = [];
    // Decelerating tumble ticks before landing on true rolls
    const schedule = [70, 145, 230, 330, 445, 580, 740];
    schedule.forEach((ms, step) => {
      const id = window.setTimeout(() => {
        if (step === schedule.length - 1 && showdown.rollsHistory.length > 1) {
          // Briefly flash the last tied roll for narrative payoff
          const tied = showdown.rollsHistory[showdown.rollsHistory.length - 2];
          setDisplayA(tied.rollA);
          setDisplayB(tied.rollB);
        } else {
          setDisplayA(((step * 2 + showdown.playerA.roll) % 6) + 1);
          setDisplayB(((step * 3 + showdown.playerB.roll + 1) % 6) + 1);
        }
        sfx.diceTick();
      }, ms);
      timers.push(id);
    });

    timers.push(
      window.setTimeout(() => {
        setDisplayA(showdown.playerA.roll);
        setDisplayB(showdown.playerB.roll);
        setPhase('landed');
        sfx.diceLand(true);
      }, 920)
    );

    timers.push(
      window.setTimeout(() => {
        setPhase('revealed');
      }, 1100)
    );

    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [showdown]);

  const showWinner = phase === 'revealed';

  return (
    <div className="modal-backdrop">
      <div className="modal modal--center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="eyebrow">3♦ tiebreaker</div>
        <h2 id={titleId} className="modal-title">Dice duel!</h2>
        <p className="modal-sub">Both of you hold 3♦ — highest roll leads the round.</p>

        <div className="duel">
          <div className={`duel-side${showWinner && aWins ? ' is-winner' : ''}`}>
            <Avatar name={showdown.playerA.name} size="md" />
            <div className="duel-name">{showdown.playerA.name}</div>
            <Die value={displayA} rolling={phase === 'rolling'} landed={phase !== 'rolling'} />
          </div>
          <div className="duel-vs">vs</div>
          <div className={`duel-side${showWinner && !aWins ? ' is-winner' : ''}`}>
            <Avatar name={showdown.playerB.name} size="md" />
            <div className="duel-name">{showdown.playerB.name}</div>
            <Die value={displayB} delay={80} rolling={phase === 'rolling'} landed={phase !== 'rolling'} />
          </div>
        </div>

        {showWinner && showdown.rollsHistory.length > 1 && (
          <p className="fine-print duel-tie-note">
            {showdown.rollsHistory.length - 1} tied roll{showdown.rollsHistory.length > 2 ? 's' : ''} before a winner.
          </p>
        )}

        <button type="button" className="btn btn-primary" disabled={!showWinner} onClick={onDismiss}>
          {showWinner ? `${showdown.winnerName} leads — let's go` : 'Rolling…'}
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
  const titleId = useId();
  const held = new Set(myCards.map((c) => `${c.rank}_${c.suit}`));
  return (
    <Modal className="modal--wide" labelledBy={titleId} onClose={onClose}>
      <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
        <X size={16} />
      </button>
      <div className="eyebrow">
        <ArrowLeftRight size={12} /> Card trade
      </div>
      <h2 id={titleId} className="modal-title">Which card do you want?</h2>
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
                aria-label={`Request ${rank} of ${SUIT_SYMBOLS[suit]}`}
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
    </Modal>
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
  const titleId = useId();
  const [extraId, setExtraId] = useState<string | null>(null);
  const candidates = myCards.filter((c) => !(c.rank === requestedCard.rank && c.suit === requestedCard.suit));

  return (
    <div className="modal-backdrop">
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="eyebrow">
          <ArrowLeftRight size={12} /> Incoming trade
        </div>
        <h2 id={titleId} className="modal-title">
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

function AnimatedScore({
  from,
  to,
  delayMs = 180,
  playTicks = false,
}: {
  from: number;
  to: number;
  delayMs?: number;
  playTicks?: boolean;
}) {
  const [val, setVal] = useState<number>(() => (prefersReducedMotion() || from === to ? to : from));

  useEffect(() => {
    if (prefersReducedMotion() || from === to) {
      setVal(to);
      return;
    }
    let raf = 0;
    let lastShown = from;
    const startTimer = window.setTimeout(() => {
      const duration = 520;
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        // Ease-out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const cur = Math.round(from + (to - from) * eased);
        if (cur !== lastShown) {
          lastShown = cur;
          setVal(cur);
          if (playTicks) sfx.scoreTick(cur - from);
        }
        if (progress < 1) {
          raf = requestAnimationFrame(step);
        } else {
          setVal(to);
        }
      };
      raf = requestAnimationFrame(step);
    }, delayMs);

    return () => {
      window.clearTimeout(startTimer);
      cancelAnimationFrame(raf);
    };
  }, [from, to, delayMs, playTicks]);

  return <span className="standing-total">{val}</span>;
}

function useAutoDealSeconds(autoDealAt: number | null | undefined, serverNow: number): number | null {
  const [secs, setSecs] = useState<number | null>(() => {
    if (typeof autoDealAt !== 'number') return null;
    return Math.max(0, Math.ceil((autoDealAt - serverNow) / 1000));
  });

  useEffect(() => {
    if (typeof autoDealAt !== 'number') {
      setSecs(null);
      return;
    }
    const offset = serverNow - Date.now();
    const calc = () => Math.max(0, Math.ceil((autoDealAt - (Date.now() + offset)) / 1000));
    setSecs(calc());
    const id = window.setInterval(() => setSecs(calc()), 250);
    return () => window.clearInterval(id);
  }, [autoDealAt, serverNow]);

  return secs;
}

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
  const titleId = useId();
  const isGameOver = room.gameState === 'gameover';
  const autoDealSecs = useAutoDealSeconds(isGameOver ? null : room.autoDealAt, room.serverNow);
  const sorted = [...room.players].sort((a, b) =>
    isGameOver ? b.score - a.score : (a.finishRank ?? 99) - (b.finishRank ?? 99)
  );
  const top = sorted[0];
  const me = room.players.find((p) => p.id === room.viewerId);
  const hostPlayer = room.players.find((p) => p.isHost);
  const iWon = isGameOver ? top?.id === room.viewerId : me?.finishRank === 1;
  const closingPlayer = room.players.find((p) => p.id === room.lastPlayerPlayedId);
  const headline = isGameOver
    ? iWon
      ? 'You won the match!'
      : `${top?.name} takes the match`
    : iWon
      ? 'You went out first!'
      : `${top?.name} wins round ${room.roundNumber}`;

  // Reveal progress bars on the next frame so GPU scaleX transition animates from prevScore -> score
  const [barsRevealed, setBarsRevealed] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (prefersReducedMotion()) {
      setBarsRevealed(true);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setBarsRevealed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  return (
    <div className="modal-backdrop">
      {iWon && <Confetti mode={isGameOver ? 'match' : 'round'} count={isGameOver ? 105 : 70} />}
      <div
        className={`modal${iWon ? ' modal--victory' : ' modal--defeat'}${isGameOver && iWon ? ' modal--match-win' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="score-hero">
          <div className={`trophy${iWon ? ' is-victory' : ' is-loss'}`}>
            {iWon ? <Trophy size={26} /> : <Award size={26} />}
          </div>
          <div>
            <div className="eyebrow">{isGameOver ? 'Match over' : `Round ${room.roundNumber}`}</div>
            <h2 id={titleId} className="modal-title">{headline}</h2>
          </div>
        </div>

        <ol className="standings">
          {sorted.map((p, idx) => {
            const targetGoal = Math.max(1, room.rules.pointsToWin);
            const prevScore = Math.max(0, p.score - p.roundPoints);
            const prevRatio = Math.min(1, prevScore / targetGoal);
            const nextRatio = Math.min(1, p.score / targetGoal);
            const place = isGameOver ? idx + 1 : (p.finishRank ?? idx + 1);
            const isMe = p.id === room.viewerId;
            return (
              <li
                key={p.id}
                className={`standing${isMe ? ' is-me' : ''}`}
                style={{ '--d': `${idx * 70}ms` } as CSSProperties}
              >
                <span className={`medal medal--${place}`}>{place}</span>
                <Avatar name={p.name} isBot={p.isBot} size="sm" />
                <div className="standing-main">
                  <div className="standing-name">
                    {p.name}
                    {isMe && <span className="you-tag">you</span>}
                  </div>
                  <div className="standing-bar">
                    <span
                      className="standing-bar-fill"
                      style={{
                        transform: `scaleX(${barsRevealed ? nextRatio : prevRatio})`,
                        transitionDelay: `${160 + idx * 80}ms`,
                      }}
                    />
                  </div>
                </div>
                <span
                  className={`standing-gain${p.roundPoints > 0 ? ' has-gain' : ''}`}
                  style={{ '--d': `${140 + idx * 80}ms` } as CSSProperties}
                >
                  +{p.roundPoints}
                </span>
                <AnimatedScore
                  from={prevScore}
                  to={p.score}
                  delayMs={180 + idx * 80}
                  playTicks={isMe && p.roundPoints > 0}
                />
              </li>
            );
          })}
        </ol>
        <p className="fine-print">
          +3 / +2 / +1 / 0 per round · first to {room.rules.pointsToWin} wins
        </p>

        {room.activePlay && (
          <div className="closing-play">
            <div className="closing-play-label">
              Closing play · <strong>{COMBO_LABELS[room.activePlay.type]}</strong>
              {closingPlayer && <span> by {closingPlayer.name}</span>}
            </div>
            <div className="closing-play-cards">
              {room.activePlay.cards.map((card, i) => (
                <div
                  key={card.id}
                  className="closing-play-slot"
                  style={{ '--i': i } as CSSProperties}
                >
                  <PlayingCard card={card} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onLeave}>
            Leave table
          </button>
          {isHost ? (
            <button type="button" className="btn btn-primary" onClick={() => onIntent({ type: 'NEXT_ROUND' })}>
              <Play size={15} />
              {isGameOver
                ? 'Rematch'
                : autoDealSecs !== null
                  ? `Deal next round (${autoDealSecs}s)`
                  : 'Deal next round'}
            </button>
          ) : autoDealSecs !== null ? (
            <span className="waiting-dots">
              {autoDealSecs > 0
                ? `${hostPlayer?.name ?? 'Host'} is AFK · dealing in ${autoDealSecs}s…`
                : 'Dealing next round…'}
            </span>
          ) : (
            <span className="waiting-dots">Waiting for {hostPlayer?.name ?? 'host'} to deal…</span>
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
  const titleId = useId();
  const ordered = [...entries].reverse();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <strong id={titleId}>Table talk</strong>
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
            autoFocus
            placeholder="Message the table…"
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
