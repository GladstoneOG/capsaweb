import { DurableObject } from 'cloudflare:workers';
import {
  evaluateBotTradeFulfill,
  evaluateBotTradeRequest,
  getBotPlay,
} from '../src/engine/bot';
import { CapsaHostEngine } from '../src/engine/hostEngine';
import type { ClientIntent, RoomState } from '../src/engine/types';

export interface SignalEnv {
  SIGNAL_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

interface SocketAttachment {
  peerId: string;
  sessionId: string;
  name: string;
  replaced?: boolean;
  explicitLeave?: boolean;
  closed?: boolean;
}

interface IncomingClientMessage {
  type: string;
  intent?: ClientIntent;
}

export interface LobbyListing {
  code: string;
  hostName: string;
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  gameState: string;
  rulesSummary: string;
  rejoinableCount: number;
  updatedAt: number;
}

const REGISTRY_NAME = '__LOBBY_REGISTRY__';
const ROOM_STALE_MS = 30 * 60 * 1000;
const EMPTY_GAME_TTL_MS = 10 * 60 * 1000;
const INIT_GRACE_MS = 2 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class SignalRoomDO extends DurableObject<SignalEnv> {
  private registryInitialized = false;
  private roomSchemaInitialized = false;
  private roomLoaded = false;

  private roomCode = '';
  private passwordHash = '';
  private engine: CapsaHostEngine | null = null;
  private diceDismissAt: number | null = null;
  private botActionAt: number | null = null;
  private botTradeKey = '';
  private emptySince: number | null = null;
  private createdAt = 0;
  private updatedAt = 0;
  private lastMetaKey = '';

  constructor(ctx: DurableObjectState, env: SignalEnv) {
    super(ctx, env);
    // Handled natively by Cloudflare runtime without waking DO from hibernation
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ==================== SQLITE SCHEMAS & PERSISTENCE ====================

  private ensureRegistrySchema(): void {
    if (this.registryInitialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        host_name TEXT NOT NULL,
        has_password INTEGER NOT NULL DEFAULT 0,
        player_count INTEGER NOT NULL DEFAULT 1,
        max_players INTEGER NOT NULL DEFAULT 4,
        game_state TEXT NOT NULL DEFAULT 'lobby',
        rules_summary TEXT NOT NULL DEFAULT '',
        rejoinable_count INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )
    `);
    try {
      this.ctx.storage.sql.exec(
        'ALTER TABLE rooms ADD COLUMN rejoinable_count INTEGER NOT NULL DEFAULT 0'
      );
    } catch {
      // Column already exists
    }
    this.registryInitialized = true;
  }

  private ensureRoomSchema(): void {
    if (this.roomSchemaInitialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        room_code TEXT NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        state_json TEXT,
        dice_dismiss_at INTEGER,
        bot_action_at INTEGER,
        bot_trade_key TEXT NOT NULL DEFAULT '',
        empty_since INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.roomSchemaInitialized = true;
  }

  private ensureRoomLoaded(): void {
    if (this.roomLoaded) return;
    this.ensureRoomSchema();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT room_code, password_hash, state_json, dice_dismiss_at, bot_action_at, bot_trade_key, empty_since, created_at, updated_at
         FROM room_state WHERE id = 1`
      )
      .toArray();

    if (rows.length > 0) {
      const row = rows[0];
      this.roomCode = String(row.room_code || '');
      this.passwordHash = String(row.password_hash || '');
      this.diceDismissAt = row.dice_dismiss_at !== null ? Number(row.dice_dismiss_at) : null;
      this.botActionAt = row.bot_action_at !== null ? Number(row.bot_action_at) : null;
      this.botTradeKey = String(row.bot_trade_key || '');
      this.emptySince = row.empty_since !== null ? Number(row.empty_since) : null;
      this.createdAt = Number(row.created_at || 0);
      this.updatedAt = Number(row.updated_at || 0);

      if (typeof row.state_json === 'string' && row.state_json.length > 0) {
        try {
          const parsed = JSON.parse(row.state_json) as RoomState;
          this.engine = CapsaHostEngine.fromState(parsed);
        } catch {
          this.engine = null;
        }
      } else {
        this.engine = null;
      }
    }

    this.roomLoaded = true;
  }

  private saveRoomRow(): void {
    this.ensureRoomSchema();
    const stateJson = this.engine ? JSON.stringify(this.engine.getState()) : null;
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO room_state
        (id, room_code, password_hash, state_json, dice_dismiss_at, bot_action_at, bot_trade_key, empty_since, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      this.roomCode,
      this.passwordHash,
      stateJson,
      this.diceDismissAt,
      this.botActionAt,
      this.botTradeKey,
      this.emptySince,
      this.createdAt,
      this.updatedAt
    );
  }

  private async cleanupRoom(): Promise<void> {
    const code = this.roomCode;
    this.engine = null;
    this.passwordHash = '';
    this.diceDismissAt = null;
    this.botActionAt = null;
    this.botTradeKey = '';
    this.emptySince = null;
    this.createdAt = 0;
    this.updatedAt = 0;
    this.lastMetaKey = '';

    this.ensureRoomSchema();
    this.ctx.storage.sql.exec('DELETE FROM room_state WHERE id = 1');
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // ignore
    }

    for (const ws of this.getClientSockets()) {
      try {
        const att = ws.deserializeAttachment() as SocketAttachment | null;
        if (att) ws.serializeAttachment({ ...att, closed: true });
        ws.close(4004, 'Room closed');
      } catch {
        // ignore
      }
    }

    if (code) {
      await this.unregisterFromLobby(code);
    }
  }

