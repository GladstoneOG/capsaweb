import { describe, expect, it } from 'vitest';
import {
  computeBoxSelection,
  computeRowCardHitBoxes,
  rectFromPoints,
  rectsOverlap,
  type RowCardSample,
} from '../src/hooks/useHandBoxSelect';

describe('hand box-select geometry', () => {
  it('normalizes drag rectangles in any direction', () => {
    expect(rectFromPoints(100, 200, 300, 400)).toEqual({
      left: 100,
      top: 200,
      right: 300,
      bottom: 400,
    });
    expect(rectFromPoints(300, 400, 100, 200)).toEqual({
      left: 100,
      top: 200,
      right: 300,
      bottom: 400,
    });
    expect(rectFromPoints(300, 200, 100, 400)).toEqual({
      left: 100,
      top: 200,
      right: 300,
      bottom: 400,
    });
  });

  it('detects overlapping and edge-touching rectangles', () => {
    const a = { left: 10, top: 10, right: 50, bottom: 50 };
    expect(rectsOverlap(a, { left: 40, top: 40, right: 80, bottom: 80 })).toBe(true);
    expect(rectsOverlap(a, { left: 50, top: 10, right: 90, bottom: 50 })).toBe(true);
    expect(rectsOverlap(a, { left: 51, top: 10, right: 90, bottom: 50 })).toBe(false);
    expect(rectsOverlap(a, { left: 10, top: 51, right: 50, bottom: 90 })).toBe(false);
  });

  it('clips hidden right overlap on fanned cards while keeping the last card full-width', () => {
    // 4 overlapping cards: each 100px wide, stepped by 50px
    const row: RowCardSample[] = [
      { id: 'c0', restingRect: { left: 100, top: 500, right: 200, bottom: 640 } },
      { id: 'c1', restingRect: { left: 150, top: 500, right: 250, bottom: 640 } },
      { id: 'c2', restingRect: { left: 200, top: 500, right: 300, bottom: 640 } },
      { id: 'c3', restingRect: { left: 250, top: 500, right: 350, bottom: 640 } },
    ];

    const hitBoxes = computeRowCardHitBoxes([row]);
    expect(hitBoxes).toEqual([
      { id: 'c0', rect: { left: 100, top: 500, right: 150, bottom: 640 } },
      { id: 'c1', rect: { left: 150, top: 500, right: 200, bottom: 640 } },
      { id: 'c2', rect: { left: 200, top: 500, right: 250, bottom: 640 } },
      { id: 'c3', rect: { left: 250, top: 500, right: 350, bottom: 640 } },
    ]);

    const handIds = ['c0', 'c1', 'c2', 'c3'];

    // Dragging over visible c1 & c2 must NOT accidentally select c0 (hidden underneath c1)
    const pairBox = rectFromPoints(160, 480, 235, 560);
    expect(computeBoxSelection(handIds, hitBoxes, pairBox, [], 'replace')).toEqual(['c1', 'c2']);

    // Dragging from the right onto the exposed right half of the last card selects only c3
    const rightEdgeBox = rectFromPoints(380, 520, 310, 580);
    expect(computeBoxSelection(handIds, hitBoxes, rightEdgeBox, [], 'replace')).toEqual(['c3']);
  });

  it('handles 2-row hands independently and respects already-lifted visual top', () => {
    const row0: RowCardSample[] = [
      { id: 'r0a', restingRect: { left: 100, top: 400, right: 180, bottom: 510 } },
      {
        id: 'r0b',
        restingRect: { left: 140, top: 400, right: 220, bottom: 510 },
        visualRect: { left: 140, top: 376, right: 220, bottom: 486 }, // lifted 24px
      },
    ];
    const row1: RowCardSample[] = [
      { id: 'r1a', restingRect: { left: 100, top: 514, right: 180, bottom: 624 } },
      { id: 'r1b', restingRect: { left: 140, top: 514, right: 220, bottom: 624 } },
    ];

    const hitBoxes = computeRowCardHitBoxes([row0, row1]);
    const handIds = ['r0a', 'r0b', 'r1a', 'r1b'];

    // Box touching only the lifted top of r0b hits r0b (full width since last in row0)
    const liftedTopBox = rectFromPoints(190, 370, 215, 390);
    expect(computeBoxSelection(handIds, hitBoxes, liftedTopBox, [], 'replace')).toEqual(['r0b']);

    // Vertical box spanning both rows on the left hits r0a and r1a
    const leftColBox = rectFromPoints(90, 420, 125, 560);
    expect(computeBoxSelection(handIds, hitBoxes, leftColBox, [], 'replace')).toEqual(['r0a', 'r1a']);
  });

  it('supports replace, additive (Shift), and toggle (Ctrl/Cmd) selection modes in hand order', () => {
    const row: RowCardSample[] = [
      { id: '3D', restingRect: { left: 0, top: 0, right: 100, bottom: 100 } },
      { id: '4C', restingRect: { left: 50, top: 0, right: 150, bottom: 100 } },
      { id: '5H', restingRect: { left: 100, top: 0, right: 200, bottom: 100 } },
      { id: '6S', restingRect: { left: 150, top: 0, right: 250, bottom: 100 } },
    ];
    const hitBoxes = computeRowCardHitBoxes([row]);
    const handIds = ['3D', '4C', '5H', '6S'];
    const boxOver4and5 = rectFromPoints(60, 10, 130, 80);

    // Replace clears previous 3D and selects only 4C, 5H
    expect(computeBoxSelection(handIds, hitBoxes, boxOver4and5, ['3D'], 'replace')).toEqual([
      '4C',
      '5H',
    ]);

    // Add (Shift) unions with base selection ['3D', '4C'] -> ['3D', '4C', '5H']
    expect(computeBoxSelection(handIds, hitBoxes, boxOver4and5, ['3D', '4C'], 'add')).toEqual([
      '3D',
      '4C',
      '5H',
    ]);

    // Toggle (Ctrl/Cmd) flips cards inside box: 4C deselected, 5H selected, 3D kept
    expect(computeBoxSelection(handIds, hitBoxes, boxOver4and5, ['3D', '4C'], 'toggle')).toEqual([
      '3D',
      '5H',
    ]);
  });
});
