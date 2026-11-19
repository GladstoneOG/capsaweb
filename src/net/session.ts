import { evaluateBotTradeFulfill, evaluateBotTradeRequest, getBotPlay } from '@engine/bot';
import { CapsaHostEngine } from '@engine/hostEngine';
import type { ClientIntent, SanitizedRoomState } from '@engine/types';
import {
  RTC_CONFIG,
  type ConnectionStatus,
  type HostToPeerMessage,
  type LocalTransportState,
  type PeerToHostMessage,
  type SignalServerMessage,
} from './protocol';

export interface SessionSnapshot {
  room: SanitizedRoomState | null;
  status: ConnectionStatus;
  transport: LocalTransportState;
  error: string | null;
}

export type SessionListener = (snapshot: SessionSnapshot) => void;

export interface GameSession {
  readonly mode: 'solo' | 'host' | 'peer';
  subscribe(listener: SessionListener): () => void;
  getSnapshot(): SessionSnapshot;
  sendIntent(intent: ClientIntent): void;
  destroy(): void;
}

function getOrCreateSessionId(roomCode: string): string {
  const key = `capsa_session_${roomCode.toUpperCase()}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }
}

function buildWsUrl(params: Record<string, string>, roomCode: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = new URLSearchParams(params).toString();
  return `${proto}//${window.location.host}/api/room/${roomCode.toUpperCase()}/ws?${query}`;
}

// ==================== SHARED HOST SCHEDULER (BOTS + TURN TIMER) ====================

class HostAutomation {
  private botTimer: number | null = null;
  private diceTimer: number | null = null;
  private turnTimer: number | null = null;
  private botTradeAttemptedKey: string | null = null;

  constructor(
    private engine: CapsaHostEngine,
    private onStateChanged: () => void
  ) {}

  schedule(): void {
    this.clearTimers();
    const state = this.engine.getState();

    if (state.gameState !== 'playing') {
      this.botTradeAttemptedKey = null;
      return;
    }

    // Auto-dismiss Dice Duel after 4.2s if nobody dismissed it
    if (state.diceShowdown) {
      this.diceTimer = window.setTimeout(() => {
        if (this.engine.getState().diceShowdown) {
          this.engine.dismissDiceShowdown();
          this.onStateChanged();
        }
      }, 4200);
      return;
    }

    // 1. Check if a bot is the target of a pending trade request
    const pendingTrade = state.tradingState?.pendingRequest;
    if (pendingTrade && pendingTrade.targetPlayerId) {
      const target = state.players.find((p) => p.id === pendingTrade.targetPlayerId);
      if (target?.isBot) {
        this.botTimer = window.setTimeout(() => {
          const decision = evaluateBotTradeFulfill(target.cards, pendingTrade.requestedCard);
          if (decision.accept && decision.extraCard) {
            this.engine.tradeFulfill(target.id, decision.extraCard.id);
          } else {
            this.engine.tradeDecline(target.id);
          }
          this.onStateChanged();
        }, 850);
        return;
      }
    }

    // 2. Check if current turn belongs to a bot
    const current = state.players[state.turnIndex];
    if (current?.isBot && current.cards.length > 0 && !pendingTrade) {
      const turnKey = `${state.roundNumber}_${state.stateVersion}_${current.id}`;
      this.botTimer = window.setTimeout(() => {
        const fresh = this.engine.getState();
        const activeBot = fresh.players[fresh.turnIndex];
        if (!activeBot || activeBot.id !== current.id || !activeBot.isBot) return;

        // Optional bot trade attempt once per turn if trading enabled
        if (
          fresh.rules.enableTrading &&
          fresh.tradingState &&
          !fresh.tradingState.pendingRequest &&
          this.botTradeAttemptedKey !== turnKey &&
          Math.random() < 0.35
        ) {
          this.botTradeAttemptedKey = turnKey;
          const desired = evaluateBotTradeRequest(activeBot.cards);
          if (desired) {
            const res = this.engine.tradeRequest(activeBot.id, desired.rank, desired.suit);
            if (res.ok) {
              this.onStateChanged();
              return;
            }
          }
        }

        const isFirstPlay = !fresh.firstPlayMade && !fresh.activePlay;
        const play = getBotPlay(
          activeBot.cards,
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
            activeBot.id,
            play.map((c) => c.id)
          );
        } else if (!isFirstPlay && fresh.activePlay) {
          this.engine.passTurn(activeBot.id);
        } else if (activeBot.cards.length > 0) {
          this.engine.playCards(activeBot.id, [activeBot.cards[0].id]);
        }

        this.onStateChanged();
      }, 750);
      return;
    }

