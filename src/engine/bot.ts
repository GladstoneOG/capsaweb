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

function comboKey5(i0: number, i1: number, i2: number, i3: number, i4: number): number {
  // Fast 5-element sorting network for indices 0..31 -> packed 25-bit integer key (zero allocations)
  let a = i0, b = i1, c = i2, d = i3, e = i4, t = 0;
  if (a > b) { t = a; a = b; b = t; }
  if (d > e) { t = d; d = e; e = t; }
  if (c > e) { t = c; c = e; e = t; }
  if (c > d) { t = c; c = d; d = t; }
  if (a > d) { t = a; a = d; d = t; }
  if (a > c) { t = a; a = c; c = t; }
  if (b > e) { t = b; b = e; e = t; }
  if (b > d) { t = b; b = d; d = t; }
  if (b > c) { t = b; b = c; c = t; }
  return (a << 20) | (b << 15) | (c << 10) | (d << 5) | e;
}

function findFiveCardCombos(hand: Card[], bombsOnly = false): Combination[] {
  if (hand.length < 5) return [];
  const sortedHand = sortCards(hand, 'rank');
  const useIntKey = sortedHand.length <= 32;
  const indexById = new Map<string, number>();
  const byRank: Partial<Record<Rank, Card[]>> = {};
  const bySuit: Record<Suit, Card[]> = { D: [], C: [], H: [], S: [] };

  for (let i = 0; i < sortedHand.length; i++) {
    const c = sortedHand[i];
    indexById.set(c.id, i);
    if (!byRank[c.rank]) byRank[c.rank] = [];
    byRank[c.rank]!.push(c);
    bySuit[c.suit].push(c);
  }

  const results: Combination[] = [];
  const seenInt = useIntKey ? new Set<number>() : null;
  const seenStr = useIntKey ? null : new Set<string>();

  const markSeen = (c0: Card, c1: Card, c2: Card, c3: Card, c4: Card): boolean => {
    if (seenInt) {
      const k = comboKey5(
        indexById.get(c0.id)!,
        indexById.get(c1.id)!,
        indexById.get(c2.id)!,
        indexById.get(c3.id)!,
        indexById.get(c4.id)!
      );
      if (seenInt.has(k)) return false;
      seenInt.add(k);
      return true;
    }
    const sorted = sortCards([c0, c1, c2, c3, c4], 'rank');
    const key = `${sorted[0].id},${sorted[1].id},${sorted[2].id},${sorted[3].id},${sorted[4].id}`;
    if (seenStr!.has(key)) return false;
    seenStr!.add(key);
    return true;
  };

  // 1. Straights & Straight Flushes
  if (bombsOnly) {
    // Fast path when only bombs (Straight Flush / Bomber) are needed
    for (const suit of ['D', 'C', 'H', 'S'] as Suit[]) {
      const list = bySuit[suit];
      if (list.length < 5) continue;
      const suitByRank: Partial<Record<Rank, Card[]>> = {};
      for (const c of list) {
        if (!suitByRank[c.rank]) suitByRank[c.rank] = [];
        suitByRank[c.rank]!.push(c);
      }
      for (const seq of VALID_STRAIGHTS) {
        const c0 = suitByRank[seq[0]];
        const c1 = suitByRank[seq[1]];
        const c2 = suitByRank[seq[2]];
        const c3 = suitByRank[seq[3]];
        const c4 = suitByRank[seq[4]];
        if (!c0 || !c1 || !c2 || !c3 || !c4) continue;
        for (const a of c0) {
          for (const b of c1) {
            for (const c of c2) {
              for (const d of c3) {
                for (const e of c4) {
                  if (markSeen(a, b, c, d, e)) {
                    results.push({ type: 'straightflush', cards: [a, b, c, d, e] });
                  }
                }
              }
            }
          }
        }
      }
    }
  } else {
    for (const seq of VALID_STRAIGHTS) {
      const c0 = byRank[seq[0]];
      const c1 = byRank[seq[1]];
      const c2 = byRank[seq[2]];
      const c3 = byRank[seq[3]];
      const c4 = byRank[seq[4]];
      if (!c0 || !c1 || !c2 || !c3 || !c4) continue;
      for (const a of c0) {
        for (const b of c1) {
          for (const c of c2) {
            for (const d of c3) {
              for (const e of c4) {
                if (markSeen(a, b, c, d, e)) {
                  const isSF =
                    a.suit === b.suit && b.suit === c.suit && c.suit === d.suit && d.suit === e.suit;
                  results.push({ type: isSF ? 'straightflush' : 'straight', cards: [a, b, c, d, e] });
                }
              }
            }
          }
        }
      }
    }

    // 2. Flushes (cards in bySuit are already rank-sorted; straight flushes are skipped via seen)
    for (const suit of ['D', 'C', 'H', 'S'] as Suit[]) {
      const list = bySuit[suit];
      if (list.length >= 5) {
        for (const comb of getCombinations(list, 5)) {
          if (markSeen(comb[0], comb[1], comb[2], comb[3], comb[4])) {
            results.push({ type: 'flush', cards: comb });
          }
        }
      }
    }

    // 3. Full Houses (triplets & pairs are already rank-sorted)
    const triplets: { rank: Rank; order: number; cards: Card[] }[] = [];
    const pairs: { rank: Rank; order: number; cards: Card[] }[] = [];
    for (const rank of Object.keys(byRank) as Rank[]) {
      const cards = byRank[rank]!;
      const order = RANK_ORDER[rank];
      if (cards.length >= 3) {
        for (const comb of getCombinations(cards, 3)) {
          triplets.push({ rank, order, cards: comb });
        }
      }
      if (cards.length >= 2) {
        for (const comb of getCombinations(cards, 2)) {
          pairs.push({ rank, order, cards: comb });
        }
      }
    }
    for (const trip of triplets) {
      for (const pr of pairs) {
        if (trip.rank === pr.rank) continue;
        const cards =
          trip.order < pr.order
            ? [trip.cards[0], trip.cards[1], trip.cards[2], pr.cards[0], pr.cards[1]]
            : [pr.cards[0], pr.cards[1], trip.cards[0], trip.cards[1], trip.cards[2]];
        if (markSeen(cards[0], cards[1], cards[2], cards[3], cards[4])) {
          results.push({ type: 'fullhouse', cards });
        }
      }
    }
  }

  // 4. Bombers (4-of-a-kind + 1 kicker)
  for (const rank of Object.keys(byRank) as Rank[]) {
    const cards = byRank[rank]!;
    if (cards.length >= 4) {
      for (const quad of getCombinations(cards, 4)) {
        const q0 = indexById.get(quad[0].id)!;
        const q1 = indexById.get(quad[1].id)!;
        const q2 = indexById.get(quad[2].id)!;
        const q3 = indexById.get(quad[3].id)!;
        for (let k = 0; k < sortedHand.length; k++) {
          if (k === q0 || k === q1 || k === q2 || k === q3) continue;
          const kicker = sortedHand[k];
          const bomberCards =
            k < q0
              ? [kicker, quad[0], quad[1], quad[2], quad[3]]
              : k < q1
                ? [quad[0], kicker, quad[1], quad[2], quad[3]]
                : k < q2
                  ? [quad[0], quad[1], kicker, quad[2], quad[3]]
                  : k < q3
                    ? [quad[0], quad[1], quad[2], kicker, quad[3]]
                    : [quad[0], quad[1], quad[2], quad[3], kicker];
          if (markSeen(bomberCards[0], bomberCards[1], bomberCards[2], bomberCards[3], bomberCards[4])) {
            results.push({ type: 'bomber', cards: bomberCards });
          }
        }
      }
    }
  }

  return results;
}

