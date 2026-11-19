import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Crown,
  Flame,
  Lightbulb,
  LogOut,
  MessageCircle,
  RotateCcw,
  Rows2,
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
  ComboType,
  SanitizedPlayer,
  SanitizedRoomState,
} from '@engine/types';
import type { LocalTransportState } from '@net/protocol';
import { sfx } from '../utils/sfx';
import { Avatar, type TimerInfo } from './Avatar';
import {
  ActivityDrawer,
  DiceDuelModal,
  ScoreboardModal,
  TradeRequestModal,
  TradeRespondModal,
} from './Overlays';
import { CardBack, PlayingCard } from './PlayingCard';

type SeatPos = 'bottom' | 'left' | 'top' | 'right';

const TOSS_FROM: Record<SeatPos, { fx: string; fy: string }> = {
  bottom: { fx: '0px', fy: '240px' },
  left: { fx: '-320px', fy: '-20px' },
  top: { fx: '0px', fy: '-220px' },
  right: { fx: '320px', fy: '-20px' },
};

const SPLASH: Partial<Record<ComboType, string>> = {
  straight: 'Straight',
  flush: 'Flush',
  fullhouse: 'Full House',
  bomber: 'Bomber!',
  straightflush: 'Straight Flush!',
};

/** Deterministic "tossed" tilt per card so the pile looks organic yet stable across renders. */
function tiltFor(id: string): { rot: number; dy: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  return { rot: (h % 13) - 6, dy: ((h >>> 5) % 9) - 4 };
}

function CountdownText({ deadline, offset }: { deadline: number; offset: number }) {
  const calc = useCallback(
    () => Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)),
    [deadline, offset]
  );
  const [secs, setSecs] = useState(calc);
  useEffect(() => {
    setSecs(calc());
    const id = window.setInterval(() => setSecs(calc()), 250);
    return () => window.clearInterval(id);
  }, [calc]);
  return <span className={secs <= 7 ? 'is-urgent' : ''}>{secs}s</span>;
}

