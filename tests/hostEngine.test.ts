import { describe, expect, it } from 'vitest';
import { CapsaHostEngine, HOST_AFK_NEXT_ROUND_DELAY_MS } from '@engine/hostEngine';
import { getBotPlay } from '@engine/bot';
import type { Card, Rank, Suit } from '@engine/types';

function c(rank: Rank, suit: Suit): Card {
  return { id: `${rank}_${suit}`, rank, suit };
}

describe('CapsaHostEngine Authoritative Rules & Scoring', () => {
  it('auto-fills bots to 4 players and strictly validates opening play and turns', () => {
    const engine = new CapsaHostEngine({
      code: 'ABCD',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Alice',
    });

    expect(engine.addOrRestorePeer({ peerId: 'peer_1', sessionId: 'sess_p1', name: 'Bob', transport: 'p2p' }).ok).toBe(true);
    // Cannot start until Bob is ready
    expect(engine.startGame('host_1').ok).toBe(false);
    expect(engine.toggleReady('peer_1').ok).toBe(true);
    expect(engine.startGame('host_1').ok).toBe(true);

    const state = engine.getState();
    expect(state.gameState).toBe('playing');
    expect(state.players).toHaveLength(4);

    const starter = state.players[state.turnIndex];
    const nonStarter = state.players[(state.turnIndex + 1) % 4];

    // Out-of-turn play rejected
    expect(engine.playCards(nonStarter.id, [nonStarter.cards[0].id]).ok).toBe(false);

    // Passing on opening play rejected
    expect(engine.passTurn(starter.id).ok).toBe(false);

    // Opening play without 3♦ rejected
    const non3D = starter.cards.find((card) => !(card.rank === '3' && card.suit === 'D'))!;
    expect(engine.playCards(starter.id, [non3D.id]).ok).toBe(false);

    // Anti-cheat sanitization: peer_1 cannot see host_1's cards
    const peerView = engine.getSanitizedState('peer_1');
    const hostFromPeer = peerView.players.find((p) => p.id === 'host_1')!;
    const selfFromPeer = peerView.players.find((p) => p.id === 'peer_1')!;
    expect(hostFromPeer.cards).toBeNull();
    expect(hostFromPeer.cardCount).toBe(13);
    expect(selfFromPeer.cards).toHaveLength(13);
  });

  it('handles Hibah lead transfer when trick winner empties hand and others pass', () => {
    const engine = new CapsaHostEngine({
      code: 'TEST',
      mode: 'solo',
      hostId: 'p0',
      hostSessionId: 's0',
      hostName: 'P0',
    });
    engine.startGame('p0');
    const state = engine.getState();

    // Craft exact hands for deterministic Hibah test
    state.players[0].cards = [c('3', 'D')]; // finishes on opening play!
    state.players[1].cards = [c('5', 'D'), c('6', 'D')];
    state.players[2].cards = [c('7', 'D'), c('8', 'D')];
    state.players[3].cards = [c('9', 'D'), c('10', 'D')];
    state.turnIndex = 0;
    state.firstPlayMade = false;
    state.startingCard = c('3', 'D');
    state.activePlay = null;

    // P0 plays final card 3♦ and gets finishRank 1
    expect(engine.playCards('p0', ['3_D']).ok).toBe(true);
    expect(state.players[0].finishRank).toBe(1);
    expect(state.turnIndex).toBe(1);

    // P1, P2, P3 all pass -> Hibah gives lead clockwise to P1
    expect(engine.passTurn(state.players[1].id).ok).toBe(true);
    expect(engine.passTurn(state.players[2].id).ok).toBe(true);
    expect(engine.passTurn(state.players[3].id).ok).toBe(true);

    expect(state.activePlay).toBeNull();
    expect(state.turnIndex).toBe(1);
    expect(state.lastTrick?.hibah).toBe(true);
  });

  it('supports Undo Pass before next player acts', () => {
    const engine = new CapsaHostEngine({
      code: 'UNDO',
      mode: 'solo',
      hostId: 'p0',
      hostSessionId: 's0',
      hostName: 'P0',
    });
    engine.startGame('p0');
    const state = engine.getState();
    state.players[0].cards = [c('3', 'D'), c('K', 'S')];
    state.players[1].cards = [c('4', 'D'), c('A', 'S')];
    state.players[2].cards = [c('5', 'D'), c('2', 'S')];
    state.players[3].cards = [c('6', 'D'), c('9', 'C')];
    state.turnIndex = 0;
    state.firstPlayMade = false;
    state.startingCard = c('3', 'D');

    expect(engine.playCards('p0', ['3_D']).ok).toBe(true);
    const p1Id = state.players[1].id;
    expect(engine.passTurn(p1Id).ok).toBe(true);
    expect(engine.getSanitizedState(p1Id).canUndoPass).toBe(true);
    expect(state.turnIndex).toBe(2);

    expect(engine.undoPass(p1Id).ok).toBe(true);
    expect(state.turnIndex).toBe(1);
    expect(state.players[1].passed).toBe(false);
    expect(engine.getSanitizedState(p1Id).canUndoPass).toBe(false);
  });

  it('handles Card Trading with target anonymity and card transfer', () => {
    const engine = new CapsaHostEngine({
      code: 'TRDE',
      mode: 'multiplayer',
      hostId: 'p0',
      hostSessionId: 's0',
      hostName: 'Alice',
      rules: { enableTrading: true },
    });
    engine.addOrRestorePeer({ peerId: 'p1', sessionId: 's1', name: 'Bob', transport: 'p2p' });
    engine.toggleReady('p1');
    engine.startGame('p0');

    const state = engine.getState();
    state.players[0].cards = [c('3', 'D'), c('7', 'C'), c('7', 'H'), c('7', 'S')];
    state.players[1].cards = [c('7', 'D'), c('4', 'C'), c('9', 'H')];
    state.turnIndex = 0;

    // Alice requests 7♦
    expect(engine.tradeRequest('p0', '7', 'D').ok).toBe(true);

    // Alice (requester) must NOT know who holds 7♦; Bob (holder) DOES see targetPlayerId
    expect(engine.getSanitizedState('p0').tradingState?.pendingRequest?.targetPlayerId).toBeNull();
    expect(engine.getSanitizedState('p1').tradingState?.pendingRequest?.targetPlayerId).toBe('p1');

    // Bob fulfills by giving 7♦ + 4♣
    expect(engine.tradeFulfill('p1', '4_C').ok).toBe(true);
    expect(state.players[0].cards.some((card) => card.id === '7_D')).toBe(true);
    expect(state.players[0].cards.some((card) => card.id === '4_C')).toBe(true);
    expect(state.players[1].cards).toHaveLength(1);
    expect(state.tradingState?.pendingRequest).toBeNull();
  });

  it('completes full rounds, awards +3/+2/+1/0 scoring, and triggers gameover at pointsToWin', () => {
    const engine = new CapsaHostEngine({
      code: 'SCOR',
      mode: 'solo',
      hostId: 'p0',
      hostSessionId: 's0',
      hostName: 'Solo',
      rules: { pointsToWin: 3 },
    });
    engine.startGame('p0');

    let guard = 0;
    while (engine.getState().gameState === 'playing' && guard < 600) {
      guard++;
      const s = engine.getState();
      const cur = s.players[s.turnIndex];
      const isFirst = !s.firstPlayMade && !s.activePlay;
      const play = getBotPlay(
        cur.cards,
        s.activePlay,
        isFirst,
        { enableBombsSingle: s.rules.enableBombsSingle, enableBombsPair: s.rules.enableBombsPair },
        s.startingCard
      );
      if (play) {
        expect(engine.playCards(cur.id, play.map((x) => x.id)).ok).toBe(true);
      } else {
        expect(engine.passTurn(cur.id).ok).toBe(true);
      }
    }

    const finished = engine.getState();
    expect(finished.gameState).toBe('gameover'); // 1st place got +3 === pointsToWin
    const sortedPoints = finished.players.map((p) => p.roundPoints).sort((a, b) => b - a);
    expect(sortedPoints).toEqual([3, 2, 1, 0]);

    // Rematch resets scores cleanly
    expect(engine.nextRound('p0').ok).toBe(true);
    expect(engine.getState().gameState).toBe('playing');
    expect(engine.getState().players.every((p) => p.score === 0)).toBe(true);
  });

  it('gives a 15s disconnect grace period before bot takeover and supports cross-device rejoin by name', () => {
    let clock = 1_000_000;
    const engine = new CapsaHostEngine({
      code: 'RECN',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Host',
      now: () => clock,
    });
    engine.addOrRestorePeer({ peerId: 'peer_old', sessionId: 'sess_pc', name: 'Bob', transport: 'p2p' });
    engine.toggleReady('peer_old');
    engine.startGame('host_1');

    // Active connected player cannot be hijacked by another session with the same name
    expect(
      engine.addOrRestorePeer({ peerId: 'intruder', sessionId: 'sess_other', name: 'bob', transport: 'p2p' }).ok
    ).toBe(false);

    const originalCards = [...engine.getState().players[1].cards];
    engine.handlePeerDisconnect('peer_old');
    // During 15s grace window: disconnected = true, isBot = false, reconnectGraceUntil = clock + 15000
    expect(engine.getState().players[1].disconnected).toBe(true);
    expect(engine.getState().players[1].isBot).toBe(false);
    expect(engine.getState().players[1].reconnectGraceUntil).toBe(clock + 15_000);

    // Before 15s: grace does not expire
    clock += 10_000;
    expect(engine.expireReconnectGrace()).toBe(false);
    expect(engine.getState().players[1].isBot).toBe(false);

    // After 15s: bot takes over
    clock += 5_000;
    expect(engine.expireReconnectGrace()).toBe(true);
    expect(engine.getState().players[1].isBot).toBe(true);
    expect(engine.getState().players[1].reconnectGraceUntil).toBeNull();

    // Phone rejoins with a brand-new sessionId and same name (case-insensitive) and reclaims seat from bot
    const restored = engine.addOrRestorePeer({
      peerId: 'peer_phone',
      sessionId: 'sess_phone',
      name: 'bob',
      transport: 'p2p',
    });
    expect(restored.ok).toBe(true);
    expect(restored.restored).toBe(true);
    expect(engine.getState().players[1].id).toBe('peer_phone');
    expect(engine.getState().players[1].sessionId).toBe('sess_phone');
    expect(engine.getState().players[1].isBot).toBe(false);
    expect(engine.getState().players[1].disconnected).toBe(false);
    expect(engine.getState().players[1].cards).toEqual(originalCards);
  });

  it('supports 60s Switch Device grace period preserved across socket disconnect', () => {
    let clock = 2_000_000;
    const engine = new CapsaHostEngine({
      code: 'SWAP',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Host',
      now: () => clock,
    });
    engine.addOrRestorePeer({ peerId: 'peer_pc', sessionId: 'sess_pc', name: 'Alice', transport: 'p2p' });
    engine.toggleReady('peer_pc');
    engine.startGame('host_1');

    // Host can now swap devices too in server-hosted multiplayer (only solo blocks it)
    const soloEngine = new CapsaHostEngine({
      code: 'SOLO',
      mode: 'solo',
      hostId: 'solo_1',
      hostSessionId: 'sess_solo',
      hostName: 'Solo',
    });
    soloEngine.startGame('solo_1');
    expect(soloEngine.prepareSwapDevice('solo_1').ok).toBe(false);

    // Peer initiates 60s swap
    expect(engine.prepareSwapDevice('peer_pc').ok).toBe(true);
    expect(engine.getState().players[1].swapDevice).toBe(true);
    expect(engine.getState().players[1].disconnected).toBe(true);
    expect(engine.getState().players[1].isBot).toBe(false);
    expect(engine.getState().players[1].reconnectGraceUntil).toBe(clock + 60_000);

    // Subsequent WebSocket disconnect preserves the 60s grace timer (does NOT downgrade to 15s)
    clock += 2_000;
    engine.handlePeerDisconnect('peer_pc');
    expect(engine.getState().players[1].reconnectGraceUntil).toBe(2_060_000);

    // Still waiting at 45s
    clock += 43_000;
    expect(engine.expireReconnectGrace()).toBe(false);
    expect(engine.getState().players[1].isBot).toBe(false);

    // Rejoins on phone at 50s -> cancels grace and resumes immediately
    clock += 5_000;
    const restored = engine.addOrRestorePeer({
      peerId: 'peer_phone',
      sessionId: 'sess_phone',
      name: 'Alice',
      transport: 'p2p',
    });
    expect(restored.ok).toBe(true);
    expect(engine.getState().players[1].swapDevice).toBe(false);
    expect(engine.getState().players[1].reconnectGraceUntil).toBeNull();
    expect(engine.getState().players[1].isBot).toBe(false);

    // Host initiates 60s Switch Device and explicitly disconnects (LEAVE)
    const hostCards = [...engine.getState().players[0].cards];
    expect(engine.prepareSwapDevice('host_1').ok).toBe(true);
    expect(engine.getState().players[0].swapDevice).toBe(true);
    expect(engine.getState().players[0].disconnected).toBe(true);
    expect(engine.getState().players[0].reconnectGraceUntil).toBe(clock + 60_000);

    // Explicit LEAVE right after PREPARE_SWAP_DEVICE preserves host's 60s grace and isHost flag
    clock += 200;
    engine.handlePeerDisconnect('host_1', true);
    expect(engine.getState().players[0].isHost).toBe(true);
    expect(engine.getState().players[0].isBot).toBe(false);
    expect(engine.getState().players[0].reconnectGraceUntil).toBe(clock - 200 + 60_000);

    // Host rejoins from phone by name within 60s -> reclaims exact hand & host status
    clock += 20_000;
    const hostRestored = engine.addOrRestorePeer({
      peerId: 'host_phone',
      sessionId: 'sess_host_phone',
      name: 'host',
      transport: 'online',
    });
    expect(hostRestored.ok).toBe(true);
    expect(hostRestored.restored).toBe(true);
    expect(engine.getState().players[0].id).toBe('host_phone');
    expect(engine.getState().players[0].isHost).toBe(true);
    expect(engine.getState().players[0].swapDevice).toBe(false);
    expect(engine.getState().players[0].disconnected).toBe(false);
    expect(engine.getState().players[0].cards).toEqual(hostCards);
  });

  it('supports Double Deck 13-card and 26-card modes via updateRules and completes 26-card round', () => {
    const engine = new CapsaHostEngine({
      code: 'DBL2',
      mode: 'solo',
      hostId: 'p0',
      hostSessionId: 's0',
      hostName: 'Solo',
    });

    // Switch to 2x (13)
    expect(engine.updateRules('p0', { enableDoubleDeck: true, doubleDeck26Cards: false }).ok).toBe(true);
    expect(engine.getState().rules.enableDoubleDeck).toBe(true);
    expect(engine.getState().rules.doubleDeck26Cards).toBe(false);

    // Switch to 2x (26)
    expect(engine.updateRules('p0', { enableDoubleDeck: true, doubleDeck26Cards: true }).ok).toBe(true);
    expect(engine.startGame('p0').ok).toBe(true);

    const started = engine.getState();
    expect(started.players.every((p) => p.cards.length === 26)).toBe(true);
    if (started.diceShowdown) {
      expect(engine.dismissDiceShowdown().ok).toBe(true);
    }

    // Play a few turns to verify 26-card gameplay runs cleanly
    for (let step = 0; step < 12 && engine.getState().gameState === 'playing'; step++) {
      const s = engine.getState();
      const cur = s.players[s.turnIndex];
      const isFirst = !s.firstPlayMade && !s.activePlay;
      const play = getBotPlay(
        cur.cards,
        s.activePlay,
        isFirst,
        { enableBombsSingle: s.rules.enableBombsSingle, enableBombsPair: s.rules.enableBombsPair },
        s.startingCard
      );
      if (play) {
        expect(engine.playCards(cur.id, play.map((x) => x.id)).ok).toBe(true);
      } else {
        expect(engine.passTurn(cur.id).ok).toBe(true);
      }
    }
    expect(engine.getState().firstPlayMade).toBe(true);
  });

  it('toggles AFK bot takeover on and off while keeping player seat and cards intact', () => {
    const engine = new CapsaHostEngine({
      code: 'AFK1',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Johan',
    });
    engine.startGame('host_1');

    expect(engine.getSanitizedState('host_1').players[0].autoPlay).toBe(false);
    expect(engine.toggleAutoPlay('host_1').ok).toBe(true);

    const afkView = engine.getSanitizedState('host_1');
    expect(afkView.players[0].autoPlay).toBe(true);
    expect(afkView.players[0].isBot).toBe(false);
    expect(afkView.players[0].isHost).toBe(true);
    expect(afkView.players[0].cards).toHaveLength(13);

    expect(engine.toggleAutoPlay('host_1').ok).toBe(true);
    expect(engine.getSanitizedState('host_1').players[0].autoPlay).toBe(false);
  });

  it('keeps the match alive when the host disconnects, promotes another human, and lets the host rejoin', () => {
    let clock = 5_000_000;
    const engine = new CapsaHostEngine({
      code: 'HOST',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Alice',
      now: () => clock,
    });
    engine.addOrRestorePeer({ peerId: 'peer_1', sessionId: 'sess_bob', name: 'Bob', transport: 'online' });
    engine.toggleReady('peer_1');
    engine.startGame('host_1');

    const aliceCards = [...engine.getState().players[0].cards];

    // Host drops unexpectedly mid-game
    engine.handlePeerDisconnect('host_1');
    expect(engine.getState().players[0].disconnected).toBe(true);
    expect(engine.getState().players[0].isBot).toBe(false);
    expect(engine.getState().players[0].reconnectGraceUntil).toBe(clock + 15_000);
    // During grace period Alice still retains isHost
    expect(engine.getState().players[0].isHost).toBe(true);

    // After 15s grace expires -> bot covers Alice AND Bob is promoted to table host
    clock += 15_000;
    expect(engine.expireReconnectGrace()).toBe(true);
    expect(engine.getState().players[0].isBot).toBe(true);
    expect(engine.getState().players[0].isHost).toBe(false);
    expect(engine.getState().players[1].isHost).toBe(true);

    // Alice rejoins from another device by name and reclaims her exact cards
    const rejoin = engine.addOrRestorePeer({
      peerId: 'host_phone',
      sessionId: 'sess_alice_phone',
      name: 'alice',
      transport: 'online',
    });
    expect(rejoin.ok).toBe(true);
    expect(rejoin.restored).toBe(true);
    expect(engine.getState().players[0].id).toBe('host_phone');
    expect(engine.getState().players[0].isBot).toBe(false);
    expect(engine.getState().players[0].disconnected).toBe(false);
    expect(engine.getState().players[0].cards).toEqual(aliceCards);
  });

  it('holds lobby seat briefly on involuntary drop and promotes host on explicit leave or grace expiry', () => {
    let clock = 6_000_000;
    const engine = new CapsaHostEngine({
      code: 'LOBY',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Alice',
      now: () => clock,
    });
    engine.addOrRestorePeer({ peerId: 'peer_1', sessionId: 'sess_bob', name: 'Bob', transport: 'online' });

    // Involuntary drop in lobby (e.g. F5 refresh): seat & host preserved during 15s grace
    engine.handlePeerDisconnect('host_1', false);
    expect(engine.getState().players).toHaveLength(2);
    expect(engine.getState().players[0].disconnected).toBe(true);
    expect(engine.getState().players[0].isHost).toBe(true);

    // Reconnect within 5s keeps host status
    clock += 5_000;
    const restored = engine.addOrRestorePeer({
      peerId: 'host_2',
      sessionId: 'sess_host',
      name: 'Alice',
      transport: 'online',
    });
    expect(restored.ok).toBe(true);
    expect(engine.getState().players[0].isHost).toBe(true);
    expect(engine.getState().players[0].disconnected).toBe(false);

    // Explicit leave removes Alice immediately and promotes Bob to host
    engine.handlePeerDisconnect('host_2', true);
    expect(engine.getState().players).toHaveLength(1);
    expect(engine.getState().players[0].name).toBe('Bob');
    expect(engine.getState().players[0].isHost).toBe(true);
    expect(engine.getState().players[0].isReady).toBe(true);
  });

  it('rehydrates state identically across Durable Object hibernation via fromState and silent socket swap', () => {
    let clock = 7_000_000;
    const engine = new CapsaHostEngine({
      code: 'HIBR',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Alice',
      now: () => clock,
    });
    engine.addOrRestorePeer({ peerId: 'peer_1', sessionId: 'sess_bob', name: 'Bob', transport: 'online' });
    engine.toggleReady('peer_1');
    engine.startGame('host_1');

    const serialized = JSON.stringify(engine.getState());
    const rehydrated = CapsaHostEngine.fromState(JSON.parse(serialized), { now: () => clock });
    const deadlineBefore = rehydrated.getState().turnDeadline;
    const activityBefore = rehydrated.getState().activity.length;

    // Silent socket replacement (network handoff before old socket closed)
    clock += 4_000;
    const swap = rehydrated.addOrRestorePeer({
      peerId: 'peer_1_new',
      sessionId: 'sess_bob',
      name: 'Bob',
      transport: 'online',
    });
    expect(swap.ok).toBe(true);
    expect(swap.silentSwap).toBe(true);
    expect(rehydrated.getState().players[1].id).toBe('peer_1_new');
    expect(rehydrated.getState().turnDeadline).toBe(deadlineBefore);
    expect(rehydrated.getState().activity.length).toBe(activityBefore);
  });

  it('auto-deals the next round after 3-5s when the host is AFK and cancels if host resumes or match ends', () => {
    let clock = 8_000_000;
    const engine = new CapsaHostEngine({
      code: 'AUTO',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Alice',
      rules: { pointsToWin: 6 },
      now: () => clock,
    });
    engine.addOrRestorePeer({ peerId: 'peer_1', sessionId: 'sess_bob', name: 'Bob', transport: 'online' });
    engine.toggleReady('peer_1');
    engine.startGame('host_1');

    // Host goes AFK mid-round
    expect(engine.toggleAutoPlay('host_1').ok).toBe(true);
    expect(engine.getState().autoDealAt).toBeNull();

    // Finish Round 1 (pointsToWin=6 -> roundover, not gameover)
    const s1 = engine.getState();
    s1.players[0].cards = [];
    s1.players[0].finishRank = 1;
    s1.players[1].cards = [];
    s1.players[1].finishRank = 2;
    s1.players[2].cards = [c('4', 'D')];
    s1.players[3].cards = [c('5', 'D'), c('6', 'D')];
    s1.turnIndex = 2;
    s1.firstPlayMade = true;
    s1.activePlay = null;
    expect(engine.playCards(s1.players[2].id, ['4_D']).ok).toBe(true);

    expect(engine.getState().gameState).toBe('roundover');
    expect(HOST_AFK_NEXT_ROUND_DELAY_MS).toBeGreaterThanOrEqual(3000);
    expect(HOST_AFK_NEXT_ROUND_DELAY_MS).toBeLessThanOrEqual(5000);
    expect(engine.getState().autoDealAt).toBe(clock + HOST_AFK_NEXT_ROUND_DELAY_MS);
    expect(engine.getSanitizedState('peer_1').autoDealAt).toBe(clock + HOST_AFK_NEXT_ROUND_DELAY_MS);

    // Does not deal early
    clock += HOST_AFK_NEXT_ROUND_DELAY_MS - 500;
    expect(engine.handleAutoNextRound().ok).toBe(false);
    expect(engine.getState().gameState).toBe('roundover');

    // If host resumes control before timer fires, auto-deal cancels
    expect(engine.toggleAutoPlay('host_1').ok).toBe(true);
    expect(engine.getState().autoDealAt).toBeNull();
    clock += 1000;
    expect(engine.handleAutoNextRound().ok).toBe(false);
    expect(engine.getState().gameState).toBe('roundover');

    // If host goes AFK again during roundover, auto-deal reschedules and deals Round 2 when due
    expect(engine.toggleAutoPlay('host_1').ok).toBe(true);
    expect(engine.getState().autoDealAt).toBe(clock + HOST_AFK_NEXT_ROUND_DELAY_MS);
    clock += HOST_AFK_NEXT_ROUND_DELAY_MS;
    expect(engine.handleAutoNextRound().ok).toBe(true);
    expect(engine.getState().gameState).toBe('playing');
    expect(engine.getState().roundNumber).toBe(2);
    expect(engine.getState().autoDealAt).toBeNull();

    // Finish Round 2 so Alice reaches 6 points (gameover) — should NOT auto-deal a rematch
    const s2 = engine.getState();
    s2.players[0].cards = [];
    s2.players[0].finishRank = 1;
    s2.players[1].cards = [];
    s2.players[1].finishRank = 2;
    s2.players[2].cards = [c('7', 'D')];
    s2.players[3].cards = [c('8', 'D'), c('9', 'D')];
    s2.turnIndex = 2;
    s2.firstPlayMade = true;
    s2.activePlay = null;
    expect(engine.playCards(s2.players[2].id, ['7_D']).ok).toBe(true);

    expect(engine.getState().gameState).toBe('gameover');
    expect(engine.getState().autoDealAt).toBeNull();
    clock += 10_000;
    expect(engine.handleAutoNextRound().ok).toBe(false);
  });
});