export function findFiveCardHands(hand: Card[]): Card[][] {
  return findFiveCardCombos(hand, false).map((c) => c.cards);
}

function getValidCombos(
  hand: Card[],
  prevPlay: Combination | null,
  isFirstPlay: boolean,
  rules: BombRules = { enableBombsSingle: true, enableBombsPair: true },
  startingCard?: Card | null
): Combination[] {
  const validCombos: Combination[] = [];
  const sortedHand = sortCards(hand, 'rank');

  const filterFirstPlay = (combos: Combination[]) => {
    if (!isFirstPlay) return combos;
    return combos.filter((combo) => containsStartingCard(combo.cards, startingCard));
  };

  if (!prevPlay) {
    for (const c of sortedHand) validCombos.push({ type: 'single', cards: [c] });
    for (const p of findCombinationsOfSize(sortedHand, 2)) validCombos.push({ type: 'pair', cards: p });
    for (const t of findCombinationsOfSize(sortedHand, 3)) validCombos.push({ type: 'tris', cards: t });
    validCombos.push(...findFiveCardCombos(sortedHand, false));
    return filterFirstPlay(validCombos);
  }

  const targetSize = prevPlay.cards.length;

  if (targetSize === 1) {
    for (const c of sortedHand) {
      const combo: Combination = { type: 'single', cards: [c] };
      if (canBeat(combo, prevPlay, rules)) {
        validCombos.push(combo);
      }
    }
    if (rules.enableBombsSingle && prevPlay.cards[0].rank === '2') {
      validCombos.push(...findFiveCardCombos(sortedHand, true));
    }
  } else if (targetSize === 2) {
    for (const p of findCombinationsOfSize(sortedHand, 2)) {
      const combo: Combination = { type: 'pair', cards: p };
      if (canBeat(combo, prevPlay, rules)) {
        validCombos.push(combo);
      }
    }
    if (rules.enableBombsPair && prevPlay.cards[0].rank === '2') {
      validCombos.push(...findFiveCardCombos(sortedHand, true));
    }
  } else if (targetSize === 3) {
    for (const t of findCombinationsOfSize(sortedHand, 3)) {
      const combo: Combination = { type: 'tris', cards: t };
      if (canBeat(combo, prevPlay, rules)) {
        validCombos.push(combo);
      }
    }
  } else if (targetSize === 5) {
    for (const combo of findFiveCardCombos(sortedHand, false)) {
      if (canBeat(combo, prevPlay, rules)) {
        validCombos.push(combo);
      }
    }
  }

  return filterFirstPlay(validCombos);
}