function Seat({
  player,
  pos,
  isTurn,
  timer,
}: {
  player: SanitizedPlayer;
  pos: SeatPos;
  isTurn: boolean;
  timer: TimerInfo | null;
}) {
  const fanCount = Math.min(player.cardCount, 6);
  const bubble = player.disconnected ? 'Offline' : player.passed && !player.finishRank ? 'Pass' : null;

  return (
    <div
      className={`seat seat--${pos}${isTurn ? ' is-turn' : ''}${
        player.passed && !player.finishRank ? ' is-passed' : ''
      }${player.finishRank ? ' is-done' : ''}`}
    >
      <div className="seat-avatar">
        <Avatar
          name={player.name}
          isBot={player.isBot}
          size="md"
          active={isTurn}
          dimmed={player.disconnected}
          timer={isTurn ? timer : null}
        />
        {player.finishRank ? (
          <span className={`medal medal--${player.finishRank}`}>{player.finishRank}</span>
        ) : (
          <span className={`seat-count${player.cardCount <= 2 ? ' is-low' : ''}`}>{player.cardCount}</span>
        )}
        {bubble && (
          <span key={bubble} className="bubble">
            {bubble}
          </span>
        )}
      </div>

      <div className="seat-info">
        <div className="seat-name">
          {player.isHost && <Crown size={11} className="seat-crown" />}
          <span>{player.name}</span>
        </div>
        <div className="seat-score">{player.score} pts</div>
      </div>

      {!player.finishRank && fanCount > 0 && (
        <div className="seat-fan" aria-hidden="true">
          {Array.from({ length: fanCount }).map((_, i) => (
            <span key={i} className="seat-fan-slot" style={{ '--off': i - (fanCount - 1) / 2 } as CSSProperties}>
              <CardBack className="card-back--xs" />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface GameTableProps {
  room: SanitizedRoomState;
  transport: LocalTransportState;
  error: string | null;
  onIntent: (intent: ClientIntent) => void;
  onLeave: () => void;
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

  const myIndex = room.players.findIndex((p) => p.id === room.viewerId);
  const me = myIndex >= 0 ? room.players[myIndex] : room.players[0];
  const isHost = Boolean(me?.isHost);
  const currentPlayer = room.players[room.turnIndex];
  const diceActive = Boolean(room.diceShowdown);
  const isMyTurn = room.gameState === 'playing' && !diceActive && currentPlayer?.id === room.viewerId;
  const isFirstPlayOfRound = !room.firstPlayMade && !room.activePlay;

  const rawHand = useMemo(() => me?.cards ?? [], [me?.cards]);
  const sortedHand = useMemo(() => sortCards(rawHand, sortMethod), [rawHand, sortMethod]);

  // ---------- Turn timer (computed once per turn; rings animate via CSS) ----------
  const timerData = useMemo(() => {
    if (!room.turnDeadline || room.rules.turnDuration <= 0 || room.gameState !== 'playing' || diceActive) {
      return null;
    }
    const totalMs = room.rules.turnDuration * 1000;
    const remainingMs = Math.max(0, Math.min(totalMs, room.turnDeadline - room.serverNow));
    return {
      info: { totalMs, remainingMs, key: room.turnDeadline } as TimerInfo,
      offset: room.serverNow - Date.now(),
      deadline: room.turnDeadline,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.turnDeadline, room.rules.turnDuration, room.gameState, diceActive]);

  // ---------- Clean stale selections ----------
  useEffect(() => {
    const validSet = new Set(rawHand.map((c) => c.id));
    setSelectedIds((prev) => {
      const filtered = prev.filter((id) => validSet.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
    setHintIdx(0);
  }, [rawHand, room.activePlay, room.turnIndex]);

  // ---------- Played pile: current + previous (faded underneath) ----------
  const playKey = room.activePlay
    ? `${room.lastPlayerPlayedId}:${room.activePlay.cards.map((c) => c.id).join(',')}`
    : null;
  const [underPlay, setUnderPlay] = useState<Card[] | null>(null);
  const lastPlayRef = useRef<{ key: string | null; cards: Card[] | null }>({ key: null, cards: null });

  useEffect(() => {
    const prev = lastPlayRef.current;
    if (playKey === prev.key) return;
    setUnderPlay(playKey && prev.key ? prev.cards : null);
    lastPlayRef.current = { key: playKey, cards: room.activePlay ? room.activePlay.cards : null };
    if (playKey) {
      const t = room.activePlay?.type;
      sfx.cardPlay(t === 'bomber' || t === 'straightflush');
    }
  }, [playKey, room.activePlay]);

  // ---------- Sound cues ----------
  const prevTurnRef = useRef(false);
  const prevGameStateRef = useRef(room.gameState);
  useEffect(() => {
    if (isMyTurn && !prevTurnRef.current) sfx.yourTurn();
    prevTurnRef.current = isMyTurn;
  }, [isMyTurn]);
  useEffect(() => {
    if ((room.gameState === 'roundover' || room.gameState === 'gameover') && prevGameStateRef.current === 'playing') {
      sfx.roundWin();
    }
    prevGameStateRef.current = room.gameState;
  }, [room.gameState]);

  useEffect(() => {
    if (drawerOpen) setSeenActivityCount(room.activity.length);
  }, [drawerOpen, room.activity.length]);

  // ---------- Selection evaluation ----------
  const selectedCards = useMemo(() => {
    const set = new Set(selectedIds);
    return sortedHand.filter((c) => set.has(c.id));
  }, [sortedHand, selectedIds]);

  const bombRules = useMemo(
    () => ({ enableBombsSingle: room.rules.enableBombsSingle, enableBombsPair: room.rules.enableBombsPair }),
    [room.rules.enableBombsSingle, room.rules.enableBombsPair]
  );

  const selectionEval = useMemo(() => {
    if (selectedCards.length === 0) return { valid: false, label: null as string | null };
    const combo = checkCombination(selectedCards);
    if (combo.type === 'invalid') return { valid: false, label: 'Not a combo' };
    if (isFirstPlayOfRound && !containsStartingCard(combo.cards, room.startingCard)) {
      return { valid: false, label: `Needs ${room.startingCard ? cardToString(room.startingCard) : '3♦'}` };
    }
    if (!canBeat(combo, room.activePlay, bombRules)) {
      return { valid: false, label: `${COMBO_LABELS[combo.type]} · too low` };
    }
    return { valid: true, label: COMBO_LABELS[combo.type] };
  }, [selectedCards, isFirstPlayOfRound, room.startingCard, room.activePlay, bombRules]);

  const eligiblePlays = useMemo(() => {
    if (!isMyTurn) return [];
    return getSortedEligiblePlays(rawHand, room.activePlay, isFirstPlayOfRound, bombRules, room.startingCard);
  }, [isMyTurn, rawHand, room.activePlay, isFirstPlayOfRound, bombRules, room.startingCard]);

  // ---------- Actions ----------
  const toggleCard = useCallback((card: Card) => {
    sfx.cardSelect();
    setSelectedIds((prev) => (prev.includes(card.id) ? prev.filter((id) => id !== card.id) : [...prev, card.id]));
  }, []);

  const canPass = isMyTurn && Boolean(room.activePlay) && !isFirstPlayOfRound;

  const handlePlay = useCallback(() => {
    if (!isMyTurn || !selectionEval.valid) return;
    onIntent({ type: 'PLAY_CARDS', cardIds: selectedIds });
    setSelectedIds([]);
  }, [isMyTurn, selectionEval.valid, onIntent, selectedIds]);

  const handlePass = useCallback(() => {
    if (!canPass) return;
    sfx.pass();
    onIntent({ type: 'PASS' });
    setSelectedIds([]);
  }, [canPass, onIntent]);

  const handleUndoPass = useCallback(() => {
    if (room.canUndoPass) onIntent({ type: 'UNDO_PASS' });
  }, [room.canUndoPass, onIntent]);

  const handleHint = useCallback(() => {
    if (!isMyTurn || eligiblePlays.length === 0) return;
    const play = eligiblePlays[hintIdx % eligiblePlays.length];
    sfx.cardSelect();
    setSelectedIds(play.map((c) => c.id));
    setHintIdx((prev) => (prev + 1) % eligiblePlays.length);
  }, [isMyTurn, eligiblePlays, hintIdx]);

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (tradePickerOpen || room.gameState !== 'playing') return;
      const k = e.key.toLowerCase();
      if (e.key === 'Enter' && isMyTurn && selectionEval.valid) {
        e.preventDefault();
        handlePlay();
      } else if (k === 'p') {
        e.preventDefault();
        if (canPass) handlePass();
        else if (room.canUndoPass) handleUndoPass();
      } else if (k === 'h' && isMyTurn) {
        e.preventDefault();
        handleHint();
      } else if (k === 's') {
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
    room.canUndoPass,
    isMyTurn,
    canPass,
    selectionEval.valid,
    handlePlay,
    handlePass,
    handleUndoPass,
    handleHint,
  ]);

  // ---------- Seats (clockwise: me → left → top → right) ----------
  const seats = useMemo(() => {
    const n = room.players.length;
    const base = myIndex >= 0 ? myIndex : 0;
    const order: SeatPos[] = n === 2 ? ['top'] : n === 3 ? ['left', 'right'] : ['left', 'top', 'right'];
    return order
      .map((pos, k) => ({ pos, player: room.players[(base + k + 1) % n] }))
      .filter((s) => Boolean(s.player));
  }, [room.players, myIndex]);

  const seatOf = (id: string | null): SeatPos =>
    id === room.viewerId ? 'bottom' : (seats.find((s) => s.player.id === id)?.pos ?? 'top');

  // ---------- Hand rows ----------
  const useTwoRows = sortedHand.length > 13 && twoRowPref;
  const handRows = useMemo(() => {
    if (!useTwoRows) return [sortedHand];
    const mid = Math.ceil(sortedHand.length / 2);
    return [sortedHand.slice(0, mid), sortedHand.slice(mid)];
  }, [sortedHand, useTwoRows]);

  // ---------- Derived display ----------
  const lastPlayedPlayer = room.players.find((p) => p.id === room.lastPlayerPlayedId);
  const activeType = room.activePlay?.type;
  const isBomb = activeType === 'bomber' || activeType === 'straightflush';
  const splashText = activeType ? SPLASH[activeType] : undefined;
  const toss = TOSS_FROM[seatOf(room.lastPlayerPlayedId)];

  const pendingTrade = room.tradingState?.pendingRequest ?? null;
  const isTradeTarget = Boolean(pendingTrade && pendingTrade.targetPlayerId === room.viewerId);
  const isTradeRequester = Boolean(pendingTrade && pendingTrade.requesterId === room.viewerId);

  const latestNote = useMemo(() => {
    for (let i = room.activity.length - 1; i >= 0; i--) {
      const a = room.activity[i];
      if (!a.system) continue;
      if (/ played | passed\.$/.test(a.text)) continue; // already visualised on the table
      return a;
    }
    return null;
  }, [room.activity]);

  const unreadCount = Math.max(0, room.activity.length - seenActivityCount);
  const noPlays = isMyTurn && !isFirstPlayOfRound && room.activePlay && eligiblePlays.length === 0;
  const leaderName = currentPlayer?.id === room.viewerId ? 'You' : currentPlayer?.name;

  return (
    <div className="table-shell">
      {/* ================= HUD ================= */}
      <header className="hud">
        <div className="hud-chips">
          <span className="chip chip--gold">{room.mode === 'solo' ? 'Practice' : room.code}</span>
          <span className="chip">
            Round <strong>{room.roundNumber}</strong>
          </span>
          <span className="chip hide-sm">
            First to <strong>{room.rules.pointsToWin}</strong>
          </span>
          {room.rules.enableDoubleDeck && (
            <span className="chip hide-sm">2× deck{room.rules.doubleDeck26Cards ? ' · 26' : ''}</span>
          )}
          {room.rules.enableTrading && <span className="chip hide-sm">Trading</span>}
          {room.mode === 'multiplayer' && (
            <span className={`chip ${transport === 'relay' || transport === 'connecting' ? '' : 'chip--mint'}`}>
              <Wifi size={12} />
              {transport === 'host' ? 'Host' : transport === 'p2p' ? 'P2P' : transport === 'relay' ? 'Relay' : '…'}
            </span>
          )}
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={() => setMuted(sfx.toggleMute())}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <button type="button" className="icon-btn" aria-label="Table chat" onClick={() => setDrawerOpen(true)}>
            <MessageCircle size={17} />
            {unreadCount > 0 && !drawerOpen && <span className="icon-dot" />}
          </button>
          <button type="button" className="icon-btn" aria-label="Leave table" onClick={onLeave}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      {/* ================= STAGE ================= */}
      <main className="stage">
        <div className="table-rim">
          <div className="table-felt" aria-live="polite">
            <div className="felt-mark" aria-hidden="true">
              <span>CAPSA</span>
            </div>

            {underPlay && room.activePlay && (
              <div className="trick trick--under" aria-hidden="true">
                {underPlay.map((card) => {
                  const t = tiltFor(card.id);
                  return (
                    <div
                      key={card.id}
                      className="trick-card"
                      style={{ '--rot': `${t.rot}deg`, '--dy': `${t.dy}px` } as CSSProperties}
                    >
                      <PlayingCard card={card} size="lg" />
                    </div>
                  );
                })}
              </div>
            )}

            {room.activePlay ? (
              <>
                <div key={playKey} className={`trick${isBomb ? ' is-bomb' : ''}`}>
                  {room.activePlay.cards.map((card, i) => {
                    const t = tiltFor(card.id);
                    return (
                      <div
                        key={card.id}
                        className="trick-card is-fresh"
                        style={
                          {
                            '--rot': `${t.rot}deg`,
                            '--dy': `${t.dy}px`,
                            '--fx': toss.fx,
                            '--fy': toss.fy,
                            '--i': i,
                          } as CSSProperties
                        }
                      >
                        <PlayingCard card={card} size="lg" />
                      </div>
                    );
                  })}
                </div>
                <div className={`combo-tag${isBomb ? ' is-bomb' : ''}`}>
                  {isBomb && <Flame size={13} />}
                  <strong>{COMBO_LABELS[room.activePlay.type]}</strong>
                  {lastPlayedPlayer && (
                    <span>· {lastPlayedPlayer.id === room.viewerId ? 'you' : lastPlayedPlayer.name}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="lead-hint">
                <div className="lead-hint-title">
                  {isFirstPlayOfRound ? 'Opening lead' : 'Fresh trick'}
                </div>
                <div className="lead-hint-sub">
                  {isFirstPlayOfRound ? (
                    <>
                      <strong>{leaderName}</strong> {leaderName === 'You' ? 'start' : 'starts'} with{' '}
                      <strong className="gold">
                        {room.startingCard ? cardToString(room.startingCard) : '3♦'}
                      </strong>
                    </>
                  ) : (
                    <>
                      <strong>{leaderName}</strong> {leaderName === 'You' ? 'have' : 'has'} the lead
                    </>
                  )}
                </div>
              </div>
            )}

            {splashText && playKey && (
              <div key={`splash_${playKey}`} className={`combo-splash${isBomb ? ' is-bomb' : ''}`} aria-hidden="true">
                {splashText}
              </div>
            )}

            <div className="felt-notes">
              {isTradeRequester && pendingTrade && (
                <div className="note-chip is-static">
                  Asking for {cardToString(pendingTrade.requestedCard)}…
                  <button type="button" className="note-chip-btn" onClick={() => onIntent({ type: 'TRADE_CANCEL' })}>
                    Cancel
                  </button>
                </div>
              )}
              {error ? (
                <div key={`err_${error}`} className="note-chip is-error is-static">
                  {error}
                </div>
              ) : (
                latestNote && (
                  <div key={latestNote.id} className="note-chip">
                    {latestNote.text}
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        {seats.map(({ player, pos }) => (
          <Seat
            key={player.id}
            player={player}
            pos={pos}
            isTurn={currentPlayer?.id === player.id && room.gameState === 'playing' && !diceActive}
            timer={timerData?.info ?? null}
          />
        ))}
      </main>

      {/* ================= DOCK ================= */}
      <footer className="dock">
        <div className="hand" key={`round_${room.roundNumber}`}>
          {(selectionEval.label || noPlays) && (
            <div
              className={`sel-chip ${
                selectionEval.label ? (selectionEval.valid ? 'is-valid' : 'is-invalid') : 'is-info'
              }`}
            >
              <span>{selectionEval.label ?? 'Nothing beats that — pass?'}</span>
              {selectedIds.length > 0 && (
                <button type="button" aria-label="Clear selection" onClick={() => setSelectedIds([])}>
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {handRows.map((row, rowIdx) => {
            const n = row.length;
            const spread = Math.min(3, 34 / Math.max(n, 1));
            return (
              <div
                key={rowIdx}
                className="hand-row"
                style={{ '--gaps': Math.max(1, n - 1), '--spread': `${spread}deg` } as CSSProperties}
              >
                {row.map((card, i) => {
                  const isStartCard =
                    isFirstPlayOfRound &&
                    isMyTurn &&
                    Boolean(room.startingCard && card.rank === room.startingCard.rank && card.suit === room.startingCard.suit);
                  return (
                    <div
                      key={card.id}
                      className="fan-slot"
                      style={{ '--off': i - (n - 1) / 2, '--i': i + rowIdx * 13 } as CSSProperties}
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

        <div className={`dock-bar${isMyTurn ? ' is-turn' : ''}`}>
          <div className="me">
            <Avatar
              name={me?.name ?? 'You'}
              size="sm"
              active={isMyTurn}
              timer={isMyTurn ? (timerData?.info ?? null) : null}
            />
            <div className="me-info">
              <div className="me-name">
                <span className="me-name-text">{me?.name}</span>
                {isMyTurn && <span className="turn-pill">Your turn</span>}
                {me?.finishRank && <span className={`medal medal--${me.finishRank} medal--inline`}>{me.finishRank}</span>}
                {me?.passed && !me.finishRank && <span className="soft-pill">Passed</span>}
              </div>
              <div className="me-sub">
                {me?.score ?? 0} pts · {rawHand.length} cards
                {isMyTurn && timerData && (
                  <>
                    {' · '}
                    <CountdownText deadline={timerData.deadline} offset={timerData.offset} />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="tools">
            <button
              type="button"
              className="tool-btn"
              title="Sort (S)"
              onClick={() => setSortMethod((prev) => (prev === 'rank' ? 'suit' : 'rank'))}
            >
              <ArrowUpDown size={15} />
              <span>{sortMethod === 'rank' ? 'Rank' : 'Suit'}</span>
            </button>
            {sortedHand.length > 13 && (
              <button type="button" className="tool-btn" title="Rows" onClick={() => setTwoRowPref((p) => !p)}>
                <Rows2 size={15} />
                <span>{twoRowPref ? '2 rows' : '1 row'}</span>
              </button>
            )}
            <button
              type="button"
              className="tool-btn"
              title="Hint (H)"
              disabled={!isMyTurn || eligiblePlays.length === 0}
              onClick={handleHint}
            >
              <Lightbulb size={15} />
              <span>Hint</span>
            </button>
            {room.rules.enableTrading && (
              <button
                type="button"
                className="tool-btn"
                title="Request a card"
                disabled={!isMyTurn || Boolean(pendingTrade)}
                onClick={() => setTradePickerOpen(true)}
              >
                <ArrowLeftRight size={15} />
                <span>Trade</span>
              </button>
            )}
          </div>

          <div className="actions">
            {room.canUndoPass ? (
              <button type="button" className="act-btn act-btn--ghost" onClick={handleUndoPass}>
                <RotateCcw size={15} />
                Undo
              </button>
            ) : (
              <button type="button" className="act-btn act-btn--ghost" disabled={!canPass} onClick={handlePass}>
                Pass
              </button>
            )}
            <button
              type="button"
              className={`act-btn act-btn--play${isMyTurn && selectionEval.valid ? ' is-ready' : ''}`}
              disabled={!isMyTurn || !selectionEval.valid}
              onClick={handlePlay}
            >
              Play{selectedCards.length > 0 ? ` ${selectedCards.length}` : ''}
            </button>
          </div>
        </div>
      </footer>

      {/* ================= OVERLAYS ================= */}
      {room.diceShowdown && (
        <DiceDuelModal showdown={room.diceShowdown} onDismiss={() => onIntent({ type: 'DISMISS_DICE' })} />
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
