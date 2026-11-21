import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Bot,
  Check,
  Clock,
  Copy,
  Crown,
  Flame,
  Layers,
  Lightbulb,
  LogOut,
  MessageCircle,
  RotateCcw,
  Rows2,
  SkipForward,
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
import { haptics } from '../utils/haptics';
import { prefersReducedMotion, shakeElement } from '../utils/motion';
import { sfx } from '../utils/sfx';
import { Avatar, type TimerInfo } from './Avatar';
import { Confetti, ImpactBurst, type BurstEvent } from './Confetti';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
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

const SEAT_ANGLES_WIDE: Record<SeatPos, number> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
};

const SEAT_ANGLES_NARROW: Record<SeatPos, number> = {
  top: 0,
  right: 45,
  bottom: 180,
  left: 315,
};

const SWEEP_FALLBACK: Record<SeatPos, { tx: string; ty: string }> = {
  bottom: { tx: '0px', ty: '180px' },
  left: { tx: '-240px', ty: '-10px' },
  top: { tx: '0px', ty: '-170px' },
  right: { tx: '240px', ty: '-10px' },
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

function CountdownText({
  deadline,
  offset,
  tickAudio = false,
  onUrgentChange,
}: {
  deadline: number;
  offset: number;
  tickAudio?: boolean;
  onUrgentChange?: (urgent: boolean) => void;
}) {
  const calc = useCallback(
    () => Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)),
    [deadline, offset]
  );
  const [secs, setSecs] = useState(calc);
  const lastTickedRef = useRef<number | null>(null);

  useEffect(() => {
    lastTickedRef.current = null;
    setSecs(calc());
    const id = window.setInterval(() => setSecs(calc()), 250);
    return () => window.clearInterval(id);
  }, [calc]);

  useEffect(() => {
    onUrgentChange?.(secs <= 7 && secs > 0);
  }, [secs, onUrgentChange]);

  useEffect(() => {
    if (!tickAudio || secs <= 0 || secs > 5) return;
    if (lastTickedRef.current !== secs) {
      lastTickedRef.current = secs;
      sfx.timerTick(secs);
    }
  }, [secs, tickAudio]);

  return <span className={secs <= 7 ? 'is-urgent' : ''}>{secs}s</span>;
}

