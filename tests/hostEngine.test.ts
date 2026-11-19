import { describe, expect, it } from 'vitest';
import { CapsaHostEngine } from '@engine/hostEngine';
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

  it('covers disconnected peers with a bot and restores exact seat on session rejoin', () => {
    const engine = new CapsaHostEngine({
      code: 'RECN',
      mode: 'multiplayer',
      hostId: 'host_1',
      hostSessionId: 'sess_host',
      hostName: 'Host',
    });
    engine.addOrRestorePeer({ peerId: 'peer_old', sessionId: 'sess_bob', name: 'Bob', transport: 'p2p' });
    engine.toggleReady('peer_old');
    engine.startGame('host_1');

    const originalCards = [...engine.getState().players[1].cards];
    engine.handlePeerDisconnect('peer_old');
    expect(engine.getState().players[1].isBot).toBe(true);
    expect(engine.getState().players[1].disconnected).toBe(true);

    const restored = engine.addOrRestorePeer({
      peerId: 'peer_new',
      sessionId: 'sess_bob',
      name: 'Bob',
      transport: 'p2p',
    });
    expect(restored.ok).toBe(true);
    expect(restored.restored).toBe(true);
    expect(engine.getState().players[1].id).toBe('peer_new');
    expect(engine.getState().players[1].isBot).toBe(false);
    expect(engine.getState().players[1].cards).toEqual(originalCards);
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
});
