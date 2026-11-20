import type { ComboType } from '@engine/types';

const STORAGE_KEY = 'capsa_muted';

// Pentatonic ladder for rising card-selection feedback (C5 -> A5)
const SELECT_SCALE = [523.25, 587.33, 659.25, 783.99, 880.0];

class SoundFX {
  private ctx: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;
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
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (!this.noiseBuf && this.ctx) {
      const length = Math.floor(this.ctx.sampleRate * 0.5);
      const buf = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      // Lightly shaped pink-ish noise for warm paper/felt acoustics
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.55) * 0.65));
      }
      this.noiseBuf = buf;
    }
    return this.ctx;
  }

  private jitter(spread = 0.04): number {
    return 1 + (Math.random() * 2 - 1) * spread;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gainVal: number,
    delay = 0,
    endFreq?: number
  ): void {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };
    osc.start(now);
    osc.stop(now + duration + 0.025);
  }

  private noiseBurst(
    duration: number,
    filterHz: number,
    q: number,
    gainVal: number,
    delay = 0,
    filterType: BiquadFilterType = 'bandpass',
    endFilterHz?: number
  ): void {
    const ctx = this.getContext();
    if (!ctx || !this.noiseBuf) return;
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterHz, now);
    if (endFilterHz !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, endFilterHz), now + duration);
    }
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + Math.min(0.004, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // ignore
      }
    };

    // Random offset into buffer so rapid bursts sound organic
    const maxOffset = Math.max(0, this.noiseBuf.duration - duration - 0.02);
    const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;
    src.start(now, offset, duration + 0.02);
  }

  /** Crisp cardstock flick + subtle rising pentatonic cue */
  cardSelect(selectionCount = 1, isDeselect = false): void {
    const j = this.jitter(0.035);
    if (isDeselect) {
      this.noiseBurst(0.028, 1500 * j, 1.4, 0.065);
      this.tone(392 * j, 0.04, 'triangle', 0.028, 0, 310 * j);
      return;
    }
    const idx = Math.max(0, Math.min(SELECT_SCALE.length - 1, selectionCount - 1));
    const note = SELECT_SCALE[idx] * j;
    this.noiseBurst(0.026, 2400 * j, 1.3, 0.075);
    this.tone(note, 0.055, 'triangle', 0.04);
  }

  /** Ultra-light cardstock brush on drag reorder swap */
  dragSwap(): void {
    const j = this.jitter(0.05);
    this.noiseBurst(0.018, 3000 * j, 1.6, 0.042);
  }

  /** Riffle snap during round-start card deal */
  dealCard(index = 0): void {
    const pitchBoost = 1 + Math.min(index, 14) * 0.022;
    const j = this.jitter(0.03) * pitchBoost;
    this.noiseBurst(0.024, 2100 * j, 1.3, 0.048);
    this.tone(240 * j, 0.028, 'sine', 0.018, 0, 140);
  }

  /** Quick 3-snap shuffle when toggling Rank/Suit sort */
  sortShuffle(): void {
    for (let i = 0; i < 3; i++) {
      const j = this.jitter(0.04);
      this.noiseBurst(0.024, (1900 + i * 320) * j, 1.4, 0.055, i * 0.032);
    }
  }

  /** Tiered card-table slap + harmonic combo sweetener */
  cardPlay(comboOrBomb: boolean | ComboType = false, cardCount = 1, hasBigTwo = false): void {
    const combo: ComboType =
      typeof comboOrBomb === 'boolean' ? (comboOrBomb ? 'bomber' : 'single') : comboOrBomb;

    // 1. Staggered physical card slaps onto felt
    const slaps = Math.max(1, Math.min(cardCount, combo === 'bomber' || combo === 'straightflush' ? 5 : 4));
    const stagger = slaps >= 4 ? 0.028 : 0.038;
    for (let i = 0; i < slaps; i++) {
      const d = i * stagger;
      const j = this.jitter(0.04);
      this.noiseBurst(0.042, (1150 + i * 90) * j, 1.0, 0.095, d);
      this.tone(125 * j, 0.065, 'sine', 0.075, d, 48);
    }

    // 2. Combo-tier harmonic signature
    if (combo === 'bomber' || combo === 'straightflush') {
      // Heavy sub-bass thump + impact crackle + dramatic chord
      this.noiseBurst(0.22, 900, 0.7, 0.16, 0.02, 'lowpass', 180);
      this.tone(105, 0.28, 'sine', 0.18, 0.01, 34);
      this.tone(146.83, 0.24, 'sawtooth', 0.085, 0.02, 138);
      this.tone(220, 0.22, 'triangle', 0.09, 0.04);
      this.tone(293.66, 0.24, 'triangle', 0.08, 0.065);
      if (combo === 'straightflush') {
        this.tone(587.33, 0.34, 'sine', 0.085, 0.09);
        this.tone(880, 0.38, 'sine', 0.075, 0.13);
      }
      return;
    }

    if (combo === 'fullhouse') {
      this.tone(110, 0.14, 'sine', 0.12, 0.02, 46);
      this.tone(392, 0.14, 'triangle', 0.075, 0.04);
      this.tone(587.33, 0.18, 'triangle', 0.08, 0.085);
      this.tone(783.99, 0.24, 'sine', 0.07, 0.13);
      return;
    }

    if (combo === 'flush') {
      this.tone(329.63, 0.14, 'triangle', 0.06, 0.03);
      this.tone(415.3, 0.15, 'triangle', 0.065, 0.07);
      this.tone(493.88, 0.18, 'sine', 0.065, 0.11);
      this.tone(622.25, 0.22, 'sine', 0.055, 0.15);
      return;
    }

    if (combo === 'straight') {
      this.tone(392, 0.09, 'triangle', 0.06, 0.03);
      this.tone(440, 0.09, 'triangle', 0.06, 0.065);
      this.tone(523.25, 0.12, 'triangle', 0.065, 0.1);
      this.tone(659.25, 0.18, 'sine', 0.065, 0.14);
      return;
    }

    // Metallic glint ping when slamming the Big Two (2♠)
    if (hasBigTwo) {
      this.tone(1046.5, 0.14, 'sine', 0.065, 0.03);
      this.tone(1567.98, 0.2, 'sine', 0.05, 0.07);
    }
  }

  /** Local player pass */
  pass(): void {
    const j = this.jitter(0.03);
    this.noiseBurst(0.055, 780 * j, 0.9, 0.065, 0, 'lowpass');
    this.tone(250 * j, 0.09, 'sine', 0.045, 0, 195);
    this.tone(185 * j, 0.11, 'sine', 0.038, 0.045, 160);
  }

  /** Subtle double table-knock / brush when an opponent passes */
  opponentPass(): void {
    const j = this.jitter(0.05);
    this.noiseBurst(0.032, 620 * j, 1.2, 0.052, 0, 'bandpass');
    this.tone(175 * j, 0.045, 'sine', 0.038, 0, 110);
    this.noiseBurst(0.028, 560 * j, 1.2, 0.038, 0.065, 'bandpass');
  }

  /** Crisp invalid-selection reject thud */
  invalidAction(): void {
    this.tone(175, 0.07, 'triangle', 0.065, 0, 130);
    this.tone(140, 0.09, 'triangle', 0.06, 0.065, 105);
  }

  /** Soft wood-block countdown tick during final 5s of your turn */
  timerTick(secsLeft: number): void {
    const urgent = secsLeft <= 2;
    const freq = urgent ? 1120 : 840;
    this.tone(freq, 0.038, 'sine', urgent ? 0.07 : 0.045, 0, freq * 0.72);
    this.noiseBurst(0.015, 2200, 2.2, urgent ? 0.05 : 0.03);
  }

  /** Tense ping when any player hits 1 card remaining */
  lowCardAlert(): void {
    this.tone(698.46, 0.12, 'triangle', 0.065, 0);
    this.tone(932.33, 0.18, 'sine', 0.065, 0.11);
  }

  yourTurn(): void {
    this.tone(587.33, 0.11, 'triangle', 0.085, 0);
    this.tone(880, 0.17, 'triangle', 0.09, 0.075);
    this.tone(1174.66, 0.22, 'sine', 0.05, 0.135);
  }

  turnNudge(): void {
    this.tone(783.99, 0.09, 'sine', 0.07, 0);
    this.tone(1046.5, 0.14, 'sine', 0.075, 0.09);
  }

  trickWon(): void {
    // Felt sweep + warm 2-note resolution
    this.noiseBurst(0.18, 950, 0.8, 0.06, 0, 'bandpass', 420);
    this.tone(392, 0.085, 'sine', 0.045, 0.03);
    this.tone(523.25, 0.12, 'sine', 0.05, 0.08);
  }

  playerFinished(rank: number): void {
    if (rank === 1) {
      this.tone(587.33, 0.11, 'triangle', 0.08, 0);
      this.tone(783.99, 0.12, 'triangle', 0.08, 0.07);
      this.tone(1174.66, 0.26, 'sine', 0.09, 0.15);
      return;
    }
    this.tone(440, 0.1, 'triangle', 0.065, 0);
    this.tone(659.25, 0.16, 'sine', 0.07, 0.08);
  }

  roundWin(isMatch = false): void {
    this.tone(523.25, 0.14, 'triangle', 0.075, 0);
    this.tone(659.25, 0.14, 'triangle', 0.075, 0.085);
    this.tone(783.99, 0.18, 'triangle', 0.08, 0.17);
    this.tone(1046.5, 0.32, 'sine', 0.085, 0.26);
    if (isMatch) {
      this.tone(1318.5, 0.36, 'sine', 0.065, 0.35);
      this.tone(1567.98, 0.44, 'sine', 0.06, 0.43);
    }
  }

  /** Respectful, mellow resolution when losing a round or match */
  roundLose(isMatch = false): void {
    this.tone(392, 0.16, 'triangle', 0.055, 0);
    this.tone(349.23, 0.18, 'triangle', 0.05, 0.12);
    this.tone(isMatch ? 261.63 : 329.63, 0.32, 'sine', 0.055, 0.24);
  }

  /** Subtle ascending tick for scoreboard count-up */
  scoreTick(step = 0): void {
    const freq = 660 + Math.min(step, 8) * 42;
    this.tone(freq, 0.032, 'sine', 0.032);
  }

  /** Dice Duel rattle tick */
  diceTick(): void {
    const j = this.jitter(0.08);
    this.noiseBurst(0.022, 1800 * j, 1.8, 0.055);
    this.tone(420 * j, 0.025, 'triangle', 0.03);
  }

  /** Dice Duel land thud + optional winner chime */
  diceLand(withFanfare = false): void {
    this.noiseBurst(0.05, 920, 1.1, 0.09);
    this.tone(150, 0.07, 'sine', 0.085, 0, 62);
    if (withFanfare) {
      this.tone(587.33, 0.12, 'triangle', 0.07, 0.16);
      this.tone(880, 0.22, 'sine', 0.075, 0.24);
    }
  }

  /** Card trade completed swap shimmer */
  tradeComplete(): void {
    this.noiseBurst(0.07, 2200, 1.2, 0.055, 0, 'bandpass', 1200);
    this.tone(523.25, 0.1, 'sine', 0.05, 0.03);
    this.tone(783.99, 0.16, 'sine', 0.055, 0.09);
  }
}

export const sfx = new SoundFX();
