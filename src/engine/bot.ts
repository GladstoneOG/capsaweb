import { COMBO_VALUE, RANK_ORDER, SUIT_ORDER, sortCards } from './cards';
import {
  VALID_STRAIGHTS,
  canBeat,
  checkCombination,
  containsStartingCard,
  getBomberParts,
  getFullHouseParts,
} from './rules';
import type { BombRules } from './rules';
import type { Card, Combination, Rank, Suit } from './types';

function getCombinations<T>(array: T[], k: number): T[][] {
  const result: T[][] = [];
  function helper(start: number, combo: T[]) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < array.length; i++) {
      combo.push(array[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return result;
}

function findCombinationsOfSize(hand: Card[], size: 2 | 3): Card[][] {
  const groups: Partial<Record<Rank, Card[]>> = {};
  for (const c of hand) {
    if (!groups[c.rank]) groups[c.rank] = [];
    groups[c.rank]!.push(c);
  }
  const results: Card[][] = [];
  for (const rank of Object.keys(groups) as Rank[]) {
    const list = groups[rank]!;
    if (list.length >= size) {
      results.push(...getCombinations(list, size));
    }
  }
  return results;
}

export function findFiveCardHands(hand: Card[]): Card[][] {
  const results: Card[][] = [];
  const seen = new Set<string>();

  const addIfValid = (combo: Card[]) => {
    const sorted = sortCards(combo, 'rank');
    const key = sorted.map((c) => c.id).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const validated = checkCombination(sorted);
    if (validated.type !== 'invalid') {
      results.push(validated.cards);
    }
  };

  const byRank: Partial<Record<Rank, Card[]>> = {};
  const bySuit: Record<Suit, Card[]> = { D: [], C: [], H: [], S: [] };

  for (const c of hand) {
    if (!byRank[c.rank]) byRank[c.rank] = [];
    byRank[c.rank]!.push(c);
    bySuit[c.suit].push(c);
  }

  // 1. Straights & Straight Flushes
  for (const seq of VALID_STRAIGHTS) {
    if (seq.every((r) => byRank[r] && byRank[r]!.length > 0)) {
      const [c0, c1, c2, c3, c4] = seq.map((r) => byRank[r]!);
      for (const a of c0) {
        for (const b of c1) {
          for (const c of c2) {
            for (const d of c3) {
              for (const e of c4) {
                addIfValid([a, b, c, d, e]);
              }
            }
          }
        }
      }
    }
  }

  // 2. Flushes
  for (const suit of ['D', 'C', 'H', 'S'] as Suit[]) {
    const list = bySuit[suit];
    if (list.length >= 5) {
      for (const comb of getCombinations(list, 5)) {
        addIfValid(comb);
      }
    }
  }

  // 3. Full Houses
  const triplets: { rank: Rank; cards: Card[] }[] = [];
  const pairs: { rank: Rank; cards: Card[] }[] = [];
  for (const rank of Object.keys(byRank) as Rank[]) {
    const cards = byRank[rank]!;
    if (cards.length >= 3) {
      for (const comb of getCombinations(cards, 3)) {
        triplets.push({ rank, cards: comb });
      }
    }
    if (cards.length >= 2) {
      for (const comb of getCombinations(cards, 2)) {
        pairs.push({ rank, cards: comb });
      }
    }
  }
  for (const trip of triplets) {
    for (const pr of pairs) {
      if (trip.rank !== pr.rank) {
        addIfValid([...trip.cards, ...pr.cards]);
      }
    }
  }

  // 4. Bombers (4-of-a-kind + 1 kicker)
  for (const rank of Object.keys(byRank) as Rank[]) {
    const cards = byRank[rank]!;
    if (cards.length >= 4) {
      for (const quad of getCombinations(cards, 4)) {
        const quadIds = new Set(quad.map((c) => c.id));
        for (const kicker of hand) {
          if (!quadIds.has(kicker.id)) {
            addIfValid([...quad, kicker]);
          }
        }
      }
    }
  }

  return results;
}

export function getValidPlays(
  hand: Card[],
  prevPlay: Combination | null,
  isFirstPlay: boolean,
  rules: BombRules = { enableBombsSingle: true, enableBombsPair: true },
  startingCard?: Card | null
): Card[][] {
  const validPlays: Card[][] = [];

  const filterFirstPlay = (plays: Card[][]) => {
    if (!isFirstPlay) return plays;
    return plays.filter((play) => containsStartingCard(play, startingCard));
  };

  if (!prevPlay) {
    for (const c of hand) validPlays.push([c]);
    validPlays.push(...findCombinationsOfSize(hand, 2));
    validPlays.push(...findCombinationsOfSize(hand, 3));
    validPlays.push(...findFiveCardHands(hand));
    return filterFirstPlay(validPlays);
  }

  const targetSize = prevPlay.cards.length;

  if (targetSize === 1) {
    for (const c of hand) {
      const play = [c];
      if (canBeat(checkCombination(play), prevPlay, rules)) {
        validPlays.push(play);
      }
    }
    if (rules.enableBombsSingle && prevPlay.cards[0].rank === '2') {
      const bombs = findFiveCardHands(hand).filter((b) => {
        const t = checkCombination(b).type;
        return t === 'bomber' || t === 'straightflush';
      });
      validPlays.push(...bombs);
    }
  } else if (targetSize === 2) {
    for (const p of findCombinationsOfSize(hand, 2)) {
      if (canBeat(checkCombination(p), prevPlay, rules)) {
        validPlays.push(p);
      }
    }
    if (rules.enableBombsPair && prevPlay.cards[0].rank === '2') {
      const bombs = findFiveCardHands(hand).filter((b) => {
        const t = checkCombination(b).type;
        return t === 'bomber' || t === 'straightflush';
      });
      validPlays.push(...bombs);
    }
  } else if (targetSize === 3) {
    for (const t of findCombinationsOfSize(hand, 3)) {
      if (canBeat(checkCombination(t), prevPlay, rules)) {
        validPlays.push(t);
      }
    }
  } else if (targetSize === 5) {
    for (const f of findFiveCardHands(hand)) {
      if (canBeat(checkCombination(f), prevPlay, rules)) {
        validPlays.push(f);
      }
    }
  }

  return filterFirstPlay(validPlays);
}

export function ratePlay(cards: Card[]): number {
  const combo = checkCombination(cards);
  if (combo.type === 'single') {
    return RANK_ORDER[combo.cards[0].rank] * 10 + SUIT_ORDER[combo.cards[0].suit];
  }
  if (combo.type === 'pair') {
    const high = sortCards(combo.cards, 'rank')[1];
    return 200 + RANK_ORDER[high.rank] * 10 + SUIT_ORDER[high.suit];
  }
  if (combo.type === 'tris') {
    const high = sortCards(combo.cards, 'rank')[2];
    return 400 + RANK_ORDER[high.rank] * 10 + SUIT_ORDER[high.suit];
  }
  if (combo.type !== 'invalid') {
    const typeVal = COMBO_VALUE[combo.type];
    let highCard = combo.cards[4];
    if (combo.type === 'fullhouse') {
      const parts = getFullHouseParts(combo.cards);
      highCard = sortCards(parts.triple, 'rank')[2];
    } else if (combo.type === 'bomber') {
      const parts = getBomberParts(combo.cards);
      highCard = sortCards(parts.quad, 'rank')[3];
    }
    return 600 + typeVal * 100 + RANK_ORDER[highCard.rank] * 10 + SUIT_ORDER[highCard.suit];
  }
  return 9999;
}

export function getSortedEligiblePlays(
  hand: Card[],
  prevPlay: Combination | null,
  isFirstPlay: boolean,
  rules: BombRules = { enableBombsSingle: true, enableBombsPair: true },
  startingCard?: Card | null
): Card[][] {
  const validPlays = getValidPlays(hand, prevPlay, isFirstPlay, rules, startingCard);
  if (validPlays.length === 0) return [];

  const uniqueMap = new Map<string, Card[]>();
  for (const play of validPlays) {
    const sorted = sortCards(play, 'rank');
    const key = sorted.map((c) => c.id).join(',');
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, sorted);
    }
  }

  const ratedPlays = Array.from(uniqueMap.values()).map((play) => ({
    play,
    rating: ratePlay(play),
    length: play.length,
  }));

  if (!prevPlay) {
    ratedPlays.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return a.rating - b.rating;
    });
  } else {
    ratedPlays.sort((a, b) => a.rating - b.rating);
  }

  return ratedPlays.map((r) => r.play);
}

