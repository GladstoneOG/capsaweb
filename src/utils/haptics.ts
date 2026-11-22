import { prefersReducedMotion } from './motion';

const STORAGE_KEY = 'capsa_vibration_enabled';

let enabled = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === null ? true : saved === '1';
  } catch {
    return true;
  }
})();

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function pulse(pattern: number | number[], isTurnAlert = false): void {
  if (!enabled || !isSupported()) return;
  // Subtle tactile UI micro-pulses respect reduced motion, while explicit turn alerts honor the Vibration toggle
  if (!isTurnAlert && prefersReducedMotion()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore on browsers that block vibration before user interaction
  }
}

function setEnabled(next: boolean): boolean {
  if (enabled === next) return enabled;
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore
  }
  if (!enabled && isSupported()) {
    try {
      navigator.vibrate(0);
    } catch {
      // ignore
    }
  }
  emit();
  return enabled;
}

export const haptics = {
  isSupported,
  isEnabled: (): boolean => enabled,
  setEnabled,
  toggle: (): boolean => {
    const next = setEnabled(!enabled);
    if (next) pulse([24, 45, 32], true);
    return next;
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  select: () => pulse(8),
  deselect: () => pulse(5),
  dragSwap: () => pulse(6),
  play: (tier: 'normal' | 'five' | 'bomb') => {
    if (tier === 'bomb') pulse([28, 28, 55]);
    else if (tier === 'five') pulse([14, 30, 22]);
    else pulse(14);
  },
  pass: () => pulse(10),
  /** Distinct double-buzz alert when your turn begins */
  yourTurn: () => pulse([45, 65, 60], true),
  /** Gentle reminder buzz if idle on your turn */
  turnNudge: () => pulse([30, 55, 30], true),
  error: () => pulse([18, 28, 18]),
  win: () => pulse([18, 45, 18, 45, 42]),
};
