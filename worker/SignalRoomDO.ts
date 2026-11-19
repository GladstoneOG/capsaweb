import { DurableObject } from 'cloudflare:workers';

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
}

export class SignalRoomDO extends DurableObject<Record<string, unknown>> {
  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env);
    // Keepalive ping/pong handled at Cloudflare edge without waking the Durable Object
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
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
      // Socket already closing/closed
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/status')) {
      const hasHost = this.getHostSocket() !== null;
      const peerCount = this.getPeerSockets().length;
      return Response.json({ hasHost, peerCount });
    }

    const upgrade = request.headers.get('Upgrade');
    if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const roleParam = url.searchParams.get('role');
    const role: 'host' | 'peer' = roleParam === 'host' ? 'host' : 'peer';
    const sessionId = (url.searchParams.get('sessionId') || crypto.randomUUID()).slice(0, 64);
    const peerId = (url.searchParams.get('peerId') || `p_${crypto.randomUUID().slice(0, 8)}`).slice(0, 48);
    const name = (url.searchParams.get('name') || (role === 'host' ? 'Host' : 'Player')).slice(0, 24);

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

      const attachment: SocketAttachment = { role: 'host', peerId, sessionId, name };
      this.ctx.acceptWebSocket(server, ['host', `id:${peerId}`]);
      server.serializeAttachment(attachment);

      this.safeSend(server, { type: 'welcome', role: 'host', peerId });

      // Inform reconnected host of any waiting peers
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

    // Close stale socket if same sessionId reconnects
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
    this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.handleDisconnect(ws);
  }

  private handleDisconnect(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att) return;

    if (att.role === 'host') {
      // Only notify if no replacement host socket is active
      const remainingHosts = this.ctx.getWebSockets('host').filter((s) => s !== ws);
      if (remainingHosts.length === 0) {
        for (const peerWs of this.getPeerSockets()) {
          this.safeSend(peerWs, {
            type: 'host-disconnected',
            message: 'The host closed the room.',
          });
        }
      }
      return;
    }

    // Peer disconnected
    const hostWs = this.getHostSocket();
    if (hostWs) {
      this.safeSend(hostWs, {
        type: 'peer-disconnected',
        peerId: att.peerId,
      });
    }
  }
}
