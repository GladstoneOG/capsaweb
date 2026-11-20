import { useState, type CSSProperties } from 'react';
import { Check, Copy, Crown, LogOut, Plus, Share2, Sparkles, Wifi, X } from 'lucide-react';
import type { CapsaRules, ClientIntent, SanitizedRoomState } from '@engine/types';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';

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

type DeckMode = 'standard' | 'double13' | 'double26';

function getDeckMode(rules: CapsaRules): DeckMode {
  if (!rules.enableDoubleDeck) return 'standard';
  return rules.doubleDeck26Cards ? 'double26' : 'double13';
}

function Toggle({
  on,
  disabled,
  onClick,
  label,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
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
  const [copiedCode, setCopiedCode] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const me = room.players.find((p) => p.id === room.viewerId);
  const isHost = Boolean(me?.isHost);
  const hasHumanPeers = room.mode === 'multiplayer' && room.players.some((p) => !p.isHost && !p.isBot);
  const allReady = room.players.every((p) => p.isReady || p.isHost);
  const emptySlots = Math.max(0, 4 - room.players.length);
  const isSolo = room.mode === 'solo';
  const inviteLink = typeof window !== 'undefined' ? `${window.location.origin}/?room=${room.code}` : '';
  const deckMode = getDeckMode(room.rules);

  const share = async () => {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: 'Capsa Banting',
          text: `Join my Capsa Banting table: ${room.code}`,
          url: inviteLink,
        });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard?.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard?.writeText(room.code);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // ignore
    }
  };

  const updateRule = (patch: Partial<CapsaRules>) => {
    if (isHost) onIntent({ type: 'UPDATE_RULES', rules: patch });
  };

  const setDeckMode = (mode: DeckMode) => {
    if (mode === 'standard') {
      updateRule({ enableDoubleDeck: false, doubleDeck26Cards: false });
    } else if (mode === 'double13') {
      updateRule({ enableDoubleDeck: true, doubleDeck26Cards: false });
    } else {
      updateRule({ enableDoubleDeck: true, doubleDeck26Cards: true });
    }
  };

  const deckDesc =
    deckMode === 'standard'
      ? '52 cards · 13 each · 3♦ leads'
      : deckMode === 'double13'
        ? '104-card shoe · 13 each · duplicates & lowest card leads'
        : 'All 104 cards dealt · 26 each · twin 3♦ dice duel';

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
                  aria-label={copiedCode ? 'Code copied' : 'Copy room code'}
                  title={copiedCode ? 'Code copied' : 'Copy room code'}
                  onClick={() => void copyRoomCode()}
                >
                  {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                </button>
                {copiedCode && <span className="copy-feedback" role="status">Code copied</span>}
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Leave table"
            title="Leave table"
            onClick={() => setLeaveConfirmOpen(true)}
          >
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
                      <span
                        className={`tag${p.transport === 'p2p' || p.transport === 'relay' ? ' tag--mint' : ''}`}
                        title={
                          p.transport === 'p2p'
                            ? 'Direct connection'
                            : p.transport === 'relay'
                              ? 'Relayed connection'
                              : 'Connecting to table'
                        }
                      >
                        <Wifi size={10} />
                        {p.transport === 'connecting' ? 'connecting' : 'online'}
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
                    <div className="tile-ready">Bot fills on start</div>
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
                <b>Deck</b>
                <small>{deckDesc}</small>
              </div>
              <div className="seg">
                <button
                  type="button"
                  disabled={!isHost}
                  className={deckMode === 'standard' ? 'is-on' : ''}
                  onClick={() => setDeckMode('standard')}
                >
                  Standard
                </button>
                <button
                  type="button"
                  disabled={!isHost}
                  className={deckMode === 'double13' ? 'is-on' : ''}
                  onClick={() => setDeckMode('double13')}
                >
                  2× (13)
                </button>
                <button
                  type="button"
                  disabled={!isHost}
                  className={deckMode === 'double26' ? 'is-on' : ''}
                  onClick={() => setDeckMode('double26')}
                >
                  2× (26)
                </button>
              </div>
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

      <ConfirmDialog
        open={leaveConfirmOpen}
        tone={isHost && hasHumanPeers ? 'danger' : 'default'}
        eyebrow={isHost && hasHumanPeers ? 'Close table' : 'Leave lobby'}
        title={isHost && hasHumanPeers ? 'Close this table?' : 'Leave the lobby?'}
        description={
          isHost && hasHumanPeers
            ? "You're hosting this room — leaving will close the lobby for all connected players."
            : isSolo
              ? 'Return to the home screen.'
              : 'You will return to the home screen and give up your seat.'
        }
        confirmLabel={isHost && hasHumanPeers ? 'Close table' : 'Leave lobby'}
        onCancel={() => setLeaveConfirmOpen(false)}
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          onLeave();
        }}
      />
    </div>
  );
}
