# Capsa Banting Web (`capsaweb`)

Authoritative multiplayer Indonesian **Capsa Banting (Big Two)** built for **Cloudflare Workers with Static Assets** + **SQLite Durable Objects**.

## Features
- **Resilient Cloudflare Durable Object Rooms**: Each room runs the authoritative game engine, shuffling, move validation, turn timers, and AI bots inside a hibernatable SQLite Durable Object (`SignalRoomDO`). Host or peer disconnects never end a match — clients auto-reconnect seamlessly, and disconnected seats get a grace period before temporary bot coverage.
- **Anti-Cheat Sanitization**: Clients only receive their own hand and opponent card counts.
- **Full Capsa Banting Rules & Scoring**:
  - Single, Pair, Tris, Straight (`A-2-3-4-5` to `J-Q-K-A-2`), Suit-First Flush, Full House, Bomber (`4+1`), Straight Flush.
  - Configurable Bombing on Single `2` and Pair of `2`s.
  - Hibah lead transfer, Undo Pass, Turn Timer, and placement scoring (`+3 / +2 / +1 / 0`).
  - Optional **Double Deck** (13-card & 26-card + `3♦` Dice Duel) and **Card Trading** rules.
- **Solo / Offline Mode**: Play against 3 AI bots with zero network calls.

## Development & Cloudflare Deployment

```bash
npm install
npm run dev        # Local Vite + Cloudflare Workers runtime
npm test           # Run Vitest rules & engine suite
npm run typecheck  # TypeScript check (client + worker)
npm run build      # Build SPA + Worker bundle
npm run deploy     # Deploy to Cloudflare Workers
```

### Cloudflare Workers Git Integration
- **Worker name**: `capsaweb` (`https://capsaweb.johansans999.workers.dev`)
- **Build command**: `npm run build`
- **Deploy command**: `npx wrangler deploy`
