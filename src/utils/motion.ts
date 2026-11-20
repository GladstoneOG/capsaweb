/**
 * Motion preferences & lightweight Web Animations API (WAAPI) helpers.
 * All animations strictly use GPU-composited `transform` and `opacity`.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function shakeElement(
  el: HTMLElement | null,
  variant: 'bomb' | 'heavy' | 'reject' = 'bomb'
): void {
  if (!el || prefersReducedMotion() || typeof el.animate !== 'function') return;

  if (variant === 'reject') {
    el.animate(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(-6px, 0, 0)', offset: 0.2 },
        { transform: 'translate3d(5px, 0, 0)', offset: 0.45 },
        { transform: 'translate3d(-4px, 0, 0)', offset: 0.7 },
        { transform: 'translate3d(2px, 0, 0)', offset: 0.88 },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 280, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' }
    );
    return;
  }

  if (variant === 'heavy') {
    el.animate(
      [
        { transform: 'translate3d(0, 0, 0)' },
        { transform: 'translate3d(0, 3px, 0)', offset: 0.3 },
        { transform: 'translate3d(0, -1.5px, 0)', offset: 0.65 },
        { transform: 'translate3d(0, 0, 0)' },
      ],
      { duration: 190, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
    return;
  }

  // Bomb / Straight Flush directional kick with subtle rotational punch
  el.animate(
    [
      { transform: 'translate3d(0, 0, 0) rotate(0deg)' },
      { transform: 'translate3d(-7px, 3px, 0) rotate(-0.6deg)', offset: 0.16 },
      { transform: 'translate3d(7px, -3px, 0) rotate(0.55deg)', offset: 0.34 },
      { transform: 'translate3d(-5px, 2px, 0) rotate(-0.35deg)', offset: 0.54 },
      { transform: 'translate3d(3px, -1px, 0) rotate(0.2deg)', offset: 0.76 },
      { transform: 'translate3d(0, 0, 0) rotate(0deg)' },
    ],
    { duration: 360, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' }
  );
}
