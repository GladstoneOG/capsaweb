import {
  COMBO_VALUE,
  RANK_ORDER,
  SUIT_ORDER,
  compareCards,
  createDeck,
  createDoubleDeck,
  defaultRng,
  shuffleDeck,
  sortCards,
} from './cards';
import type { Card, CapsaRules, Combination, DiceShowdown, Rank } from './types';

export const VALID_STRAIGHTS: Rank[][] = [
  ['A', '2', '3', '4', '5'],
  ['2', '3', '4', '5', '6'],
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],
  ['J', 'Q', 'K', 'A', '2'],
];

export function getConsecutiveStraight(cards: Card[]): Card[] | null {
  if (cards.length !== 5) return null;
  const cardRanks = cards.map((c) => c.rank);
  for (const seq of VALID_STRAIGHTS) {
    const isMatch = seq.every((r) => cardRanks.includes(r));
    if (isMatch) {
      return seq.map((r) => cards.find((c) => c.rank === r)!);
    }
  }
  return null;
}

function isFlush(sorted: Card[]): boolean {
  const suit = sorted[0].suit;
  return sorted.every((c) => c.suit === suit);
}

function isFullHouse(sorted: Card[]): boolean {
  const [r0, r1, r2, r3, r4] = sorted.map((c) => c.rank);
  if (r0 === r1 && r1 === r2 && r3 === r4 && r2 !== r3) return true;
  if (r0 === r1 && r2 === r3 && r3 === r4 && r1 !== r2) return true;
  return false;
}

function isBomber(sorted: Card[]): boolean {
  const [r0, r1, r2, r3, r4] = sorted.map((c) => c.rank);
  if (r0 === r1 && r1 === r2 && r2 === r3 && r3 !== r4) return true;
  if (r1 === r2 && r2 === r3 && r3 === r4 && r0 !== r1) return true;
  // In double deck, 5 cards of identical rank can occur — treat 4+1 kicker strictly
  // (original capsa.js/gameLogic.ts accepted r0===r1===r2===r3 even if r4 matched)
  if (r0 === r1 && r1 === r2 && r2 === r3) return true;
  return false;
}

export function getFullHouseParts(cards: Card[]): { triple: Card[]; pair: Card[] } {
  const sorted = sortCards(cards, 'rank');
  const tripleRank = sorted[2].rank;
  const triple = sorted.filter((c) => c.rank === tripleRank);
  const pair = sorted.filter((c) => c.rank !== tripleRank);
  return { triple, pair };
}

export function getBomberParts(cards: Card[]): { quad: Card[]; kicker: Card | undefined } {
  const sorted = sortCards(cards, 'rank');
  const quadRank = sorted[2].rank;
  const matching = sorted.filter((c) => c.rank === quadRank);
  const quad = matching.slice(0, 4);
  const quadIds = new Set(quad.map((c) => c.id));
  const kicker = sorted.find((c) => !quadIds.has(c.id));
  return { quad, kicker };
}

export function checkCombination(cards: Card[]): Combination {
  const sorted = sortCards(cards, 'rank');
  const count = sorted.length;

  if (count === 1) {
    return { type: 'single', cards: sorted };
  }

  if (count === 2) {
    if (sorted[0].rank === sorted[1].rank) {
      return { type: 'pair', cards: sorted };
    }
    return { type: 'invalid', cards };
  }

  if (count === 3) {
    if (sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank) {
      return { type: 'tris', cards: sorted };
    }
    return { type: 'invalid', cards };
  }

  if (count === 5) {
    const consecutiveS = getConsecutiveStraight(sorted);
    const isS = consecutiveS !== null;
    const isF = isFlush(sorted);

    if (isS && isF) {
      return { type: 'straightflush', cards: consecutiveS };
    }
    if (isBomber(sorted)) {
      return { type: 'bomber', cards: sorted };
    }
    if (isFullHouse(sorted)) {
      return { type: 'fullhouse', cards: sorted };
    }
    if (isF) {
      return { type: 'flush', cards: sorted };
    }
    if (isS) {
      return { type: 'straight', cards: consecutiveS };
    }
  }

  return { type: 'invalid', cards };
}

