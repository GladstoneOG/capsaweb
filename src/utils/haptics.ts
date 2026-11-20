import { prefersReducedMotion } from './motion';
import { sfx } from './sfx';

function pulse(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (prefersReducedMotion() || sfx.isMuted()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore on browsers that block vibration before interaction
  }
}

export const haptics = {
  select: () => pulse(8),
  deselect: () => pulse(5),
  dragSwap: () => pulse(6),
  play: (tier: 'normal' | 'five' | 'bomb') => {
    if (tier === 'bomb') pulse([28, 28, 55]);
    else if (tier === 'five') pulse([14, 30, 22]);
    else pulse(14);
  },
  pass: () => pulse(10),
  yourTurn: () => pulse([12, 45, 12]),
  error: () => pulse([18, 28, 18]),
  win: () => pulse([18, 45, 18, 45, 42]),
};