export function getBotPlay(
  hand: Card[],
  prevPlay: Combination | null,
  isFirstPlay: boolean,
  rules: BombRules = { enableBombsSingle: true, enableBombsPair: true },
  startingCard?: Card | null
): Card[] | null {
  const eligible = getSortedEligiblePlays(hand, prevPlay, isFirstPlay, rules, startingCard);
  return eligible.length > 0 ? eligible[0] : null;
}

export function evaluateBotTradeRequest(hand: Card[]): Card | null {
  const rankCounts: Partial<Record<Rank, Card[]>> = {};
  for (const c of hand) {
    if (!rankCounts[c.rank]) rankCounts[c.rank] = [];
    rankCounts[c.rank]!.push(c);
  }

  // 1. 3-of-a-kind -> complete Bomber
  for (const r of ['2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'] as Rank[]) {
    const group = rankCounts[r] || [];
    if (group.length === 3) {
      const heldSuits = group.map((c) => c.suit);
      const missingSuit = (['S', 'H', 'C', 'D'] as Suit[]).find((s) => !heldSuits.includes(s));
      if (missingSuit) {
        return { id: `${r}_${missingSuit}`, rank: r, suit: missingSuit };
      }
    }
  }

  // 2. 4-to-a-straight-flush
  const suitGroups: Record<Suit, Card[]> = { D: [], C: [], H: [], S: [] };
  for (const c of hand) suitGroups[c.suit].push(c);

  for (const suit of ['S', 'H', 'C', 'D'] as Suit[]) {
    const list = suitGroups[suit];
    if (list.length >= 4) {
      for (const straightRanks of VALID_STRAIGHTS) {
        const matches = straightRanks.filter((sr) => list.some((c) => c.rank === sr));
        if (matches.length === 4) {
          const missingRank = straightRanks.find((sr) => !list.some((c) => c.rank === sr));
          if (missingRank) {
            return { id: `${missingRank}_${suit}`, rank: missingRank, suit };
          }
        }
      }
    }
  }

  // 3. 4-to-a-straight (only if no 5-card hand yet)
  const uniqueRanks = Array.from(new Set(hand.map((c) => c.rank)));
  if (findFiveCardHands(hand).length === 0) {
    for (const straightRanks of VALID_STRAIGHTS) {
      const matches = straightRanks.filter((sr) => uniqueRanks.includes(sr));
      if (matches.length === 4) {
        const missingRank = straightRanks.find((sr) => !uniqueRanks.includes(sr));
        if (missingRank) {
          return { id: `${missingRank}_S`, rank: missingRank, suit: 'S' };
        }
      }
    }
  }

  // 4. Seek 2♠ if strong high cards
  const has2S = hand.some((c) => c.rank === '2' && c.suit === 'S');
  const countOf2s = hand.filter((c) => c.rank === '2').length;
  if (!has2S && countOf2s <= 1) {
    const highCardsCount = hand.filter((c) => c.rank === 'A' || c.rank === 'K').length;
    if (highCardsCount >= 2) {
      return { id: '2_S', rank: '2', suit: 'S' };
    }
  }

  return null;
}

