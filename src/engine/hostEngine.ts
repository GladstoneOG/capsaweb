import { COMBO_LABELS, cardToString, defaultRng, describeCards, sortCards } from './cards';
import { canBeat, checkCombination, containsStartingCard, dealCapsaCards } from './rules';
import type {
  ActivityEntry,
  CapsaRules,
  Card,
  ClientIntent,
  Player,
  PlayerTransport,
  Rank,
  RoomState,
  SanitizedRoomState,
  Suit,
} from './types';
import { DEFAULT_RULES } from './types';

const BOT_NAMES = [
  'Budi Bot',
  'Siti Bot',
  'Joko Bot',
  'Dewi Bot',
  'Agus Bot',
  'Sari Bot',
  'Rudi Bot',
  'Putri Bot',
  'Taufik Bot',
  'Wulan Bot',
  'Hendra Bot',
  'Laras Bot',
  'Surya Bot',
  'Indra Bot',
  'Kartika Bot',
  'Eko Bot',
];

const MAX_ACTIVITY = 60;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export class CapsaHostEngine {
  private state: RoomState;
  private rng: () => number;
  private now: () => number;

  constructor(options: {
    code: string;
    mode: 'solo' | 'multiplayer';
    hostId: string;
    hostSessionId: string;
    hostName: string;
    rules?: Partial<CapsaRules>;
    rng?: () => number;
    now?: () => number;
  }) {
    this.rng = options.rng ?? defaultRng;
    this.now = options.now ?? (() => Date.now());

    this.state = {
      code: options.code,
      mode: options.mode,
      gameState: 'lobby',
      rules: { ...DEFAULT_RULES, ...options.rules },
      players: [
        {
          id: options.hostId,
          sessionId: options.hostSessionId,
          name: options.hostName.trim() || 'Host',
          isHost: true,
          isReady: true,
          isBot: false,
          transport: options.mode === 'solo' ? 'local' : 'host',
          cards: [],
          passed: false,
          score: 0,
          roundPoints: 0,
          lastPlay: null,
        },
      ],
      turnIndex: 0,
      roundNumber: 0,
      activePlay: null,
      lastPlayerPlayedId: null,
      lastTrick: null,
      firstPlayMade: false,
      startingCard: null,
      undoPassEligiblePlayerId: null,
      diceShowdown: null,
      tradingState: null,
      turnDeadline: null,
      activity: [],
      stateVersion: 1,
    };
  }

  static fromState(
    state: RoomState,
    options?: { rng?: () => number; now?: () => number }
  ): CapsaHostEngine {
    const engine = Object.create(CapsaHostEngine.prototype) as CapsaHostEngine;
    engine.state = state;
    engine.rng = options?.rng ?? defaultRng;
    engine.now = options?.now ?? (() => Date.now());
    return engine;
  }

  getState(): RoomState {
    return this.state;
  }

  hasHumanPlayers(): boolean {
    return this.state.players.some((p) => !p.isBot || Boolean(p.disconnected));
  }

  refreshTurnDeadlineIfNeeded(): void {
    this.resetTurnDeadline();
  }

  executeIntent(actorId: string, intent: ClientIntent): ActionResult & { kickedPeerId?: string } {
    switch (intent.type) {
      case 'TOGGLE_READY':
        return this.toggleReady(actorId);
      case 'UPDATE_RULES':
        return this.updateRules(actorId, intent.rules);
      case 'ADD_BOT':
        return this.addBot(actorId);
      case 'REMOVE_PLAYER':
        return this.removePlayer(actorId, intent.playerId);
      case 'START_GAME':
        return this.startGame(actorId);
      case 'NEXT_ROUND':
        return this.nextRound(actorId);
      case 'PLAY_CARDS':
        return this.playCards(actorId, intent.cardIds);
      case 'PASS':
        return this.passTurn(actorId);
      case 'UNDO_PASS':
        return this.undoPass(actorId);
      case 'TRADE_REQUEST':
        return this.tradeRequest(actorId, intent.rank, intent.suit);
      case 'TRADE_FULFILL':
        return this.tradeFulfill(actorId, intent.extraCardId);
      case 'TRADE_DECLINE':
        return this.tradeDecline(actorId);
      case 'TRADE_CANCEL':
        return this.tradeCancel(actorId);
      case 'DISMISS_DICE':
        return this.dismissDiceShowdown();
      case 'TOGGLE_AUTOPLAY':
        return this.toggleAutoPlay(actorId);
      case 'PREPARE_SWAP_DEVICE':
        return this.prepareSwapDevice(actorId);
      case 'CHAT':
        return this.addChat(actorId, intent.text);
    }
  }

  private promoteNextHost(excludeId?: string): boolean {
    const nextHost =
      this.state.players.find(
        (p) => p.id !== excludeId && !p.isBot && !p.disconnected && !p.isHost
      ) ??
      (this.state.gameState === 'lobby'
        ? this.state.players.find((p) => p.id !== excludeId && !p.isBot && !p.isHost)
        : undefined);
    if (!nextHost) return false;
    for (const p of this.state.players) {
      p.isHost = p.id === nextHost.id;
    }
    nextHost.isReady = true;
    this.pushActivity('system', 'System', `${nextHost.name} is now the table host.`, true);
    return true;
  }

  private bumpVersion(): void {
    this.state.stateVersion += 1;
  }

  private pushActivity(senderId: string, senderName: string, text: string, system: boolean): void {
    const entry: ActivityEntry = {
      id: `act_${this.now()}_${Math.floor(this.rng() * 1e6).toString(36)}`,
      senderId,
      senderName,
      text,
      system,
      timestamp: this.now(),
    };
    this.state.activity.push(entry);
    if (this.state.activity.length > MAX_ACTIVITY) {
      this.state.activity.splice(0, this.state.activity.length - MAX_ACTIVITY);
    }
  }

  private resetTurnDeadline(): void {
    if (this.state.gameState !== 'playing' || this.state.diceShowdown) {
      this.state.turnDeadline = null;
      return;
    }
    const current = this.state.players[this.state.turnIndex];
    // Pause turn countdown while waiting for a disconnected player's grace period
    if (current?.disconnected && !current.isBot && current.reconnectGraceUntil) {
      this.state.turnDeadline = null;
      return;
    }
    const duration = this.state.rules.turnDuration;
    this.state.turnDeadline = duration > 0 ? this.now() + duration * 1000 : null;
  }

  // ==================== LOBBY & PRESENCE ====================

  addOrRestorePeer(options: {
    peerId: string;
    sessionId: string;
    name: string;
    transport: PlayerTransport;
  }): ActionResult & { restored?: boolean; silentSwap?: boolean } {
    const cleanName = options.name.trim().slice(0, 20) || `Player ${this.state.players.length + 1}`;

    // 1. Check exact sessionId match (same device/tab)
    let existing = this.state.players.find(
      (p) => p.sessionId && p.sessionId === options.sessionId
    );
    let crossDevice = false;

    // 2. Fallback: match any currently disconnected seat by name (case-insensitive) for PC <-> phone rejoin
    if (!existing) {
      const lower = cleanName.toLowerCase();
      existing = this.state.players.find(
        (p) => p.disconnected && p.name.toLowerCase() === lower
      );
      if (existing) crossDevice = true;
    }

    if (existing) {
      const oldId = existing.id;
      const wasDisconnected = Boolean(existing.disconnected);
      existing.id = options.peerId;
      existing.sessionId = options.sessionId;
      if (cleanName) existing.name = cleanName;
      existing.transport = options.transport;
      this.replacePlayerIdReferences(oldId, options.peerId);

      // Silent live socket replacement (e.g., network handoff before old socket closed)
      if (!wasDisconnected) {
        this.bumpVersion();
        return { ok: true, restored: true, silentSwap: true };
      }

      existing.isBot = false;
      existing.autoPlay = false;
      existing.disconnected = false;
      existing.reconnectGraceUntil = null;
      existing.swapDevice = false;
      if (this.state.gameState !== 'lobby' || existing.isHost) {
        existing.isReady = true;
      }

      // If no active connected host exists (e.g. host timed out to bot while everyone was offline), promote this returning human
      const activeHost = this.state.players.find((p) => p.isHost);
      if (!activeHost || (activeHost.disconnected && activeHost.isBot && activeHost.id !== existing.id)) {
        for (const p of this.state.players) p.isHost = p.id === existing.id;
        existing.isReady = true;
      }

      if (this.state.gameState !== 'lobby' || crossDevice) {
        this.pushActivity(
          'system',
          'System',
          crossDevice
            ? `${existing.name} rejoined from another device and took back control.`
            : `${existing.name} rejoined the table.`,
          true
        );
      }
      this.resetTurnDeadline();
      this.bumpVersion();
      return { ok: true, restored: true };
    }

    if (this.state.gameState !== 'lobby') {
      return { ok: false, error: 'Game is already in progress.' };
    }

    if (this.state.players.length >= 4) {
      return { ok: false, error: 'Room is full (4 players max).' };
    }

    const noHostExists = !this.state.players.some((p) => p.isHost);
    this.state.players.push({
      id: options.peerId,
      sessionId: options.sessionId,
      name: cleanName,
      isHost: noHostExists,
      isReady: noHostExists,
      isBot: false,
      transport: options.transport,
      cards: [],
      passed: false,
      score: 0,
      roundPoints: 0,
      lastPlay: null,
    });

    this.pushActivity('system', 'System', `${cleanName} joined the lobby.`, true);
    this.bumpVersion();
    return { ok: true, restored: false };
  }

  setPeerTransport(peerId: string, transport: PlayerTransport): void {
    const player = this.state.players.find((p) => p.id === peerId);
    if (player && !player.isBot && player.transport !== transport) {
      player.transport = transport;
      this.bumpVersion();
    }
  }

  handlePeerDisconnect(peerId: string, explicit = false): void {
    const idx = this.state.players.findIndex((p) => p.id === peerId);
    if (idx === -1) return;
    const player = this.state.players[idx];

    if (this.state.gameState === 'lobby') {
      if (explicit) {
        const wasHost = player.isHost;
        this.state.players.splice(idx, 1);
        this.pushActivity('system', 'System', `${player.name} left the lobby.`, true);
        if (wasHost) {
          this.promoteNextHost();
        }
        this.bumpVersion();
        return;
      }
      // Involuntary lobby drop (refresh, brief signal loss): hold seat for 15s before removing
      if (player.disconnected && player.reconnectGraceUntil) {
        return;
      }
      player.disconnected = true;
      player.transport = 'connecting';
      player.reconnectGraceUntil = this.now() + 15_000;
      this.bumpVersion();
      return;
    }

    // If the player explicitly initiated a 60s device swap, preserve their grace timer
    if (player.swapDevice && player.disconnected && player.reconnectGraceUntil) {
      return;
    }

    // Avoid resetting grace timer or duplicating messages on duplicate disconnect events
    if (player.disconnected) {
      if (explicit && player.isHost && this.promoteNextHost(player.id)) {
        this.bumpVersion();
      }
      return;
    }

    // Disconnect mid-game (host OR peer): give a 15-second grace period before bot takeover
    player.disconnected = true;
    player.isReady = true;
    player.isBot = false;
    player.swapDevice = false;
    player.transport = 'connecting';
    player.reconnectGraceUntil = this.now() + 15_000;
    this.pushActivity(
      'system',
      'System',
      `${player.name} disconnected. Waiting 15s for rejoin before bot takeover.`,
      true
    );
    if (explicit && player.isHost) {
      this.promoteNextHost(player.id);
    }
    this.resetTurnDeadline();
    this.bumpVersion();
  }

  prepareSwapDevice(actorId: string): ActionResult {
    if (this.state.mode === 'solo') {
      return { ok: false, error: 'Cannot switch devices in solo mode.' };
    }
    if (this.state.gameState === 'lobby') {
      return { ok: false, error: 'Cannot switch devices from lobby.' };
    }
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player || player.isBot) return { ok: false, error: 'Invalid player.' };

    player.disconnected = true;
    player.swapDevice = true;
    player.isBot = false;
    player.autoPlay = false;
    player.transport = 'connecting';
    player.reconnectGraceUntil = this.now() + 60_000;

    this.pushActivity(
      'system',
      'System',
      `${player.name} is switching devices (60s grace period to rejoin).`,
      true
    );
    this.resetTurnDeadline();
    this.bumpVersion();
    return { ok: true };
  }

  expireReconnectGrace(): boolean {
    const now = this.now();
    let changed = false;

    if (this.state.gameState === 'lobby') {
      const expired = this.state.players.filter(
        (p) => p.disconnected && !p.isBot && p.reconnectGraceUntil && p.reconnectGraceUntil <= now
      );
      if (expired.length === 0) return false;
      let hostLeft = false;
      for (const p of expired) {
        if (p.isHost) hostLeft = true;
        const idx = this.state.players.indexOf(p);
        if (idx !== -1) {
          this.state.players.splice(idx, 1);
          this.pushActivity('system', 'System', `${p.name} left the lobby.`, true);
          changed = true;
        }
      }
      if (hostLeft) {
        this.promoteNextHost();
      }
      if (changed) {
        this.bumpVersion();
      }
      return changed;
    }

    for (const p of this.state.players) {
      if (p.disconnected && !p.isBot && p.reconnectGraceUntil && p.reconnectGraceUntil <= now) {
        p.isBot = true;
        p.transport = 'bot';
        p.reconnectGraceUntil = null;
        p.swapDevice = false;
        this.pushActivity(
          'system',
          'System',
          `${p.name}'s grace period ended. A bot is now covering their seat until they rejoin.`,
          true
        );
        if (p.isHost) {
          this.promoteNextHost(p.id);
        }
        changed = true;
      }
    }
    if (changed) {
      this.resetTurnDeadline();
      this.bumpVersion();
    }
    return changed;
  }

  private replacePlayerIdReferences(oldId: string, newId: string): void {
    if (oldId === newId) return;
    if (this.state.lastPlayerPlayedId === oldId) this.state.lastPlayerPlayedId = newId;
    if (this.state.undoPassEligiblePlayerId === oldId) this.state.undoPassEligiblePlayerId = newId;
    if (this.state.lastTrick && this.state.lastTrick.winnerId === oldId) {
      this.state.lastTrick.winnerId = newId;
    }
    if (this.state.diceShowdown) {
      if (this.state.diceShowdown.playerA.id === oldId) this.state.diceShowdown.playerA.id = newId;
      if (this.state.diceShowdown.playerB.id === oldId) this.state.diceShowdown.playerB.id = newId;
      if (this.state.diceShowdown.winnerId === oldId) this.state.diceShowdown.winnerId = newId;
    }
    if (this.state.tradingState?.pendingRequest) {
      const req = this.state.tradingState.pendingRequest;
      if (req.requesterId === oldId) req.requesterId = newId;
      if (req.targetPlayerId === oldId) req.targetPlayerId = newId;
    }
  }

  addBot(actorId: string): ActionResult {
    if (this.state.gameState !== 'lobby') return { ok: false, error: 'Cannot add bot mid-game.' };
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor?.isHost) return { ok: false, error: 'Only the host can add bots.' };
    if (this.state.players.length >= 4) return { ok: false, error: 'Room already has 4 players.' };

    this.pushBotPlayer();
    this.bumpVersion();
    return { ok: true };
  }

  private pushBotPlayer(): Player {
    const existingNames = new Set(this.state.players.map((p) => p.name));
    const unused = BOT_NAMES.filter((n) => !existingNames.has(n));
    const name =
      unused.length > 0
        ? unused[Math.floor(this.rng() * unused.length)]
        : `Bot ${this.state.players.length + 1}`;
    const bot: Player = {
      id: `bot_${Math.floor(this.rng() * 1e9).toString(36)}`,
      name,
      isHost: false,
      isReady: true,
      isBot: true,
      transport: 'bot',
      cards: [],
      passed: false,
      score: 0,
      roundPoints: 0,
      lastPlay: null,
    };
    this.state.players.push(bot);
    return bot;
  }

  removePlayer(actorId: string, targetId: string): ActionResult & { kickedPeerId?: string } {
    if (this.state.gameState !== 'lobby') return { ok: false, error: 'Cannot kick mid-game.' };
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor?.isHost) return { ok: false, error: 'Only the host can remove players.' };

    const idx = this.state.players.findIndex((p) => p.id === targetId);
    if (idx === -1) return { ok: false, error: 'Player not found.' };
    if (this.state.players[idx].isHost) return { ok: false, error: 'Cannot remove the host.' };

    const [removed] = this.state.players.splice(idx, 1);
    this.pushActivity('system', 'System', `${removed.name} was removed from the lobby.`, true);
    this.bumpVersion();
    return { ok: true, kickedPeerId: removed.isBot ? undefined : removed.id };
  }

  toggleReady(actorId: string): ActionResult {
    if (this.state.gameState !== 'lobby') return { ok: false, error: 'Game already started.' };
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player || player.isHost) return { ok: false, error: 'Invalid player.' };
    player.isReady = !player.isReady;
    this.bumpVersion();
    return { ok: true };
  }

  updateRules(actorId: string, patch: Partial<CapsaRules>): ActionResult {
    if (this.state.gameState !== 'lobby') return { ok: false, error: 'Cannot change rules mid-game.' };
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor?.isHost) return { ok: false, error: 'Only the host can update rules.' };

    const next: CapsaRules = { ...this.state.rules, ...patch };
    // Clamp numeric values safely
    next.pointsToWin = Math.max(3, Math.min(100, Math.round(next.pointsToWin || 15)));
    next.turnDuration =
      next.turnDuration === 0 ? 0 : Math.max(10, Math.min(120, Math.round(next.turnDuration || 30)));
    if (!next.enableDoubleDeck) {
      next.doubleDeck26Cards = false;
    }

    this.state.rules = next;
    this.bumpVersion();
    return { ok: true };
  }

  // ==================== ROUND LIFECYCLE ====================

  startGame(actorId: string): ActionResult {
    if (this.state.gameState !== 'lobby') return { ok: false, error: 'Game already started.' };
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor?.isHost) return { ok: false, error: 'Only the host can start the game.' };

    const allReady = this.state.players.every((p) => p.isReady || p.isHost);
    if (!allReady) {
      return { ok: false, error: 'All players must be ready first.' };
    }

    while (this.state.players.length < 4) {
      this.pushBotPlayer();
    }

    this.startRoundInternal();
    return { ok: true };
  }

  nextRound(actorId: string): ActionResult {
    if (this.state.gameState !== 'roundover' && this.state.gameState !== 'gameover') {
      return { ok: false, error: 'Round is not finished.' };
    }
    const actor = this.state.players.find((p) => p.id === actorId);
    if (!actor?.isHost) return { ok: false, error: 'Only the host can start the next round.' };

    if (this.state.gameState === 'gameover') {
      this.state.roundNumber = 0;
      this.state.players.forEach((p) => {
        p.score = 0;
        p.roundPoints = 0;
      });
    }

    this.startRoundInternal();
    return { ok: true };
  }

  private startRoundInternal(): void {
    const rules = this.state.rules;
    const deal = dealCapsaCards({
      playerCount: this.state.players.length,
      doubleDeck: rules.enableDoubleDeck,
      doubleDeck26Cards: rules.enableDoubleDeck && rules.doubleDeck26Cards,
      playerNames: this.state.players.map((p) => p.name),
      playerIds: this.state.players.map((p) => p.id),
      rng: this.rng,
    });

    this.state.gameState = 'playing';
    this.state.roundNumber += 1;
    this.state.activePlay = null;
    this.state.lastPlayerPlayedId = null;
    this.state.lastTrick = null;
    this.state.undoPassEligiblePlayerId = null;
    this.state.firstPlayMade = false;
    this.state.startingCard = deal.startingCard;
    this.state.turnIndex = deal.startingPlayerIndex;
    this.state.diceShowdown = deal.diceShowdown;
    this.state.tradingState = rules.enableTrading ? { pendingRequest: null, history: [] } : null;

    this.state.players.forEach((p, idx) => {
      p.cards = deal.hands[idx];
      p.passed = false;
      p.lastPlay = null;
      p.roundPoints = 0;
      delete p.finishRank;
    });

    if (rules.enableDoubleDeck && deal.reshuffleCount > 0) {
      this.pushActivity(
        'system',
        'System',
        `Duplicate lowest cards dealt! Deck reshuffled ${deal.reshuffleCount} time${deal.reshuffleCount > 1 ? 's' : ''}.`,
        true
      );
    }

    if (deal.diceShowdown) {
      const ds = deal.diceShowdown;
      this.pushActivity(
        'system',
        'System',
        `3♦ Tiebreaker! ${ds.playerA.name} rolled [${ds.playerA.roll}] vs ${ds.playerB.name} rolled [${ds.playerB.roll}]. ${ds.winnerName} starts!`,
        true
      );
    } else if (rules.enableDoubleDeck) {
      const starter = this.state.players[deal.startingPlayerIndex];
      this.pushActivity(
        'system',
        'System',
        `Double Deck Round ${this.state.roundNumber}: ${starter.name} holds ${cardToString(deal.startingCard)} and leads.`,
        true
      );
    } else {
      const starter = this.state.players[deal.startingPlayerIndex];
      this.pushActivity(
        'system',
        'System',
        `Round ${this.state.roundNumber} started. ${starter.name} holds 3♦ and leads.`,
        true
      );
    }

    this.resetTurnDeadline();
    this.bumpVersion();
  }

  // ==================== GAMEPLAY ACTIONS ====================

  private isFirstPlayOfRound(): boolean {
    return !this.state.firstPlayMade && !this.state.activePlay;
  }

  private getActivePlayerCount(): number {
    return this.state.players.filter((p) => !p.passed && p.cards.length > 0).length;
  }

  private getNextTurnIndex(currentIndex: number): number {
    const total = this.state.players.length;
    let idx = currentIndex;
    for (let i = 0; i < total; i++) {
      idx = (idx + 1) % total;
      if (!this.state.players[idx].passed && this.state.players[idx].cards.length > 0) {
        return idx;
      }
    }
    return currentIndex;
  }

  dismissDiceShowdown(): ActionResult {
    if (!this.state.diceShowdown) return { ok: true };
    this.state.diceShowdown = null;
    this.resetTurnDeadline();
    this.bumpVersion();
    return { ok: true };
  }

  playCards(actorId: string, cardIds: string[]): ActionResult {
    if (this.state.gameState !== 'playing') return { ok: false, error: 'Game is not active.' };
    if (this.state.diceShowdown) return { ok: false, error: 'Waiting for Dice Duel to finish.' };

    const currentPlayer = this.state.players[this.state.turnIndex];
    if (!currentPlayer || currentPlayer.id !== actorId) {
      return { ok: false, error: 'It is not your turn.' };
    }

    if (!cardIds.length) {
      return { ok: false, error: 'Select cards to play.' };
    }

    // Verify no duplicate IDs and that player owns every card
    const uniqueIds = new Set(cardIds);
    if (uniqueIds.size !== cardIds.length) {
      return { ok: false, error: 'Duplicate card selection.' };
    }

    const playedCards: Card[] = [];
    for (const id of cardIds) {
      const card = currentPlayer.cards.find((c) => c.id === id);
      if (!card) {
        return { ok: false, error: 'Card not found in hand.' };
      }
      playedCards.push(card);
    }

    // Authoritative combination & beat validation
    const combo = checkCombination(playedCards);
    if (combo.type === 'invalid') {
      return { ok: false, error: 'Invalid Capsa combination.' };
    }

    if (this.isFirstPlayOfRound() && !containsStartingCard(combo.cards, this.state.startingCard)) {
      const cardLabel = this.state.startingCard ? cardToString(this.state.startingCard) : '3♦';
      return { ok: false, error: `Opening play must include ${cardLabel}.` };
    }

    if (
      !canBeat(combo, this.state.activePlay, {
        enableBombsSingle: this.state.rules.enableBombsSingle,
        enableBombsPair: this.state.rules.enableBombsPair,
      })
    ) {
      return { ok: false, error: 'Play does not beat the current table combination.' };
    }

    // Clear any pending trade on action
    if (this.state.tradingState) {
      this.state.tradingState.pendingRequest = null;
    }

    this.state.firstPlayMade = true;
    this.state.undoPassEligiblePlayerId = null;

    currentPlayer.cards = currentPlayer.cards.filter((c) => !uniqueIds.has(c.id));
    currentPlayer.lastPlay = combo.cards;
    currentPlayer.passed = false;

    const finishedCount = this.state.players.filter((p) => p.finishRank !== undefined).length;
    if (currentPlayer.cards.length === 0) {
      currentPlayer.finishRank = finishedCount + 1;
    }

    this.state.activePlay = combo;
    this.state.lastPlayerPlayedId = currentPlayer.id;

    this.pushActivity(
      'system',
      'System',
      `${currentPlayer.name} played ${COMBO_LABELS[combo.type]}: ${describeCards(combo.cards)}`,
      true
    );

    // Check round end (<= 1 player with cards left)
    const playersWithCards = this.state.players.filter((p) => p.cards.length > 0);
    if (playersWithCards.length <= 1) {
      this.state.players.forEach((p) => {
        if (p.cards.length > 0 && p.finishRank === undefined) {
          p.finishRank = this.state.players.length;
        }
      });
      this.finishRound();
      return { ok: true };
    }

    // Check if all other remaining players have already passed
    const otherWithCards = this.state.players.filter(
      (p) => p.id !== currentPlayer.id && p.cards.length > 0
    );
    const allOthersPassed = otherWithCards.every((p) => p.passed);

    if (allOthersPassed) {
      let nextIdx = this.state.turnIndex;
      const isHibah = currentPlayer.cards.length === 0;
      if (isHibah) {
        for (let i = 0; i < this.state.players.length; i++) {
          nextIdx = (nextIdx + 1) % this.state.players.length;
          if (this.state.players[nextIdx].cards.length > 0) break;
        }
      }
      this.state.turnIndex = nextIdx;
      const leadPlayer = this.state.players[nextIdx];

      this.state.lastTrick = {
        winnerId: leadPlayer.id,
        winnerName: leadPlayer.name,
        cards: combo.cards,
        hibah: isHibah,
        timestamp: this.now(),
      };
      this.state.activePlay = null;
      this.state.lastPlayerPlayedId = null;

      this.state.players.forEach((p) => {
        p.passed = false;
        p.lastPlay = null;
      });

      this.pushActivity(
        'system',
        'System',
        isHibah
          ? `Trick won by ${currentPlayer.name} (out of cards). Hibah lead goes to ${leadPlayer.name}!`
          : `Trick won! ${leadPlayer.name} gets the lead.`,
        true
      );
    } else {
      this.state.turnIndex = this.getNextTurnIndex(this.state.turnIndex);
    }

    this.resetTurnDeadline();
    this.bumpVersion();
    return { ok: true };
  }

  passTurn(actorId: string): ActionResult {
    if (this.state.gameState !== 'playing') return { ok: false, error: 'Game is not active.' };
    if (this.state.diceShowdown) return { ok: false, error: 'Waiting for Dice Duel to finish.' };

    const currentPlayer = this.state.players[this.state.turnIndex];
    if (!currentPlayer || currentPlayer.id !== actorId) {
      return { ok: false, error: 'It is not your turn.' };
    }

    if (this.isFirstPlayOfRound() || !this.state.activePlay) {
      return { ok: false, error: 'You have the lead and must play a combination.' };
    }

    if (this.state.tradingState) {
      this.state.tradingState.pendingRequest = null;
    }

    currentPlayer.passed = true;
    currentPlayer.lastPlay = null;
    this.pushActivity('system', 'System', `${currentPlayer.name} passed.`, true);

    const activeCount = this.getActivePlayerCount();
    const lastPlayerIdx = this.state.players.findIndex(
      (p) => p.id === this.state.lastPlayerPlayedId
    );
    const lastPlayerStillActive =
      lastPlayerIdx !== -1 &&
      !this.state.players[lastPlayerIdx].passed &&
      this.state.players[lastPlayerIdx].cards.length > 0;

    const trickOver = lastPlayerStillActive ? activeCount <= 1 : activeCount === 0;

    if (trickOver) {
      this.state.undoPassEligiblePlayerId = null;
      const lastPlayer = lastPlayerIdx !== -1 ? this.state.players[lastPlayerIdx] : null;
      const trickCards = this.state.activePlay ? this.state.activePlay.cards : [];

      this.state.activePlay = null;
      this.state.lastPlayerPlayedId = null;
      this.state.players.forEach((p) => {
        p.passed = false;
        p.lastPlay = null;
      });

      let nextIdx = lastPlayerIdx;
      const isHibah = nextIdx === -1 || this.state.players[nextIdx].cards.length === 0;
      if (isHibah) {
        let searchIdx = lastPlayerIdx !== -1 ? lastPlayerIdx : this.state.turnIndex;
        for (let i = 0; i < this.state.players.length; i++) {
          searchIdx = (searchIdx + 1) % this.state.players.length;
          if (this.state.players[searchIdx].cards.length > 0) {
            nextIdx = searchIdx;
            break;
          }
        }
        if (nextIdx === -1) nextIdx = this.state.turnIndex;
      }

      this.state.turnIndex = nextIdx;
      const leadPlayer = this.state.players[nextIdx];

      this.state.lastTrick = {
        winnerId: leadPlayer.id,
        winnerName: leadPlayer.name,
        cards: trickCards,
        hibah: isHibah,
        timestamp: this.now(),
      };

      this.pushActivity(
        'system',
        'System',
        isHibah && lastPlayer
          ? `Trick won by ${lastPlayer.name} (out of cards). Hibah lead goes to ${leadPlayer.name}!`
          : `Trick won! ${leadPlayer.name} gets the lead.`,
        true
      );
    } else {
      this.state.undoPassEligiblePlayerId = currentPlayer.id;
      this.state.turnIndex = this.getNextTurnIndex(this.state.turnIndex);
    }

    this.resetTurnDeadline();
    this.bumpVersion();
    return { ok: true };
  }

  undoPass(actorId: string): ActionResult {
    if (this.state.gameState !== 'playing') return { ok: false, error: 'Game is not active.' };
    if (this.state.undoPassEligiblePlayerId !== actorId) {
      return { ok: false, error: 'Cannot undo pass right now.' };
    }
    if (!this.state.activePlay) {
      return { ok: false, error: 'Trick has already ended.' };
    }

    const playerIdx = this.state.players.findIndex((p) => p.id === actorId);
    const player = this.state.players[playerIdx];
    if (!player || !player.passed) return { ok: false, error: 'Player has not passed.' };

    this.state.undoPassEligiblePlayerId = null;
    player.passed = false;
    this.state.turnIndex = playerIdx;

    this.pushActivity('system', 'System', `${player.name} cancelled their pass.`, true);
    this.resetTurnDeadline();
    this.bumpVersion();
    return { ok: true };
  }

  handleTurnTimeout(): ActionResult {
    if (this.state.gameState !== 'playing' || this.state.diceShowdown) {
      return { ok: false };
    }
    const current = this.state.players[this.state.turnIndex];
    if (!current || current.cards.length === 0) return { ok: false };

    // On lead turn (including first play of round), auto-play startingCard or lowest card
    if (this.isFirstPlayOfRound()) {
      const target = this.state.startingCard;
      const card =
        (target
          ? current.cards.find((c) => c.rank === target.rank && c.suit === target.suit)
          : null) ?? current.cards[0];
      return this.playCards(current.id, [card.id]);
    }

    if (!this.state.activePlay) {
      // Leading a new trick — play lowest single card
      return this.playCards(current.id, [current.cards[0].id]);
    }

    return this.passTurn(current.id);
  }

  private finishRound(): void {
    this.state.gameState = 'roundover';
    this.state.turnDeadline = null;
    this.state.undoPassEligiblePlayerId = null;
    if (this.state.tradingState) {
      this.state.tradingState.pendingRequest = null;
    }

    const numPlayers = this.state.players.length;
    this.state.players.forEach((p) => {
      const rank = p.finishRank || numPlayers;
      const points = Math.max(0, numPlayers - rank);
      p.score += points;
      p.roundPoints = points;
    });

    const winner = this.state.players.find((p) => p.finishRank === 1);
    this.pushActivity(
      'system',
      'System',
      `${winner?.name ?? 'Unknown'} won Round ${this.state.roundNumber}!`,
      true
    );

    if (this.state.players.some((p) => p.score >= this.state.rules.pointsToWin)) {
      this.state.gameState = 'gameover';
    }

    this.bumpVersion();
  }

  // ==================== TRADING NOVELTY RULE ====================

  tradeRequest(actorId: string, rank: Rank, suit: Suit): ActionResult {
    if (this.state.gameState !== 'playing') return { ok: false, error: 'Game is not active.' };
    if (!this.state.rules.enableTrading) return { ok: false, error: 'Card trading is disabled.' };
    if (this.state.diceShowdown) return { ok: false, error: 'Wait for Dice Duel to finish.' };
    if (this.state.tradingState?.pendingRequest) {
      return { ok: false, error: 'A trade request is already pending.' };
    }

    const requester = this.state.players[this.state.turnIndex];
    if (!requester || requester.id !== actorId) {
      return { ok: false, error: 'You can only request a trade on your turn.' };
    }

    if (requester.cards.some((c) => c.rank === rank && c.suit === suit)) {
      return { ok: false, error: 'You already hold that card.' };
    }

    const holder = this.state.players.find(
      (p) => p.id !== requester.id && p.cards.some((c) => c.rank === rank && c.suit === suit)
    );
    if (!holder) {
      return { ok: false, error: 'Nobody currently holds that card.' };
    }

    if (!this.state.tradingState) {
      this.state.tradingState = { pendingRequest: null, history: [] };
    }

    const requestedCard: Card = { id: `${rank}_${suit}`, rank, suit };
    this.state.tradingState.pendingRequest = {
      requesterId: requester.id,
      requesterName: requester.name,
      requestedCard,
      targetPlayerId: holder.id,
      targetPlayerName: holder.name,
    };

    this.pushActivity(
      'system',
      'System',
      `${requester.name} requested ${cardToString(requestedCard)} in a trade!`,
      true
    );
    this.bumpVersion();
    return { ok: true };
  }

  tradeCancel(actorId: string): ActionResult {
    const pending = this.state.tradingState?.pendingRequest;
    if (!pending) return { ok: false, error: 'No pending trade.' };
    if (pending.requesterId !== actorId) return { ok: false, error: 'Not authorized.' };

    this.state.tradingState!.pendingRequest = null;
    this.pushActivity('system', 'System', `${pending.requesterName} cancelled the trade request.`, true);
    this.bumpVersion();
    return { ok: true };
  }

  tradeDecline(actorId: string): ActionResult {
    const pending = this.state.tradingState?.pendingRequest;
    if (!pending) return { ok: false, error: 'No pending trade.' };
    if (pending.targetPlayerId !== actorId) return { ok: false, error: 'Not authorized.' };

    this.pushActivity(
      'system',
      'System',
      `Trade request for ${cardToString(pending.requestedCard)} was declined.`,
      true
    );
    this.state.tradingState!.pendingRequest = null;
    this.bumpVersion();
    return { ok: true };
  }

  tradeFulfill(actorId: string, extraCardId: string): ActionResult {
    const pending = this.state.tradingState?.pendingRequest;
    if (!pending) return { ok: false, error: 'No pending trade.' };
    if (pending.targetPlayerId !== actorId) return { ok: false, error: 'Not authorized.' };

    const target = this.state.players.find((p) => p.id === pending.targetPlayerId);
    const requester = this.state.players.find((p) => p.id === pending.requesterId);
    if (!target || !requester) return { ok: false, error: 'Player not found.' };

    const realRequested = target.cards.find(
      (c) => c.rank === pending.requestedCard.rank && c.suit === pending.requestedCard.suit
    );
    const realExtra = target.cards.find((c) => c.id === extraCardId);

    if (!realRequested || !realExtra) {
      return { ok: false, error: 'Selected card not in hand.' };
    }
    if (realRequested.id === realExtra.id) {
      return { ok: false, error: 'Choose a different card as the extra card.' };
    }
    if (
      realRequested.rank === realExtra.rank &&
      realRequested.suit === realExtra.suit
    ) {
      return { ok: false, error: 'Extra card cannot match the requested card.' };
    }

    target.cards = sortCards(
      target.cards.filter((c) => c.id !== realRequested.id && c.id !== realExtra.id),
      'rank'
    );
    requester.cards = sortCards([...requester.cards, realRequested, realExtra], 'rank');

    this.state.tradingState!.history.push({
      requesterId: requester.id,
      requesterName: requester.name,
      targetPlayerId: target.id,
      targetPlayerName: target.name,
      requestedCard: realRequested,
      extraCard: realExtra,
      timestamp: this.now(),
    });

    this.pushActivity(
      'system',
      'System',
      `Trade completed! ${target.name} gave ${cardToString(realRequested)} + ${cardToString(realExtra)} to ${requester.name}.`,
      true
    );

    this.state.tradingState!.pendingRequest = null;

    // Edge case: if target emptied their hand by trading away their final 2 cards
    if (target.cards.length === 0 && target.finishRank === undefined) {
      const finishedCount = this.state.players.filter((p) => p.finishRank !== undefined).length;
      target.finishRank = finishedCount + 1;
      const playersWithCards = this.state.players.filter((p) => p.cards.length > 0);
      if (playersWithCards.length <= 1) {
        this.state.players.forEach((p) => {
          if (p.cards.length > 0 && p.finishRank === undefined) {
            p.finishRank = this.state.players.length;
          }
        });
        this.finishRound();
        return { ok: true };
      }
    }

    this.bumpVersion();
    return { ok: true };
  }

  // ==================== AFK AUTO-PLAY ====================

  toggleAutoPlay(actorId: string): ActionResult {
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player || player.isBot) return { ok: false, error: 'Invalid player.' };
    player.autoPlay = !player.autoPlay;
    this.pushActivity(
      'system',
      'System',
      player.autoPlay
        ? `${player.name} stepped away — a bot is covering their turns.`
        : `${player.name} took back control.`,
      true
    );
    this.resetTurnDeadline();
    this.bumpVersion();
    return { ok: true };
  }

  // ==================== CHAT ====================

  addChat(actorId: string, text: string): ActionResult {
    const clean = text.trim().slice(0, 200);
    if (!clean) return { ok: false };
    const player = this.state.players.find((p) => p.id === actorId);
    if (!player) return { ok: false };
    this.pushActivity(player.id, player.name, clean, false);
    this.bumpVersion();
    return { ok: true };
  }

  // ==================== SANITIZED VIEW (ANTI-CHEAT) ====================

  getSanitizedState(viewerId: string): SanitizedRoomState {
    const s = this.state;
    let sanitizedTrading = null;
    if (s.tradingState) {
      const pending = s.tradingState.pendingRequest
        ? { ...s.tradingState.pendingRequest }
        : null;
      if (pending && pending.targetPlayerId !== viewerId) {
        pending.targetPlayerId = null;
        pending.targetPlayerName = null;
      }
      sanitizedTrading = {
        pendingRequest: pending,
        history: s.tradingState.history,
      };
    }

    const revealAll = s.gameState === 'roundover' || s.gameState === 'gameover';

    return {
      code: s.code,
      mode: s.mode,
      viewerId,
      gameState: s.gameState,
      rules: { ...s.rules },
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        isReady: p.isReady,
        isBot: p.isBot,
        autoPlay: Boolean(p.autoPlay),
        disconnected: p.disconnected,
        reconnectGraceUntil: p.reconnectGraceUntil ?? null,
        swapDevice: Boolean(p.swapDevice),
        transport: p.transport,
        cards: p.id === viewerId || revealAll ? [...p.cards] : null,
        cardCount: p.cards.length,
        passed: p.passed,
        score: p.score,
        roundPoints: p.roundPoints,
        finishRank: p.finishRank,
        lastPlay: p.lastPlay ? [...p.lastPlay] : null,
      })),
      turnIndex: s.turnIndex,
      roundNumber: s.roundNumber,
      activePlay: s.activePlay ? { type: s.activePlay.type, cards: [...s.activePlay.cards] } : null,
      lastPlayerPlayedId: s.lastPlayerPlayedId,
      lastTrick: s.lastTrick ? { ...s.lastTrick } : null,
      firstPlayMade: s.firstPlayMade,
      startingCard: s.startingCard ? { ...s.startingCard } : null,
      canUndoPass: s.undoPassEligiblePlayerId === viewerId,
      diceShowdown: s.firstPlayMade ? null : s.diceShowdown,
      tradingState: sanitizedTrading,
      turnDeadline: s.turnDeadline,
      serverNow: this.now(),
      activity: [...s.activity],
      stateVersion: s.stateVersion,
    };
  }
}
