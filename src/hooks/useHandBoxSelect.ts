import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface BoxRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CardHitBox {
  id: string;
  rect: BoxRect;
}

export interface RowCardSample {
  id: string;
  restingRect: BoxRect;
  visualRect?: BoxRect;
}

export type BoxSelectMode = 'replace' | 'add' | 'toggle';

const DRAG_THRESHOLD_PX = 6;

const EXCLUDED_START_SELECTOR = [
  '.pcard.is-interactive',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="dialog"]',
  '.hud',
  '.dock-bar',
  '.modal-backdrop',
  '.drawer-backdrop',
  '.settings-menu',
].join(', ');

export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): BoxRect {
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    right: Math.max(x1, x2),
    bottom: Math.max(y1, y2),
  };
}

export function rectsOverlap(a: BoxRect, b: BoxRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/**
 * Computes visible hit rectangles for fanned cards grouped by visual row.
 * Each non-trailing card's right edge is clipped to its right neighbor's left edge
 * so boxes dragged onto a card never accidentally select cards tucked underneath it.
 */
export function computeRowCardHitBoxes(
  rows: ReadonlyArray<ReadonlyArray<RowCardSample>>
): CardHitBox[] {
  const result: CardHitBox[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const { id, restingRect, visualRect } = row[i];
      const next = row[i + 1];
      const clippedRight = next
        ? Math.max(restingRect.left + 1, Math.min(restingRect.right, next.restingRect.left))
        : restingRect.right;
      const top = visualRect ? Math.min(restingRect.top, visualRect.top) : restingRect.top;
      const bottom = visualRect
        ? Math.max(restingRect.bottom, visualRect.bottom)
        : restingRect.bottom;
      result.push({
        id,
        rect: {
          left: restingRect.left,
          top,
          right: clippedRight,
          bottom,
        },
      });
    }
  }
  return result;
}