export function getValidPlays(
  hand: Card[],
  prevPlay: Combination | null,
  isFirstPlay: boolean,
  rules: BombRules = { enableBombsSingle: true, enableBombsPair: true },
  startingCard?: Card | null
): Card[][] {
  return getValidCombos(hand, prevPlay, isFirstPlay, rules, startingCard).map((c) => c.cards);
}

function rateCombo(combo: Combination): number {
  if (combo.type === 'single') {
    return RANK_ORDER[combo.cards[0].rank] * 10 + SUIT_ORDER[combo.cards[0].suit];
  }
  if (combo.type === 'pair') {
    const high = combo.cards[1];
    return 200 + RANK_ORDER[high.rank] * 10 + SUIT_ORDER[high.suit];
  }
  if (combo.type === 'tris') {
    const high = combo.cards[2];
    return 400 + RANK_ORDER[high.rank] * 10 + SUIT_ORDER[high.suit];
  }
  if (combo.type !== 'invalid') {
    const typeVal = COMBO_VALUE[combo.type];
    let highCard = combo.cards[4];
    if (combo.type === 'fullhouse') {
      const parts = getFullHouseParts(combo.cards);
      highCard = parts.triple[2];
    } else if (combo.type === 'bomber') {
      const parts = getBomberParts(combo.cards);
      highCard = parts.quad[3];
    }
    return 600 + typeVal * 100 + RANK_ORDER[highCard.rank] * 10 + SUIT_ORDER[highCard.suit];
  }
  return 9999;
}

export function ratePlay(cards: Card[]): number {
  return rateCombo(checkCombination(cards));
}

export function getSortedEligiblePlays(
  hand: Card[],
  prevPlay: Combination | null,
  isFirstPlay: boolean,
  rules: BombRules = { enableBombsSingle: true, enableBombsPair: true },
  startingCard?: Card | null
): Card[][] {
  const validCombos = getValidCombos(hand, prevPlay, isFirstPlay, rules, startingCard);
  if (validCombos.length === 0) return [];

  const ratedPlays = validCombos.map((combo) => ({
    play:
      combo.type === 'straight' || combo.type === 'straightflush'
        ? sortCards(combo.cards, 'rank')
        : combo.cards,
    rating: rateCombo(combo),
    length: combo.cards.length,
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
  const fiveCombos = findFiveCardCombos(hand);
  const inStraightFlush = fiveCombos.some(
    (combo) => combo.type === 'straightflush' && combo.cards.some((c) => c.id === matchedCard.id)
  );
  if (inStraightFlush) return { accept: false };

  // 3. Keep isolated 2♠
  if (matchedCard.rank === '2' && matchedCard.suit === 'S') {
    const total2s = hand.filter((c) => c.rank === '2').length;
    if (total2s <= 1) return { accept: false };
  }

  // 4. Avoid breaking triple in Full House / Bomber
  const inBomberOrFH = fiveCombos.some(
    (combo) =>
      (combo.type === 'bomber' || combo.type === 'fullhouse') &&
      combo.cards.some((c) => c.id === matchedCard.id)
  );
  if (inBomberOrFH && sameRankCount >= 3) return { accept: false };

  // Pick worst unwanted card to attach as extra card
  const candidates = hand.filter((c) => c.id !== matchedCard.id);
  if (candidates.length === 0) return { accept: false };

  const inFiveCardIds = new Set<string>();
  for (const combo of fiveCombos) {
    for (const fc of combo.cards) inFiveCardIds.add(fc.id);
  }

  const scoredCandidates = candidates.map((c) => {
    let trashScore = 100 - (RANK_ORDER[c.rank] * 4 + SUIT_ORDER[c.suit]);
    if (c.rank === '2') trashScore -= 1000;
    if (c.rank === 'A') trashScore -= 500;

    const countInCandidates = candidates.filter((o) => o.rank === c.rank).length;
    if (countInCandidates === 1) trashScore += 50;
    else if (countInCandidates >= 2) trashScore -= 40;

    if (inFiveCardIds.has(c.id)) {
      trashScore -= 80;
    }
    return { card: c, trashScore };
  });

  scoredCandidates.sort((a, b) => b.trashScore - a.trashScore);
  return { accept: true, extraCard: scoredCandidates[0].card };
}
