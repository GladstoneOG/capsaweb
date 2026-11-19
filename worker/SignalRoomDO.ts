import { DurableObject } from 'cloudflare:workers';

export interface SignalEnv {
  SIGNAL_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

interface SocketAttachment {
  role: 'host' | 'peer';
  peerId: string;
  sessionId: string;
  name: string;
}

interface IncomingSignal {
  type: string;
  to?: string;
  sdp?: unknown;
  candidate?: unknown;
  payload?: unknown;
  peerId?: string;
  hostName?: string;
  playerCount?: number;
  gameState?: string;
  rulesSummary?: string;
}

export interface LobbyListing {
  code: string;
  hostName: string;
  hasPassword: boolean;
  playerCount: number;
  maxPlayers: number;
  gameState: string;
  rulesSummary: string;
  updatedAt: number;
}

const REGISTRY_NAME = '__LOBBY_REGISTRY__';
const ROOM_STALE_MS = 30 * 60 * 1000;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class SignalRoomDO extends DurableObject<SignalEnv> {
  private registryInitialized = false;

  constructor(ctx: DurableObjectState, env: SignalEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

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
        updated_at INTEGER NOT NULL
      )
    `);
    this.registryInitialized = true;
  }

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
      await this.getRegistryStub().fetch(`https://signal.internal/registry/${encodeURIComponent(code)}`, {
        method: 'DELETE',
      });
    } catch {
      // non-fatal
    }
  }

  private getHostSocket(): WebSocket | null {
    const hosts = this.ctx.getWebSockets('host');
    return hosts.length > 0 ? hosts[0] : null;
  }

  private getPeerSockets(): WebSocket[] {
    return this.ctx.getWebSockets('peer');
  }

  private getSocketByPeerId(peerId: string): WebSocket | null {
    const matches = this.ctx.getWebSockets(`id:${peerId}`);
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ==================== LOBBY REGISTRY ROUTES ====================
    if (url.pathname === '/registry/list') {
      this.ensureRegistrySchema();
      const cutoff = Date.now() - ROOM_STALE_MS;
      this.ctx.storage.sql.exec('DELETE FROM rooms WHERE updated_at < ?', cutoff);
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT code, host_name, has_password, player_count, max_players, game_state, rules_summary, updated_at
           FROM rooms
           ORDER BY CASE WHEN game_state = 'lobby' THEN 0 ELSE 1 END, updated_at DESC
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
      };
      this.ctx.storage.sql.exec(
        `INSERT INTO rooms (code, host_name, has_password, player_count, max_players, game_state, rules_summary, updated_at)
         VALUES (?, ?, ?, ?, 4, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           host_name = excluded.host_name,
           has_password = excluded.has_password,
           player_count = excluded.player_count,
           game_state = excluded.game_state,
           rules_summary = excluded.rules_summary,
           updated_at = excluded.updated_at`,
        body.code.toUpperCase(),
        (body.hostName || 'Host').slice(0, 24),
        body.hasPassword ? 1 : 0,
        Math.max(1, Math.min(4, Number(body.playerCount) || 1)),
        body.gameState || 'lobby',
        (body.rulesSummary || '').slice(0, 80),
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
      const hasHost = this.getHostSocket() !== null;
      const peerCount = this.getPeerSockets().length;
      const passwordHash = await this.ctx.storage.get<string>('passwordHash');
      return Response.json({ hasHost, peerCount, hasPassword: Boolean(passwordHash) });
    }

    if (url.pathname.endsWith('/init') && request.method === 'POST') {
      const body = (await request.json()) as {
        code: string;
        hostName?: string;
        password?: string;
      };
      const code = body.code.toUpperCase();
      const hostName = (body.hostName || 'Host').trim().slice(0, 24) || 'Host';
      const cleanPass = (body.password || '').trim();

      await this.ctx.storage.put('roomCode', code);
      await this.ctx.storage.put('hostName', hostName);
      if (cleanPass) {
        const hash = await sha256Hex(cleanPass);
        await this.ctx.storage.put('passwordHash', hash);
      } else {
        await this.ctx.storage.delete('passwordHash');
      }

      return Response.json({ ok: true });
    }

    // ==================== WEBSOCKET SIGNALING ====================
    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const roleParam = url.searchParams.get('role');
    const role: 'host' | 'peer' = roleParam === 'host' ? 'host' : 'peer';
    const sessionId = (url.searchParams.get('sessionId') || crypto.randomUUID()).slice(0, 64);
    const peerId = (url.searchParams.get('peerId') || `p_${crypto.randomUUID().slice(0, 8)}`).slice(0, 48);
    const name = (url.searchParams.get('name') || (role === 'host' ? 'Host' : 'Player')).slice(0, 24);
    const password = (url.searchParams.get('password') || '').trim();
    const roomCodeFromUrl = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4})\/ws$/)?.[1]?.toUpperCase() || '';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'host') {
      const existingHost = this.getHostSocket();
      if (existingHost) {
        const existingAtt = existingHost.deserializeAttachment() as SocketAttachment | null;
        if (existingAtt && existingAtt.sessionId !== sessionId) {
          server.accept();
          this.safeSend(server, {
            type: 'error',
            code: 'ROOM_OCCUPIED',
            message: 'This room already has an active host.',
          });
          server.close(4009, 'Room already has a host');
          return new Response(null, { status: 101, webSocket: client });
        }
        try {
          existingHost.close(1000, 'Replaced by host reconnect');
        } catch {
          // ignore
        }
      }

      if (roomCodeFromUrl) {
        await this.ctx.storage.put('roomCode', roomCodeFromUrl);
      }
      await this.ctx.storage.put('hostName', name);

      const attachment: SocketAttachment = { role: 'host', peerId, sessionId, name };
      this.ctx.acceptWebSocket(server, ['host', `id:${peerId}`]);
      server.serializeAttachment(attachment);

      const storedCode = roomCodeFromUrl || (await this.ctx.storage.get<string>('roomCode')) || '';
      const storedPass = await this.ctx.storage.get<string>('passwordHash');
      if (storedCode) {
        await this.registerInLobby({
          code: storedCode,
          hostName: name,
          hasPassword: Boolean(storedPass),
          playerCount: 1 + this.getPeerSockets().length,
          gameState: 'lobby',
          rulesSummary: 'First to 15',
        });
      }

      this.safeSend(server, { type: 'welcome', role: 'host', peerId });

      for (const peerWs of this.getPeerSockets()) {
        const pAtt = peerWs.deserializeAttachment() as SocketAttachment | null;
        if (pAtt) {
          this.safeSend(server, {
            type: 'peer-connected',
            peerId: pAtt.peerId,
            sessionId: pAtt.sessionId,
            name: pAtt.name,
          });
        }
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // Role === 'peer'
    const hostWs = this.getHostSocket();
    if (!hostWs) {
      server.accept();
      this.safeSend(server, {
        type: 'error',
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found or host is offline.',
      });
      server.close(4004, 'Room not found');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Verify password if room is password-protected
    const storedHash = await this.ctx.storage.get<string>('passwordHash');
    if (storedHash) {
      const providedHash = password ? await sha256Hex(password) : '';
      if (providedHash !== storedHash) {
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

    for (const existingPeer of this.getPeerSockets()) {
      const pAtt = existingPeer.deserializeAttachment() as SocketAttachment | null;
      if (pAtt && pAtt.sessionId === sessionId) {
        try {
          existingPeer.close(1000, 'Replaced by peer reconnect');
        } catch {
          // ignore
        }
      }
    }

    const hostAtt = hostWs.deserializeAttachment() as SocketAttachment | null;
    const attachment: SocketAttachment = { role: 'peer', peerId, sessionId, name };
    this.ctx.acceptWebSocket(server, ['peer', `id:${peerId}`]);
    server.serializeAttachment(attachment);

    this.safeSend(server, {
      type: 'welcome',
      role: 'peer',
      peerId,
      hostPeerId: hostAtt?.peerId ?? 'host',
    });

    this.safeSend(hostWs, {
      type: 'peer-connected',
      peerId,
      sessionId,
      name,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message === 'ping') {
      this.safeSend(ws, 'pong');
      return;
    }

    let parsed: IncomingSignal;
    try {
      parsed = JSON.parse(message) as IncomingSignal;
    } catch {
      return;
    }

    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att) return;

    switch (parsed.type) {
      case 'room-meta': {
        if (att.role !== 'host') return;
        const code = (await this.ctx.storage.get<string>('roomCode')) || '';
        if (!code) return;
        const passwordHash = await this.ctx.storage.get<string>('passwordHash');
        await this.registerInLobby({
          code,
          hostName: parsed.hostName || att.name,
          hasPassword: Boolean(passwordHash),
          playerCount: parsed.playerCount ?? 1,
          gameState: parsed.gameState || 'lobby',
          rulesSummary: parsed.rulesSummary || '',
        });
        break;
      }

      case 'rtc-offer':
      case 'rtc-answer':
      case 'rtc-ice': {
        const target =
          att.role === 'host' && parsed.to
            ? this.getSocketByPeerId(parsed.to)
            : att.role === 'peer'
              ? this.getHostSocket()
              : null;
        if (!target) return;
        this.safeSend(target, {
          type: parsed.type,
          from: att.peerId,
          sdp: parsed.sdp,
          candidate: parsed.candidate,
        });
        break;
      }

      case 'relay-to-host': {
        if (att.role !== 'peer') return;
        const hostWs = this.getHostSocket();
        this.safeSend(hostWs, {
          type: 'relay-from-peer',
          from: att.peerId,
          payload: parsed.payload,
        });
        break;
      }

      case 'relay-to-peer': {
        if (att.role !== 'host' || !parsed.to) return;
        const target = this.getSocketByPeerId(parsed.to);
        this.safeSend(target, {
          type: 'relay-from-host',
          payload: parsed.payload,
        });
        break;
      }

      case 'kick-peer': {
        if (att.role !== 'host' || !parsed.peerId) return;
        const target = this.getSocketByPeerId(parsed.peerId);
        if (target) {
          this.safeSend(target, { type: 'kicked', message: 'You were removed by the host.' });
          try {
            target.close(4003, 'Kicked by host');
          } catch {
            // ignore
          }
        }
        break;
      }

      default:
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att) return;

    if (att.role === 'host') {
      const remainingHosts = this.ctx.getWebSockets('host').filter((s) => s !== ws);
      if (remainingHosts.length === 0) {
        const code = (await this.ctx.storage.get<string>('roomCode')) || '';
        await this.ctx.storage.delete('passwordHash');
        await this.unregisterFromLobby(code);
        for (const peerWs of this.getPeerSockets()) {
          this.safeSend(peerWs, {
            type: 'host-disconnected',
            message: 'The host closed the room.',
          });
        }
      }
      return;
    }

    const hostWs = this.getHostSocket();
    if (hostWs) {
      this.safeSend(hostWs, {
        type: 'peer-disconnected',
        peerId: att.peerId,
      });
    }
  }
}
