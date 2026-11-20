import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Bot,
  Crown,
  Flame,
  Lightbulb,
  LogOut,
  MessageCircle,
  RotateCcw,
  Rows2,
  Smartphone,
  Sparkles,
  Trophy,
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
import { useHandDrag } from '../hooks/useHandDrag';
import { sfx } from '../utils/sfx';
import { Avatar, type TimerInfo } from './Avatar';
import { Confetti } from './Confetti';
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
  straight: 'Straight!',
  flush: 'Flush!',
  fullhouse: 'Full House!',
  bomber: 'BOMBER!',
  straightflush: 'STRAIGHT FLUSH!',
};

const ORDINALS = ['', '1st', '2nd', '3rd', '4th'];

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
  justFinished,
  clockOffset,
}: {
  player: SanitizedPlayer;
  pos: SeatPos;
  isTurn: boolean;
  timer: TimerInfo | null;
  justFinished: boolean;
  clockOffset: number;
}) {
  const fanCount = Math.min(player.cardCount, 7);
  const inGrace = Boolean(player.disconnected && !player.isBot && player.reconnectGraceUntil);
  const bubble = inGrace
    ? null
    : player.disconnected
      ? 'Bot (DC)'
      : player.finishRank
        ? `${ORDINALS[player.finishRank]} · Out!`
        : player.passed
          ? 'Pass'
          : player.autoPlay
            ? 'AFK · Bot'
            : null;

  return (
    <div
      className={`seat seat--${pos}${isTurn ? ' is-turn' : ''}${
        player.passed && !player.finishRank ? ' is-passed' : ''
      }${player.finishRank ? ` is-done is-rank-${player.finishRank}` : ''}${
        justFinished ? ' is-celebrating' : ''
      }`}
    >
      <div className="seat-avatar">
        <Avatar
          name={player.name}
          isBot={player.isBot || Boolean(player.autoPlay)}
          size="md"
          active={isTurn}
          dimmed={player.disconnected && !inGrace}
          timer={isTurn ? timer : null}
        />
        {justFinished && <span className="finish-halo" aria-hidden="true" />}
        {player.finishRank ? (
          <span className={`medal medal--${player.finishRank}`}>{player.finishRank}</span>
        ) : (
          <span className={`seat-count${player.cardCount <= 2 ? ' is-low' : ''}`}>
            {player.cardCount}
          </span>
        )}
        {inGrace && player.reconnectGraceUntil ? (
          <span className={`bubble ${player.swapDevice ? 'bubble--swap' : 'bubble--grace'}`}>
            {player.swapDevice ? 'Swap · ' : 'Wait · '}
            <CountdownText deadline={player.reconnectGraceUntil} offset={clockOffset} />
          </span>
        ) : (
          bubble && (
            <span
              key={bubble}
              className={`bubble${player.finishRank ? ` bubble--rank-${player.finishRank}` : ''}`}
            >
              {bubble}
            </span>
          )
        )}
      </div>

      <div className="seat-info">
        <div className="seat-name">
          {player.isHost && <Crown size={12} className="seat-crown" />}
          <span>{player.name}</span>
        </div>
        <div className="seat-score">{player.score} pts</div>
      </div>

      {!player.finishRank && fanCount > 0 && (
        <div className="seat-fan" aria-hidden="true">
          {Array.from({ length: fanCount }).map((_, i) => (
            <span
              key={i}
              className="seat-fan-slot"
              style={{ '--off': i - (fanCount - 1) / 2 } as CSSProperties}
            >
              <CardBack className="card-back--xs" />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface FinishBanner {
  id: string;
  playerId: string;
  name: string;
  rank: number;
  points: number;
}

interface TrickBanner {
  id: number;
  winnerName: string;
  hibah: boolean;
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
  const [customOrder, setCustomOrder] = useState<string[] | null>(null);
  const [isDealing, setIsDealing] = useState(true);
  const [twoRowPref, setTwoRowPref] = useState(true);
  const [hintIdx, setHintIdx] = useState(0);
  const [muted, setMuted] = useState(() => sfx.isMuted());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seenActivityCount, setSeenActivityCount] = useState(room.activity.length);
  const [tradePickerOpen, setTradePickerOpen] = useState(false);
  const [afkConfirmOpen, setAfkConfirmOpen] = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(
    () => room.gameState === 'roundover' || room.gameState === 'gameover'
  );
  const clockOffset = useMemo(() => room.serverNow - Date.now(), [room.serverNow]);

  // Celebratory & impact effects state
  const [finishBanner, setFinishBanner] = useState<FinishBanner | null>(null);
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const [midRoundConfettiKey, setMidRoundConfettiKey] = useState<number>(0);
  const [trickBanner, setTrickBanner] = useState<TrickBanner | null>(null);
  const [bombShakeKey, setBombShakeKey] = useState<number>(0);

  const myIndex = room.players.findIndex((p) => p.id === room.viewerId);
  const me = myIndex >= 0 ? room.players[myIndex] : room.players[0];
  const isHost = Boolean(me?.isHost);
  const isAfk = Boolean(me?.autoPlay);
  const currentPlayer = room.players[room.turnIndex];
  const diceActive = Boolean(room.diceShowdown);
  const isMyTurn = room.gameState === 'playing' && !diceActive && currentPlayer?.id === room.viewerId;
  const canAct = isMyTurn && !isAfk;
  const isFirstPlayOfRound = !room.firstPlayMade && !room.activePlay;

  const rawHand = useMemo(() => me?.cards ?? [], [me?.cards]);
  const sortedHand = useMemo(() => {
    const autoSorted = sortCards(rawHand, sortMethod);
    if (!customOrder) return autoSorted;
    const byId = new Map(rawHand.map((c) => [c.id, c]));
    const ordered: Card[] = [];
    const seen = new Set<string>();
    for (const id of customOrder) {
      const card = byId.get(id);
      if (card) {
        ordered.push(card);
        seen.add(id);
      }
    }
    // Append any newly received cards (e.g. from Card Trading) in sorted order
    for (const card of autoSorted) {
      if (!seen.has(card.id)) ordered.push(card);
    }
    return ordered;
  }, [rawHand, sortMethod, customOrder]);

  // Reset manual hand order and play deal entrance once per round
  useEffect(() => {
    setCustomOrder(null);
    setIsDealing(true);
    const id = window.setTimeout(() => setIsDealing(false), 950);
    return () => window.clearTimeout(id);
  }, [room.roundNumber]);

  // ---------- Turn timer ----------
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

  // ---------- Played pile + Bomb slam effect ----------
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
      const bombed = t === 'bomber' || t === 'straightflush';
      sfx.cardPlay(bombed);
      if (bombed) {
        setBombShakeKey((k) => k + 1);
      }
    }
  }, [playKey, room.activePlay]);

  // ---------- Detect player running out of cards (1st / 2nd / 3rd) ----------
  const knownFinishedRef = useRef<Set<string>>(new Set());
  const lastRoundRef = useRef<number>(room.roundNumber);

  useEffect(() => {
    if (room.roundNumber !== lastRoundRef.current) {
      lastRoundRef.current = room.roundNumber;
      knownFinishedRef.current = new Set();
      setFinishBanner(null);
      setCelebratingId(null);
      setTrickBanner(null);
    }

    const newlyFinished = room.players.filter(
      (p) => p.finishRank !== undefined && p.finishRank < room.players.length && !knownFinishedRef.current.has(p.id)
    );
    if (newlyFinished.length === 0) return;

    for (const p of newlyFinished) {
      knownFinishedRef.current.add(p.id);
    }

    // Highlight the highest finisher in this update
    newlyFinished.sort((a, b) => (a.finishRank ?? 9) - (b.finishRank ?? 9));
    const topFinisher = newlyFinished[0];
    const rank = topFinisher.finishRank!;
    const pts = Math.max(0, room.players.length - rank);

    sfx.playerFinished(rank);
    setCelebratingId(topFinisher.id);
    setFinishBanner({
      id: `${room.roundNumber}_${topFinisher.id}_${rank}`,
      playerId: topFinisher.id,
      name: topFinisher.id === room.viewerId ? 'You' : topFinisher.name,
      rank,
      points: pts,
    });
    if (rank === 1 && room.gameState === 'playing') {
      setMidRoundConfettiKey((k) => k + 1);
    }

    const timer = window.setTimeout(() => {
      setCelebratingId((cur) => (cur === topFinisher.id ? null : cur));
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [room.players, room.roundNumber, room.viewerId, room.gameState]);

  // ---------- Detect Trick Win / Hibah ----------
  const lastTrickTsRef = useRef<number | null>(room.lastTrick?.timestamp ?? null);
  useEffect(() => {
    const ts = room.lastTrick?.timestamp ?? null;
    if (ts && ts !== lastTrickTsRef.current) {
      lastTrickTsRef.current = ts;
      sfx.trickWon();
      setTrickBanner({
        id: ts,
        winnerName:
          room.lastTrick!.winnerId === room.viewerId ? 'You' : room.lastTrick!.winnerName,
        hibah: room.lastTrick!.hibah,
      });
    }
  }, [room.lastTrick, room.viewerId]);

  // ---------- Sound cues & delayed scoreboard so the closing play is clearly visible ----------
  const prevTurnRef = useRef(false);
  const prevGameStateRef = useRef(room.gameState);
  useEffect(() => {
    if (isMyTurn && !prevTurnRef.current) sfx.yourTurn();
    prevTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  useEffect(() => {
    const isEnd = room.gameState === 'roundover' || room.gameState === 'gameover';
    const wasPlaying = prevGameStateRef.current === 'playing';
    prevGameStateRef.current = room.gameState;

    if (!isEnd) {
      setScoreboardVisible(false);
      return;
    }

    if (wasPlaying) {
      sfx.roundWin();
      setScoreboardVisible(false);
      const id = window.setTimeout(() => setScoreboardVisible(true), 2200);
      return () => window.clearTimeout(id);
    }

    setScoreboardVisible(true);
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

  const {
    draggingCard,
    draggingId,
    ghostRef,
    ghostDims,
    registerSlot,
    registerFlip,
    handleCardPointerDown,
    snapshotRects,
  } = useHandDrag({
    hand: sortedHand,
    onReorder: (nextIds) => setCustomOrder(nextIds),
    onTap: toggleCard,
    resetKey: room.roundNumber,
  });

  useEffect(() => {
    if (draggingId) setIsDealing(false);
  }, [draggingId]);

  const handleSortToggle = useCallback(() => {
    snapshotRects();
    if (customOrder) {
      // Snap back to current sort method first
      setCustomOrder(null);
    } else {
      setSortMethod((prev) => (prev === 'rank' ? 'suit' : 'rank'));
    }
  }, [customOrder, snapshotRects]);

  const canPass = canAct && Boolean(room.activePlay) && !isFirstPlayOfRound;

  const handlePlay = useCallback(() => {
    if (!canAct || !selectionEval.valid) return;
    onIntent({ type: 'PLAY_CARDS', cardIds: selectedIds });
    setSelectedIds([]);
  }, [canAct, selectionEval.valid, onIntent, selectedIds]);

  const handlePass = useCallback(() => {
    if (!canPass) return;
    sfx.pass();
    onIntent({ type: 'PASS' });
    setSelectedIds([]);
  }, [canPass, onIntent]);

  const handleUndoPass = useCallback(() => {
    if (!isAfk && room.canUndoPass) onIntent({ type: 'UNDO_PASS' });
  }, [isAfk, room.canUndoPass, onIntent]);

  const handleHint = useCallback(() => {
    if (!canAct || eligiblePlays.length === 0) return;
    const play = eligiblePlays[hintIdx % eligiblePlays.length];
    sfx.cardSelect();
    setSelectedIds(play.map((c) => c.id));
    setHintIdx((prev) => (prev + 1) % eligiblePlays.length);
  }, [canAct, eligiblePlays, hintIdx]);

  const handleAvatarClick = useCallback(() => {
    if (isAfk) {
      onIntent({ type: 'TOGGLE_AUTOPLAY' });
    } else {
      setAfkConfirmOpen(true);
    }
  }, [isAfk, onIntent]);

  const handleSwapDevice = useCallback(() => {
    setAfkConfirmOpen(false);
    setSelectedIds([]);
    onIntent({ type: 'PREPARE_SWAP_DEVICE' });
    window.setTimeout(() => {
      onLeave();
    }, 180);
  }, [onIntent, onLeave]);

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (afkConfirmOpen) {
        if (e.key === 'Escape') setAfkConfirmOpen(false);
        return;
      }
      if (tradePickerOpen || room.gameState !== 'playing') return;
      const k = e.key.toLowerCase();
      if (e.key === 'Enter' && canAct && selectionEval.valid) {
        e.preventDefault();
        handlePlay();
      } else if (k === 'p' || e.key === 'Backspace') {
        if (!isAfk && (canPass || room.canUndoPass)) {
          e.preventDefault();
          if (canPass) handlePass();
          else if (room.canUndoPass) handleUndoPass();
        }
      } else if (k === 'h' && canAct) {
        e.preventDefault();
        handleHint();
      } else if (k === 's') {
        e.preventDefault();
        handleSortToggle();
      } else if (e.key === 'Escape') {
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    afkConfirmOpen,
    tradePickerOpen,
    room.gameState,
    room.canUndoPass,
    isAfk,
    canAct,
    canPass,
    selectionEval.valid,
    handlePlay,
    handlePass,
    handleUndoPass,
    handleHint,
    handleSortToggle,
  ]);

  // ---------- Seats ----------
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

  const unreadCount = Math.max(0, room.activity.length - seenActivityCount);
  const noPlays = isMyTurn && !isFirstPlayOfRound && room.activePlay && eligiblePlays.length === 0;
  const leaderName = currentPlayer?.id === room.viewerId ? 'You' : currentPlayer?.name;

  const handleRightClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (selectedIds.length > 0) {
        sfx.cardSelect();
        setSelectedIds([]);
      }
    },
    [selectedIds.length]
  );

  return (
    <div className="table-shell" onContextMenu={handleRightClick}>
      {midRoundConfettiKey > 0 && room.gameState === 'playing' && (
        <Confetti key={midRoundConfettiKey} count={75} duration={2100} />
      )}

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
            <span className="chip chip--gold">
              2× Deck · {room.rules.doubleDeck26Cards ? '26' : '13'}
            </span>
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

      {/* ================= STAGE (SEATS HUGGING THE TABLE) ================= */}
      <main className="stage">
        <div className="table-cluster">
          {seats.map(({ player, pos }) => (
            <Seat
              key={player.id}
              player={player}
              pos={pos}
              isTurn={currentPlayer?.id === player.id && room.gameState === 'playing' && !diceActive}
              timer={timerData?.info ?? null}
              justFinished={celebratingId === player.id}
              clockOffset={clockOffset}
            />
          ))}

          <div
            key={`rim_${bombShakeKey}`}
            className={`table-rim${bombShakeKey > 0 ? ' is-shaking' : ''}`}
          >
            <div className="table-felt" aria-live="polite">
              <div className="felt-mark" aria-hidden="true">
                <span>CAPSA</span>
              </div>

              {isBomb && playKey && <span key={`wave_${playKey}`} className="shockwave" aria-hidden="true" />}

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
                    {isBomb && <Flame size={14} />}
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
                <div
                  key={`splash_${playKey}`}
                  className={`combo-splash${isBomb ? ' is-bomb' : ''}`}
                  aria-hidden="true"
                >
                  {splashText}
                </div>
              )}

              {/* Celebratory Player-Out Finish Banner */}
              {finishBanner && room.gameState === 'playing' && (
                <div
                  key={finishBanner.id}
                  className={`finish-banner finish-banner--${finishBanner.rank}`}
                >
                  <Trophy size={16} />
                  <span>
                    <strong>{finishBanner.name}</strong> went out <strong>{ORDINALS[finishBanner.rank]}</strong>!
                  </span>
                  <span className="finish-pts">+{finishBanner.points} pts</span>
                </div>
              )}

              <div className="felt-notes">
                {isTradeRequester && pendingTrade && (
                  <div className="note-chip is-static">
                    Asking for {cardToString(pendingTrade.requestedCard)}…
                    <button
                      type="button"
                      className="note-chip-btn"
                      onClick={() => onIntent({ type: 'TRADE_CANCEL' })}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {error ? (
                  <div key={`err_${error}`} className="note-chip is-error is-static">
                    {error}
                  </div>
                ) : (room.gameState === 'roundover' || room.gameState === 'gameover') && !scoreboardVisible ? (
                  <div className="note-chip is-trick is-static">
                    <Sparkles size={13} />
                    <span>Round complete — tallying scores…</span>
                  </div>
                ) : currentPlayer?.disconnected && !currentPlayer.isBot && currentPlayer.reconnectGraceUntil ? (
                  <div className="note-chip is-static">
                    <span>
                      Waiting for <strong>{currentPlayer.name}</strong>{' '}
                      {currentPlayer.swapDevice ? 'to switch devices' : 'to reconnect'} (
                      <CountdownText deadline={currentPlayer.reconnectGraceUntil} offset={clockOffset} />)
                    </span>
                  </div>
                ) : (
                  trickBanner &&
                  !room.activePlay && (
                    <div key={trickBanner.id} className="note-chip is-trick">
                      <Sparkles size={13} />
                      <span>
                        {trickBanner.hibah
                          ? `Hibah! Lead passes to ${trickBanner.winnerName}`
                          : `${trickBanner.winnerName} ${trickBanner.winnerName === 'You' ? 'take' : 'takes'} the lead`}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ================= DOCK ================= */}
      <footer className="dock">
        <div className="sel-slot">
          {isAfk ? (
            <button
              type="button"
              className="sel-chip is-afk-chip"
              onClick={handleAvatarClick}
            >
              <Bot size={13} />
              <span>AFK bot active — click here or your avatar to resume</span>
            </button>
          ) : (
            (selectionEval.label || noPlays) && (
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
            )
          )}
        </div>

        <div
          className={`hand${useTwoRows ? ' is-two-rows' : ''}${isDealing ? ' is-dealing' : ''}${draggingId ? ' is-dragging' : ''}`}
          key={`round_${room.roundNumber}`}
        >
          {handRows.map((row, rowIdx) => {
            const n = row.length;
            const spread = Math.min(2.8, 30 / Math.max(n, 1));
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
                    Boolean(
                      room.startingCard &&
                        card.rank === room.startingCard.rank &&
                        card.suit === room.startingCard.suit
                    );
                  const isBeingDragged = draggingId === card.id;
                  return (
                    <div
                      key={card.id}
                      ref={(el) => registerSlot(card.id, el)}
                      className={`fan-slot${isBeingDragged ? ' is-drag-placeholder' : ''}`}
                      style={{ '--off': i - (n - 1) / 2, '--i': i + rowIdx * 13 } as CSSProperties}
                    >
                      <div className="fan-flip" ref={(el) => registerFlip(card.id, el)}>
                        <PlayingCard
                          card={card}
                          interactive
                          selected={selectedIds.includes(card.id)}
                          highlightStarting={isStartCard}
                          onPointerDown={(e) => handleCardPointerDown(card, e)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault();
                              toggleCard(card);
                            }
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* GPU-composited floating card while dragging */}
        {draggingCard && (
          <div
            ref={ghostRef}
            className="drag-ghost"
            style={{ width: ghostDims.w, height: ghostDims.h }}
            aria-hidden="true"
          >
            <PlayingCard
              card={draggingCard}
              selected={false}
            />
          </div>
        )}

        <div className={`dock-bar${isMyTurn ? ' is-turn' : ''}${me?.finishRank ? ' is-me-done' : ''}${isAfk ? ' is-afk' : ''}`}>
          <div className="me">
            <button
              type="button"
              className={`me-avatar-btn${isAfk ? ' is-afk' : ''}`}
              title={isAfk ? 'Click to resume control' : 'Click to let a bot play while AFK'}
              aria-label={isAfk ? 'Resume control from AFK bot' : 'Enable AFK bot takeover'}
              onClick={handleAvatarClick}
            >
              <Avatar
                name={me?.name ?? 'You'}
                isBot={isAfk}
                size="sm"
                active={isMyTurn}
                timer={isMyTurn ? (timerData?.info ?? null) : null}
              />
              {isAfk && <span className="afk-dot">AFK</span>}
            </button>
            <div className="me-info">
              <div className="me-name">
                <span className="me-name-text">{me?.name}</span>
                {isAfk ? (
                  <span className="afk-pill">AFK · Bot</span>
                ) : (
                  isMyTurn && <span className="turn-pill">Your turn</span>
                )}
                {me?.finishRank && (
                  <span className={`medal medal--${me.finishRank} medal--inline`}>
                    {ORDINALS[me.finishRank]}
                  </span>
                )}
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
              title={customOrder ? `Sort by ${sortMethod} (S)` : 'Sort (S)'}
              onClick={handleSortToggle}
            >
              <ArrowUpDown size={15} />
              <span>{sortMethod === 'rank' ? 'Rank' : 'Suit'}</span>
              {customOrder && <span className="sort-dot" title="Custom order" />}
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
              disabled={!canAct || eligiblePlays.length === 0}
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
                disabled={!canAct || Boolean(pendingTrade)}
                onClick={() => setTradePickerOpen(true)}
              >
                <ArrowLeftRight size={15} />
                <span>Trade</span>
              </button>
            )}
          </div>

          <div className="actions">
            {room.canUndoPass && !isAfk ? (
              <button
                type="button"
                className="act-btn act-btn--ghost"
                title="Undo Pass (P / Backspace)"
                onClick={handleUndoPass}
              >
                <RotateCcw size={15} />
                Undo
              </button>
            ) : (
              <button
                type="button"
                className="act-btn act-btn--ghost"
                title="Pass (P / Backspace)"
                disabled={!canPass}
                onClick={handlePass}
              >
                Pass
              </button>
            )}
            <button
              type="button"
              className={`act-btn act-btn--play${canAct && selectionEval.valid ? ' is-ready' : ''}`}
              disabled={!canAct || !selectionEval.valid}
              onClick={handlePlay}
            >
              Play{selectedCards.length > 0 ? ` ${selectedCards.length}` : ''}
            </button>
          </div>
        </div>
      </footer>

      {/* ================= OVERLAYS ================= */}
      {afkConfirmOpen && (
        <div className="modal-backdrop" onClick={() => setAfkConfirmOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={() => setAfkConfirmOpen(false)}
            >
              <X size={16} />
            </button>
            <div className="eyebrow">Seat controls · {me?.name}</div>
            <h2 className="modal-title">Step away or switch devices</h2>
            <p className="modal-sub">Choose how you'd like your seat handled while you're away.</p>

            <div className="profile-options">
              <button
                type="button"
                className="profile-opt-card"
                onClick={() => {
                  setAfkConfirmOpen(false);
                  setSelectedIds([]);
                  onIntent({ type: 'TOGGLE_AUTOPLAY' });
                }}
              >
                <span className="profile-opt-icon">
                  <Bot size={20} />
                </span>
                <div className="profile-opt-text">
                  <strong>AFK Bot Takeover</strong>
                  <small>Stay seated while a bot plays your turns. Click your avatar anytime to resume.</small>
                </div>
              </button>

              {room.mode === 'multiplayer' && (
                <button
                  type="button"
                  className="profile-opt-card"
                  disabled={isHost}
                  onClick={handleSwapDevice}
                >
                  <span className="profile-opt-icon is-sky">
                    <Smartphone size={20} />
                  </span>
                  <div className="profile-opt-text">
                    <strong>Switch Device (1 min grace)</strong>
                    <small>
                      {isHost
                        ? 'Unavailable while hosting — closing the host tab closes the room.'
                        : `Exit here and tap Rejoin on your phone using "${me?.name}" within 60s before a bot takes over.`}
                    </small>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
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

      {(room.gameState === 'roundover' || room.gameState === 'gameover') && scoreboardVisible && (
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
