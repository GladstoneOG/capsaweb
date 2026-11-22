import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '../src/utils/haptics';
import { MUSIC_TRACKS, music } from '../src/utils/music';
import { sfx } from '../src/utils/sfx';

describe('Lounge Music Catalog & Independent Audio/Haptic Toggles', () => {
  afterEach(() => {
    sfx.setMuted(false);
    haptics.setEnabled(true);
    music.setEnabled(true);
    vi.unstubAllGlobals();
  });

  it('provides 5-10 distinct jazz tracks split cleanly between lobby and in-game', () => {
    expect(MUSIC_TRACKS.length).toBeGreaterThanOrEqual(5);
    expect(MUSIC_TRACKS.length).toBeLessThanOrEqual(10);

    const lobbyTracks = MUSIC_TRACKS.filter((t) => t.scene === 'lobby');
    const gameTracks = MUSIC_TRACKS.filter((t) => t.scene === 'game');
    expect(lobbyTracks.length).toBeGreaterThanOrEqual(3);
    expect(gameTracks.length).toBeGreaterThanOrEqual(3);

    const lobbySrcs = new Set(lobbyTracks.map((t) => t.src));
    for (const track of gameTracks) {
      expect(lobbySrcs.has(track.src)).toBe(false);
    }

    const publicDir = path.resolve(__dirname, '../public');
    for (const track of MUSIC_TRACKS) {
      const filePath = path.join(publicDir, track.src.replace(/^\//, ''));
      expect(fs.existsSync(filePath), `Missing audio asset ${filePath}`).toBe(true);
      const stats = fs.statSync(filePath);
      expect(stats.size).toBeGreaterThan(100_000);
    }
  });

  it('toggles music, sfx, and turn vibration independently', () => {
    music.setEnabled(false);
    expect(music.isEnabled()).toBe(false);
    expect(sfx.isMuted()).toBe(false);
    expect(haptics.isEnabled()).toBe(true);

    sfx.setMuted(true);
    expect(sfx.isMuted()).toBe(true);
    expect(music.isEnabled()).toBe(false);
    expect(haptics.isEnabled()).toBe(true);

    music.setEnabled(true);
    expect(music.isEnabled()).toBe(true);
    expect(sfx.isMuted()).toBe(true);

    haptics.setEnabled(false);
    expect(haptics.isEnabled()).toBe(false);
    expect(music.isEnabled()).toBe(true);
  });

  it('vibrates on turn alerts even when SFX is muted, and respects vibration toggle', () => {
    const vibrateMock = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate: vibrateMock });

    sfx.setMuted(true);
    haptics.setEnabled(true);

    haptics.yourTurn();
    expect(vibrateMock).toHaveBeenCalledTimes(1);

    haptics.turnNudge();
    expect(vibrateMock).toHaveBeenCalledTimes(2);

    vibrateMock.mockClear();
    haptics.setEnabled(false);
    // Turning off cancels any active vibration with 0
    expect(vibrateMock).toHaveBeenCalledWith(0);

    vibrateMock.mockClear();
    haptics.yourTurn();
    haptics.turnNudge();
    expect(vibrateMock).not.toHaveBeenCalled();
  });
});