  // ==================== LOBBY REGISTRY HELPERS ====================

  private getRegistryStub(): DurableObjectStub {
    return this.env.SIGNAL_ROOM.get(this.env.SIGNAL_ROOM.idFromName(REGISTRY_NAME));
  }

  private async registerInLobby(meta: {
    code: string;
    hostName: string;
    hasPassword: boolean;
    playerCount: number;
    gameState: string;
    rulesSummary: string;
    rejoinableCount: number;
  }): Promise<void> {
    try {
      await this.getRegistryStub().fetch('https://signal.internal/registry/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      });
    } catch {
      // non-fatal
    }
  }

  private async unregisterFromLobby(code: string): Promise<void> {
    if (!code) return;
    try {
      await this.getRegistryStub().fetch(
        `https://signal.internal/registry/${encodeURIComponent(code)}`,
        { method: 'DELETE' }
      );
    } catch {
      // non-fatal
    }
  }

  private async syncLobbyMeta(force = false): Promise<void> {
    if (!this.engine || !this.roomCode) return;
    const s = this.engine.getState();
    const host = s.players.find((p) => p.isHost) ?? s.players[0];
    const parts: string[] = [];
    if (s.rules.enableDoubleDeck) {
      parts.push(s.rules.doubleDeck26Cards ? '2× Deck (26)' : '2× Deck (13)');
    }
    if (s.rules.enableTrading) parts.push('Trading');
    parts.push(`First to ${s.rules.pointsToWin}`);
    const rulesSummary = parts.join(' · ');
    const rejoinableCount = s.players.filter((p) => p.disconnected).length;
    const metaKey = `${host?.name ?? ''}|${s.players.length}|${s.gameState}|${rulesSummary}|${rejoinableCount}|${Boolean(this.passwordHash)}`;
    if (!force && metaKey === this.lastMetaKey) return;
    this.lastMetaKey = metaKey;

    await this.registerInLobby({
      code: this.roomCode,
      hostName: host?.name ?? 'Host',
      hasPassword: Boolean(this.passwordHash),
      playerCount: s.players.length,
      gameState: s.gameState,
      rulesSummary,
      rejoinableCount,
    });
  }

  // ==================== WEBSOCKET HELPERS ====================

  private getClientSockets(): WebSocket[] {
    return this.ctx.getWebSockets('client').filter((s) => {
      const att = s.deserializeAttachment() as SocketAttachment | null;
      return Boolean(att && !att.closed && !att.replaced);
    });
  }

  private getSocketsBySession(sessionId: string): WebSocket[] {
    return this.ctx.getWebSockets(`sess:${sessionId}`).filter((s) => {
      const att = s.deserializeAttachment() as SocketAttachment | null;
      return Boolean(att && !att.closed && !att.replaced);
    });
  }

  private getSocketByPeerId(peerId: string): WebSocket | null {
    const matches = this.ctx.getWebSockets(`id:${peerId}`).filter((s) => {
      const att = s.deserializeAttachment() as SocketAttachment | null;
      return Boolean(att && !att.closed && !att.replaced);
    });
    return matches.length > 0 ? matches[0] : null;
  }

  private safeSend(ws: WebSocket | null, data: unknown): void {
    if (!ws) return;
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // ignore closing socket
    }
  }

