import { useState, type CSSProperties } from 'react';
import { Check, Copy, Crown, LogOut, Plus, Share2, Sparkles, Wifi, X } from 'lucide-react';
import type { CapsaRules, ClientIntent, SanitizedRoomState } from '@engine/types';
import { Avatar } from './Avatar';

interface LobbyViewProps {
  room: SanitizedRoomState;
  error: string | null;
  onIntent: (intent: ClientIntent) => void;
  onLeave: () => void;
}

const TARGET_SCORES = [5, 10, 15, 20, 30];
const TURN_TIMERS = [
  { label: 'Off', value: 0 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
];

function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle${on ? ' is-on' : ''}`}
      onClick={onClick}
    />
  );
}

export function LobbyView({ room, error, onIntent, onLeave }: LobbyViewProps) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === room.viewerId);
  const isHost = Boolean(me?.isHost);
  const allReady = room.players.every((p) => p.isReady || p.isHost);
  const emptySlots = Math.max(0, 4 - room.players.length);
  const isSolo = room.mode === 'solo';
  const inviteLink = typeof window !== 'undefined' ? `${window.location.origin}/?room=${room.code}` : '';

  const share = async () => {
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Capsa Banting', text: `Join my Capsa table: ${room.code}`, url: inviteLink });
        return;
      }
      await navigator.clipboard?.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // user dismissed share sheet
    }
  };

  const updateRule = (patch: Partial<CapsaRules>) => {
    if (isHost) onIntent({ type: 'UPDATE_RULES', rules: patch });
  };

  return (
    <div className="screen">
      <div className="lobby">
        <header className="lobby-head">
          <div>
            <div className="eyebrow">{isSolo ? 'Practice table' : 'Your table'}</div>
            {isSolo ? (
              <h1 className="lobby-title">You vs. the bots</h1>
            ) : (
              <div className="code-row">
                <h1 className="room-code">{room.code}</h1>
                <button type="button" className="btn btn-ghost btn-sm" onClick={share}>
                  {copied ? <Check size={15} /> : <Share2 size={15} />}
                  {copied ? 'Link copied' : 'Invite'}
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--sm"
                  aria-label="Copy code"
                  onClick={() => void navigator.clipboard?.writeText(room.code)}
                >
                  <Copy size={14} />
                </button>
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Leave" onClick={onLeave}>
            <LogOut size={17} />
          </button>
        </header>

        <div className="lobby-grid">
          <section className="lobby-card">
            <div className="section-title">
              Players <span>{room.players.length}/4</span>
            </div>
            <div className="seat-grid">
              {room.players.map((p, idx) => (
                <div
                  key={p.id}
                  className={`seat-tile${p.isReady || p.isHost ? ' is-ready' : ''}`}
                  style={{ '--d': `${idx * 60}ms` } as CSSProperties}
                >
                  {isHost && !p.isHost && (
                    <button
                      type="button"
                      className="tile-x"
                      aria-label={`Remove ${p.name}`}
                      onClick={() => onIntent({ type: 'REMOVE_PLAYER', playerId: p.id })}
                    >
                      <X size={13} />
                    </button>
                  )}
                  <Avatar name={p.name} isBot={p.isBot} size="lg" />
                  <div className="tile-name">
                    {p.name}
                    {p.id === room.viewerId && <span className="you-tag">you</span>}
                  </div>
                  <div className="tile-tags">
                    {p.isHost && (
                      <span className="tag tag--gold">
                        <Crown size={10} /> host
                      </span>
                    )}
                    {p.isBot && <span className="tag">bot</span>}
                    {!p.isHost && !p.isBot && (
                      <span className={`tag${p.transport === 'p2p' ? ' tag--mint' : ''}`}>
                        <Wifi size={10} />
                        {p.transport === 'p2p' ? 'p2p' : p.transport === 'relay' ? 'relay' : 'linking'}
                      </span>
                    )}
                  </div>
                  <div className="tile-ready">{p.isReady || p.isHost ? 'Ready' : 'Not ready'}</div>
                </div>
              ))}

              {Array.from({ length: emptySlots }).map((_, i) =>
                isHost ? (
                  <button
                    key={`empty_${i}`}
                    type="button"
                    className="seat-tile is-empty"
                    onClick={() => onIntent({ type: 'ADD_BOT' })}
                  >
                    <span className="empty-plus">
                      <Plus size={20} />
                    </span>
                    <div className="tile-name">Open seat</div>
                    <div className="tile-ready">Tap to add a bot</div>
                  </button>
                ) : (
                  <div key={`empty_${i}`} className="seat-tile is-empty">
                    <span className="empty-plus">
                      <Plus size={20} />
                    </span>
                    <div className="tile-name">Open seat</div>
                    <div className="tile-ready">A bot fills in</div>
                  </div>
                )
              )}
            </div>

            {error && <div className="alert">{error}</div>}

            {isHost ? (
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                disabled={!allReady}
                onClick={() => onIntent({ type: 'START_GAME' })}
              >
                <Sparkles size={17} />
                {allReady ? 'Deal the cards' : 'Waiting on everyone…'}
              </button>
            ) : (
              <button
                type="button"
                className={`btn btn-lg btn-block ${me?.isReady ? 'btn-ghost' : 'btn-primary'}`}
                onClick={() => onIntent({ type: 'TOGGLE_READY' })}
              >
                <Check size={17} />
                {me?.isReady ? "I'm not ready" : "I'm ready"}
              </button>
            )}
          </section>

          <section className="lobby-card">
            <div className="section-title">
              House rules {!isHost && <span>host decides</span>}
            </div>

            <div className="rule">
              <div className="rule-text">
                <b>Play to</b>
                <small>points to win the match</small>
              </div>
              <div className="seg">
                {TARGET_SCORES.map((pts) => (
                  <button
                    key={pts}
                    type="button"
                    disabled={!isHost}
                    className={room.rules.pointsToWin === pts ? 'is-on' : ''}
                    onClick={() => updateRule({ pointsToWin: pts })}
                  >
                    {pts}
                  </button>
                ))}
              </div>
            </div>

            <div className="rule">
              <div className="rule-text">
                <b>Turn timer</b>
                <small>auto-pass when it runs out</small>
              </div>
              <div className="seg">
                {TURN_TIMERS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    disabled={!isHost}
                    className={room.rules.turnDuration === t.value ? 'is-on' : ''}
                    onClick={() => updateRule({ turnDuration: t.value })}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rule">
              <div className="rule-text">
                <b>Bomb a single 2</b>
                <small>Bomber / Straight Flush beats a lone 2</small>
              </div>
              <Toggle
                label="Bomb a single 2"
                on={room.rules.enableBombsSingle}
                disabled={!isHost}
                onClick={() => updateRule({ enableBombsSingle: !room.rules.enableBombsSingle })}
              />
            </div>

            <div className="rule">
              <div className="rule-text">
                <b>Bomb a pair of 2s</b>
                <small>same, but against a pair</small>
              </div>
              <Toggle
                label="Bomb a pair of 2s"
                on={room.rules.enableBombsPair}
                disabled={!isHost}
                onClick={() => updateRule({ enableBombsPair: !room.rules.enableBombsPair })}
              />
            </div>

            <div className="rule">
              <div className="rule-text">
                <b>Double deck</b>
                <small>104 cards · lowest unique card leads</small>
              </div>
              <Toggle
                label="Double deck"
                on={room.rules.enableDoubleDeck}
                disabled={!isHost}
                onClick={() => updateRule({ enableDoubleDeck: !room.rules.enableDoubleDeck })}
              />
            </div>

            {room.rules.enableDoubleDeck && (
              <div className="rule rule--nested">
                <div className="rule-text">
                  <b>26-card hands</b>
                  <small>deal everything · dice duel on twin 3♦</small>
                </div>
                <Toggle
                  label="26-card hands"
                  on={room.rules.doubleDeck26Cards}
                  disabled={!isHost}
                  onClick={() => updateRule({ doubleDeck26Cards: !room.rules.doubleDeck26Cards })}
                />
              </div>
            )}

            <div className="rule">
              <div className="rule-text">
                <b>Card trading</b>
                <small>ask for a card; they send it + one extra</small>
              </div>
              <Toggle
                label="Card trading"
                on={room.rules.enableTrading}
                disabled={!isHost}
                onClick={() => updateRule({ enableTrading: !room.rules.enableTrading })}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
