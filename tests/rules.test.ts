import { describe, expect, it } from 'vitest';
import { createDeck, createDoubleDeck } from '@engine/cards';
import { canBeat, checkCombination, containsStartingCard, dealCapsaCards } from '@engine/rules';
import type { Card, Rank, Suit } from '@engine/types';

function c(rank: Rank, suit: Suit, deck = 0): Card {
  return { id: deck === 0 ? `${rank}_${suit}` : `${rank}_${suit}_${deck}`, rank, suit };
}

describe('Capsa Banting Combinations & Hierarchy', () => {
  it('classifies single, pair, tris, invalid 4-card, and all 5-card hands', () => {
    expect(checkCombination([c('3', 'D')]).type).toBe('single');
    expect(checkCombination([c('3', 'D'), c('3', 'C')]).type).toBe('pair');
    expect(checkCombination([c('3', 'D'), c('4', 'D')]).type).toBe('invalid');
    expect(checkCombination([c('3', 'D'), c('3', 'C'), c('3', 'H')]).type).toBe('tris');
    expect(checkCombination([c('3', 'D'), c('4', 'D'), c('5', 'D'), c('6', 'D')]).type).toBe('invalid');

    expect(
      checkCombination([c('3', 'D'), c('4', 'C'), c('5', 'H'), c('6', 'S'), c('7', 'D')]).type
    ).toBe('straight');
    expect(
      checkCombination([c('3', 'H'), c('6', 'H'), c('8', 'H'), c('J', 'H'), c('A', 'H')]).type
    ).toBe('flush');
    expect(
      checkCombination([c('3', 'D'), c('3', 'C'), c('3', 'H'), c('2', 'S'), c('2', 'H')]).type
    ).toBe('fullhouse');
    expect(
      checkCombination([c('7', 'D'), c('7', 'C'), c('7', 'H'), c('7', 'S'), c('4', 'D')]).type
    ).toBe('bomber');
    expect(
      checkCombination([c('3', 'D'), c('4', 'D'), c('5', 'D'), c('6', 'D'), c('7', 'D')]).type
    ).toBe('straightflush');
  });

  it('orders straights from A-2-3-4-5 (lowest) through J-Q-K-A-2 (highest)', () => {
    const wheel = checkCombination([c('A', 'S'), c('2', 'S'), c('3', 'D'), c('4', 'C'), c('5', 'H')]);
    const twoToSix = checkCombination([c('2', 'D'), c('3', 'C'), c('4', 'H'), c('5', 'S'), c('6', 'D')]);
    const tenToAce = checkCombination([c('10', 'D'), c('J', 'C'), c('Q', 'H'), c('K', 'S'), c('A', 'D')]);
    const jackToTwo = checkCombination([c('J', 'D'), c('Q', 'C'), c('K', 'H'), c('A', 'S'), c('2', 'D')]);

    expect(wheel.type).toBe('straight');
    expect(twoToSix.type).toBe('straight');
    expect(tenToAce.type).toBe('straight');
    expect(jackToTwo.type).toBe('straight');

    expect(canBeat(twoToSix, wheel)).toBe(true);
    expect(canBeat(wheel, twoToSix)).toBe(false);
    expect(canBeat(tenToAce, twoToSix)).toBe(true);
    expect(canBeat(jackToTwo, tenToAce)).toBe(true);
    expect(canBeat(tenToAce, jackToTwo)).toBe(false);
  });

  it('ranks flushes by suit first (♦ < ♣ < ♥ < ♠), then descending ranks', () => {
    const lowSpades = checkCombination([c('3', 'S'), c('4', 'S'), c('5', 'S'), c('7', 'S'), c('9', 'S')]);
    const highHearts = checkCombination([c('9', 'H'), c('10', 'H'), c('J', 'H'), c('Q', 'H'), c('2', 'H')]);
    const higherSpades = checkCombination([c('3', 'S'), c('4', 'S'), c('5', 'S'), c('7', 'S'), c('10', 'S')]);

    expect(canBeat(lowSpades, highHearts)).toBe(true);
    expect(canBeat(highHearts, lowSpades)).toBe(false);
    expect(canBeat(higherSpades, lowSpades)).toBe(true);
  });

  it('enforces bombing rules on single 2 and pair of 2s', () => {
    const single2S = checkCombination([c('2', 'S')]);
    const pair2s = checkCombination([c('2', 'S'), c('2', 'H')]);
    const bomber = checkCombination([c('3', 'D'), c('3', 'C'), c('3', 'H'), c('3', 'S'), c('4', 'D')]);
    const sf = checkCombination([c('3', 'D'), c('4', 'D'), c('5', 'D'), c('6', 'D'), c('7', 'D')]);

    expect(canBeat(bomber, single2S, { enableBombsSingle: true, enableBombsPair: false })).toBe(true);
    expect(canBeat(bomber, single2S, { enableBombsSingle: false, enableBombsPair: false })).toBe(false);
    expect(canBeat(sf, single2S, { enableBombsSingle: true, enableBombsPair: false })).toBe(true);

    expect(canBeat(bomber, pair2s, { enableBombsSingle: false, enableBombsPair: true })).toBe(true);
    expect(canBeat(bomber, pair2s, { enableBombsSingle: true, enableBombsPair: false })).toBe(false);
    expect(canBeat(sf, pair2s, { enableBombsSingle: false, enableBombsPair: true })).toBe(true);

    // Non-bomb 5-card hand cannot beat single 2
    const fh = checkCombination([c('A', 'D'), c('A', 'C'), c('A', 'H'), c('K', 'S'), c('K', 'H')]);
    expect(canBeat(fh, single2S, { enableBombsSingle: true, enableBombsPair: true })).toBe(false);
  });

  it('resolves double-deck identical rank tiebreakers properly', () => {
    const pairHigh = checkCombination([c('A', 'S', 0), c('A', 'H', 0)]);
    const pairLow = checkCombination([c('A', 'S', 1), c('A', 'D', 0)]);
    expect(canBeat(pairHigh, pairLow)).toBe(true);
    expect(canBeat(pairLow, pairHigh)).toBe(false);

    const fhHigh = checkCombination([c('K', 'S', 0), c('K', 'H', 0), c('K', 'C', 0), c('4', 'D'), c('4', 'C')]);
    const fhLow = checkCombination([c('K', 'S', 1), c('K', 'H', 1), c('K', 'D', 0), c('A', 'S'), c('A', 'H')]);
    expect(canBeat(fhHigh, fhLow)).toBe(true);
  });

  it('handles deck sizes and dealing variants including 26-card Dice Duel', () => {
    expect(createDeck().length).toBe(52);
    expect(createDoubleDeck().length).toBe(104);

    const std = dealCapsaCards({ playerCount: 4, doubleDeck: false });
    expect(std.hands).toHaveLength(4);
    expect(std.hands.every((h) => h.length === 13)).toBe(true);
    expect(containsStartingCard(std.hands[std.startingPlayerIndex], std.startingCard)).toBe(true);

    const dbl13 = dealCapsaCards({ playerCount: 4, doubleDeck: true, doubleDeck26Cards: false });
    expect(dbl13.hands.every((h) => h.length === 13)).toBe(true);
    const holdersOfStart = dbl13.hands.filter((h) => containsStartingCard(h, dbl13.startingCard));
    expect(holdersOfStart.length).toBe(1);

    // Verify 26-card deal splits all 104 cards
    const dbl26 = dealCapsaCards({ playerCount: 4, doubleDeck: true, doubleDeck26Cards: true });
    expect(dbl26.hands.every((h) => h.length === 26)).toBe(true);
    expect(containsStartingCard(dbl26.hands[dbl26.startingPlayerIndex], dbl26.startingCard)).toBe(true);
  });
});
