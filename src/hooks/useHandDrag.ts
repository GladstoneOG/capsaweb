import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Card } from '@engine/types';
import { prefersReducedMotion } from '../utils/motion';

interface UseHandDragOptions {
  hand: Card[];
  onReorder: (nextIds: string[]) => void;
  onTap: (card: Card) => void;
  onDragStart?: (card: Card) => void;
  onSwap?: () => void;
  onDragEnd?: () => void;
  resetKey: string | number;
}

interface PendingPointer {
  pointerId: number;
  card: Card;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  cardWidth: number;
  cardHeight: number;
  active: boolean;
  lastX: number;
  curX: number;
  curY: number;
  tilt: number;
  lastSwapAt: number;
}

const DRAG_THRESHOLD_PX = 6;
const SETTLE_MS = 155;

/** Read computed Z-rotation (in degrees) of an element so the ghost settles cleanly into the fan angle. */
function getElementRotationDeg(el: HTMLElement): number {
  const tf = window.getComputedStyle(el).transform;
  if (!tf || tf === 'none') return 0;
  try {
    const matrix = new DOMMatrixReadOnly(tf);
    return Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);
  } catch {
    return 0;
  }
}

export function useHandDrag({
  hand,
  onReorder,
  onTap,
  onDragStart,
  onSwap,
  onDragEnd,
  resetKey,
}: UseHandDragOptions) {
  const [draggingCard, setDraggingCard] = useState<Card | null>(null);
  const [ghostDims, setGhostDims] = useState<{ w: number; h: number }>({ w: 80, h: 114 });

  const handRef = useRef(hand);
  handRef.current = hand;

  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;

  const onSwapRef = useRef(onSwap);
  onSwapRef.current = onSwap;

  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  // Map cardId -> inner .fan-flip element (used for FLIP) and outer .fan-slot element (used for hit-testing)
  const flipElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const slotElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const slotRefCallbacksRef = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  const flipRefCallbacksRef = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());
  const prevRectsRef = useRef<Map<string, DOMRect> | null>(null);

  const ghostRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<PendingPointer | null>(null);
  const rafRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const draggingIdRef = useRef<string | null>(null);

  const registerSlot = useCallback((id: string, el: HTMLElement | null) => {
    if (el) slotElsRef.current.set(id, el);
    else slotElsRef.current.delete(id);
  }, []);

  const registerFlip = useCallback((id: string, el: HTMLElement | null) => {
    if (el) flipElsRef.current.set(id, el);
    else flipElsRef.current.delete(id);
  }, []);

  const getSlotRef = useCallback(
    (id: string) => {
      let cb = slotRefCallbacksRef.current.get(id);
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          if (el) slotElsRef.current.set(id, el);
          else slotElsRef.current.delete(id);
        };
        slotRefCallbacksRef.current.set(id, cb);
      }
      return cb;
    },
    []
  );

  const getFlipRef = useCallback(
    (id: string) => {
      let cb = flipRefCallbacksRef.current.get(id);
      if (!cb) {
        cb = (el: HTMLElement | null) => {
          if (el) flipElsRef.current.set(id, el);
          else flipElsRef.current.delete(id);
        };
        flipRefCallbacksRef.current.set(id, cb);
      }
      return cb;
    },
    []
  );

  const cancelDrag = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    pendingRef.current = null;
    draggingIdRef.current = null;
    setDraggingCard(null);
  }, []);

  // Cancel cleanly if round changes or dragged card leaves hand
  useEffect(() => {
    cancelDrag();
  }, [resetKey, cancelDrag]);

  useEffect(() => {
    const id = draggingIdRef.current;
    if (id && !hand.some((c) => c.id === id)) {
      cancelDrag();
    }
  }, [hand, cancelDrag]);

  // FLIP animation: smoothly glide neighbors whenever hand order changes
  useLayoutEffect(() => {
    const prevRects = prevRectsRef.current;
    if (!prevRects) return;
    prevRectsRef.current = null;

    if (prefersReducedMotion()) return;

    const animated: HTMLElement[] = [];
    const entries: { el: HTMLElement; prev: DOMRect }[] = [];

    // 1. Reset any in-flight inline FLIP transform so we measure true resting target rects
    for (const card of hand) {
      if (card.id === draggingIdRef.current) continue;
      const el = flipElsRef.current.get(card.id);
      const prev = prevRects.get(card.id);
      if (!el || !prev) continue;
      el.style.transition = 'none';
      el.style.transform = '';
      entries.push({ el, prev });
    }

    // 2. Measure true resting positions and invert from visual pre-reorder positions
    for (const { el, prev } of entries) {
      const next = el.getBoundingClientRect();
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      el.style.willChange = 'transform';
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      animated.push(el);
    }

    if (animated.length === 0) return;

    // 3. Force single layout flush, then glide smoothly into place
    void animated[0].offsetWidth;

    for (const el of animated) {
      el.style.transition = 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = 'translate3d(0, 0, 0)';
    }

    // Release temporary will-change once FLIP settles so GPU layers aren't held permanently
    const cleanupTimer = window.setTimeout(() => {
      for (const el of animated) {
        el.style.willChange = 'auto';
      }
    }, 240);

    return () => window.clearTimeout(cleanupTimer);
  }, [hand]);

  // Capture all card rects before a reorder
  const snapshotRects = useCallback(() => {
    const map = new Map<string, DOMRect>();
    for (const [id, el] of flipElsRef.current.entries()) {
      map.set(id, el.getBoundingClientRect());
    }
    prevRectsRef.current = map;
  }, []);

  const findTargetIndex = useCallback((cardId: string, px: number, py: number): number => {
    const curHand = handRef.current;
    const curIdx = curHand.findIndex((c) => c.id === cardId);
    if (curIdx === -1) return -1;

    // Collect centers of all slots
    const centers: { idx: number; cx: number; cy: number; rect: DOMRect }[] = [];
    for (let i = 0; i < curHand.length; i++) {
      const el = slotElsRef.current.get(curHand[i].id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      centers.push({
        idx: i,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        rect,
      });
    }
    if (centers.length <= 1) return curIdx;

    // Group into visual rows (supports both 1-row and 2-row 26-card hands cleanly)
    const rows: typeof centers[] = [];
    for (const item of centers) {
      const existingRow = rows.find((r) => Math.abs(r[0].cy - item.cy) < item.rect.height * 0.55);
      if (existingRow) existingRow.push(item);
      else rows.push([item]);
    }

    // Pick closest row vertically
    let targetRow = rows[0];
    let bestRowDist = Infinity;
    for (const row of rows) {
      const avgY = row.reduce((acc, item) => acc + item.cy, 0) / row.length;
      const dist = Math.abs(py - avgY);
      if (dist < bestRowDist) {
        bestRowDist = dist;
        targetRow = row;
      }
    }

    // Within targetRow, pick closest card index horizontally with a small hysteresis deadzone
    let bestIdx = curIdx;
    let bestDist = Infinity;
    for (const item of targetRow) {
      const d = Math.abs(px - item.cx);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = item.idx;
      }
    }

    // Hysteresis to prevent midpoint oscillation
    if (bestIdx !== curIdx) {
      const targetItem = centers.find((c) => c.idx === bestIdx);
      if (targetItem) {
        if (bestIdx > curIdx && px < targetItem.cx - 2) return curIdx;
        if (bestIdx < curIdx && px > targetItem.cx + 2) return curIdx;
      }
    }

    return bestIdx;
  }, []);

  const startGhostLoop = useCallback(() => {
    const reduced = prefersReducedMotion();
    let prevRenderedX = NaN;
    let prevRenderedY = NaN;
    let prevRenderedTilt = NaN;
    const tick = () => {
      const p = pendingRef.current;
      const ghost = ghostRef.current;
      if (!p || !p.active) {
        rafRef.current = null;
        return;
      }
      if (reduced) {
        p.tilt = 0;
      } else {
        const vx = p.curX - p.lastX;
        p.lastX = p.curX;
        const targetTilt = Math.max(-13, Math.min(13, vx * 0.7));
        p.tilt += (targetTilt - p.tilt) * 0.24;
        if (Math.abs(p.tilt) < 0.02 && Math.abs(targetTilt) < 0.02) {
          p.tilt = 0;
        }
      }

      if (ghost) {
        const x = p.curX - p.grabOffsetX;
        const y = p.curY - p.grabOffsetY;
        const tilt = Math.round(p.tilt * 100) / 100;
        if (x !== prevRenderedX || y !== prevRenderedY || tilt !== prevRenderedTilt) {
          prevRenderedX = x;
          prevRenderedY = y;
          prevRenderedTilt = tilt;
          ghost.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg) scale(1.06)`;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const handleCardPointerDown = useCallback(
    (card: Card, e: React.PointerEvent<HTMLElement>) => {
      // Only primary mouse button (preserve right-click deselect!) or touch/pen
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Ignore if a previous drag is mid-settle
      if (settleTimerRef.current !== null) return;

      const cardRect = e.currentTarget.getBoundingClientRect();
      pendingRef.current = {
        pointerId: e.pointerId,
        card,
        startX: e.clientX,
        startY: e.clientY,
        grabOffsetX: e.clientX - cardRect.left,
        grabOffsetY: e.clientY - cardRect.top,
        cardWidth: cardRect.width,
        cardHeight: cardRect.height,
        active: false,
        lastX: e.clientX,
        curX: e.clientX,
        curY: e.clientY,
        tilt: 0,
        lastSwapAt: 0,
      };
    },
    []
  );

  // Global move & up listeners
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;

      p.curX = e.clientX;
      p.curY = e.clientY;

      if (!p.active) {
        const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
        if (dist < DRAG_THRESHOLD_PX) return;

        p.active = true;
        draggingIdRef.current = p.card.id;
        setGhostDims({ w: p.cardWidth, h: p.cardHeight });
        setDraggingCard(p.card);
        onDragStartRef.current?.(p.card);
        startGhostLoop();
      }

      // Live reorder check with tiny cooldown for silky non-oscillating swaps
      const now = performance.now();
      if (now - p.lastSwapAt < 55) return;

      const curHand = handRef.current;
      const curIdx = curHand.findIndex((c) => c.id === p.card.id);
      const nextIdx = findTargetIndex(p.card.id, e.clientX, e.clientY);

      if (curIdx !== -1 && nextIdx !== -1 && nextIdx !== curIdx) {
        p.lastSwapAt = now;
        snapshotRects();
        const nextIds = curHand.map((c) => c.id);
        const [moved] = nextIds.splice(curIdx, 1);
        nextIds.splice(nextIdx, 0, moved);
        onReorderRef.current(nextIds);
        onSwapRef.current?.();
      }
    };

    const finishPointer = (e: PointerEvent, cancelled: boolean) => {
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      pendingRef.current = null;

      if (!p.active) {
        if (!cancelled) {
          onTapRef.current(p.card);
        }
        return;
      }

      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      onDragEndRef.current?.();

      const ghost = ghostRef.current;
      const slotEl = slotElsRef.current.get(p.card.id);
      const targetSlot = flipElsRef.current.get(p.card.id) ?? slotEl;

      if (ghost && targetSlot && !prefersReducedMotion()) {
        const cardEl = targetSlot.querySelector<HTMLElement>('.pcard') ?? targetSlot;
        const rect = cardEl.getBoundingClientRect();
        // Match the exact fan slot rotation and center so there is zero snap when ghost unmounts
        const targetAngle = slotEl ? getElementRotationDeg(slotEl) : 0;
        const targetCenterX = rect.left + rect.width / 2;
        const targetCenterY = rect.top + rect.height / 2;
        const settleX = targetCenterX - p.cardWidth / 2;
        const settleY = targetCenterY - p.cardHeight / 2;
        const targetScale = cardEl.classList.contains('is-selected') ? 1.03 : 1;

        ghost.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        ghost.style.transform = `translate3d(${settleX}px, ${settleY}px, 0) rotate(${targetAngle.toFixed(2)}deg) scale(${targetScale})`;
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          draggingIdRef.current = null;
          setDraggingCard(null);
        }, SETTLE_MS);
      } else {
        draggingIdRef.current = null;
        setDraggingCard(null);
      }
    };

    const onPointerUp = (e: PointerEvent) => finishPointer(e, false);
    const onPointerCancel = (e: PointerEvent) => finishPointer(e, true);

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [findTargetIndex, snapshotRects, startGhostLoop]);

  // Position ghost cleanly on its very first mounted frame
  useLayoutEffect(() => {
    const p = pendingRef.current;
    const ghost = ghostRef.current;
    if (draggingCard && p && ghost) {
      const x = p.curX - p.grabOffsetX;
      const y = p.curY - p.grabOffsetY;
      ghost.style.transition = 'none';
      ghost.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(0deg) scale(1.06)`;
    }
  }, [draggingCard]);

  return {
    draggingCard,
    draggingId: draggingCard?.id ?? null,
    ghostRef,
    ghostDims,
    registerSlot,
    registerFlip,
    getSlotRef,
    getFlipRef,
    handleCardPointerDown,
    snapshotRects,
  };
}
