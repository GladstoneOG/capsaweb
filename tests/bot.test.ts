import { describe, expect, it } from 'vitest';
import {
  evaluateBotTradeFulfill,
  evaluateBotTradeRequest,
  getBotPlay,
} from '@engine/bot';
import { checkCombination, containsStartingCard, dealCapsaCards } from '@engine/rules';
import type { Card, Rank, Suit } from '@engine/types';

function c(rank: Rank, suit: Suit): Card {
  return { id: `${rank}_${suit}`, rank, suit };
}

describe('Capsa Bot Heuristics & Performance', () => {
  it('always includes the starting card on first play of round', () => {
    const deal = dealCapsaCards({ playerCount: 4, doubleDeck: false });
    const starterHand = deal.hands[deal.startingPlayerIndex];
    const play = getBotPlay(starterHand, null, true, { enableBombsSingle: true, enableBombsPair: true }, deal.startingCard);
    expect(play).not.toBeNull();
    expect(containsStartingCard(play!, deal.startingCard)).toBe(true);
    expect(checkCombination(play!).type).not.toBe('invalid');
  });

  it('evaluates 26-card double-deck hands quickly without combinatoric stall', () => {
    const deal = dealCapsaCards({ playerCount: 4, doubleDeck: true, doubleDeck26Cards: true });
    const start = performance.now();
    const play = getBotPlay(deal.hands[0], null, false);
    const elapsed = performance.now() - start;
    expect(play).not.toBeNull();
    expect(elapsed).toBeLessThan(250);
  });

  it('requests 4th card to complete a Bomber and refuses to break its own Bomber on trade fulfill', () => {
    const handNearBomber = [c('K', 'D'), c('K', 'C'), c('K', 'H'), c('4', 'D'), c('8', 'S')];
    const req = evaluateBotTradeRequest(handNearBomber);
    expect(req).toEqual({ id: 'K_S', rank: 'K', suit: 'S' });

    const handWithBomber = [c('9', 'D'), c('9', 'C'), c('9', 'H'), c('9', 'S'), c('4', 'D')];
    expect(evaluateBotTradeFulfill(handWithBomber, c('9', 'S')).accept).toBe(false);

    const handWithSpare = [c('7', 'D'), c('3', 'D'), c('2', 'S'), c('A', 'H')];
    const res = evaluateBotTradeFulfill(handWithSpare, c('7', 'D'));
    expect(res.accept).toBe(true);
    expect(res.extraCard?.id).toBe('3_D'); // sheds lowest trash card, keeps 2♠ and A♥
  });
});
