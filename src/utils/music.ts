export type MusicScene = 'lobby' | 'game';

export interface MusicTrack {
  id: string;
  title: string;
  subtitle: string;
  artist: string;
  scene: MusicScene;
  src: string;
}

export interface MusicSnapshot {
  enabled: boolean;
  volume: number; // 0..1 user preference
  scene: MusicScene;
  currentTrack: MusicTrack | null;
  isPlaying: boolean;
  awaitingGesture: boolean;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  // Lobby / Lounge playlist (4 tracks)
  {
    id: 'lobby-night-in-venice',
    title: 'Night in Venice',
    subtitle: 'Alto sax · vintage piano',
    artist: 'Kevin MacLeod',
    scene: 'lobby',
    src: '/music/lobby-night-in-venice.mp3',
  },
  {
    id: 'lobby-lobby-time',
    title: 'Lobby Time',
    subtitle: 'Vibraphone · lounge piano',
    artist: 'Kevin MacLeod',
    scene: 'lobby',
    src: '/music/lobby-lobby-time.mp3',
  },
  {
    id: 'lobby-backbay-lounge',
    title: 'Backbay Lounge',
    subtitle: 'Piano · guitar · soft drums',
    artist: 'Kevin MacLeod',
    scene: 'lobby',
    src: '/music/lobby-backbay-lounge.mp3',
  },
  {
    id: 'lobby-long-stroll',
    title: 'Long Stroll',
    subtitle: 'Trumpet · piano · brushed kit',
    artist: 'Kevin MacLeod',
    scene: 'lobby',
    src: '/music/lobby-long-stroll.mp3',
  },

  // In-Game Table playlist (5 tracks)
  {
    id: 'game-acid-trumpet',
    title: 'Acid Trumpet',
    subtitle: 'Muted trumpet · electric piano',
    artist: 'Kevin MacLeod',
    scene: 'game',
    src: '/music/game-acid-trumpet.mp3',
  },
  {
    id: 'game-night-on-the-docks',
    title: 'Night on the Docks',
    subtitle: 'Tenor sax · lounge keys',
    artist: 'Kevin MacLeod',
    scene: 'game',
    src: '/music/game-night-on-the-docks.mp3',
  },
  {
    id: 'game-hard-boiled',
    title: 'Hard Boiled',
    subtitle: 'Upright bass · piano · drums',
    artist: 'Kevin MacLeod',
    scene: 'game',
    src: '/music/game-hard-boiled.mp3',
  },
  {
    id: 'game-just-as-soon',
    title: 'Just As Soon',
    subtitle: 'Tenor sax · brushed drums',
    artist: 'Kevin MacLeod',
    scene: 'game',
    src: '/music/game-just-as-soon.mp3',
  },
  {
    id: 'game-cool-vibes',
    title: 'Cool Vibes',
    subtitle: 'Slow jazz vibraphone trio',
    artist: 'Kevin MacLeod',
    scene: 'game',
    src: '/music/game-cool-vibes.mp3',
  },
];

const ENABLED_KEY = 'capsa_music_enabled';
const VOLUME_KEY = 'capsa_music_volume';
const DEFAULT_VOLUME = 0.45;
const MAX_OUTPUT_GAIN = 0.40;
const FADE_IN_MS = 950;
const FADE_OUT_MS = 750;