  private broadcastState(): void {
    if (!this.engine) return;
    for (const ws of this.getClientSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att || att.replaced || att.closed) continue;
      this.safeSend(ws, {
        type: 'STATE_SYNC',
        state: this.engine.getSanitizedState(att.peerId),
      });
    }
  }

  // ==================== SCHEDULING & ALARMS ====================

  private computeNextSchedule(now: number): number | null {
    if (!this.engine) {
      return this.createdAt > 0 ? this.createdAt + INIT_GRACE_MS : null;
    }

    const state = this.engine.getState();
    const connectedCount = this.getClientSockets().length;
    const deadlines: number[] = [];

    // 1. Grace period deadlines for disconnected humans
    for (const p of state.players) {
      if (p.disconnected && !p.isBot && typeof p.reconnectGraceUntil === 'number') {
        deadlines.push(p.reconnectGraceUntil);
      }
    }

    if (connectedCount === 0) {
      this.diceDismissAt = null;
      this.botActionAt = null;
      if (this.emptySince === null) {
        this.emptySince = now;
      }
      if (state.gameState === 'lobby') {
        // If no grace timers left, caller will clean up immediately; otherwise wait for grace
        deadlines.push(this.emptySince + 20_000);
      } else {
        // Keep mid-game rooms alive for 10 minutes if everyone drops simultaneously
        deadlines.push(this.emptySince + EMPTY_GAME_TTL_MS);
      }
    } else {
      this.emptySince = null;
      deadlines.push(this.updatedAt + ROOM_STALE_MS);

      if (state.gameState !== 'playing') {
        this.diceDismissAt = null;
        this.botActionAt = null;
        this.botTradeKey = '';
      } else if (state.diceShowdown) {
        this.botActionAt = null;
        if (this.diceDismissAt === null) {
          this.diceDismissAt = now + 4200;
        }
        deadlines.push(this.diceDismissAt);
      } else {
        this.diceDismissAt = null;

        const pendingTrade = state.tradingState?.pendingRequest;
        let waitingForGrace = false;
        let botNeededDelay: number | null = null;

        if (pendingTrade && pendingTrade.targetPlayerId) {
          const target = state.players.find((p) => p.id === pendingTrade.targetPlayerId);
          if (target?.disconnected && !target.isBot && target.reconnectGraceUntil) {
            waitingForGrace = true;
          } else if (target && (target.isBot || target.autoPlay)) {
            botNeededDelay = 850;
          }
        } else {
          const current = state.players[state.turnIndex];
          if (current?.disconnected && !current.isBot && current.reconnectGraceUntil) {
            waitingForGrace = true;
          } else if (
            current &&
            (current.isBot || current.autoPlay) &&
            current.cards.length > 0
          ) {
            botNeededDelay = 750;
          }
        }

        if (!waitingForGrace && botNeededDelay !== null) {
          if (this.botActionAt === null) {
            this.botActionAt = now + botNeededDelay;
          }
          deadlines.push(this.botActionAt);
        } else {
          this.botActionAt = null;
          if (!waitingForGrace && state.turnDeadline && !pendingTrade) {
            deadlines.push(state.turnDeadline);
          }
        }
      }
    }

    if (deadlines.length === 0) return null;
    return Math.min(...deadlines);
  }

  private async commitAndBroadcast(forceLobbySync = false): Promise<void> {
    const now = Date.now();
    this.updatedAt = now;
    const nextAlarm = this.computeNextSchedule(now);
    this.saveRoomRow();

    if (nextAlarm !== null) {
      await this.ctx.storage.setAlarm(Math.max(now + 25, nextAlarm));
    } else {
      await this.ctx.storage.deleteAlarm();
    }

    this.broadcastState();
    await this.syncLobbyMeta(forceLobbySync);
  }

  async alarm(): Promise<void> {
    this.ensureRoomLoaded();
    const now = Date.now();

    // Unjoined /init room expired
    if (!this.engine) {
      if (this.createdAt > 0 && now - this.createdAt >= INIT_GRACE_MS) {
        await this.cleanupRoom();
      }
      return;
    }

    const connectedCount = this.getClientSockets().length;

    // 1. Check stale / abandoned rooms
    if (connectedCount === 0) {
      this.engine.expireReconnectGrace();
      const s = this.engine.getState();

      if (s.gameState === 'lobby' && !this.engine.hasHumanPlayers()) {
        await this.cleanupRoom();
        return;
      }

      if (this.emptySince !== null && now - this.emptySince >= EMPTY_GAME_TTL_MS) {
        await this.cleanupRoom();
        return;
      }

      // Persist any grace expirations (e.g. player switched to bot) and arm next alarm
      const nextAlarm = this.computeNextSchedule(now);
      this.saveRoomRow();
      if (nextAlarm !== null) {
        await this.ctx.storage.setAlarm(Math.max(now + 50, nextAlarm));
      }
      await this.syncLobbyMeta();
      return;
    }

    if (this.updatedAt > 0 && now - this.updatedAt >= ROOM_STALE_MS) {
      await this.cleanupRoom();
      return;
    }

    let changed = false;

    // 2. Grace period expiration for disconnected humans
    if (this.engine.expireReconnectGrace()) {
      changed = true;
      this.botActionAt = null;
      if (this.engine.getState().gameState === 'lobby' && !this.engine.hasHumanPlayers()) {
        await this.cleanupRoom();
        return;
      }
    }

    const state = this.engine.getState();

    // 3. Auto-dismiss Dice Duel
    if (
      state.gameState === 'playing' &&
      state.diceShowdown &&
      this.diceDismissAt !== null &&
      now >= this.diceDismissAt
    ) {
      this.engine.dismissDiceShowdown();
      this.diceDismissAt = null;
      changed = true;
    }

    const fresh = this.engine.getState();

    // 4. Bot / AFK trade fulfillment or turn play
    if (fresh.gameState === 'playing' && !fresh.diceShowdown) {
      const pendingTrade = fresh.tradingState?.pendingRequest;

      if (pendingTrade && pendingTrade.targetPlayerId) {
        const target = fresh.players.find((p) => p.id === pendingTrade.targetPlayerId);
        const targetInGrace = Boolean(
          target?.disconnected && !target.isBot && target.reconnectGraceUntil
        );
        if (
          target &&
          !targetInGrace &&
          (target.isBot || target.autoPlay) &&
          this.botActionAt !== null &&
          now >= this.botActionAt
        ) {
          this.botActionAt = null;
          const decision = evaluateBotTradeFulfill(target.cards, pendingTrade.requestedCard);
          if (decision.accept && decision.extraCard) {
            this.engine.tradeFulfill(target.id, decision.extraCard.id);
          } else {
            this.engine.tradeDecline(target.id);
          }
          changed = true;
        }
      } else {
        const current = fresh.players[fresh.turnIndex];
        const currentInGrace = Boolean(
          current?.disconnected && !current.isBot && current.reconnectGraceUntil
        );

        if (
          current &&
          !currentInGrace &&
          (current.isBot || current.autoPlay) &&
          current.cards.length > 0 &&
          this.botActionAt !== null &&
          now >= this.botActionAt
        ) {
          this.botActionAt = null;
          const turnKey = `${fresh.roundNumber}_${fresh.stateVersion}_${current.id}`;
          let acted = false;

          if (
            fresh.rules.enableTrading &&
            fresh.tradingState &&
            !fresh.tradingState.pendingRequest &&
            this.botTradeKey !== turnKey &&
            Math.random() < 0.35
          ) {
            this.botTradeKey = turnKey;
            const desired = evaluateBotTradeRequest(current.cards);
            if (desired) {
              const res = this.engine.tradeRequest(current.id, desired.rank, desired.suit);
              if (res.ok) {
                acted = true;
              }
            }
          }

          if (!acted) {
            const isFirstPlay = !fresh.firstPlayMade && !fresh.activePlay;
            const play = getBotPlay(
              current.cards,
              fresh.activePlay,
              isFirstPlay,
              {
                enableBombsSingle: fresh.rules.enableBombsSingle,
                enableBombsPair: fresh.rules.enableBombsPair,
              },
              fresh.startingCard
            );

            if (play && play.length > 0) {
              this.engine.playCards(
                current.id,
                play.map((c) => c.id)
              );
            } else if (!isFirstPlay && fresh.activePlay) {
              this.engine.passTurn(current.id);
            } else if (current.cards.length > 0) {
              this.engine.playCards(current.id, [current.cards[0].id]);
            }
          }
          changed = true;
        } else if (
          !currentInGrace &&
          fresh.turnDeadline !== null &&
          now >= fresh.turnDeadline
        ) {
          if (this.engine.handleTurnTimeout().ok) {
            changed = true;
          }
        }
      }
    }

    if (changed) {
      await this.commitAndBroadcast();
    } else {
      const nextAlarm = this.computeNextSchedule(now);
      this.saveRoomRow();
      if (nextAlarm !== null) {
        await this.ctx.storage.setAlarm(Math.max(now + 25, nextAlarm));
      }
    }
  }

  // ==================== HTTP & WEBSOCKET ENTRYPOINT ====================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ==================== LOBBY REGISTRY ROUTES ====================
    if (url.pathname === '/registry/list') {
      this.ensureRegistrySchema();
      const cutoff = Date.now() - ROOM_STALE_MS;
      this.ctx.storage.sql.exec('DELETE FROM rooms WHERE updated_at < ?', cutoff);
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT code, host_name, has_password, player_count, max_players, game_state, rules_summary, rejoinable_count, updated_at
           FROM rooms
           ORDER BY CASE WHEN game_state = 'lobby' THEN 0 WHEN rejoinable_count > 0 THEN 1 ELSE 2 END, updated_at DESC
           LIMIT 30`
        )
        .toArray();
      const rooms: LobbyListing[] = rows.map((r) => ({
        code: String(r.code),
        hostName: String(r.host_name),
        hasPassword: Number(r.has_password) === 1,
        playerCount: Number(r.player_count),
        maxPlayers: Number(r.max_players),
        gameState: String(r.game_state),
        rulesSummary: String(r.rules_summary || ''),
        rejoinableCount: Number(r.rejoinable_count || 0),
        updatedAt: Number(r.updated_at),
      }));
      return Response.json({ rooms });
    }

    if (url.pathname === '/registry/upsert' && request.method === 'POST') {
      this.ensureRegistrySchema();
      const body = (await request.json()) as {
        code: string;
        hostName: string;
        hasPassword: boolean;
        playerCount: number;
        gameState: string;
        rulesSummary?: string;
        rejoinableCount?: number;
      };
      this.ctx.storage.sql.exec(
        `INSERT INTO rooms (code, host_name, has_password, player_count, max_players, game_state, rules_summary, rejoinable_count, updated_at)
         VALUES (?, ?, ?, ?, 4, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           host_name = excluded.host_name,
           has_password = excluded.has_password,
           player_count = excluded.player_count,
           game_state = excluded.game_state,
           rules_summary = excluded.rules_summary,
           rejoinable_count = excluded.rejoinable_count,
           updated_at = excluded.updated_at`,
        body.code.toUpperCase(),
        (body.hostName || 'Host').slice(0, 24),
        body.hasPassword ? 1 : 0,
        Math.max(1, Math.min(4, Number(body.playerCount) || 1)),
        body.gameState || 'lobby',
        (body.rulesSummary || '').slice(0, 80),
        Math.max(0, Math.min(4, Number(body.rejoinableCount) || 0)),
        Date.now()
      );
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith('/registry/') && request.method === 'DELETE') {
      this.ensureRegistrySchema();
      const code = decodeURIComponent(url.pathname.slice('/registry/'.length)).toUpperCase();
      this.ctx.storage.sql.exec('DELETE FROM rooms WHERE code = ?', code);
      return Response.json({ ok: true });
    }

    // ==================== ROOM STATUS & INIT ====================
    if (url.pathname.endsWith('/status')) {
      this.ensureRoomLoaded();
      const now = Date.now();
      const isPendingInit = this.engine === null && this.createdAt > 0 && now - this.createdAt < INIT_GRACE_MS;
      const hasActiveRoom = this.engine !== null || isPendingInit;
      return Response.json({
        hasHost: hasActiveRoom,
        active: hasActiveRoom,
        peerCount: this.getClientSockets().length,
        hasPassword: Boolean(this.passwordHash),
      });
    }

    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      this.ensureRoomLoaded();
      const body = (await request.json()) as {
        code: string;
        hostName?: string;
        password?: string;
      };
      const code = body.code.toUpperCase();
      const cleanPass = (body.password || '').trim();
      const now = Date.now();

      this.roomCode = code;
      this.passwordHash = cleanPass ? await sha256Hex(cleanPass) : '';
      this.engine = null;
      this.diceDismissAt = null;
      this.botActionAt = null;
      this.botTradeKey = '';
      this.emptySince = now;
      this.createdAt = now;
      this.updatedAt = now;
      this.lastMetaKey = '';

      this.saveRoomRow();
      await this.ctx.storage.setAlarm(now + INIT_GRACE_MS);
      return Response.json({ ok: true });
    }

    // ==================== WEBSOCKET ROOM CONNECTION ====================
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    this.ensureRoomLoaded();

    const roleParam = url.searchParams.get('role');
    const isCreatorConnect = roleParam === 'host';
    const sessionId = (url.searchParams.get('sessionId') || crypto.randomUUID()).slice(0, 64);
    const peerId = (url.searchParams.get('peerId') || `p_${crypto.randomUUID().slice(0, 8)}`).slice(0, 48);
    const name = (url.searchParams.get('name') || (isCreatorConnect ? 'Host' : 'Player')).slice(0, 24);
    const password = (url.searchParams.get('password') || '').trim();
    const roomCodeFromUrl =
      url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4})\/ws$/)?.[1]?.toUpperCase() || '';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Case 1: Brand new room awaiting creator's first WebSocket connection
    if (!this.engine) {
      const hasPendingInit =
        this.createdAt > 0 && Date.now() - this.createdAt < INIT_GRACE_MS;
      if (!isCreatorConnect || !hasPendingInit) {
        server.accept();
        this.safeSend(server, {
          type: 'error',
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found or has already ended.',
        });
        server.close(4004, 'Room not found');
        return new Response(null, { status: 101, webSocket: client });
      }

      const code = roomCodeFromUrl || this.roomCode || 'ROOM';
      this.roomCode = code;

      this.engine = new CapsaHostEngine({
        code,
        mode: 'multiplayer',
        hostId: peerId,
        hostSessionId: sessionId,
        hostName: name,
      });
      this.engine.setPeerTransport(peerId, 'online');

      const attachment: SocketAttachment = { peerId, sessionId, name };
      this.ctx.acceptWebSocket(server, ['client', `id:${peerId}`, `sess:${sessionId}`]);
      server.serializeAttachment(attachment);

      this.safeSend(server, { type: 'welcome', peerId, sessionId });
      await this.commitAndBroadcast(true);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Case 2: Joining or reconnecting to an existing active room
    const existingSeat = this.engine.getState().players.find((p) => p.sessionId === sessionId);

    // Password verification (bypassed when reconnecting with an already-seated sessionId)
    if (this.passwordHash && !existingSeat) {
      const providedHash = password ? await sha256Hex(password) : '';
      if (providedHash !== this.passwordHash) {
        server.accept();
        this.safeSend(server, {
          type: 'error',
          code: 'WRONG_PASSWORD',
          message: password ? 'Incorrect room password.' : 'This table requires a password.',
        });
        server.close(4001, 'Wrong password');
        return new Response(null, { status: 101, webSocket: client });
      }
    }

    const wasEmpty = this.getClientSockets().length === 0;

    // Attempt to seat or restore player BEFORE closing any old socket
    const res = this.engine.addOrRestorePeer({
      peerId,
      sessionId,
      name,
      transport: 'online',
    });

    if (!res.ok) {
      server.accept();
      this.safeSend(server, {
        type: 'error',
        code: 'JOIN_REJECTED',
        message: res.error ?? 'Unable to join room.',
      });
      server.close(4003, res.error ?? 'Unable to join room');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Close any stale/previous sockets for this same sessionId cleanly without triggering disconnect grace
    for (const oldWs of this.getSocketsBySession(sessionId)) {
      try {
        const oldAtt = oldWs.deserializeAttachment() as SocketAttachment | null;
        if (oldAtt) {
          oldWs.serializeAttachment({ ...oldAtt, replaced: true });
        }
        oldWs.close(4000, 'Replaced by reconnect');
      } catch {
        // ignore
      }
    }

    // If everyone had dropped out and this player is waking the room back up mid-game, refresh turn timer
    if (wasEmpty && this.engine.getState().gameState === 'playing') {
      this.engine.refreshTurnDeadlineIfNeeded();
    }

    const attachment: SocketAttachment = { peerId, sessionId, name };
    this.ctx.acceptWebSocket(server, ['client', `id:${peerId}`, `sess:${sessionId}`]);
    server.serializeAttachment(attachment);

    this.safeSend(server, { type: 'welcome', peerId, sessionId });
    await this.commitAndBroadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message === 'ping') {
      try {
        ws.send('pong');
      } catch {
        // ignore
      }
      return;
    }

    let parsed: IncomingClientMessage;
    try {
      parsed = JSON.parse(message) as IncomingClientMessage;
    } catch {
      return;
    }

    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att || att.replaced || att.closed) return;

    this.ensureRoomLoaded();
    if (!this.engine) {
      this.safeSend(ws, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'This table has already ended.',
      });
      try {
        ws.close(4004, 'Room closed');
      } catch {
        // ignore
      }
      return;
    }

    if (parsed.type === 'LEAVE') {
      try {
        ws.serializeAttachment({ ...att, explicitLeave: true });
      } catch {
        // ignore
      }
      await this.handleDisconnect(ws, true);
      try {
        ws.close(1000, 'Player left');
      } catch {
        // ignore
      }
      return;
    }

    if (parsed.type === 'INTENT' && parsed.intent) {
      const res = this.engine.executeIntent(att.peerId, parsed.intent);
      if (!res.ok) {
        if (res.error) {
          this.safeSend(ws, { type: 'ACTION_ERROR', message: res.error });
        }
        return;
      }

      if (res.kickedPeerId) {
        const kickedWs = this.getSocketByPeerId(res.kickedPeerId);
        if (kickedWs) {
          try {
            const kAtt = kickedWs.deserializeAttachment() as SocketAttachment | null;
            if (kAtt) kickedWs.serializeAttachment({ ...kAtt, replaced: true, closed: true });
          } catch {
            // ignore
          }
          this.safeSend(kickedWs, {
            type: 'KICKED',
            message: 'You were removed from the lobby by the host.',
          });
          try {
            kickedWs.close(4003, 'Kicked by host');
          } catch {
            // ignore
          }
        }
      }

      await this.commitAndBroadcast();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws, false);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws, false);
  }

  private async handleDisconnect(ws: WebSocket, forceExplicit: boolean): Promise<void> {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att || att.replaced || att.closed) return;

    try {
      ws.serializeAttachment({ ...att, closed: true });
    } catch {
      // ignore
    }

    // If a newer socket for the same sessionId is already connected, ignore this stale close
    const siblingActive = this.getSocketsBySession(att.sessionId).some((s) => s !== ws);
    if (siblingActive) return;

    this.ensureRoomLoaded();
    if (!this.engine) return;

    const explicit = forceExplicit || Boolean(att.explicitLeave);
    this.engine.handlePeerDisconnect(att.peerId, explicit);

    if (this.engine.getState().gameState === 'lobby' && !this.engine.hasHumanPlayers()) {
      await this.cleanupRoom();
      return;
    }

    await this.commitAndBroadcast();
  }
}
