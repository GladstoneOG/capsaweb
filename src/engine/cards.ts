import type { Card, ComboType, Rank, Suit } from './types';

export const SUITS: Suit[] = ['D', 'C', 'H', 'S'];
export const RANKS: Rank[] = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

export const SUIT_ORDER: Record<Suit, number> = {
  D: 0, // Diamond (Lowest)
  C: 1, // Club
  H: 2, // Heart
  S: 3, // Spade (Highest)
};

export const SUIT_SYMBOLS: Record<Suit, string> = {
  D: '♦',
  C: '♣',
  H: '♥',
  S: '♠',
};

export const RANK_ORDER: Record<Rank, number> = {
  '3': 0,
  '4': 1,
  '5': 2,
  '6': 3,
  '7': 4,
  '8': 5,
  '9': 6,
  '10': 7,
  J: 8,
  Q: 9,
  K: 10,
  A: 11,
  '2': 12,
};

export const COMBO_VALUE: Record<ComboType, number> = {
  invalid: 0,
  single: 1,
  pair: 2,
  tris: 3,
  straight: 4,
  flush: 5,
  fullhouse: 6,
  bomber: 7,
  straightflush: 8,
};

export const COMBO_LABELS: Record<ComboType, string> = {
  invalid: 'Invalid',
  single: 'Single',
  pair: 'Pair',
  tris: 'Tris',
  straight: 'Straight',
  flush: 'Flush',
  fullhouse: 'Full House',
  bomber: 'Bomber',
  straightflush: 'Straight Flush',
};

export function cardToString(card: Pick<Card, 'rank' | 'suit'>): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function describeCards(cards: Card[]): string {
  return cards.map(cardToString).join(' ');
}

export function compareCards(a: Pick<Card, 'rank' | 'suit'>, b: Pick<Card, 'rank' | 'suit'>): number {
  const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  if (rankDiff !== 0) return rankDiff;
  return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
}

export function sortCards(cards: Card[], method: 'rank' | 'suit' = 'rank'): Card[] {
  return [...cards].sort((a, b) => {
    if (method === 'rank') {
      const diff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
      if (diff !== 0) return diff;
      const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
      if (suitDiff !== 0) return suitDiff;
      return a.id.localeCompare(b.id);
    }
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (suitDiff !== 0) return suitDiff;
    const rankDiff = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    if (rankDiff !== 0) return rankDiff;
    return a.id.localeCompare(b.id);
  });
}

export function createDeck(deckIndex = 0): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push({
        id: deckIndex === 0 ? `${rank}_${suit}` : `${rank}_${suit}_${deckIndex}`,
        rank,
        suit,
      });
    }
  }
  return deck;
}

export function createDoubleDeck(): Card[] {
  return [...createDeck(0), ...createDeck(1)];
}

export function defaultRng(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] / 0x100000000;
  }
  return Math.random();
}

export function shuffleDeck(deck: Card[], rng: () => number = defaultRng): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