function compareSameFiveCard(a: Combination, b: Combination): number {
  const type = a.type;

  if (type === 'straight' || type === 'straightflush') {
    const highDiff = compareCards(a.cards[4], b.cards[4]);
    if (highDiff !== 0) return highDiff;

    for (let i = 3; i >= 0; i--) {
      const cardDiff = compareCards(a.cards[i], b.cards[i]);
      if (cardDiff !== 0) return cardDiff;
    }
    return 0;
  }

  if (type === 'flush') {
    // Capsa Banting rule: Flushes rank by suit first (♦ < ♣ < ♥ < ♠), then highest rank descending
    const suitA = a.cards[0].suit;
    const suitB = b.cards[0].suit;
    if (suitA !== suitB) {
      return SUIT_ORDER[suitA] - SUIT_ORDER[suitB];
    }
    for (let i = 4; i >= 0; i--) {
      const diff = compareCards(a.cards[i], b.cards[i]);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  if (type === 'fullhouse') {
    const partsA = getFullHouseParts(a.cards);
    const partsB = getFullHouseParts(b.cards);

    const rankDiff = RANK_ORDER[partsA.triple[0].rank] - RANK_ORDER[partsB.triple[0].rank];
    if (rankDiff !== 0) return rankDiff;

    const tripleA = sortCards(partsA.triple, 'rank');
    const tripleB = sortCards(partsB.triple, 'rank');
    for (let i = 2; i >= 0; i--) {
      const cardDiff = compareCards(tripleA[i], tripleB[i]);
      if (cardDiff !== 0) return cardDiff;
    }

    const pairRankDiff = RANK_ORDER[partsA.pair[0].rank] - RANK_ORDER[partsB.pair[0].rank];
    if (pairRankDiff !== 0) return pairRankDiff;

    const pairA = sortCards(partsA.pair, 'rank');
    const pairB = sortCards(partsB.pair, 'rank');
    for (let i = 1; i >= 0; i--) {
      const cardDiff = compareCards(pairA[i], pairB[i]);
      if (cardDiff !== 0) return cardDiff;
    }

    return 0;
  }

  if (type === 'bomber') {
    const partsA = getBomberParts(a.cards);
    const partsB = getBomberParts(b.cards);

    const rankDiff = RANK_ORDER[partsA.quad[0].rank] - RANK_ORDER[partsB.quad[0].rank];
    if (rankDiff !== 0) return rankDiff;

    const quadA = sortCards(partsA.quad, 'rank');
    const quadB = sortCards(partsB.quad, 'rank');
    for (let i = 3; i >= 0; i--) {
      const cardDiff = compareCards(quadA[i], quadB[i]);
      if (cardDiff !== 0) return cardDiff;
    }

    if (partsA.kicker && partsB.kicker) {
      return compareCards(partsA.kicker, partsB.kicker);
    }

    return 0;
  }

  return 0;
}

export type BombRules = Pick<CapsaRules, 'enableBombsSingle' | 'enableBombsPair'>;

export function canBeat(
  nextPlay: Combination,
  prevPlay: Combination | null,
  rules: BombRules = { enableBombsSingle: true, enableBombsPair: true }
): boolean {
  if (nextPlay.type === 'invalid') return false;
  if (!prevPlay) return true;

  const nextVal = COMBO_VALUE[nextPlay.type];
  const prevVal = COMBO_VALUE[prevPlay.type];

  // Special Bombing / Slamming rules on 2s
  if (rules.enableBombsSingle && prevPlay.type === 'single' && prevPlay.cards[0].rank === '2') {
    if (nextPlay.type === 'bomber' || nextPlay.type === 'straightflush') {
      return true;
    }
  }

  if (rules.enableBombsPair && prevPlay.type === 'pair' && prevPlay.cards[0].rank === '2') {
    if (nextPlay.type === 'bomber' || nextPlay.type === 'straightflush') {
      return true;
    }
  }

  if (prevVal <= 3) {
    if (nextPlay.type !== prevPlay.type) return false;

    if (nextPlay.type === 'single') {
      return compareCards(nextPlay.cards[0], prevPlay.cards[0]) > 0;
    }

    if (nextPlay.type === 'pair') {
      const sortedNext = sortCards(nextPlay.cards, 'rank');
      const sortedPrev = sortCards(prevPlay.cards, 'rank');
      const rankDiff = RANK_ORDER[sortedNext[1].rank] - RANK_ORDER[sortedPrev[1].rank];
      if (rankDiff !== 0) return rankDiff > 0;
      for (let i = 1; i >= 0; i--) {
        const diff = compareCards(sortedNext[i], sortedPrev[i]);
        if (diff !== 0) return diff > 0;
      }
      return false;
    }

    if (nextPlay.type === 'tris') {
      const rankDiff = RANK_ORDER[nextPlay.cards[0].rank] - RANK_ORDER[prevPlay.cards[0].rank];
      if (rankDiff !== 0) return rankDiff > 0;
      const sortedNext = sortCards(nextPlay.cards, 'rank');
      const sortedPrev = sortCards(prevPlay.cards, 'rank');
      for (let i = 2; i >= 0; i--) {
        const diff = compareCards(sortedNext[i], sortedPrev[i]);
        if (diff !== 0) return diff > 0;
      }
      return false;
    }
  }

  if (prevVal >= 4 && prevVal <= 8) {
    if (nextVal < 4 || nextVal > 8) return false;
    if (nextVal > prevVal) return true;
    if (nextVal === prevVal) {
      return compareSameFiveCard(nextPlay, prevPlay) > 0;
    }
  }

  return false;
}

export function contains3Diamonds(cards: Card[]): boolean {
  return cards.some((c) => c.rank === '3' && c.suit === 'D');
}

export function containsStartingCard(cards: Card[], startingCard?: Card | null): boolean {
  if (!startingCard) return contains3Diamonds(cards);
  return cards.some((c) => c.rank === startingCard.rank && c.suit === startingCard.suit);
}

export interface DealResult {
  hands: Card[][];
  startingPlayerIndex: number;
  startingCard: Card;
  reshuffleCount: number;
  diceShowdown: DiceShowdown | null;
}

export function dealCapsaCards(options: {
  playerCount?: number;
  doubleDeck?: boolean;
  doubleDeck26Cards?: boolean;
  playerNames?: string[];
  playerIds?: string[];
  rng?: () => number;
}): DealResult {
  const {
    playerCount = 4,
    doubleDeck = false,
    doubleDeck26Cards = false,
    playerNames = ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
    playerIds = ['0', '1', '2', '3'],
    rng = defaultRng,
  } = options;

  // Standard 52-card deck: 13 cards each, 3♦ starts
  if (!doubleDeck) {
    const deck = shuffleDeck(createDeck(0), rng);
    const hands: Card[][] = Array.from({ length: playerCount }, () => []);
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < playerCount; p++) {
        hands[p].push(deck[i * playerCount + p]);
      }
    }
    const sortedHands = hands.map((h) => sortCards(h, 'rank'));
    let startIdx = 0;
    sortedHands.forEach((hand, idx) => {
      if (contains3Diamonds(hand)) startIdx = idx;
    });
    return {
      hands: sortedHands,
      startingPlayerIndex: startIdx,
      startingCard: { id: '3_D', rank: '3', suit: 'D' },
      reshuffleCount: 0,
      diceShowdown: null,
    };
  }

  // Double deck 26 cards each (all 104 cards dealt); Dice Duel if 2 players hold 3♦
  if (doubleDeck26Cards) {
    const fullDeck = createDoubleDeck();
    const shuffled = shuffleDeck(fullDeck, rng);
    const hands: Card[][] = Array.from({ length: playerCount }, () => []);
    for (let i = 0; i < 26; i++) {
      for (let p = 0; p < playerCount; p++) {
        const card = shuffled[i * playerCount + p];
        if (card) hands[p].push(card);
      }
    }
    const sortedHands = hands.map((h) => sortCards(h, 'rank'));

    const playersWith3D: number[] = [];
    sortedHands.forEach((hand, idx) => {
      if (contains3Diamonds(hand)) playersWith3D.push(idx);
    });

    let startIdx = 0;
    let diceShowdown: DiceShowdown | null = null;

    if (playersWith3D.length === 1) {
      startIdx = playersWith3D[0];
    } else if (playersWith3D.length >= 2) {
      const idxA = playersWith3D[0];
      const idxB = playersWith3D[1];
      const rollsHistory: { rollA: number; rollB: number }[] = [];
      let rollA = 0;
      let rollB = 0;
      do {
        rollA = Math.floor(rng() * 6) + 1;
        rollB = Math.floor(rng() * 6) + 1;
        rollsHistory.push({ rollA, rollB });
      } while (rollA === rollB);

      const winnerIdx = rollA > rollB ? idxA : idxB;
      startIdx = winnerIdx;

      diceShowdown = {
        playerA: {
          id: playerIds[idxA] ?? String(idxA),
          name: playerNames[idxA] ?? `Player ${idxA + 1}`,
          roll: rollA,
        },
        playerB: {
          id: playerIds[idxB] ?? String(idxB),
          name: playerNames[idxB] ?? `Player ${idxB + 1}`,
          roll: rollB,
        },
        winnerId: playerIds[winnerIdx] ?? String(winnerIdx),
        winnerName: playerNames[winnerIdx] ?? `Player ${winnerIdx + 1}`,
        reason: 'Both players hold 3♦! Dice Duel decides who starts.',
        rollsHistory,
      };
    }

    return {
      hands: sortedHands,
      startingPlayerIndex: startIdx,
      startingCard: { id: '3_D', rank: '3', suit: 'D' },
      reshuffleCount: 0,
      diceShowdown,
    };
  }

  // Double deck 13 cards each: lowest uniquely held card starts; reshuffle on duplicate lowest card
  const fullDeck = createDoubleDeck();
  let reshuffleCount = 0;
  const maxAttempts = 200;

  while (reshuffleCount < maxAttempts) {
    const shuffled = shuffleDeck(fullDeck, rng);
    const hands: Card[][] = Array.from({ length: playerCount }, () => []);
    for (let i = 0; i < 13; i++) {
      for (let p = 0; p < playerCount; p++) {
        hands[p].push(shuffled[i * playerCount + p]);
      }
    }
    const sortedHands = hands.map((h) => sortCards(h, 'rank'));
    const allDealt = sortedHands.flat();
    let minCard = allDealt[0];
    for (let i = 1; i < allDealt.length; i++) {
      if (compareCards(allDealt[i], minCard) < 0) {
        minCard = allDealt[i];
      }
    }

    const playersWithMin: number[] = [];
    sortedHands.forEach((hand, idx) => {
      if (hand.some((c) => c.rank === minCard.rank && c.suit === minCard.suit)) {
        playersWithMin.push(idx);
      }
    });

    if (playersWithMin.length === 1) {
      return {
        hands: sortedHands,
        startingPlayerIndex: playersWithMin[0],
        startingCard: minCard,
        reshuffleCount,
        diceShowdown: null,
      };
    }

    reshuffleCount++;
  }

  // Defensive fallback (virtually unreachable)
  const fallbackDeck = shuffleDeck(fullDeck, rng);
  const fallbackHands: Card[][] = Array.from({ length: playerCount }, (_, p) =>
    sortCards(fallbackDeck.slice(p * 13, (p + 1) * 13), 'rank')
  );
  return {
    hands: fallbackHands,
    startingPlayerIndex: 0,
    startingCard: fallbackHands[0][0],
    reshuffleCount,
    diceShowdown: null,
  };
}
