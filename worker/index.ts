import { SignalRoomDO } from './SignalRoomDO';

export { SignalRoomDO };

export interface Env {
  SIGNAL_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return code;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'capsaweb' });
    }

    if (url.pathname === '/api/room/create' && request.method === 'POST') {
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = generateRoomCode();
        const stub = env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(code));
        const res = await stub.fetch('https://signal.internal/status');
        const status = (await res.json()) as { hasHost: boolean };
        if (!status.hasHost) {
          return Response.json({ roomCode: code });
        }
      }
      return Response.json({ error: 'Unable to allocate room code. Try again.' }, { status: 503 });
    }

    const wsMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4})\/ws$/);
    if (wsMatch) {
      const code = wsMatch[1].toUpperCase();
      const stub = env.SIGNAL_ROOM.get(env.SIGNAL_ROOM.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
};