function Seat({
  player,
  pos,
  isTurn,
  timer,
  justFinished,
  isDealing,
  justPassed,
  lowAlert,
  roundGain,
  seatRef,
  clockOffset,
}: {
  player: SanitizedPlayer;
  pos: SeatPos;
  isTurn: boolean;
  timer: TimerInfo | null;
  justFinished: boolean;
  isDealing: boolean;
  justPassed: boolean;
  lowAlert: boolean;
  roundGain: number;
  seatRef: (el: HTMLElement | null) => void;
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
      ref={seatRef}
      className={`seat seat--${pos}${isTurn ? ' is-turn' : ''}${
        player.passed && !player.finishRank ? ' is-passed' : ''
      }${justPassed ? ' is-just-passed' : ''}${
        player.finishRank ? ` is-done is-rank-${player.finishRank}` : ''
      }${justFinished ? ' is-celebrating' : ''}`}
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
        {roundGain > 0 && (
          <span className="seat-pts-float" aria-hidden="true">
            +{roundGain}
          </span>
        )}
        {lowAlert && !player.finishRank && (
          <span className="seat-low-alert" aria-hidden="true">
            1 CARD!
          </span>
        )}
        {player.finishRank && (
          <span className={`medal medal--${player.finishRank}`}>{player.finishRank}</span>
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
        <div className="seat-stats">
          <span className="seat-score">
            <strong>{player.score}</strong> pts
          </span>
          {!player.finishRank && (
            <span
              className={`seat-count${player.cardCount <= 2 ? ' is-low' : ''}`}
              title={`${player.cardCount} cards left`}
            >
              <Layers size={12} className="seat-count-ico" />
              <strong key={player.cardCount} className="seat-count-num">
                {player.cardCount}
              </strong>
            </span>
          )}
        </div>
      </div>

      {!player.finishRank && fanCount > 0 && (
        <div className={`seat-fan${isDealing ? ' is-dealing' : ''}`} aria-hidden="true">
          {Array.from({ length: fanCount }).map((_, i) => (
            <span
              key={i}
              className="seat-fan-slot"
              style={{ '--off': i - (fanCount - 1) / 2, '--i': i } as CSSProperties}
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
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [copiedHudCode, setCopiedHudCode] = useState(false);
  const [visibleError, setVisibleError] = useState<string | null>(error);
  const [isPassQueued, setIsPassQueued] = useState(false);
  const [turnFlashKey, setTurnFlashKey] = useState(0);
  const [turnNudged, setTurnNudged] = useState(false);
  const [scoreboardVisible, setScoreboardVisible] = useState(
    () => room.gameState === 'roundover' || room.gameState === 'gameover'
  );
  const handRef = useRef<HTMLDivElement | null>(null);
  const afkTitleId = useId();
  const clockOffset = useMemo(() => room.serverNow - Date.now(), [room.serverNow]);

  useEffect(() => {
    setVisibleError(error);
    if (!error) return;
    const id = window.setTimeout(() => setVisibleError(null), 3500);
    return () => window.clearTimeout(id);
  }, [error]);

  // Celebratory & impact effects state
  const [finishBanner, setFinishBanner] = useState<FinishBanner | null>(null);
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  const [midRoundConfettiKey, setMidRoundConfettiKey] = useState<number>(0);
  const [trickBanner, setTrickBanner] = useState<TrickBanner | null>(null);
  const [isUrgentTurn, setIsUrgentTurn] = useState(false);
  const [burstEvent, setBurstEvent] = useState<BurstEvent | null>(null);
  const [feltRipple, setFeltRipple] = useState<{ key: string; tier: 'normal' | 'five' | 'bomb' } | null>(null);
  const [justPassedIds, setJustPassedIds] = useState<Set<string>>(() => new Set());
  const [lowAlertId, setLowAlertId] = useState<string | null>(null);
  const [recentlyTradedIds, setRecentlyTradedIds] = useState<Set<string>>(() => new Set());
  const [sweepingTrick, setSweepingTrick] = useState<{
    id: number;
    cards: Card[];
    tx: string;
    ty: string;
  } | null>(null);

  const tableRimRef = useRef<HTMLDivElement | null>(null);
  const feltRef = useRef<HTMLDivElement | null>(null);
  const selChipRef = useRef<HTMLDivElement | null>(null);
  const seatElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const burstIdRef = useRef(0);

  const registerSeatEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) seatElsRef.current.set(id, el);
    else seatElsRef.current.delete(id);
  }, []);

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

  // Reset manual hand order and choreograph deal entrance + riffle audio once per round
  useEffect(() => {
    setCustomOrder(null);
    if (prefersReducedMotion()) {
      setIsDealing(false);
      return;
    }
    setIsDealing(true);
    const dealTimers: number[] = [];
    const snapCount = 9;
    for (let i = 0; i < snapCount; i++) {
      dealTimers.push(
        window.setTimeout(() => {
          sfx.dealCard(i);
        }, 60 + i * 44)
      );
    }
    const endTimer = window.setTimeout(() => setIsDealing(false), 860);
    return () => {
      for (const t of dealTimers) window.clearTimeout(t);
      window.clearTimeout(endTimer);
    };
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

  useEffect(() => {
    if (!canAct || !timerData) setIsUrgentTurn(false);
  }, [canAct, timerData]);

  // ---------- Clean stale selections ----------
  useEffect(() => {
    const validSet = new Set(rawHand.map((c) => c.id));
    setSelectedIds((prev) => {
      const filtered = prev.filter((id) => validSet.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
    setHintIdx(0);
  }, [rawHand, room.activePlay, room.turnIndex]);

  // ---------- Played pile + Tiered Combo Juice ----------
  const playKey = room.activePlay
    ? `${room.lastPlayerPlayedId}:${room.activePlay.cards.map((c) => c.id).join(',')}`
    : null;
  const [underPlay, setUnderPlay] = useState<{ key: string; cards: Card[] } | null>(null);
  const lastPlayRef = useRef<{ key: string | null; cards: Card[] | null }>({ key: null, cards: null });

  useEffect(() => {
    const prev = lastPlayRef.current;
    if (playKey === prev.key) return;
    setUnderPlay(playKey && prev.key && prev.cards ? { key: prev.key, cards: prev.cards } : null);
    lastPlayRef.current = { key: playKey, cards: room.activePlay ? room.activePlay.cards : null };
    if (!playKey || !room.activePlay) return;

    const feltRect = feltRef.current?.getBoundingClientRect();
    const t = room.activePlay.type;
    const count = room.activePlay.cards.length;
    const bombed = t === 'bomber' || t === 'straightflush';
    const isFive = count === 5 && !bombed;
    const hasBigTwo = room.activePlay.cards.some((c) => c.rank === '2' && c.suit === 'S');

    sfx.cardPlay(t, count, hasBigTwo);
    if (room.lastPlayerPlayedId === room.viewerId || bombed) {
      haptics.play(bombed ? 'bomb' : isFive ? 'five' : 'normal');
    }

    setFeltRipple({ key: playKey, tier: bombed ? 'bomb' : isFive ? 'five' : 'normal' });

    if (bombed) {
      shakeElement(tableRimRef.current, 'bomb');
      if (feltRect) {
        burstIdRef.current += 1;
        setBurstEvent({
          id: burstIdRef.current,
          x: feltRect.left + feltRect.width / 2,
          y: feltRect.top + feltRect.height / 2,
          variant: t === 'straightflush' ? 'straightflush' : 'bomb',
        });
      }
    } else if (t === 'fullhouse') {
      shakeElement(tableRimRef.current, 'heavy');
      if (feltRect) {
        burstIdRef.current += 1;
        setBurstEvent({
          id: burstIdRef.current,
          x: feltRect.left + feltRect.width / 2,
          y: feltRect.top + feltRect.height / 2,
          variant: 'fullhouse',
        });
      }
    }
  }, [playKey, room.activePlay, room.lastPlayerPlayedId, room.viewerId]);

  // ---------- Opponent Pass Recoil/Audio & Last-Card Alert ----------
  const prevPassedRef = useRef<Map<string, boolean>>(new Map());
  const prevCountRef = useRef<Map<string, number>>(new Map());
  const lowAlertedRef = useRef<Set<string>>(new Set());
  const seatEffectTimersRef = useRef<Set<number>>(new Set());

  const clearSeatEffectTimers = useCallback(() => {
    for (const id of seatEffectTimersRef.current) {
      window.clearTimeout(id);
    }
    seatEffectTimersRef.current.clear();
  }, []);

  useEffect(() => {
    clearSeatEffectTimers();
    lowAlertedRef.current = new Set();
    prevPassedRef.current = new Map();
    prevCountRef.current = new Map();
    setJustPassedIds(new Set());
    setLowAlertId(null);
  }, [room.roundNumber, clearSeatEffectTimers]);

  useEffect(() => clearSeatEffectTimers, [clearSeatEffectTimers]);

  useEffect(() => {
    if (room.gameState !== 'playing') return;
    const newlyPassed: string[] = [];
    let newLowPlayerId: string | null = null;

    for (const p of room.players) {
      const wasPassed = prevPassedRef.current.get(p.id);
      if (wasPassed === false && p.passed && p.id !== room.viewerId && !p.finishRank) {
        newlyPassed.push(p.id);
      }
      prevPassedRef.current.set(p.id, p.passed);

      const prevCount = prevCountRef.current.get(p.id);
      if (
        prevCount !== undefined &&
        prevCount > 1 &&
        p.cardCount === 1 &&
        !p.finishRank &&
        !lowAlertedRef.current.has(p.id)
      ) {
        lowAlertedRef.current.add(p.id);
        newLowPlayerId = p.id;
      }
      prevCountRef.current.set(p.id, p.cardCount);
    }

    if (newlyPassed.length > 0) {
      sfx.opponentPass();
      setJustPassedIds((prev) => {
        const next = new Set(prev);
        for (const id of newlyPassed) next.add(id);
        return next;
      });
      const id = window.setTimeout(() => {
        seatEffectTimersRef.current.delete(id);
        setJustPassedIds((prev) => {
          const next = new Set(prev);
          for (const pid of newlyPassed) next.delete(pid);
          return next;
        });
      }, 300);
      seatEffectTimersRef.current.add(id);
    }

    if (newLowPlayerId) {
      sfx.lowCardAlert();
      setLowAlertId(newLowPlayerId);
      const id = window.setTimeout(() => {
        seatEffectTimersRef.current.delete(id);
        setLowAlertId((cur) => (cur === newLowPlayerId ? null : cur));
      }, 1700);
      seatEffectTimersRef.current.add(id);
    }
  }, [room.players, room.viewerId, room.gameState]);

  // ---------- Card Trade arrival shimmer ----------
  const lastTradeCountRef = useRef<number>(room.tradingState?.history.length ?? 0);
  useEffect(() => {
    const history = room.tradingState?.history ?? [];
    if (history.length > lastTradeCountRef.current) {
      const latest = history[history.length - 1];
      if (latest && latest.requesterId === room.viewerId) {
        sfx.tradeComplete();
        const arrived = new Set([latest.requestedCard.id, latest.extraCard.id]);
        setRecentlyTradedIds(arrived);
        const id = window.setTimeout(() => setRecentlyTradedIds(new Set()), 1400);
        lastTradeCountRef.current = history.length;
        return () => window.clearTimeout(id);
      }
    }
    lastTradeCountRef.current = history.length;
  }, [room.tradingState?.history, room.viewerId]);

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
      setSweepingTrick(null);
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
    } else {
      const seatEl = seatElsRef.current.get(topFinisher.id);
      const rect = seatEl?.getBoundingClientRect() ?? feltRef.current?.getBoundingClientRect();
      if (rect) {
        burstIdRef.current += 1;
        setBurstEvent({
          id: burstIdRef.current,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          variant: 'finish',
        });
      }
    }

    const timer = window.setTimeout(() => {
      setCelebratingId((cur) => (cur === topFinisher.id ? null : cur));
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [room.players, room.roundNumber, room.viewerId, room.gameState]);

  // ---------- Detect Trick Win / Hibah + Sweep Collect Animation ----------
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

      const cardsToSweep = room.lastTrick!.cards;
      if (cardsToSweep.length > 0 && !prefersReducedMotion()) {
        const feltRect = feltRef.current?.getBoundingClientRect();
        const winnerSeatEl =
          room.lastTrick!.winnerId !== room.viewerId
            ? seatElsRef.current.get(room.lastTrick!.winnerId)
            : null;
        let tx = SWEEP_FALLBACK.bottom.tx;
        let ty = SWEEP_FALLBACK.bottom.ty;

        if (feltRect && winnerSeatEl) {
          const sr = winnerSeatEl.getBoundingClientRect();
          tx = `${Math.round((sr.left + sr.width / 2 - (feltRect.left + feltRect.width / 2)) * 0.72)}px`;
          ty = `${Math.round((sr.top + sr.height / 2 - (feltRect.top + feltRect.height / 2)) * 0.72)}px`;
        } else if (room.lastTrick!.winnerId !== room.viewerId) {
          tx = '0px';
          ty = '-160px';
        }

        setSweepingTrick({ id: ts, cards: cardsToSweep, tx, ty });
        const clearId = window.setTimeout(() => {
          setSweepingTrick((cur) => (cur?.id === ts ? null : cur));
        }, 440);
        return () => window.clearTimeout(clearId);
      }
    }
  }, [room.lastTrick, room.viewerId]);

  // ---------- Sound cues, turn alerts, tab title & delayed scoreboard ----------
  const prevCanActRef = useRef(false);
  const prevGameStateRef = useRef(room.gameState);
  useEffect(() => {
    if (canAct && !prevCanActRef.current && !isPassQueued) {
      sfx.yourTurn();
      haptics.yourTurn();
      setTurnFlashKey((k) => k + 1);
    }
    prevCanActRef.current = canAct;
  }, [canAct, isPassQueued]);

  // Gentle reminder chime + extra pulse if idle for 8s on your turn
  useEffect(() => {
    if (!canAct || isPassQueued) {
      setTurnNudged(false);
      return;
    }
    const id = window.setTimeout(() => {
      setTurnNudged(true);
      sfx.turnNudge();
    }, 8000);
    return () => window.clearTimeout(id);
  }, [canAct, isPassQueued, room.turnIndex, room.activePlay, room.roundNumber]);

  // Browser tab title alert so tabbed-out players notice their turn
  useEffect(() => {
    document.title = canAct ? '★ YOUR TURN — Capsa Banting' : 'Capsa Banting';
    return () => {
      document.title = 'Capsa Banting';
    };
  }, [canAct]);

  useEffect(() => {
    const isEnd = room.gameState === 'roundover' || room.gameState === 'gameover';
    const wasPlaying = prevGameStateRef.current === 'playing';
    prevGameStateRef.current = room.gameState;

    if (!isEnd) {
      setScoreboardVisible(false);
      return;
    }

    if (wasPlaying) {
      const isMatchOver = room.gameState === 'gameover';
      const sortedPlayers = [...room.players].sort((a, b) =>
        isMatchOver ? b.score - a.score : (a.finishRank ?? 99) - (b.finishRank ?? 99)
      );
      const viewer = room.players.find((p) => p.id === room.viewerId);
      const viewerWon = isMatchOver
        ? sortedPlayers[0]?.id === room.viewerId
        : viewer?.finishRank === 1;

      if (viewerWon) {
        sfx.roundWin(isMatchOver);
        haptics.win();
      } else {
        sfx.roundLose(isMatchOver);
      }

      setScoreboardVisible(false);
      const id = window.setTimeout(() => setScoreboardVisible(true), 2200);
      return () => window.clearTimeout(id);
    }

    setScoreboardVisible(true);
  }, [room.gameState, room.players, room.viewerId]);

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
    if (combo.type === 'invalid') {
      if (selectedCards.length === 2) return { valid: false, label: 'Pair needs matching ranks' };
      if (selectedCards.length === 3) return { valid: false, label: 'Tris needs 3 matching ranks' };
      if (selectedCards.length === 4) return { valid: false, label: 'Play 1, 2, 3, or 5 cards' };
      if (selectedCards.length === 5) return { valid: false, label: 'Not a valid 5-card hand' };
      return { valid: false, label: 'Select at most 5 cards' };
    }
    if (isFirstPlayOfRound && !containsStartingCard(combo.cards, room.startingCard)) {
      return { valid: false, label: `Needs ${room.startingCard ? cardToString(room.startingCard) : '3♦'}` };
    }
    if (!canBeat(combo, room.activePlay, bombRules)) {
      if (room.activePlay && combo.cards.length !== room.activePlay.cards.length) {
        const isBombCombo = combo.type === 'bomber' || combo.type === 'straightflush';
        if (isBombCombo) {
          return { valid: false, label: `${COMBO_LABELS[combo.type]} · only bombs 2s` };
        }
        return {
          valid: false,
          label: `Table is ${COMBO_LABELS[room.activePlay.type]} (${room.activePlay.cards.length} cards)`,
        };
      }
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
    setSelectedIds((prev) => {
      const removing = prev.includes(card.id);
      const next = removing ? prev.filter((id) => id !== card.id) : [...prev, card.id];
      sfx.cardSelect(next.length, removing);
      if (removing) haptics.deselect();
      else haptics.select();
      return next;
    });
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
    onDragStart: () => haptics.select(),
    onSwap: () => {
      sfx.dragSwap();
      haptics.dragSwap();
    },
    resetKey: room.roundNumber,
  });

  useEffect(() => {
    if (draggingId) setIsDealing(false);
  }, [draggingId]);

  const handleSortToggle = useCallback(() => {
    snapshotRects();
    sfx.sortShuffle();
    haptics.select();
    if (customOrder) {
      // Snap back to current sort method first
      setCustomOrder(null);
    } else {
      setSortMethod((prev) => (prev === 'rank' ? 'suit' : 'rank'));
    }
  }, [customOrder, snapshotRects]);

  const canPass = canAct && Boolean(room.activePlay) && !isFirstPlayOfRound;
  const canQueuePass =
    room.gameState === 'playing' &&
    !diceActive &&
    !isMyTurn &&
    !isAfk &&
    !me?.finishRank &&
    !me?.passed &&
    !room.canUndoPass &&
    Boolean(room.activePlay);

  // Clear queued pass whenever trick resets, round changes, or player is no longer eligible
  useEffect(() => {
    if (
      room.gameState !== 'playing' ||
      diceActive ||
      !room.activePlay ||
      isAfk ||
      Boolean(me?.finishRank) ||
      Boolean(me?.passed)
    ) {
      setIsPassQueued(false);
    }
  }, [room.gameState, room.roundNumber, diceActive, room.activePlay, isAfk, me?.finishRank, me?.passed]);

  // Auto-fire queued pass as soon as your turn begins on an active trick
  useEffect(() => {
    if (!isPassQueued || !canAct) return;
    if (Boolean(room.activePlay) && !isFirstPlayOfRound) {
      setIsPassQueued(false);
      setSelectedIds([]);
      sfx.pass();
      haptics.pass();
      onIntent({ type: 'PASS' });
    } else {
      // Fresh lead — cancel queued pass instead of passing
      setIsPassQueued(false);
    }
  }, [isPassQueued, canAct, room.activePlay, isFirstPlayOfRound, onIntent]);

  const handlePlay = useCallback(() => {
    if (!canAct || !selectionEval.valid) return;
    setIsPassQueued(false);
    onIntent({ type: 'PLAY_CARDS', cardIds: selectedIds });
    setSelectedIds([]);
  }, [canAct, selectionEval.valid, onIntent, selectedIds]);

  const handlePass = useCallback(() => {
    if (!canPass) return;
    setIsPassQueued(false);
    sfx.pass();
    haptics.pass();
    onIntent({ type: 'PASS' });
    setSelectedIds([]);
  }, [canPass, onIntent]);

  const handleUndoPass = useCallback(() => {
    if (!isAfk && room.canUndoPass) onIntent({ type: 'UNDO_PASS' });
  }, [isAfk, room.canUndoPass, onIntent]);

  const handleHint = useCallback(() => {
    if (!canAct || eligiblePlays.length === 0) return;
    const play = eligiblePlays[hintIdx % eligiblePlays.length];
    sfx.cardSelect(play.length, false);
    haptics.select();
    setSelectedIds(play.map((c) => c.id));
    setHintIdx((prev) => prev + 1);
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

  const copyHudInvite = useCallback(() => {
    if (room.mode === 'solo' || typeof window === 'undefined') return;
    const url = `${window.location.origin}/?room=${room.code}`;
    void navigator.clipboard?.writeText(url).then(() => {
      setCopiedHudCode(true);
      window.setTimeout(() => setCopiedHudCode(false), 1800);
    }).catch(() => {
      // ignore
    });
  }, [room.mode, room.code]);

  const handleCardKeyDown = useCallback(
    (card: Card, indexInHand: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        toggleCard(card);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const delta = e.key === 'ArrowLeft' ? -1 : 1;
        const nextIdx = indexInHand + delta;
        if (nextIdx < 0 || nextIdx >= sortedHand.length) return;

        if (e.shiftKey) {
          snapshotRects();
          const nextIds = sortedHand.map((c) => c.id);
          const [moved] = nextIds.splice(indexInHand, 1);
          nextIds.splice(nextIdx, 0, moved);
          setCustomOrder(nextIds);
          window.requestAnimationFrame(() => {
            const buttons = handRef.current?.querySelectorAll<HTMLButtonElement>('.pcard.is-interactive');
            buttons?.[nextIdx]?.focus();
          });
        } else {
          const buttons = handRef.current?.querySelectorAll<HTMLButtonElement>('.pcard.is-interactive');
          buttons?.[nextIdx]?.focus();
        }
      }
    },
    [toggleCard, sortedHand, snapshotRects]
  );

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (afkConfirmOpen || leaveConfirmOpen || tradePickerOpen || drawerOpen) return;
      if (room.gameState !== 'playing') return;
      const k = e.key.toLowerCase();
      if (e.key === 'Enter' && canAct && selectedIds.length > 0) {
        e.preventDefault();
        if (selectionEval.valid) {
          handlePlay();
        } else {
          sfx.invalidAction();
          haptics.error();
          shakeElement(selChipRef.current, 'reject');
        }
      } else if (k === 'p' || e.key === 'Backspace') {
        if (!isAfk && (canPass || room.canUndoPass || canQueuePass)) {
          e.preventDefault();
          if (canPass) handlePass();
          else if (room.canUndoPass) handleUndoPass();
          else if (canQueuePass) setIsPassQueued((prev) => !prev);
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
    leaveConfirmOpen,
    tradePickerOpen,
    drawerOpen,
    room.gameState,
    room.canUndoPass,
    isAfk,
    canAct,
    canPass,
    canQueuePass,
    selectionEval.valid,
    selectedIds.length,
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
  const mustPass = Boolean(noPlays && !isAfk);
  const leaderName = currentPlayer?.id === room.viewerId ? 'You' : currentPlayer?.name;

  // Smoothly rotating clockwise spotlight angle pointing at the active player's side of the table
  const [isNarrowLayout, setIsNarrowLayout] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 860 : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 860px)');
    const update = () => setIsNarrowLayout(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const seatAngles = isNarrowLayout ? SEAT_ANGLES_NARROW : SEAT_ANGLES_WIDE;
  const activeSeat: SeatPos | null =
    room.gameState === 'playing' && !diceActive && currentPlayer
      ? seatOf(currentPlayer.id)
      : null;
  const [turnAngle, setTurnAngle] = useState<number>(() =>
    activeSeat ? seatAngles[activeSeat] : 180
  );
  useEffect(() => {
    if (!activeSeat) return;
    const target = seatAngles[activeSeat];
    setTurnAngle((prev) => {
      const mod = ((prev % 360) + 360) % 360;
      let delta = target - mod;
      if (delta < 0) delta += 360;
      if (delta === 270) delta = -90; // smooth reverse on Undo Pass
      return prev + delta;
    });
  }, [activeSeat, seatAngles]);

  const handleRightClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      if (selectedIds.length > 0) {
        sfx.cardSelect(0, true);
        haptics.deselect();
        setSelectedIds([]);
      }
    },
    [selectedIds.length]
  );

  const liveAnnouncement = useMemo(() => {
    if (visibleError) return visibleError;
    if (canAct) {
      if (isFirstPlayOfRound) return 'Your turn. Opening lead.';
      return !room.activePlay ? 'Your turn to lead.' : 'Your turn.';
    }
    if (room.activePlay && lastPlayedPlayer) {
      const who = lastPlayedPlayer.id === room.viewerId ? 'You' : lastPlayedPlayer.name;
      return `${who} played ${COMBO_LABELS[room.activePlay.type]}`;
    }
    return '';
  }, [visibleError, canAct, isFirstPlayOfRound, room.activePlay, room.viewerId, lastPlayedPlayer]);

  const isFlushRed =
    activeType === 'flush' &&
    (room.activePlay?.cards[0]?.suit === 'H' || room.activePlay?.cards[0]?.suit === 'D');
  const showRoundGain =
    (room.gameState === 'roundover' || room.gameState === 'gameover') && !scoreboardVisible;
  const isFiveReady = canAct && selectionEval.valid && selectedCards.length === 5;

  return (
    <div
      className={`table-shell${canAct ? ' is-my-turn' : ''}${turnNudged ? ' is-turn-nudged' : ''}${
        isUrgentTurn ? ' is-urgent-turn' : ''
      }`}
      onContextMenu={handleRightClick}
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
      {midRoundConfettiKey > 0 && room.gameState === 'playing' && (
        <Confetti key={midRoundConfettiKey} count={70} duration={2100} mode="round" />
      )}
      <ImpactBurst burst={burstEvent} />

      {/* ================= HUD ================= */}
      <header className="hud">
        <div className="hud-chips">
          {room.mode === 'solo' ? (
            <span className="chip chip--gold">Practice</span>
          ) : (
            <button
              type="button"
              className="chip chip--gold chip--copy"
              title="Copy invite link"
              aria-label={copiedHudCode ? 'Invite link copied' : `Room ${room.code} — copy invite link`}
              onClick={copyHudInvite}
            >
              {copiedHudCode ? <Check size={12} /> : <Copy size={11} />}
              <span>{copiedHudCode ? 'Copied' : room.code}</span>
            </button>
          )}
          <span className="chip">
            Round <strong>{room.roundNumber}</strong>
          </span>
          <span className="chip hide-sm">
            First to <strong>{room.rules.pointsToWin}</strong>
          </span>
          {room.roundNumber === 1 && (
            <span className="chip hide-sm" title="Turn order moves clockwise around the table">
              ↻ Clockwise
            </span>
          )}
          {room.rules.enableDoubleDeck && (
            <span className="chip chip--gold">
              2× Deck · {room.rules.doubleDeck26Cards ? '26' : '13'}
            </span>
          )}
          {room.rules.enableTrading && <span className="chip hide-sm">Trading</span>}
          {room.mode === 'multiplayer' && (
            <span
              className={`chip ${
                transport === 'reconnecting'
                  ? 'chip--gold'
                  : transport === 'connecting'
                    ? ''
                    : 'chip--mint'
              }`}
              title={
                transport === 'reconnecting'
                  ? 'Reconnecting to table…'
                  : transport === 'connecting'
                    ? 'Connecting to table'
                    : 'Connected to table'
              }
            >
              <Wifi size={12} />
              {transport === 'reconnecting'
                ? 'Reconnecting…'
                : transport === 'connecting'
                  ? 'Connecting'
                  : 'Online'}
            </span>
          )}
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute sound' : 'Mute sound'}
            onClick={() => setMuted(sfx.toggleMute())}
          >
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Table chat"
            title="Table talk"
            onClick={() => setDrawerOpen(true)}
          >
            <MessageCircle size={17} />
            {unreadCount > 0 && !drawerOpen && <span className="icon-dot" />}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Leave table"
            title="Leave table"
            onClick={() => setLeaveConfirmOpen(true)}
          >
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
              isDealing={isDealing}
              justPassed={justPassedIds.has(player.id)}
              lowAlert={lowAlertId === player.id}
              roundGain={showRoundGain ? player.roundPoints : 0}
              seatRef={(el) => registerSeatEl(player.id, el)}
              clockOffset={clockOffset}
            />
          ))}

          <div ref={tableRimRef} className="table-rim">
            <div ref={feltRef} className="table-felt">
              {activeSeat && (
                <div
                  className={`turn-beacon${activeSeat === 'bottom' ? ' is-self' : ''}`}
                  style={{ '--turn-deg': `${turnAngle}deg` } as CSSProperties}
                  aria-hidden="true"
                >
                  <span className="turn-beacon-beam" />
                </div>
              )}

              {isDealing && (
                <div className="deal-shoe" aria-hidden="true">
                  <CardBack className="card-back--xs" />
                  <CardBack className="card-back--xs" />
                  <CardBack className="card-back--xs" />
                </div>
              )}

              <div className="felt-mark" aria-hidden="true">
                <svg className="felt-crest" viewBox="0 0 220 120" fill="none">
                  <rect x="64" y="14" width="92" height="92" rx="14" transform="rotate(45 110 60)" stroke="currentColor" strokeWidth="1.4" />
                  <rect x="70" y="20" width="80" height="80" rx="10" transform="rotate(45 110 60)" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
                  <path d="M110 28l4.5 6-4.5 6-4.5-6z" fill="currentColor" opacity="0.65" />
                  <path d="M110 80c-2.5 2.4-5.5 4.2-5.5 6.8a3 3 0 0 0 5.5 1.7 3 3 0 0 0 5.5-1.7c0-2.6-3-4.4-5.5-6.8z" fill="currentColor" opacity="0.65" />
                  <circle cx="78" cy="60" r="2.8" fill="currentColor" opacity="0.55" />
                  <circle cx="142" cy="60" r="2.8" fill="currentColor" opacity="0.55" />
                  <text x="110" y="64" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="800" letterSpacing="5">
                    CAPSA
                  </text>
                </svg>
              </div>

              {turnFlashKey > 0 && canAct && (
                <div
                  key={`turn_${turnFlashKey}`}
                  className="turn-flash"
                  style={splashText ? { animationDelay: '380ms' } : undefined}
                  aria-hidden="true"
                >
                  <span>{!room.activePlay ? 'YOUR LEAD!' : 'YOUR TURN!'}</span>
                </div>
              )}

              {feltRipple && (
                <span
                  key={`ripple_${feltRipple.key}`}
                  className={`felt-ripple felt-ripple--${feltRipple.tier}`}
                  aria-hidden="true"
                />
              )}

              {isBomb && playKey && (
                <>
                  <span key={`wave_${playKey}`} className="shockwave" aria-hidden="true" />
                  <span
                    key={`wave2_${playKey}`}
                    className="shockwave shockwave--secondary"
                    aria-hidden="true"
                  />
                </>
              )}

              {underPlay && room.activePlay && (
                <div key={`under_${underPlay.key}`} className="trick trick--under" aria-hidden="true">
                  {underPlay.cards.map((card) => {
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

              {sweepingTrick && !room.activePlay && (
                <div
                  key={`sweep_${sweepingTrick.id}`}
                  className="trick trick--sweep"
                  style={{ '--tx': sweepingTrick.tx, '--ty': sweepingTrick.ty } as CSSProperties}
                  aria-hidden="true"
                >
                  {sweepingTrick.cards.map((card) => {
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
                      const isBigTwo = card.rank === '2' && card.suit === 'S';
                      return (
                        <div
                          key={card.id}
                          className={`trick-card is-fresh${isBigTwo ? ' is-big-two' : ''}`}
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
                <div className={`lead-hint${sweepingTrick ? ' is-delayed' : ''}`}>
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

              {splashText && playKey && activeType && (
                <div
                  key={`splash_${playKey}`}
                  className={`combo-splash combo-splash--${activeType}${isBomb ? ' is-bomb' : ''}${
                    isFlushRed ? ' is-flush-red' : ''
                  }`}
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
                {visibleError ? (
                  <div key={`err_${visibleError}`} className="note-chip is-error is-static" role="alert">
                    {visibleError}
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
                          ? `Hibah (free lead) → ${trickBanner.winnerName}`
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
          ) : mustPass && !selectionEval.label ? (
            <button
              type="button"
              className="sel-chip is-no-plays"
              onClick={handlePass}
            >
              <SkipForward size={15} />
              <span>Nothing beats that — press Pass</span>
            </button>
          ) : selectionEval.label ? (
            <div ref={selChipRef} className={`sel-chip ${selectionEval.valid ? 'is-valid' : 'is-invalid'}`}>
              <span>{selectionEval.label}</span>
              {selectedIds.length > 0 && (
                <button type="button" aria-label="Clear selection" onClick={() => setSelectedIds([])}>
                  <X size={12} />
                </button>
              )}
            </div>
          ) : isPassQueued ? (
            <button
              type="button"
              className="sel-chip is-queued-chip"
              onClick={() => setIsPassQueued(false)}
            >
              <Clock size={14} />
              <span>Pass queued — click or Backspace to cancel</span>
            </button>
          ) : canAct ? (
            <div className={`sel-chip is-your-turn${turnNudged ? ' is-nudged' : ''}`}>
              <span className="turn-dot" aria-hidden="true" />
              <span>
                {isFirstPlayOfRound
                  ? `YOUR TURN · Start with ${room.startingCard ? cardToString(room.startingCard) : '3♦'}`
                  : !room.activePlay
                    ? 'YOUR TURN · Lead any combo'
                    : 'YOUR TURN · Play or Pass'}
              </span>
            </div>
          ) : null}
        </div>

        <div
          ref={handRef}
          className={`hand${useTwoRows ? ' is-two-rows' : ''}${isDealing ? ' is-dealing' : ''}${draggingId ? ' is-dragging' : ''}${mustPass ? ' is-no-plays' : ''}${isFiveReady ? ' is-five-ready' : ''}`}
          key={`round_${room.roundNumber}`}
        >
          {handRows.map((row, rowIdx) => {
            const n = row.length;
            const spread = Math.min(2.8, 30 / Math.max(n, 1));
            const rowOffset = rowIdx === 0 ? 0 : handRows[0].length;
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
                  const isTradeArrived = recentlyTradedIds.has(card.id);
                  return (
                    <div
                      key={card.id}
                      ref={(el) => registerSlot(card.id, el)}
                      className={`fan-slot${isBeingDragged ? ' is-drag-placeholder' : ''}${isTradeArrived ? ' is-trade-arrived' : ''}`}
                      style={{ '--off': i - (n - 1) / 2, '--i': i + rowIdx * 13 } as CSSProperties}
                    >
                      <div className="fan-flip" ref={(el) => registerFlip(card.id, el)}>
                        <PlayingCard
                          card={card}
                          interactive
                          selected={selectedIds.includes(card.id)}
                          highlightStarting={isStartCard}
                          onPointerDown={(e) => handleCardPointerDown(card, e)}
                          onKeyDown={(e) => handleCardKeyDown(card, rowOffset + i, e)}
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
              selected={selectedIds.includes(draggingCard.id)}
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
                {isAfk && <span className="afk-pill">AFK · Bot</span>}
                {me?.finishRank && (
                  <span className={`medal medal--${me.finishRank} medal--inline`}>
                    {ORDINALS[me.finishRank]}
                  </span>
                )}
                {me?.passed && !me.finishRank && <span className="soft-pill">Passed</span>}
              </div>
              <div className="me-stats">
                <span className="stat-pill stat-pill--pts">
                  <strong>{me?.score ?? 0}</strong> pts
                  {showRoundGain && (me?.roundPoints ?? 0) > 0 && (
                    <span className="seat-pts-float seat-pts-float--self" aria-hidden="true">
                      +{me?.roundPoints}
                    </span>
                  )}
                </span>
                <span
                  className={`stat-pill stat-pill--cards${rawHand.length <= 2 && rawHand.length > 0 ? ' is-low' : ''}`}
                >
                  <Layers size={12} />
                  <strong>{rawHand.length}</strong>
                  <span className="hide-sm">{rawHand.length === 1 ? 'card' : 'cards'}</span>
                </span>
                {isMyTurn && timerData && (
                  <span className={`stat-pill stat-pill--timer${isUrgentTurn ? ' is-urgent-pill' : ''}`}>
                    <CountdownText
                      deadline={timerData.deadline}
                      offset={timerData.offset}
                      tickAudio={canAct}
                      onUrgentChange={setIsUrgentTurn}
                    />
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="tools">
            <button
              type="button"
              className="tool-btn"
              title={
                customOrder
                  ? `Reset custom order to ${sortMethod === 'rank' ? 'Rank' : 'Suit'} (S)`
                  : `Currently sorted by ${sortMethod === 'rank' ? 'Rank' : 'Suit'} — click to switch (S)`
              }
              onClick={handleSortToggle}
            >
              <ArrowUpDown size={15} />
              <span>{customOrder ? 'Reset sort' : `By ${sortMethod === 'rank' ? 'Rank' : 'Suit'}`}</span>
              {customOrder && <span className="sort-dot" title="Custom order" />}
            </button>
            {sortedHand.length > 13 && (
              <button type="button" className="tool-btn" title="Toggle 1 or 2 card rows" onClick={() => setTwoRowPref((p) => !p)}>
                <Rows2 size={15} />
                <span>{twoRowPref ? '2 rows' : '1 row'}</span>
              </button>
            )}
            <button
              type="button"
              className="tool-btn"
              title={
                canAct && eligiblePlays.length > 0
                  ? `Cycle playable hints (H) — ${eligiblePlays.length} available`
                  : 'Hint (H)'
              }
              disabled={!canAct || eligiblePlays.length === 0}
              onClick={handleHint}
            >
              <Lightbulb size={15} />
              <span>
                Hint
                {canAct && eligiblePlays.length > 1 && (
                  <span className="tool-count">
                    {' '}
                    {hintIdx > 0 ? `${((hintIdx - 1) % eligiblePlays.length) + 1}/${eligiblePlays.length}` : eligiblePlays.length}
                  </span>
                )}
              </span>
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
            {me?.finishRank && room.gameState === 'playing' ? (
              <div className="done-dock-note">
                Finished <strong>{ORDINALS[me.finishRank]}</strong> · Watching round
              </div>
            ) : (
              <>
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
                ) : canQueuePass ? (
                  <button
                    type="button"
                    className={`act-btn ${isPassQueued ? 'act-btn--queued' : 'act-btn--queue'}`}
                    title={
                      isPassQueued
                        ? 'Cancel queued pass (P / Backspace)'
                        : 'Pre-fire pass when your turn arrives (P / Backspace)'
                    }
                    onClick={() => setIsPassQueued((prev) => !prev)}
                  >
                    <Clock size={15} />
                    {isPassQueued ? 'Queued' : 'Queue Pass'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`act-btn ${mustPass ? 'act-btn--pass-alert' : 'act-btn--ghost'}`}
                    title="Pass (P / Backspace)"
                    disabled={!canPass}
                    onClick={handlePass}
                  >
                    {mustPass && <SkipForward size={15} />}
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
              </>
            )}
          </div>
        </div>
      </footer>

      {/* ================= OVERLAYS ================= */}
      {afkConfirmOpen && (
        <Modal labelledBy={afkTitleId} onClose={() => setAfkConfirmOpen(false)}>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={() => setAfkConfirmOpen(false)}
          >
            <X size={16} />
          </button>
          <div className="eyebrow">Seat controls · {me?.name}</div>
          <h2 id={afkTitleId} className="modal-title">Step away or switch devices</h2>
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
                onClick={handleSwapDevice}
              >
                <span className="profile-opt-icon is-sky">
                  <Smartphone size={20} />
                </span>
                <div className="profile-opt-text">
                  <strong>Switch Device (1 min grace)</strong>
                  <small>
                    {`Exit here and tap Rejoin on your phone using "${me?.name}" within 60s before a bot takes over.`}
                  </small>
                </div>
              </button>
            )}
          </div>
        </Modal>
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
        <ScoreboardModal
          room={room}
          isHost={isHost}
          onIntent={onIntent}
          onLeave={() => (room.gameState === 'gameover' ? onLeave() : setLeaveConfirmOpen(true))}
        />
      )}

      {drawerOpen && (
        <ActivityDrawer
          entries={room.activity}
          onSendChat={(text) => onIntent({ type: 'CHAT', text })}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      <ConfirmDialog
        open={leaveConfirmOpen}
        tone="default"
        eyebrow="Leave table"
        title="Leave the table?"
        description={
          room.mode === 'solo'
            ? 'Your current practice match will end.'
            : room.gameState === 'playing'
              ? 'A bot will cover your seat after 15 seconds if you do not rejoin. The table stays open for everyone else.'
              : 'Return to the home screen. The table stays open for other players.'
        }
        confirmLabel="Leave table"
        onCancel={() => setLeaveConfirmOpen(false)}
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          onLeave();
        }}
      />
    </div>
  );
}
