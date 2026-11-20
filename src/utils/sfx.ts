const STORAGE_KEY = 'capsa_muted';

class SoundFX {
  private ctx: AudioContext | null = null;
  private muted: boolean;

  constructor() {
    let saved = false;
    try {
      saved = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      saved = false;
    }
    this.muted = saved;
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // ignore
    }
    return this.muted;
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType, gainVal: number, delay = 0): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  cardSelect(): void {
    this.tone(540, 0.045, 'triangle', 0.05);
  }

  cardPlay(isBomb = false): void {
    if (isBomb) {
      this.tone(130, 0.22, 'sawtooth', 0.12);
      this.tone(220, 0.16, 'triangle', 0.09, 0.03);
      this.tone(440, 0.14, 'sine', 0.07, 0.06);
      return;
    }
    this.tone(320, 0.06, 'triangle', 0.08);
    this.tone(480, 0.07, 'sine', 0.06, 0.025);
  }

  pass(): void {
    this.tone(240, 0.09, 'sine', 0.05);
    this.tone(185, 0.1, 'sine', 0.04, 0.04);
  }

  yourTurn(): void {
    this.tone(587.33, 0.12, 'triangle', 0.095, 0);
    this.tone(880, 0.18, 'triangle', 0.1, 0.08);
    this.tone(1174.66, 0.22, 'sine', 0.055, 0.14);
  }

  turnNudge(): void {
    this.tone(783.99, 0.09, 'sine', 0.075, 0);
    this.tone(1046.5, 0.14, 'sine', 0.08, 0.09);
  }

  roundWin(): void {
    this.tone(523.25, 0.14, 'triangle', 0.07, 0);
    this.tone(659.25, 0.14, 'triangle', 0.07, 0.09);
    this.tone(783.99, 0.18, 'triangle', 0.08, 0.18);
    this.tone(1046.5, 0.28, 'sine', 0.08, 0.28);
  }

  playerFinished(rank: number): void {
    if (rank === 1) {
      this.tone(587.33, 0.11, 'triangle', 0.08, 0);
      this.tone(783.99, 0.12, 'triangle', 0.08, 0.07);
      this.tone(1174.66, 0.24, 'sine', 0.09, 0.15);
      return;
    }
    this.tone(440, 0.1, 'triangle', 0.065, 0);
    this.tone(659.25, 0.16, 'sine', 0.07, 0.08);
  }

  trickWon(): void {
    this.tone(392, 0.08, 'sine', 0.045, 0);
    this.tone(523.25, 0.11, 'sine', 0.05, 0.05);
  }
}

export const sfx = new SoundFX();