    // 3. Human turn countdown timer
    if (state.turnDeadline && !pendingTrade) {
      const delay = Math.max(50, state.turnDeadline - Date.now());
      this.turnTimer = window.setTimeout(() => {
        const res = this.engine.handleTurnTimeout();
        if (res.ok) {
          this.onStateChanged();
        }
      }, delay);
    }
  }

  clearTimers(): void {
    if (this.botTimer !== null) {
      window.clearTimeout(this.botTimer);
      this.botTimer = null;
    }
    if (this.diceTimer !== null) {
      window.clearTimeout(this.diceTimer);
      this.diceTimer = null;
    }
    if (this.turnTimer !== null) {
      window.clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }
}

function executeIntentOnEngine(
  engine: CapsaHostEngine,
  actorId: string,
  intent: ClientIntent
): { ok: boolean; error?: string; kickedPeerId?: string } {
  switch (intent.type) {
    case 'TOGGLE_READY':
      return engine.toggleReady(actorId);
    case 'UPDATE_RULES':
      return engine.updateRules(actorId, intent.rules);
    case 'ADD_BOT':
      return engine.addBot(actorId);
    case 'REMOVE_PLAYER':
      return engine.removePlayer(actorId, intent.playerId);
    case 'START_GAME':
      return engine.startGame(actorId);
    case 'NEXT_ROUND':
      return engine.nextRound(actorId);
    case 'PLAY_CARDS':
      return engine.playCards(actorId, intent.cardIds);
    case 'PASS':
      return engine.passTurn(actorId);
    case 'UNDO_PASS':
      return engine.undoPass(actorId);
    case 'TRADE_REQUEST':
      return engine.tradeRequest(actorId, intent.rank, intent.suit);
    case 'TRADE_FULFILL':
      return engine.tradeFulfill(actorId, intent.extraCardId);
    case 'TRADE_DECLINE':
      return engine.tradeDecline(actorId);
    case 'TRADE_CANCEL':
      return engine.tradeCancel(actorId);
    case 'DISMISS_DICE':
      return engine.dismissDiceShowdown();
    case 'CHAT':
      return engine.addChat(actorId, intent.text);
  }
}

// ==================== 1. LOCAL SOLO SESSION (OFFLINE VS BOTS) ====================

export class LocalSoloSession implements GameSession {
  readonly mode = 'solo' as const;
  private engine: CapsaHostEngine;
  private automation: HostAutomation;
  private listeners = new Set<SessionListener>();
  private hostId = 'local_player';
  private snapshot: SessionSnapshot;

  constructor(playerName: string) {
    this.engine = new CapsaHostEngine({
      code: 'SOLO',
      mode: 'solo',
      hostId: this.hostId,
      hostSessionId: 'solo',
      hostName: playerName,
    });
    // Pre-fill 3 bots in Solo lobby so user can either start immediately or tweak rules first
    this.engine.addBot(this.hostId);
    this.engine.addBot(this.hostId);
    this.engine.addBot(this.hostId);

    this.automation = new HostAutomation(this.engine, () => this.emit());
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: null,
    };
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  sendIntent(intent: ClientIntent): void {
    const res = executeIntentOnEngine(this.engine, this.hostId, intent);
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: res.ok ? null : (res.error ?? 'Action rejected.'),
    };
    this.notify();
    this.automation.schedule();
  }

  private emit(): void {
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connected',
      transport: 'local',
      error: null,
    };
    this.notify();
    this.automation.schedule();
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  destroy(): void {
    this.automation.clearTimers();
    this.listeners.clear();
  }
}

