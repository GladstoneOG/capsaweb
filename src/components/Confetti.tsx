import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../utils/motion';

const COLORS = ['#f2c66d', '#ffe1a0', '#5eead4', '#ff7a6b', '#fffdf8', '#7dd3fc'];
const SUITS = ['♦', '♥', '♠', '♣'] as const;

type ParticleShape = 'ribbon' | 'circle' | 'diamond' | 'suit';

interface ConfettiPart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  phase: number;
  sway: number;
  w: number;
  h: number;
  c: string;
  shape: ParticleShape;
  suit?: (typeof SUITS)[number];
  delayMs: number;
}

function makeConfettiParticles(
  count: number,
  w: number,
  h: number,
  mode: 'round' | 'match'
): ConfettiPart[] {
  const parts: ConfettiPart[] = [];
  for (let i = 0; i < count; i++) {
    const roll = Math.random();
    const shape: ParticleShape =
      roll < 0.62 ? 'ribbon' : roll < 0.78 ? 'circle' : roll < 0.9 ? 'diamond' : 'suit';
    const c = COLORS[Math.floor(Math.random() * COLORS.length)];

    if (mode === 'match') {
      // Dual side cannons + gentle delayed second wave
      const fromLeft = i % 2 === 0;
      const isSecondWave = i >= Math.floor(count * 0.62);
      const speed = 10 + Math.random() * 11;
      const angle = fromLeft
        ? -Math.PI * (0.18 + Math.random() * 0.24)
        : -Math.PI * (0.58 + Math.random() * 0.24);
      parts.push({
        x: fromLeft ? w * 0.04 : w * 0.96,
        y: h * (0.72 + Math.random() * 0.16),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3.5,
        r: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.26,
        phase: Math.random() * Math.PI * 2,
        sway: 0.4 + Math.random() * 0.9,
        w: 6 + Math.random() * 5,
        h: 9 + Math.random() * 7,
        c,
        shape,
        suit: shape === 'suit' ? SUITS[i % SUITS.length] : undefined,
        delayMs: isSecondWave ? 260 : 0,
      });
    } else {
      parts.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.34,
        y: h * 0.36,
        vx: (Math.random() - 0.5) * 13.5,
        vy: -Math.random() * 13 - 4.5,
        r: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.28,
        phase: Math.random() * Math.PI * 2,
        sway: 0.35 + Math.random() * 0.8,
        w: 6 + Math.random() * 5,
        h: 8 + Math.random() * 7,
        c,
        shape,
        suit: shape === 'suit' ? SUITS[i % SUITS.length] : undefined,
        delayMs: 0,
      });
    }
  }
  return parts;
}

/**
 * One-shot delta-time-normalized canvas confetti burst.
 * Self-terminates & unmounts canvas when complete; skipped for reduced-motion users.
 */
