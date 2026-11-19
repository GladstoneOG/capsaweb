import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Bot,
  Crown,
  Flame,
  Lightbulb,
  LogOut,
  MessageSquare,
  RotateCcw,
  Rows2,
  SkipForward,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from 'lucide-react';
import { getSortedEligiblePlays } from '@engine/bot';
import { COMBO_LABELS, cardToString, sortCards } from '@engine/cards';
import { canBeat, checkCombination, containsStartingCard } from '@engine/rules';
import type {
  Card,
  ClientIntent,
  SanitizedPlayer,
  SanitizedRoomState,
} from '@engine/types';
import type { LocalTransportState } from '@net/protocol';
import { sfx } from '../utils/sfx';
import {
  ActivityDrawer,
  DiceDuelModal,
  ScoreboardModal,
  TradeRequestModal,
  TradeRespondModal,
} from './Overlays';
import { PlayingCard } from './PlayingCard';

interface GameTableProps {
  room: SanitizedRoomState;
  transport: LocalTransportState;
  error: string | null;
  onIntent: (intent: ClientIntent) => void;
  onLeave: () => void;
}

function OpponentSeat({
  player,
  isTurn,
  timerRatio,
  secondsLeft,
  slotClass,
}: {
  player: SanitizedPlayer;
  isTurn: boolean;
  timerRatio: number | null;
  secondsLeft: number | null;
  slotClass: string;
}) {
  const miniCount = Math.min(player.cardCount, 7);

  return (
    <div className={slotClass}>
      <div
        className={`opp-card ${isTurn ? 'active-turn' : ''} ${
          player.passed && !player.finishRank ? 'passed' : ''
        }`}
      >
        <div className="opp-header">
          <div className={`avatar-dot ${player.isBot ? 'bot' : ''}`} style={{ width: 28, height: 28, fontSize: '0.72rem' }}>
            {player.isBot ? <Bot size={14} /> : player.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="opp-meta">
            <div className="opp-name" title={player.name}>
              {player.name}
            </div>
            <div className="opp-sub">
              <span>{player.score} pts</span>
              {player.isHost && <Crown size={11} color="var(--gold-bright)" />}
              {player.disconnected && <span style={{ color: '#fca5a5' }}>DC</span>}
            </div>
          </div>
        </div>

        <div className="opp-cards-row">
          {player.finishRank ? (
            <span className={`pill ${player.finishRank === 1 ? 'pill-gold' : 'pill-green'}`}>
              #{player.finishRank} Finished
            </span>
          ) : player.passed ? (
            <span className="pill">Passed</span>
          ) : (
            <div className="mini-backs" aria-label={`${player.cardCount} cards remaining`}>
              {Array.from({ length: miniCount }).map((_, i) => (
                <span key={i} className="mini-back" />
              ))}
            </div>
          )}

          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: '0.8rem',
              color: player.cardCount <= 2 && player.cardCount > 0 ? '#fca5a5' : 'var(--text-secondary)',
            }}
          >
            {player.cardCount}
          </span>
        </div>

        {isTurn && timerRatio !== null && (
          <div className="turn-progress" title={secondsLeft !== null ? `${secondsLeft}s left` : undefined}>
            <div
              className={`turn-progress-fill ${secondsLeft !== null && secondsLeft <= 7 ? 'urgent' : ''}`}
              style={{ width: `${Math.max(0, Math.min(100, timerRatio * 100))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function GameTable({ room, transport, error, onIntent, onLeave }: GameTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortMethod, setSortMethod] = useState<'rank' | 'suit'>('rank');
  const [twoRowPref, setTwoRowPref] = useState(true);
  const [hintIdx, setHintIdx] = useState(0);
  const [muted, setMuted] = useState(() => sfx.isMuted());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seenActivityCount, setSeenActivityCount] = useState(room.activity.length);
  const [tradePickerOpen, setTradePickerOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Track clock delta between host and local browser for accurate countdown bar
  const clockOffsetRef = useRef(0);
  useEffect(() => {
    clockOffsetRef.current = room.serverNow - Date.now();
  }, [room.serverNow]);

  useEffect(() => {
    if (!room.turnDeadline || room.gameState !== 'playing') return;
    const id = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [room.turnDeadline, room.gameState]);

  const myIndex = room.players.findIndex((p) => p.id === room.viewerId);
  const me = myIndex >= 0 ? room.players[myIndex] : room.players[0];
  const isHost = Boolean(me?.isHost);
  const currentPlayer = room.players[room.turnIndex];
  const isMyTurn =
    room.gameState === 'playing' &&
    !room.diceShowdown &&
    currentPlayer?.id === room.viewerId;
  const isFirstPlayOfRound = !room.firstPlayMade && !room.activePlay;

  const rawHand = useMemo(() => me?.cards ?? [], [me?.cards]);
  const sortedHand = useMemo(() => sortCards(rawHand, sortMethod), [rawHand, sortMethod]);

  // Clear stale selections if cards were played or traded
  useEffect(() => {
    const validSet = new Set(rawHand.map((c) => c.id));
    setSelectedIds((prev) => {
      const filtered = prev.filter((id) => validSet.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
    setHintIdx(0);
  }, [rawHand, room.activePlay, room.turnIndex]);

  // Sound cues on state changes
  const prevTurnRef = useRef(false);
  const prevPlayKeyRef = useRef<string | null>(null);
  const prevGameStateRef = useRef(room.gameState);

  useEffect(() => {
    if (isMyTurn && !prevTurnRef.current) {
      sfx.yourTurn();
    }
    prevTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  useEffect(() => {
    const playKey = room.activePlay
      ? `${room.lastPlayerPlayedId}:${room.activePlay.cards.map((c) => c.id).join(',')}`
      : null;
    if (playKey && playKey !== prevPlayKeyRef.current) {
      const isBomb =
        room.activePlay?.type === 'bomber' || room.activePlay?.type === 'straightflush';
      sfx.cardPlay(isBomb);
    }
    prevPlayKeyRef.current = playKey;
  }, [room.activePlay, room.lastPlayerPlayedId]);

  useEffect(() => {
    if (
      (room.gameState === 'roundover' || room.gameState === 'gameover') &&
      prevGameStateRef.current === 'playing'
    ) {
      sfx.roundWin();
    }
    prevGameStateRef.current = room.gameState;
  }, [room.gameState]);

  useEffect(() => {
    if (drawerOpen) {
      setSeenActivityCount(room.activity.length);
    }
  }, [drawerOpen, room.activity.length]);

  const selectedCards = useMemo(() => {
    const set = new Set(selectedIds);
    return sortedHand.filter((c) => set.has(c.id));
  }, [sortedHand, selectedIds]);

  const bombRules = useMemo(
    () => ({
      enableBombsSingle: room.rules.enableBombsSingle,
      enableBombsPair: room.rules.enableBombsPair,
    }),
    [room.rules.enableBombsSingle, room.rules.enableBombsPair]
  );

  const selectionEval = useMemo(() => {
    if (selectedCards.length === 0) return { valid: false, label: null as string | null };
    const combo = checkCombination(selectedCards);
    if (combo.type === 'invalid') {
      return { valid: false, label: 'Invalid combo' };
    }
    if (isFirstPlayOfRound && !containsStartingCard(combo.cards, room.startingCard)) {
      const needed = room.startingCard ? cardToString(room.startingCard) : '3♦';
      return { valid: false, label: `Must include ${needed}` };
    }
    if (!canBeat(combo, room.activePlay, bombRules)) {
      return { valid: false, label: `${COMBO_LABELS[combo.type]} · Too low` };
    }
    return { valid: true, label: COMBO_LABELS[combo.type] };
  }, [selectedCards, isFirstPlayOfRound, room.startingCard, room.activePlay, bombRules]);

  const eligiblePlays = useMemo(() => {
    if (!isMyTurn) return [];
    return getSortedEligiblePlays(
      rawHand,
      room.activePlay,
      isFirstPlayOfRound,
      bombRules,
      room.startingCard
    );
  }, [isMyTurn, rawHand, room.activePlay, isFirstPlayOfRound, bombRules, room.startingCard]);

  const toggleCard = useCallback((card: Card) => {
    sfx.cardSelect();
    setSelectedIds((prev) =>
      prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id]
    );
  }, []);

  const handlePlay = useCallback(() => {
    if (!isMyTurn || !selectionEval.valid) return;
    onIntent({ type: 'PLAY_CARDS', cardIds: selectedIds });
    setSelectedIds([]);
  }, [isMyTurn, selectionEval.valid, onIntent, selectedIds]);

  const handlePass = useCallback(() => {
    if (!isMyTurn || !room.activePlay || isFirstPlayOfRound) return;
    sfx.pass();
    onIntent({ type: 'PASS' });
    setSelectedIds([]);
  }, [isMyTurn, room.activePlay, isFirstPlayOfRound, onIntent]);

  const handleUndoPass = useCallback(() => {
    if (!room.canUndoPass) return;
    onIntent({ type: 'UNDO_PASS' });
  }, [room.canUndoPass, onIntent]);

  const handleHint = useCallback(() => {
    if (!isMyTurn || eligiblePlays.length === 0) return;
    const play = eligiblePlays[hintIdx % eligiblePlays.length];
    sfx.cardSelect();
    setSelectedIds(play.map((c) => c.id));
    setHintIdx((prev) => (prev + 1) % eligiblePlays.length);
  }, [isMyTurn, eligiblePlays, hintIdx]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (tradePickerOpen || room.gameState !== 'playing') return;

      if (e.key === 'Enter' && isMyTurn && selectionEval.valid) {
        e.preventDefault();
        handlePlay();
      } else if (e.key.toLowerCase() === 'p') {
        if (isMyTurn && room.activePlay && !isFirstPlayOfRound) {
          e.preventDefault();
          handlePass();
        } else if (room.canUndoPass) {
          e.preventDefault();
          handleUndoPass();
        }
      } else if (e.key.toLowerCase() === 'h' && isMyTurn) {
        e.preventDefault();
        handleHint();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSortMethod((prev) => (prev === 'rank' ? 'suit' : 'rank'));
      } else if (e.key === 'Escape') {
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    tradePickerOpen,
    room.gameState,
    room.activePlay,
    room.canUndoPass,
    isMyTurn,
    isFirstPlayOfRound,
    selectionEval.valid,
    handlePlay,
    handlePass,
    handleUndoPass,
    handleHint,
  ]);

  // Compute rotated opponent seats (left, top, right)
  const opponents = useMemo(() => {
    const n = room.players.length;
    if (n === 0) return { left: null, top: null, right: null };
    const base = myIndex >= 0 ? myIndex : 0;
    return {
      left: n > 1 ? room.players[(base + 1) % n] : null,
      top: n > 2 ? room.players[(base + 2) % n] : null,
      right: n > 3 ? room.players[(base + 3) % n] : null,
    };
  }, [room.players, myIndex]);

  // Turn countdown calculation
  const { timerRatio, secondsLeft } = useMemo(() => {
    if (!room.turnDeadline || room.rules.turnDuration <= 0 || room.gameState !== 'playing') {
      return { timerRatio: null, secondsLeft: null };
    }
    const serverNowEst = nowMs + clockOffsetRef.current;
    const msLeft = Math.max(0, room.turnDeadline - serverNowEst);
    const totalMs = room.rules.turnDuration * 1000;
    return {
      timerRatio: msLeft / totalMs,
      secondsLeft: Math.ceil(msLeft / 1000),
    };
  }, [room.turnDeadline, room.rules.turnDuration, room.gameState, nowMs]);

  const useTwoRows = sortedHand.length > 13 && twoRowPref;
  const handRows = useMemo(() => {
    if (!useTwoRows) return [sortedHand];
    const mid = Math.ceil(sortedHand.length / 2);
    return [sortedHand.slice(0, mid), sortedHand.slice(mid)];
  }, [sortedHand, useTwoRows]);

  const getOverlapPx = (count: number) => {
    if (count <= 8) return -10;
    if (count <= 13) return -22;
    if (count <= 18) return -32;
    return -40;
  };

  const lastPlayedPlayer = room.players.find((p) => p.id === room.lastPlayerPlayedId);
  const isActiveBomb =
    room.activePlay?.type === 'bomber' || room.activePlay?.type === 'straightflush';

  const pendingTrade = room.tradingState?.pendingRequest ?? null;
  const isTradeTarget = Boolean(pendingTrade && pendingTrade.targetPlayerId === room.viewerId);
  const isTradeRequester = Boolean(pendingTrade && pendingTrade.requesterId === room.viewerId);

  const latestSystemNote = useMemo(() => {
    for (let i = room.activity.length - 1; i >= 0; i--) {
      if (room.activity[i].system) return room.activity[i].text;
    }
    return null;
  }, [room.activity]);

  const unreadCount = Math.max(0, room.activity.length - seenActivityCount);

  return (
    <div className="table-shell">
      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar-left">
          <span className="pill pill-gold">
            {room.mode === 'solo' ? 'SOLO' : `ROOM ${room.code}`}
          </span>
          <span className="pill">Round {room.roundNumber}</span>
          <span className="pill">Target {room.rules.pointsToWin} pts</span>
          {room.rules.enableDoubleDeck && (
            <span className="pill">
              2× Deck{room.rules.doubleDeck26Cards ? ' (26)' : ''}
            </span>
          )}
          {room.rules.enableTrading && <span className="pill">Trading</span>}
        </div>

        <div className="topbar-right">
          {room.mode === 'multiplayer' && (
            <span className={`pill ${transport === 'p2p' || transport === 'host' ? 'pill-green' : ''}`}>
              <Wifi size={11} />
              {transport === 'host'
                ? 'Host'
                : transport === 'p2p'
                  ? 'P2P'
                  : transport === 'relay'
                    ? 'Relay'
                    : 'Syncing'}
            </span>
          )}

          <button
            type="button"
            className="btn-icon"
            title={muted ? 'Unmute SFX' : 'Mute SFX'}
            onClick={() => setMuted(sfx.toggleMute())}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          <button
            type="button"
            className="btn-icon"
            title="Table log & chat"
            onClick={() => setDrawerOpen(true)}
          >
            <MessageSquare size={16} />
            {unreadCount > 0 && !drawerOpen && <span className="unread-dot" />}
          </button>

          <button type="button" className="btn btn-secondary btn-sm" onClick={onLeave}>
            <LogOut size={14} />
            Leave
          </button>
        </div>
      </header>

      {/* Main Arena */}
      <main className="arena">
        {opponents.top && (
          <OpponentSeat
            player={opponents.top}
            isTurn={currentPlayer?.id === opponents.top.id && room.gameState === 'playing'}
            timerRatio={currentPlayer?.id === opponents.top.id ? timerRatio : null}
            secondsLeft={currentPlayer?.id === opponents.top.id ? secondsLeft : null}
            slotClass="seat-top"
          />
        )}

        {opponents.left && (
          <OpponentSeat
            player={opponents.left}
            isTurn={currentPlayer?.id === opponents.left.id && room.gameState === 'playing'}
            timerRatio={currentPlayer?.id === opponents.left.id ? timerRatio : null}
            secondsLeft={currentPlayer?.id === opponents.left.id ? secondsLeft : null}
            slotClass="seat-left"
          />
        )}

        {opponents.right && (
          <OpponentSeat
            player={opponents.right}
            isTurn={currentPlayer?.id === opponents.right.id && room.gameState === 'playing'}
            timerRatio={currentPlayer?.id === opponents.right.id ? timerRatio : null}
            secondsLeft={currentPlayer?.id === opponents.right.id ? secondsLeft : null}
            slotClass="seat-right"
          />
        )}

        {/* Center Felt */}
        <section className="center-felt" aria-live="polite">
          {room.activePlay ? (
            <>
              <div
                key={`${room.lastPlayerPlayedId}_${room.activePlay.cards.map((c) => c.id).join('_')}`}
                className={`table-cards-stage ${isActiveBomb ? 'bomb-glow' : ''}`}
              >
                {room.activePlay.cards.map((card) => (
                  <div key={card.id} className="table-card-slot">
                    <PlayingCard card={card} size="lg" />
                  </div>
                ))}
              </div>
              <div className="combo-badge">
                {isActiveBomb && <Flame size={14} />}
                <span>{COMBO_LABELS[room.activePlay.type]}</span>
                {lastPlayedPlayer && (
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                    by {lastPlayedPlayer.name}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="table-empty-hint">
              {isFirstPlayOfRound ? (
                <>
                  Opening lead —{' '}
                  <strong style={{ color: 'var(--gold-bright)' }}>
                    {currentPlayer?.id === room.viewerId ? 'You' : currentPlayer?.name}
                  </strong>{' '}
                  must play a combo including{' '}
                  <strong style={{ color: 'var(--gold-bright)' }}>
                    {room.startingCard ? cardToString(room.startingCard) : '3♦'}
                  </strong>
                  .
                </>
              ) : (
                <>
                  Fresh trick —{' '}
                  <strong style={{ color: 'var(--gold-bright)' }}>
                    {currentPlayer?.id === room.viewerId ? 'Your lead' : `${currentPlayer?.name}'s lead`}
                  </strong>
                  .
                </>
              )}
            </div>
          )}

          {isTradeRequester && pendingTrade && (
            <div className="toast-banner" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>
                Waiting for response to your {cardToString(pendingTrade.requestedCard)} request…
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onIntent({ type: 'TRADE_CANCEL' })}
              >
                Cancel
              </button>
            </div>
          )}

          {error ? (
            <div className="error-banner" style={{ marginTop: 0 }}>
              {error}
            </div>
          ) : (
            latestSystemNote && <div className="toast-banner">{latestSystemNote}</div>
          )}
        </section>
      </main>

      {/* Bottom Player Hand & Controls */}
      <footer className="player-dock">
        <div className="hand-container">
          {handRows.map((row, rowIdx) => {
            const overlap = getOverlapPx(row.length);
            return (
              <div key={rowIdx} className="hand-row">
                {row.map((card, i) => {
                  const isStartCard =
                    isFirstPlayOfRound &&
                    isMyTurn &&
                    Boolean(
                      room.startingCard &&
                        card.rank === room.startingCard.rank &&
                        card.suit === room.startingCard.suit
                    );
                  return (
                    <div
                      key={card.id}
                      className="hand-card-wrap"
                      style={{ marginLeft: i === 0 ? 0 : overlap }}
                    >
                      <PlayingCard
                        card={card}
                        interactive
                        selected={selectedIds.includes(card.id)}
                        highlightStarting={isStartCard}
                        onClick={() => toggleCard(card)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="dock-controls">
          <div className="dock-left">
            <div className={`self-status ${isMyTurn ? 'my-turn' : ''}`}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{me?.name}</span>
                  {isMyTurn && <span className="pill pill-gold">Your Turn</span>}
                  {me?.finishRank && <span className="pill pill-green">#{me.finishRank}</span>}
                  {me?.passed && !me.finishRank && <span className="pill">Passed</span>}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {me?.score ?? 0} pts · {rawHand.length} cards
                  {isMyTurn && secondsLeft !== null && ` · ${secondsLeft}s`}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              title="Toggle Sort (S)"
              onClick={() => setSortMethod((prev) => (prev === 'rank' ? 'suit' : 'rank'))}
            >
              <ArrowUpDown size={14} />
              {sortMethod === 'rank' ? 'Rank' : 'Suit'}
            </button>

            {sortedHand.length > 13 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                title="Toggle 1 or 2 rows"
                onClick={() => setTwoRowPref((prev) => !prev)}
              >
                <Rows2 size={14} />
                {twoRowPref ? '2 Rows' : '1 Row'}
              </button>
            )}

            {isMyTurn && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                title="Hint (H)"
                disabled={eligiblePlays.length === 0}
                onClick={handleHint}
              >
                <Lightbulb size={14} />
                Hint
              </button>
            )}

            {room.rules.enableTrading && isMyTurn && !pendingTrade && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setTradePickerOpen(true)}
              >
                <ArrowLeftRight size={14} />
                Trade
              </button>
            )}
          </div>

          <div className="dock-right">
            {selectionEval.label && (
              <span className={`selection-preview ${selectionEval.valid ? 'valid' : 'invalid'}`}>
                {selectionEval.label}
              </span>
            )}

            {selectedIds.length > 0 && (
              <button
                type="button"
                className="btn-icon"
                title="Clear selection (Esc)"
                onClick={() => setSelectedIds([])}
              >
                <X size={15} />
              </button>
            )}

            {room.canUndoPass ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleUndoPass}
              >
                <RotateCcw size={15} />
                Undo Pass
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!isMyTurn || !room.activePlay || isFirstPlayOfRound}
                onClick={handlePass}
              >
                <SkipForward size={15} />
                Pass
              </button>
            )}

            <button
              type="button"
              className="btn btn-primary"
              disabled={!isMyTurn || !selectionEval.valid}
              onClick={handlePlay}
            >
              Play{selectedCards.length > 0 ? ` (${selectedCards.length})` : ''}
            </button>
          </div>
        </div>
      </footer>

      {/* Overlays */}
      {room.diceShowdown && (
        <DiceDuelModal
          showdown={room.diceShowdown}
          onDismiss={() => onIntent({ type: 'DISMISS_DICE' })}
        />
      )}

      {tradePickerOpen && (
        <TradeRequestModal
          myCards={rawHand}
          onRequest={(rank, suit) => {
            onIntent({ type: 'TRADE_REQUEST', rank, suit });
            setTradePickerOpen(false);
          }}
          onClose={() => setTradePickerOpen(false)}
        />
      )}

      {isTradeTarget && pendingTrade && (
        <TradeRespondModal
          requesterName={pendingTrade.requesterName}
          requestedCard={pendingTrade.requestedCard}
          myCards={rawHand}
          onFulfill={(extraCardId) => onIntent({ type: 'TRADE_FULFILL', extraCardId })}
          onDecline={() => onIntent({ type: 'TRADE_DECLINE' })}
        />
      )}

      {(room.gameState === 'roundover' || room.gameState === 'gameover') && (
        <ScoreboardModal room={room} isHost={isHost} onIntent={onIntent} onLeave={onLeave} />
      )}

      {drawerOpen && (
        <ActivityDrawer
          entries={room.activity}
          onSendChat={(text) => onIntent({ type: 'CHAT', text })}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