export function evaluateBotTradeFulfill(
  hand: Card[],
  requestedCard: Pick<Card, 'rank' | 'suit'>
): { accept: boolean; extraCard?: Card } {
  const matchedCard = hand.find(
    (c) => c.rank === requestedCard.rank && c.suit === requestedCard.suit
  );
  if (!matchedCard) return { accept: false };

  // 1. Never break a Bomber
  const sameRankCount = hand.filter((c) => c.rank === matchedCard.rank).length;
  if (sameRankCount >= 4) return { accept: false };

  // 2. Never break a Straight Flush
  const fiveCombos = findFiveCardHands(hand);
  const inStraightFlush = fiveCombos.some((combo) => {
    const evaluated = checkCombination(combo);
    return evaluated.type === 'straightflush' && combo.some((c) => c.id === matchedCard.id);
  });
  if (inStraightFlush) return { accept: false };

  // 3. Keep isolated 2♠
  if (matchedCard.rank === '2' && matchedCard.suit === 'S') {
    const total2s = hand.filter((c) => c.rank === '2').length;
    if (total2s <= 1) return { accept: false };
  }

  // 4. Avoid breaking triple in Full House / Bomber
  const inBomberOrFH = fiveCombos.some((combo) => {
    const evaluated = checkCombination(combo);
    return (
      (evaluated.type === 'bomber' || evaluated.type === 'fullhouse') &&
      combo.some((c) => c.id === matchedCard.id)
    );
  });
  if (inBomberOrFH && sameRankCount >= 3) return { accept: false };

  // Pick worst unwanted card to attach as extra card
  const candidates = hand.filter((c) => c.id !== matchedCard.id);
  if (candidates.length === 0) return { accept: false };

  const scoredCandidates = candidates.map((c) => {
    let trashScore = 100 - (RANK_ORDER[c.rank] * 4 + SUIT_ORDER[c.suit]);
    if (c.rank === '2') trashScore -= 1000;
    if (c.rank === 'A') trashScore -= 500;

    const countInCandidates = candidates.filter((o) => o.rank === c.rank).length;
    if (countInCandidates === 1) trashScore += 50;
    else if (countInCandidates >= 2) trashScore -= 40;

    if (fiveCombos.some((f) => f.some((fc) => fc.id === c.id))) {
      trashScore -= 80;
    }
    return { card: c, trashScore };
  });

  scoredCandidates.sort((a, b) => b.trashScore - a.trashScore);
  return { accept: true, extraCard: scoredCandidates[0].card };
}