// ==================== 2. HOST MULTIPLAYER SESSION (WEBRTC HUB + WS FALLBACK) ====================

interface PeerLink {
  peerId: string;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  mode: 'connecting' | 'p2p' | 'relay';
  fallbackTimer: number | null;
}

export class HostMultiplayerSession implements GameSession {
  readonly mode = 'host' as const;
  private engine: CapsaHostEngine;
  private automation: HostAutomation;
  private listeners = new Set<SessionListener>();
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  private peers = new Map<string, PeerLink>();
  private hostId: string;
  private roomCode: string;
  private destroyed = false;
  private snapshot: SessionSnapshot;

  constructor(roomCode: string, hostName: string) {
    this.roomCode = roomCode.toUpperCase();
    const sessionId = getOrCreateSessionId(this.roomCode);
    this.hostId = `host_${sessionId.slice(0, 8)}`;

    this.engine = new CapsaHostEngine({
      code: this.roomCode,
      mode: 'multiplayer',
      hostId: this.hostId,
      hostSessionId: sessionId,
      hostName,
    });

    this.automation = new HostAutomation(this.engine, () => this.broadcastAll());

    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: 'connecting',
      transport: 'host',
      error: null,
    };

    this.connectSignaling(sessionId, hostName);
  }

  private connectSignaling(sessionId: string, hostName: string): void {
    const url = buildWsUrl(
      { role: 'host', peerId: this.hostId, sessionId, name: hostName },
      this.roomCode
    );
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.destroyed) return;
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);
    };

    ws.onmessage = (event) => {
      if (this.destroyed || typeof event.data !== 'string' || event.data === 'pong') return;
      let msg: SignalServerMessage;
      try {
        msg = JSON.parse(event.data) as SignalServerMessage;
      } catch {
        return;
      }
      this.handleSignal(msg);
    };

    ws.onerror = () => {
      if (this.destroyed) return;
      this.updateLocalSnapshot('error', 'Unable to connect to Cloudflare signaling room.');
    };

    ws.onclose = () => {
      if (this.destroyed) return;
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (this.snapshot.status !== 'error') {
        this.updateLocalSnapshot('disconnected', 'Disconnected from signaling server.');
      }
    };
  }

  private sendSignal(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleSignal(msg: SignalServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.updateLocalSnapshot('connected', null);
        break;

      case 'error':
        this.updateLocalSnapshot('error', msg.message);
        break;

      case 'peer-connected':
        this.onPeerConnected(msg.peerId, msg.sessionId, msg.name);
        break;

      case 'peer-disconnected':
        this.onPeerDisconnected(msg.peerId);
        break;

      case 'rtc-answer': {
        const link = this.peers.get(msg.from);
        if (link?.pc) {
          void link.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).catch(() => {
            this.switchPeerToRelay(msg.from);
          });
        }
        break;
      }

      case 'rtc-ice': {
        const link = this.peers.get(msg.from);
        if (link?.pc && msg.candidate) {
          void link.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {
            // ignore stale ICE
          });
        }
        break;
      }

      case 'relay-from-peer':
        this.handlePeerMessage(msg.from, msg.payload);
        break;

      default:
        break;
    }
  }

  private onPeerConnected(peerId: string, sessionId: string, name: string): void {
    const res = this.engine.addOrRestorePeer({
      peerId,
      sessionId,
      name,
      transport: 'connecting',
    });

    if (!res.ok) {
      this.sendSignal({
        type: 'relay-to-peer',
        to: peerId,
        payload: { type: 'KICKED', message: res.error ?? 'Unable to join room.' } satisfies HostToPeerMessage,
      });
      this.sendSignal({ type: 'kick-peer', peerId });
      return;
    }

    // Create peer link and attempt WebRTC P2P while immediately syncing over WS relay
    const link: PeerLink = {
      peerId,
      pc: null,
      dc: null,
      mode: 'connecting',
      fallbackTimer: null,
    };
    this.peers.set(peerId, link);

    // Send instant initial state over relay so UI renders immediately
    this.sendToPeer(peerId, {
      type: 'STATE_SYNC',
      state: this.engine.getSanitizedState(peerId),
    });

    // Establish direct WebRTC DataChannel
    this.initiateWebRTC(link);
    this.broadcastAll();
  }

  private initiateWebRTC(link: PeerLink): void {
    if (typeof RTCPeerConnection === 'undefined') {
      this.switchPeerToRelay(link.peerId);
      return;
    }

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      link.pc = pc;

      const dc = pc.createDataChannel('capsa', { ordered: true });
      link.dc = dc;

      link.fallbackTimer = window.setTimeout(() => {
        if (link.mode !== 'p2p') {
          this.switchPeerToRelay(link.peerId);
        }
      }, 3500);

      dc.onopen = () => {
        if (link.fallbackTimer !== null) {
          window.clearTimeout(link.fallbackTimer);
          link.fallbackTimer = null;
        }
        link.mode = 'p2p';
        this.engine.setPeerTransport(link.peerId, 'p2p');
        this.broadcastAll();
      };

      dc.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const msg = JSON.parse(ev.data) as PeerToHostMessage;
          this.handlePeerMessage(link.peerId, msg);
        } catch {
          // ignore malformed packet
        }
      };

      dc.onclose = () => {
        if (this.peers.has(link.peerId) && link.mode === 'p2p') {
          this.switchPeerToRelay(link.peerId);
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.sendSignal({
            type: 'rtc-ice',
            to: link.peerId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          if (this.peers.has(link.peerId)) {
            this.switchPeerToRelay(link.peerId);
          }
        }
      };

      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => {
          this.sendSignal({
            type: 'rtc-offer',
            to: link.peerId,
            sdp: offer,
          });
        })
        .catch(() => {
          this.switchPeerToRelay(link.peerId);
        });
    } catch {
      this.switchPeerToRelay(link.peerId);
    }
  }

  private switchPeerToRelay(peerId: string): void {
    const link = this.peers.get(peerId);
    if (!link) return;
    if (link.fallbackTimer !== null) {
      window.clearTimeout(link.fallbackTimer);
      link.fallbackTimer = null;
    }
    if (link.mode !== 'relay') {
      link.mode = 'relay';
      this.engine.setPeerTransport(peerId, 'relay');
      this.broadcastAll();
    }
  }

  private onPeerDisconnected(peerId: string): void {
    const link = this.peers.get(peerId);
    if (link) {
      if (link.fallbackTimer !== null) window.clearTimeout(link.fallbackTimer);
      try {
        link.dc?.close();
        link.pc?.close();
      } catch {
        // ignore
      }
      this.peers.delete(peerId);
    }
    this.engine.handlePeerDisconnect(peerId);
    this.broadcastAll();
  }

  private sendToPeer(peerId: string, msg: HostToPeerMessage): void {
    const link = this.peers.get(peerId);
    if (link?.mode === 'p2p' && link.dc && link.dc.readyState === 'open') {
      try {
        link.dc.send(JSON.stringify(msg));
        return;
      } catch {
        this.switchPeerToRelay(peerId);
      }
    }
    // Fallback over hibernatable Cloudflare DO WebSocket
    this.sendSignal({
      type: 'relay-to-peer',
      to: peerId,
      payload: msg,
    });
  }

  private handlePeerMessage(peerId: string, msg: PeerToHostMessage): void {
    if (!msg || msg.type !== 'INTENT') return;
    const res = executeIntentOnEngine(this.engine, peerId, msg.intent);
    if (!res.ok && res.error) {
      this.sendToPeer(peerId, { type: 'ACTION_ERROR', message: res.error });
      return;
    }
    this.broadcastAll();
  }

  private broadcastAll(localError: string | null = null): void {
    // Update Host UI
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status: this.snapshot.status === 'connecting' ? 'connecting' : this.snapshot.status,
      transport: 'host',
      error: localError,
    };
    this.notify();

    // Send individualized sanitized state to each connected peer
    for (const peerId of this.peers.keys()) {
      this.sendToPeer(peerId, {
        type: 'STATE_SYNC',
        state: this.engine.getSanitizedState(peerId),
      });
    }

    this.automation.schedule();
  }

  private updateLocalSnapshot(status: ConnectionStatus, error: string | null): void {
    this.snapshot = {
      room: this.engine.getSanitizedState(this.hostId),
      status,
      transport: 'host',
      error,
    };
    this.notify();
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  sendIntent(intent: ClientIntent): void {
    const res = executeIntentOnEngine(this.engine, this.hostId, intent);
    if (res.kickedPeerId) {
      this.sendToPeer(res.kickedPeerId, {
        type: 'KICKED',
        message: 'You were removed from the lobby by the host.',
      });
      this.sendSignal({ type: 'kick-peer', peerId: res.kickedPeerId });
      this.onPeerDisconnected(res.kickedPeerId);
    }
    this.broadcastAll(res.ok ? null : (res.error ?? 'Action rejected.'));
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  destroy(): void {
    this.destroyed = true;
    this.automation.clearTimers();
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    for (const link of this.peers.values()) {
      if (link.fallbackTimer !== null) window.clearTimeout(link.fallbackTimer);
      try {
        link.dc?.close();
        link.pc?.close();
      } catch {
        // ignore
      }
    }
    this.peers.clear();
    try {
      this.ws?.close(1000, 'Host left');
    } catch {
      // ignore
    }
    this.listeners.clear();
  }
}

// ==================== 3. PEER MULTIPLAYER SESSION (WEBRTC + WS FALLBACK) ====================

export class PeerMultiplayerSession implements GameSession {
  readonly mode = 'peer' as const;
  private listeners = new Set<SessionListener>();
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pingTimer: number | null = null;
  private fallbackTimer: number | null = null;
  private roomCode: string;
  private peerId: string;
  private lastStateVersion = 0;
  private destroyed = false;
  private snapshot: SessionSnapshot = {
    room: null,
    status: 'connecting',
    transport: 'connecting',
    error: null,
  };

  constructor(roomCode: string, playerName: string) {
    this.roomCode = roomCode.toUpperCase();
    const sessionId = getOrCreateSessionId(this.roomCode);
    this.peerId = `peer_${sessionId.slice(0, 8)}_${Math.random().toString(36).slice(2, 6)}`;

    this.connectSignaling(sessionId, playerName);
  }

  private connectSignaling(sessionId: string, playerName: string): void {
    const url = buildWsUrl(
      { role: 'peer', peerId: this.peerId, sessionId, name: playerName },
      this.roomCode
    );
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      if (this.destroyed) return;
      this.pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);

      // If WebRTC doesn't open within 3.5s, mark local transport as relay
      this.fallbackTimer = window.setTimeout(() => {
        if (this.snapshot.transport === 'connecting') {
          this.snapshot = { ...this.snapshot, transport: 'relay' };
          this.notify();
        }
      }, 3500);
    };

    ws.onmessage = (event) => {
      if (this.destroyed || typeof event.data !== 'string' || event.data === 'pong') return;
      let msg: SignalServerMessage;
      try {
        msg = JSON.parse(event.data) as SignalServerMessage;
      } catch {
        return;
      }
      this.handleSignal(msg);
    };

    ws.onerror = () => {
      if (this.destroyed) return;
      this.snapshot = {
        ...this.snapshot,
        status: 'error',
        error: 'Unable to reach room signaling server.',
      };
      this.notify();
    };

    ws.onclose = (ev) => {
      if (this.destroyed) return;
      if (this.pingTimer !== null) {
        window.clearInterval(this.pingTimer);
        this.pingTimer = null;
      }
      if (this.snapshot.status !== 'error') {
        const msg =
          ev.code === 4004
            ? 'Room not found or host is offline.'
            : ev.code === 4003
              ? 'You were removed by the host.'
              : 'Disconnected from the room.';
        this.snapshot = {
          ...this.snapshot,
          status: 'disconnected',
          error: msg,
        };
        this.notify();
      }
    };
  }

  private sendSignal(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleSignal(msg: SignalServerMessage): void {
    switch (msg.type) {
      case 'welcome':
        this.snapshot = { ...this.snapshot, status: 'connected', error: null };
        this.notify();
        break;

      case 'error':
        this.snapshot = { ...this.snapshot, status: 'error', error: msg.message };
        this.notify();
        break;

      case 'host-disconnected':
        this.snapshot = {
          ...this.snapshot,
          status: 'disconnected',
          error: msg.message || 'The host disconnected and the table closed.',
        };
        this.notify();
        break;

      case 'kicked':
        this.snapshot = {
          ...this.snapshot,
          status: 'error',
          error: msg.message || 'You were removed from the room.',
        };
        this.notify();
        break;

      case 'rtc-offer':
        this.handleOffer(msg.sdp);
        break;

      case 'rtc-ice':
        if (this.pc && msg.candidate) {
          void this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {
            // ignore
          });
        }
        break;

      case 'relay-from-host':
        this.handleHostMessage(msg.payload);
        break;

      default:
        break;
    }
  }

  private handleOffer(sdp: RTCSessionDescriptionInit): void {
    if (typeof RTCPeerConnection === 'undefined') {
      this.snapshot = { ...this.snapshot, transport: 'relay' };
      this.notify();
      return;
    }

    try {
      this.pc?.close();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.sendSignal({
            type: 'rtc-ice',
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        this.dc = dc;

        dc.onopen = () => {
          if (this.fallbackTimer !== null) {
            window.clearTimeout(this.fallbackTimer);
            this.fallbackTimer = null;
          }
          this.snapshot = { ...this.snapshot, transport: 'p2p' };
          this.notify();
        };

        dc.onmessage = (msgEv) => {
          if (typeof msgEv.data !== 'string') return;
          try {
            const parsed = JSON.parse(msgEv.data) as HostToPeerMessage;
            this.handleHostMessage(parsed);
          } catch {
            // ignore
          }
        };

        dc.onclose = () => {
          if (!this.destroyed && this.snapshot.transport === 'p2p') {
            this.snapshot = { ...this.snapshot, transport: 'relay' };
            this.notify();
          }
        };
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          if (!this.destroyed && this.snapshot.transport !== 'relay') {
            this.snapshot = { ...this.snapshot, transport: 'relay' };
            this.notify();
          }
        }
      };

      void pc
        .setRemoteDescription(new RTCSessionDescription(sdp))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer).then(() => answer))
        .then((answer) => {
          this.sendSignal({ type: 'rtc-answer', sdp: answer });
        })
        .catch(() => {
          this.snapshot = { ...this.snapshot, transport: 'relay' };
          this.notify();
        });
    } catch {
      this.snapshot = { ...this.snapshot, transport: 'relay' };
      this.notify();
    }
  }

  private handleHostMessage(msg: HostToPeerMessage): void {
    if (!msg) return;

    if (msg.type === 'STATE_SYNC') {
      if (msg.state.stateVersion < this.lastStateVersion) return;
      this.lastStateVersion = msg.state.stateVersion;
      this.snapshot = {
        ...this.snapshot,
        room: msg.state,
        status: 'connected',
        error: null,
      };
      this.notify();
      return;
    }

    if (msg.type === 'ACTION_ERROR') {
      this.snapshot = { ...this.snapshot, error: msg.message };
      this.notify();
      return;
    }

    if (msg.type === 'KICKED') {
      this.snapshot = { ...this.snapshot, status: 'error', error: msg.message };
      this.notify();
    }
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  sendIntent(intent: ClientIntent): void {
    const payload: PeerToHostMessage = { type: 'INTENT', intent };
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(payload));
        return;
      } catch {
        this.snapshot = { ...this.snapshot, transport: 'relay' };
        this.notify();
      }
    }
    this.sendSignal({ type: 'relay-to-host', payload });
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    if (this.fallbackTimer !== null) window.clearTimeout(this.fallbackTimer);
    try {
      this.dc?.close();
      this.pc?.close();
      this.ws?.close(1000, 'Peer left');
    } catch {
      // ignore
    }
    this.listeners.clear();
  }
}

export async function createRoomCode(): Promise<string> {
  const res = await fetch('/api/room/create', { method: 'POST' });
  if (!res.ok) {
    throw new Error('Failed to create room.');
  }
  const data = (await res.json()) as { roomCode: string };
  return data.roomCode;
}
