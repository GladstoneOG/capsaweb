import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  Music,
  SkipForward,
  SlidersHorizontal,
  Vibrate,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { haptics } from '../utils/haptics';
import { music } from '../utils/music';
import { sfx } from '../utils/sfx';

interface SettingsMenuProps {
  /** Optional extra class on the wrapper */
  className?: string;
}

export function SettingsMenu({ className }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const musicSnap = useSyncExternalStore(music.subscribe, music.getSnapshot, music.getSnapshot);
  const sfxMuted = useSyncExternalStore(
    (cb) => sfx.subscribe(cb),
    () => sfx.isMuted(),
    () => sfx.isMuted()
  );
  const vibrationOn = useSyncExternalStore(
    (cb) => haptics.subscribe(cb),
    () => haptics.isEnabled(),
    () => haptics.isEnabled()
  );

  const vibrationSupported = haptics.isSupported();
  const allAudioOff = !musicSnap.enabled && sfxMuted;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const musicSub = !musicSnap.enabled
    ? 'Off · soft casino & bar jazz'
    : musicSnap.awaitingGesture
      ? 'Tap anywhere to start jazz'
      : musicSnap.currentTrack
        ? `♪ ${musicSnap.currentTrack.title}`
        : 'Soft casino & bar jazz';

  const volumePct = Math.round(musicSnap.volume * 100);

  return (
    <div ref={rootRef} className={`settings-menu${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className={`icon-btn settings-trigger${open ? ' is-active' : ''}`}
        aria-label="Audio & alert settings"
        title="Audio & alert settings"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={17} />
        {allAudioOff && <span className="settings-mute-pip" aria-hidden="true" />}
      </button>

      {open && (
        <div
          id={panelId}
          className="settings-popover"
          role="dialog"
          aria-label="Audio and alert settings"
        >
          <div className="settings-head">
            <span className="eyebrow settings-eyebrow">Audio &amp; Alerts</span>
            {musicSnap.enabled && musicSnap.currentTrack && (
              <span className="settings-scene-pill">
                {musicSnap.scene === 'game' ? 'Table' : 'Lounge'}
              </span>
            )}
          </div>

          <div className="settings-list">
            {/* Lounge Music */}
            <div className="settings-group">
              <div className="settings-row">
                <span className={`settings-ico${musicSnap.enabled ? ' is-gold' : ''}`} aria-hidden="true">
                  <Music size={15} />
                </span>
                <div className="settings-text">
                  <strong>Lounge Music</strong>
                  <small title={musicSnap.currentTrack?.subtitle}>{musicSub}</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={musicSnap.enabled}
                  aria-label="Toggle lounge music"
                  className={`toggle${musicSnap.enabled ? ' is-on' : ''}`}
                  onClick={() => music.toggle()}
                />
              </div>

              {musicSnap.enabled && (
                <div className="settings-music-bar">
                  <Volume1 size={13} className="settings-vol-ico" aria-hidden="true" />
                  <input
                    type="range"
                    className="settings-slider"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={musicSnap.volume}
                    aria-label="Lounge music volume"
                    onChange={(e) => music.setVolume(Number.parseFloat(e.target.value))}
                  />
                  <span className="settings-vol-pct">{volumePct}%</span>
                  <button
                    type="button"
                    className="settings-skip-btn"
                    title="Next jazz track"
                    aria-label="Next jazz track"
                    onClick={() => music.nextTrack()}
                  >
                    <SkipForward size={13} />
                  </button>
                </div>
              )}
            </div>

            {/* Sound Effects */}
            <div className="settings-row">
              <span className={`settings-ico${!sfxMuted ? ' is-mint' : ''}`} aria-hidden="true">
                {sfxMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </span>
              <div className="settings-text">
                <strong>Sound Effects</strong>
                <small>Card slaps, deals &amp; chimes</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!sfxMuted}
                aria-label="Toggle sound effects"
                className={`toggle${!sfxMuted ? ' is-on' : ''}`}
                onClick={() => {
                  const nowMuted = sfx.toggleMute();
                  if (!nowMuted) sfx.cardSelect(2, false);
                }}
              />
            </div>

            {/* Turn Vibration */}
            <div className="settings-row">
              <span className={`settings-ico${vibrationOn ? ' is-mint' : ''}`} aria-hidden="true">
                <Vibrate size={15} />
              </span>
              <div className="settings-text">
                <strong>Turn Vibration</strong>
                <small>
                  {vibrationSupported
                    ? 'Buzz on your turn & reminders'
                    : 'Turn buzz (supported mobile devices)'}
                </small>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={vibrationOn}
                aria-label="Toggle turn vibration"
                className={`toggle${vibrationOn ? ' is-on' : ''}`}
                onClick={() => haptics.toggle()}
              />
            </div>
          </div>

          {musicSnap.enabled && (
            <div className="settings-credit">
              Jazz by Kevin MacLeod · CC BY 4.0
            </div>
          )}
        </div>
      )}
    </div>
  );
}