function shuffleTracks(tracks: MusicTrack[], avoidFirstId?: string): MusicTrack[] {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (avoidFirstId && arr.length > 1 && arr[0].id === avoidFirstId) {
    const swapIdx = 1 + Math.floor(Math.random() * (arr.length - 1));
    [arr[0], arr[swapIdx]] = [arr[swapIdx], arr[0]];
  }
  return arr;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function toOutputGain(userVolume: number): number {
  const v = clamp(userVolume, 0, 1);
  if (v <= 0.001) return 0;
  return Math.pow(v, 1.35) * MAX_OUTPUT_GAIN;
}

interface Deck {
  audio: HTMLAudioElement;
  track: MusicTrack;
  fadeToken: number;
  cleanupListeners: () => void;
}

class LoungeMusicPlayer {
  private enabled: boolean;
  private volume: number;
  private scene: MusicScene = 'lobby';
  private activeDeck: Deck | null = null;
  private fadingDecks = new Set<Deck>();
  private queues: Record<MusicScene, MusicTrack[]> = { lobby: [], game: [] };
  private lastTrackId: Record<MusicScene, string | null> = { lobby: null, game: null };
  private isPlaying = false;
  private awaitingGesture = false;
  private unlockBound = false;
  private consecutiveErrors = 0;
  private listeners = new Set<() => void>();
  private snapshot: MusicSnapshot;

  constructor() {
    this.enabled = this.loadEnabled();
    this.volume = this.loadVolume();
    this.snapshot = this.buildSnapshot();
  }

  private loadEnabled(): boolean {
    try {
      const raw = localStorage.getItem(ENABLED_KEY);
      return raw === null ? true : raw === '1';
    } catch {
      return true;
    }
  }

  private loadVolume(): number {
    try {
      const raw = localStorage.getItem(VOLUME_KEY);
      if (raw === null) return DEFAULT_VOLUME;
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? clamp(parsed, 0.05, 1) : DEFAULT_VOLUME;
    } catch {
      return DEFAULT_VOLUME;
    }
  }

  private buildSnapshot(): MusicSnapshot {
    return {
      enabled: this.enabled,
      volume: this.volume,
      scene: this.scene,
      currentTrack: this.activeDeck?.track ?? null,
      isPlaying: this.isPlaying,
      awaitingGesture: this.awaitingGesture,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MusicSnapshot => {
    return this.snapshot;
  };

  isEnabled(): boolean {
    return this.enabled;
  }

  getVolume(): number {
    return this.volume;
  }

  setScene(nextScene: MusicScene): void {
    const changed = this.scene !== nextScene;
    this.scene = nextScene;

    if (!this.enabled) {
      if (changed) this.emit();
      return;
    }

    if (changed || !this.activeDeck) {
      this.playNextForScene(nextScene);
    }
  }

  setEnabled(next: boolean): boolean {
    if (this.enabled === next) return this.enabled;
    this.enabled = next;
    try {
      localStorage.setItem(ENABLED_KEY, this.enabled ? '1' : '0');
    } catch {
      // ignore
    }

    if (this.enabled) {
      this.consecutiveErrors = 0;
      if (this.activeDeck && this.activeDeck.track.scene === this.scene) {
        this.resumeDeck(this.activeDeck);
      } else {
        this.playNextForScene(this.scene);
      }
    } else {
      this.awaitingGesture = false;
      this.unbindUnlockListeners();
      this.stopActiveDeck(true);
    }

    this.emit();
    return this.enabled;
  }

  toggle(): boolean {
    return this.setEnabled(!this.enabled);
  }

  setVolume(nextVol: number): void {
    const clamped = clamp(nextVol, 0.05, 1);
    if (Math.abs(clamped - this.volume) < 0.002) return;
    this.volume = clamped;
    try {
      localStorage.setItem(VOLUME_KEY, clamped.toFixed(2));
    } catch {
      // ignore
    }
    if (this.activeDeck && this.isPlaying) {
      this.activeDeck.fadeToken += 1;
      this.activeDeck.audio.volume = toOutputGain(this.volume);
    }
    this.emit();
  }

  nextTrack(): void {
    if (!this.enabled) {
      this.setEnabled(true);
      return;
    }
    this.consecutiveErrors = 0;
    this.playNextForScene(this.scene);
  }

  private drawTrack(scene: MusicScene): MusicTrack {
    if (this.queues[scene].length === 0) {
      const pool = MUSIC_TRACKS.filter((t) => t.scene === scene);
      this.queues[scene] = shuffleTracks(pool, this.lastTrackId[scene] ?? undefined);
    }
    const next = this.queues[scene].shift()!;
    this.lastTrackId[scene] = next.id;
    return next;
  }

  private playNextForScene(scene: MusicScene): void {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
    const track = this.drawTrack(scene);
    this.crossfadeTo(track);
  }

  private crossfadeTo(track: MusicTrack): void {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    // Fade out previous active deck smoothly
    if (this.activeDeck) {
      const outgoing = this.activeDeck;
      this.activeDeck = null;
      this.fadeOutAndDispose(outgoing, FADE_OUT_MS);
    }

    const audio = new Audio(track.src);
    audio.preload = 'auto';
    audio.volume = 0;

    const deck: Deck = {
      audio,
      track,
      fadeToken: 0,
      cleanupListeners: () => {},
    };

    const onEnded = () => {
      if (this.activeDeck !== deck || !this.enabled) return;
      this.consecutiveErrors = 0;
      this.playNextForScene(this.scene);
    };

    const onError = () => {
      if (this.activeDeck !== deck || !this.enabled) return;
      this.consecutiveErrors += 1;
      const poolSize = MUSIC_TRACKS.filter((t) => t.scene === this.scene).length;
      if (this.consecutiveErrors < poolSize) {
        this.playNextForScene(this.scene);
      } else {
        this.isPlaying = false;
        this.emit();
      }
    };

    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    deck.cleanupListeners = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };

    this.activeDeck = deck;
    this.emit();

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          if (this.activeDeck !== deck || !this.enabled) {
            this.disposeDeck(deck);
            return;
          }
          this.consecutiveErrors = 0;
          this.isPlaying = true;
          this.awaitingGesture = false;
          this.unbindUnlockListeners();
          this.fadeVolume(deck, toOutputGain(this.volume), FADE_IN_MS);
          this.emit();
        })
        .catch(() => {
          if (this.activeDeck !== deck) return;
          // Autoplay blocked until first user gesture
          this.isPlaying = false;
          if (this.enabled) {
            this.awaitingGesture = true;
            this.bindUnlockListeners();
          }
          this.emit();
        });
    } else {
      this.isPlaying = true;
      this.awaitingGesture = false;
      this.fadeVolume(deck, toOutputGain(this.volume), FADE_IN_MS);
      this.emit();
    }
  }

  private resumeDeck(deck: Deck): void {
    const playPromise = deck.audio.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          if (this.activeDeck !== deck || !this.enabled) return;
          this.isPlaying = true;
          this.awaitingGesture = false;
          this.unbindUnlockListeners();
          this.fadeVolume(deck, toOutputGain(this.volume), FADE_IN_MS * 0.7);
          this.emit();
        })
        .catch(() => {
          if (this.activeDeck !== deck) return;
          this.isPlaying = false;
          if (this.enabled) {
            this.awaitingGesture = true;
            this.bindUnlockListeners();
          }
          this.emit();
        });
    }
  }

  private stopActiveDeck(fade: boolean): void {
    const deck = this.activeDeck;
    this.isPlaying = false;
    if (!deck) return;
    if (fade) {
      this.activeDeck = null;
      this.fadeOutAndDispose(deck, FADE_OUT_MS * 0.65);
    } else {
      this.activeDeck = null;
      this.disposeDeck(deck);
    }
  }

  private fadeOutAndDispose(deck: Deck, durationMs: number): void {
    this.fadingDecks.add(deck);
    this.fadeVolume(deck, 0, durationMs, () => {
      this.fadingDecks.delete(deck);
      this.disposeDeck(deck);
    });
  }

  private disposeDeck(deck: Deck): void {
    deck.fadeToken += 1;
    deck.cleanupListeners();
    try {
      deck.audio.pause();
      deck.audio.removeAttribute('src');
      deck.audio.load();
    } catch {
      // ignore
    }
  }

  private fadeVolume(deck: Deck, target: number, durationMs: number, onDone?: () => void): void {
    const token = ++deck.fadeToken;
    const startVol = deck.audio.volume;
    const clampedTarget = clamp(target, 0, 1);

    if (durationMs <= 16 || Math.abs(clampedTarget - startVol) < 0.002) {
      deck.audio.volume = clampedTarget;
      onDone?.();
      return;
    }

    const startTime = performance.now();
    const step = () => {
      if (deck.fadeToken !== token) return;
      const elapsed = performance.now() - startTime;
      const progress = clamp(elapsed / durationMs, 0, 1);
      // Smooth ease-out curve
      const eased = 1 - Math.pow(1 - progress, 2);
      deck.audio.volume = clamp(startVol + (clampedTarget - startVol) * eased, 0, 1);
      if (progress < 1) {
        if (typeof document !== 'undefined' && document.hidden) {
          window.setTimeout(step, 40);
        } else {
          window.requestAnimationFrame(step);
        }
      } else {
        deck.audio.volume = clampedTarget;
        onDone?.();
      }
    };

    if (typeof document !== 'undefined' && document.hidden) {
      window.setTimeout(step, 40);
    } else {
      window.requestAnimationFrame(step);
    }
  }

  private handleUserGesture = (): void => {
    if (!this.enabled || !this.awaitingGesture) {
      this.unbindUnlockListeners();
      return;
    }
    this.unbindUnlockListeners();
    if (this.activeDeck && this.activeDeck.track.scene === this.scene) {
      this.resumeDeck(this.activeDeck);
    } else {
      this.playNextForScene(this.scene);
    }
  };

  private bindUnlockListeners(): void {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    window.addEventListener('pointerdown', this.handleUserGesture, { passive: true, capture: true });
    window.addEventListener('keydown', this.handleUserGesture, { passive: true, capture: true });
    window.addEventListener('touchstart', this.handleUserGesture, { passive: true, capture: true });
  }

  private unbindUnlockListeners(): void {
    if (!this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = false;
    window.removeEventListener('pointerdown', this.handleUserGesture, { capture: true });
    window.removeEventListener('keydown', this.handleUserGesture, { capture: true });
    window.removeEventListener('touchstart', this.handleUserGesture, { capture: true });
  }
}

export const music = new LoungeMusicPlayer();