export function computeBoxSelection(
  handIds: readonly string[],
  hitBoxes: readonly CardHitBox[],
  box: BoxRect,
  baseSelectedIds: readonly string[],
  mode: BoxSelectMode
): string[] {
  const hitSet = new Set<string>();
  for (const item of hitBoxes) {
    if (rectsOverlap(item.rect, box)) {
      hitSet.add(item.id);
    }
  }

  if (mode === 'replace') {
    return handIds.filter((id) => hitSet.has(id));
  }

  const baseSet = new Set(baseSelectedIds);
  if (mode === 'add') {
    return handIds.filter((id) => baseSet.has(id) || hitSet.has(id));
  }

  // 'toggle'
  return handIds.filter((id) => baseSet.has(id) !== hitSet.has(id));
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function toBoxRect(r: DOMRect): BoxRect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

function snapshotHandHitBoxes(handEl: HTMLElement | null): CardHitBox[] {
  if (!handEl) return [];
  const rowEls = handEl.querySelectorAll<HTMLElement>('.hand-row');
  const rows: RowCardSample[][] = [];

  for (const rowEl of rowEls) {
    const slots = rowEl.querySelectorAll<HTMLElement>('.fan-slot[data-card-id]');
    const samples: RowCardSample[] = [];
    for (const slot of slots) {
      const id = slot.dataset.cardId;
      if (!id) continue;
      const flipEl = slot.querySelector<HTMLElement>('.fan-flip') ?? slot;
      const cardEl = slot.querySelector<HTMLElement>('.pcard');
      samples.push({
        id,
        restingRect: toBoxRect(flipEl.getBoundingClientRect()),
        visualRect: cardEl ? toBoxRect(cardEl.getBoundingClientRect()) : undefined,
      });
    }
    if (samples.length > 0) rows.push(samples);
  }

  return computeRowCardHitBoxes(rows);
}

function applyMarqueeStyle(el: HTMLDivElement, box: BoxRect): void {
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  el.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
}

function modeFromModifiers(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): BoxSelectMode {
  if (e.ctrlKey || e.metaKey) return 'toggle';
  if (e.shiftKey) return 'add';
  return 'replace';
}

interface PendingMarquee {
  pointerId: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  active: boolean;
  baseSelectedIds: string[];
  lastAppliedIds: string[];
  hitBoxes: CardHitBox[];
}

interface UseHandBoxSelectOptions {
  handRef: RefObject<HTMLElement | null>;
  handIds: string[];
  selectedIds: string[];
  enabled: boolean;
  resetKey: string | number;
  onSelectionChange: (nextIds: string[], prevIds: string[]) => void;
}

export function useHandBoxSelect({
  handRef,
  handIds,
  selectedIds,
  enabled,
  resetKey,
  onSelectionChange,
}: UseHandBoxSelectOptions) {
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<PendingMarquee | null>(null);

  const handIdsRef = useRef(handIds);
  handIdsRef.current = handIds;

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  const handKey = handIds.join(',');

  const cancelBoxSelect = useCallback(() => {
    pendingRef.current = null;
    setIsBoxSelecting(false);
  }, []);

  useEffect(() => {
    if (!enabled) cancelBoxSelect();
  }, [enabled, cancelBoxSelect]);

  useEffect(() => {
    cancelBoxSelect();
  }, [resetKey, handKey, cancelBoxSelect]);

  const updateSelection = useCallback((p: PendingMarquee, mode: BoxSelectMode) => {
    const box = rectFromPoints(p.startX, p.startY, p.curX, p.curY);
    if (marqueeRef.current) {
      applyMarqueeStyle(marqueeRef.current, box);
    }
    const nextIds = computeBoxSelection(
      handIdsRef.current,
      p.hitBoxes,
      box,
      p.baseSelectedIds,
      mode
    );
    if (!arraysEqual(nextIds, p.lastAppliedIds)) {
      const prevIds = p.lastAppliedIds;
      p.lastAppliedIds = nextIds;
      onSelectionChangeRef.current(nextIds, prevIds);
    }
  }, []);

  const handleContainerPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!enabledRef.current) return;
    if (pendingRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (handIdsRef.current.length === 0) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest(EXCLUDED_START_SELECTOR)) return;

    pendingRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      curX: e.clientX,
      curY: e.clientY,
      active: false,
      baseSelectedIds: [...selectedIdsRef.current],
      lastAppliedIds: [...selectedIdsRef.current],
      hitBoxes: [],
    };
  }, []);

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;

      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        pendingRef.current = null;
        if (p.active) setIsBoxSelecting(false);
        return;
      }

      p.curX = e.clientX;
      p.curY = e.clientY;

      if (!p.active) {
        const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
        if (dist < DRAG_THRESHOLD_PX) return;

        p.active = true;
        p.hitBoxes = snapshotHandHitBoxes(handRef.current);
        window.getSelection()?.removeAllRanges();
        setIsBoxSelecting(true);
      }

      updateSelection(p, modeFromModifiers(e));
    };

    const finishPointer = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      pendingRef.current = null;
      if (p.active) setIsBoxSelecting(false);
    };

    const onBlur = () => {
      if (pendingRef.current) {
        cancelBoxSelect();
      }
    };

    const onContextMenu = () => {
      if (pendingRef.current?.active) {
        cancelBoxSelect();
      }
    };

    const onKeyChange = (e: KeyboardEvent) => {
      const p = pendingRef.current;
      if (!p || !p.active) return;
      if (e.key === 'Escape') {
        cancelBoxSelect();
        return;
      }
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta') {
        updateSelection(p, modeFromModifiers(e));
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', finishPointer);
    window.addEventListener('blur', onBlur);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyChange);
    window.addEventListener('keyup', onKeyChange);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishPointer);
      window.removeEventListener('pointercancel', finishPointer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyChange);
      window.removeEventListener('keyup', onKeyChange);
    };
  }, [handRef, updateSelection, cancelBoxSelect]);

  // Position marquee cleanly on its very first mounted frame
  useLayoutEffect(() => {
    const p = pendingRef.current;
    const el = marqueeRef.current;
    if (isBoxSelecting && p && el) {
      applyMarqueeStyle(el, rectFromPoints(p.startX, p.startY, p.curX, p.curY));
    }
  }, [isBoxSelecting]);

  return {
    isBoxSelecting,
    marqueeRef,
    handleContainerPointerDown,
  };
}
