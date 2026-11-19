import { useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Crown,
  Link as LinkIcon,
  LogOut,
  Play,
  SlidersHorizontal,
  UserPlus,
  Wifi,
  X,
} from 'lucide-react';
import type { CapsaRules, ClientIntent, SanitizedRoomState } from '@engine/types';

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
  { label: '45s', value: 45 },
  { label: '60s', value: 60 },
];

export function LobbyView({ room, error, onIntent, onLeave }: LobbyViewProps) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const me = room.players.find((p) => p.id === room.viewerId);
  const isHost = Boolean(me?.isHost);
  const allReady = room.players.every((p) => p.isReady || p.isHost);

  const copyText = (text: string, kind: 'code' | 'link') => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1800);
    });
  };

  const inviteLink =
    typeof window !== 'undefined' ? `${window.location.origin}/?room=${room.code}` : '';

  const updateRule = (patch: Partial<CapsaRules>) => {
    if (!isHost) return;
    onIntent({ type: 'UPDATE_RULES', rules: patch });
  };

  const emptySlots = Math.max(0, 4 - room.players.length);

  return (
    <div className="lobby-wrap">
      <div className="lobby-grid">
        {/* Left: Players & Room Code */}
        <div className="panel lobby-card">
          <div className="lobby-top">
            {room.mode === 'multiplayer' ? (
              <div className="room-code-pill">
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Room
                </span>
                <span className="room-code-value">{room.code}</span>
                <button
                  type="button"
                  className="btn-icon"
                  title="Copy room code"
                  onClick={() => copyText(room.code, 'code')}
                >
                  {copied === 'code' ? <Check size={15} color="#6ee7b7" /> : <Copy size={15} />}
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  title="Copy invite link"
                  onClick={() => copyText(inviteLink, 'link')}
                >
                  {copied === 'link' ? <Check size={15} color="#6ee7b7" /> : <LinkIcon size={15} />}
                </button>
              </div>
            ) : (
              <div className="room-code-pill">
                <Bot size={18} color="var(--gold-bright)" />
                <span style={{ fontWeight: 700, color: 'var(--gold-bright)' }}>Solo vs Bots</span>
              </div>
            )}

            <button type="button" className="btn btn-secondary btn-sm" onClick={onLeave}>
              <LogOut size={14} />
              Leave
            </button>
          </div>

          <div className="seat-list">
            {room.players.map((p) => (
              <div key={p.id} className="seat-row">
                <div className="seat-left">
                  <div className={`avatar-dot ${p.isBot ? 'bot' : ''}`}>
                    {p.isBot ? <Bot size={16} /> : p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.94rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{p.name}</span>
                      {p.id === room.viewerId && <span className="pill">You</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      {p.isHost && (
                        <span className="pill pill-gold">
                          <Crown size={10} /> Host
                        </span>
                      )}
                      {p.isBot && <span className="pill">AI Bot</span>}
                      {!p.isHost && !p.isBot && (
                        <span className={`pill ${p.transport === 'p2p' ? 'pill-green' : ''}`}>
                          <Wifi size={10} />
                          {p.transport === 'p2p'
                            ? 'P2P'
                            : p.transport === 'relay'
                              ? 'Relay'
                              : 'Syncing'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`pill ${p.isReady || p.isHost ? 'pill-green' : ''}`}>
                    {p.isReady || p.isHost ? 'Ready' : 'Waiting'}
                  </span>
                  {isHost && !p.isHost && (
                    <button
                      type="button"
                      className="btn-icon"
                      title={`Remove ${p.name}`}
                      onClick={() => onIntent({ type: 'REMOVE_PLAYER', playerId: p.id })}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {Array.from({ length: emptySlots }).map((_, i) => (
              <div key={`empty_${i}`} className="seat-row empty">
                <span style={{ fontSize: '0.86rem' }}>
                  Open seat (auto-fills with Bot on start)
                </span>
                {isHost && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onIntent({ type: 'ADD_BOT' })}
                  >
                    <UserPlus size={14} />
                    Add Bot
                  </button>
                )}
              </div>
            ))}
          </div>

          {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            {isHost ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!allReady}
                onClick={() => onIntent({ type: 'START_GAME' })}
              >
                <Play size={16} />
                {allReady ? 'Deal & Start Match' : 'Waiting for Players to Ready…'}
              </button>
            ) : (
              <button
                type="button"
                className={`btn ${me?.isReady ? 'btn-secondary' : 'btn-primary'}`}
                style={{ flex: 1 }}
                onClick={() => onIntent({ type: 'TOGGLE_READY' })}
              >
                <Check size={16} />
                {me?.isReady ? 'Cancel Ready' : 'Ready Up'}
              </button>
            )}
          </div>
        </div>

        {/* Right: Match Rules */}
        <div className="panel lobby-card">
          <h2 className="rules-section-title">
            <SlidersHorizontal size={15} />
            Table Rules {!isHost && <span className="pill" style={{ marginLeft: 'auto' }}>Host Controlled</span>}
          </h2>

          <div className="rule-row">
            <div>
              <div className="rule-label">Target Score</div>
              <div className="rule-desc">Points to win match (+3/+2/+1/0 per round)</div>
            </div>
            <div className="seg-control">
              {TARGET_SCORES.map((pts) => (
                <button
                  key={pts}
                  type="button"
                  disabled={!isHost}
                  className={`seg-btn ${room.rules.pointsToWin === pts ? 'active' : ''}`}
                  onClick={() => updateRule({ pointsToWin: pts })}
                >
                  {pts}
                </button>
              ))}
            </div>
          </div>

          <div className="rule-row">
            <div>
              <div className="rule-label">Turn Timer</div>
              <div className="rule-desc">Auto-pass or lead on timeout</div>
            </div>
            <div className="seg-control">
              {TURN_TIMERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  disabled={!isHost}
                  className={`seg-btn ${room.rules.turnDuration === t.value ? 'active' : ''}`}
                  onClick={() => updateRule({ turnDuration: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rule-row">
            <div>
              <div className="rule-label">Bomb Single 2</div>
              <div className="rule-desc">Bomber or Straight Flush slams any single 2</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={room.rules.enableBombsSingle}
              disabled={!isHost}
              className={`toggle ${room.rules.enableBombsSingle ? 'on' : ''}`}
              onClick={() => updateRule({ enableBombsSingle: !room.rules.enableBombsSingle })}
            />
          </div>

          <div className="rule-row">
            <div>
              <div className="rule-label">Bomb Pair of 2s</div>
              <div className="rule-desc">Bomber or Straight Flush slams a pair of 2s</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={room.rules.enableBombsPair}
              disabled={!isHost}
              className={`toggle ${room.rules.enableBombsPair ? 'on' : ''}`}
              onClick={() => updateRule({ enableBombsPair: !room.rules.enableBombsPair })}
            />
          </div>

          <div className="rule-row">
            <div>
              <div className="rule-label">Double Deck (104 Cards)</div>
              <div className="rule-desc">Two decks mixed; lowest unique card starts</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={room.rules.enableDoubleDeck}
              disabled={!isHost}
              className={`toggle ${room.rules.enableDoubleDeck ? 'on' : ''}`}
              onClick={() => updateRule({ enableDoubleDeck: !room.rules.enableDoubleDeck })}
            />
          </div>

          {room.rules.enableDoubleDeck && (
            <div className="rule-row">
              <div>
                <div className="rule-label">26-Card Hands + 3♦ Dice Duel</div>
                <div className="rule-desc">Deal all 104 cards; dice duel if two hold 3♦</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={room.rules.doubleDeck26Cards}
                disabled={!isHost}
                className={`toggle ${room.rules.doubleDeck26Cards ? 'on' : ''}`}
                onClick={() => updateRule({ doubleDeck26Cards: !room.rules.doubleDeck26Cards })}
              />
            </div>
          )}

          <div className="rule-row">
            <div>
              <div className="rule-label">Card Trading</div>
              <div className="rule-desc">Request a card on your turn; holder sends it + 1 extra card</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={room.rules.enableTrading}
              disabled={!isHost}
              className={`toggle ${room.rules.enableTrading ? 'on' : ''}`}
              onClick={() => updateRule({ enableTrading: !room.rules.enableTrading })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