export function Confetti({
  count = 85,
  duration = 2400,
  mode = 'round',
}: {
  count?: number;
  duration?: number;
  mode?: 'round' | 'match';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (done || prefersReducedMotion()) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = window.innerWidth;
    let h = window.innerHeight;
    const sizeCanvas = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    };
    sizeCanvas();

    // Keep particle counts modest for 60/120fps across desktop & mobile
    const cappedCount = Math.min(count, mode === 'match' ? 110 : 75);
    const parts = makeConfettiParticles(cappedCount, w, h, mode);

    const onResize = () => sizeCanvas();
    window.addEventListener('resize', onResize, { passive: true });

    let raf = 0;
    const start = performance.now();
    let prevT = start;

    const tick = (t: number) => {
      const elapsed = t - start;
      const dt = Math.min(32, Math.max(0.5, t - prevT)) / 16.667;
      prevT = t;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const fade = Math.max(0, 1 - Math.max(0, elapsed - duration * 0.62) / (duration * 0.38));
      ctx.globalAlpha = fade;

      const drag = Math.pow(0.985, dt);
      for (const p of parts) {
        if (elapsed < p.delayMs) continue;
        p.vy += 0.34 * dt;
        p.vx *= drag;
        p.phase += 0.09 * dt;
        p.x += (p.vx + Math.sin(p.phase) * p.sway) * dt;
        p.y += p.vy * dt;
        p.r += p.vr * dt;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.w * 0.42, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'diamond') {
          const rx = p.w * 0.52;
          const ry = p.h * 0.56;
          ctx.beginPath();
          ctx.moveTo(0, -ry);
          ctx.lineTo(rx, 0);
          ctx.lineTo(0, ry);
          ctx.lineTo(-rx, 0);
          ctx.closePath();
          ctx.fill();
        } else if (p.shape === 'suit' && p.suit) {
          ctx.font = `700 ${Math.round(p.h + 4)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.suit, 0, 0);
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1.2);
        }
        ctx.restore();
      }

      if (elapsed < duration) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
        setDone(true);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [count, duration, mode, done]);

  if (done) return null;
  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}

export interface BurstEvent {
  id: number;
  x: number;
  y: number;
  variant: 'fullhouse' | 'bomb' | 'straightflush' | 'finish';
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  c: string;
  isDiamond: boolean;
}

const BURST_PALETTES: Record<BurstEvent['variant'], string[]> = {
  fullhouse: ['#ffe5a3', '#f2c66d', '#fffdf8'],
  bomb: ['#ffe294', '#ff7a5c', '#f2c66d', '#fffdf8'],
  straightflush: ['#ffe5a3', '#5eead4', '#7dd3fc', '#fffdf8'],
  finish: ['#ffe9ab', '#5eead4', '#f2c66d', '#fffdf8'],
};

/**
 * Short one-shot canvas spark burst for peak plays (Full House, Bomber, Straight Flush, Player-Out).
 * Tears down completely when idle (0% idle CPU/GPU).
 */
export function ImpactBurst({ burst }: { burst: BurstEvent | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    if (!burst || prefersReducedMotion()) {
      setActiveId(null);
      return;
    }
    setActiveId(burst.id);
  }, [burst]);

  useEffect(() => {
    if (!burst || activeId !== burst.id || prefersReducedMotion()) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const palette = BURST_PALETTES[burst.variant];
    const count =
      burst.variant === 'bomb' || burst.variant === 'straightflush'
        ? 38
        : burst.variant === 'finish'
          ? 24
          : 18;
    const maxDuration = burst.variant === 'bomb' || burst.variant === 'straightflush' ? 860 : 680;

    const sparks: Spark[] = Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
      const speed =
        (burst.variant === 'bomb' || burst.variant === 'straightflush' ? 4.5 : 3.2) +
        Math.random() * 6.2;
      return {
        x: burst.x,
        y: burst.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.2,
        size: 2.5 + Math.random() * 3.8,
        life: 0,
        maxLife: maxDuration * (0.65 + Math.random() * 0.35),
        c: palette[i % palette.length],
        isDiamond: i % 3 === 0,
      };
    });

    let raf = 0;
    const start = performance.now();
    let prevT = start;

    const tick = (t: number) => {
      const elapsed = t - start;
      const dtMs = Math.min(32, Math.max(1, t - prevT));
      const dt = dtMs / 16.667;
      prevT = t;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const drag = Math.pow(0.93, dt);
      let alive = false;
      for (const s of sparks) {
        s.life += dtMs;
        if (s.life >= s.maxLife) continue;
        alive = true;
        s.vx *= drag;
        s.vy = s.vy * drag + 0.16 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;

        const progress = s.life / s.maxLife;
        const alpha = 1 - progress * progress;
        const radius = s.size * (1 - progress * 0.55);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.c;
        if (s.isDiamond) {
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - radius * 1.4);
          ctx.lineTo(s.x + radius, s.y);
          ctx.lineTo(s.x, s.y + radius * 1.4);
          ctx.lineTo(s.x - radius, s.y);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (alive && elapsed < maxDuration + 60) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
        setActiveId(null);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burst, activeId]);

  if (!burst || activeId !== burst.id) return null;
  return <canvas ref={ref} className="impact-burst-canvas" aria-hidden="true" />;
}
