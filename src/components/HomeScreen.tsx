import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  Bot,
  HelpCircle,
  Lock,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import type { Card } from '@engine/types';
import { fetchOpenRoomsResult, type LobbyListing } from '@net/session';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { PlayingCard } from './PlayingCard';

const HERO_CARDS: Card[] = [
  { id: 'h1', rank: 'J', suit: 'C' },
  { id: 'h2', rank: 'Q', suit: 'H' },
  { id: 'h3', rank: '2', suit: 'S' },
  { id: 'h4', rank: 'K', suit: 'D' },
  { id: 'h5', rank: 'A', suit: 'S' },
];

interface HomeScreenProps {
  initialRoomCode: string;
  initialName: string;
  busy: boolean;
  error: string | null;
  onHost: (name: string, password?: string) => void;
  onJoin: (code: string, name: string, password?: string) => void;
  onSolo: (name: string) => void;
}

export function HomeScreen({
  initialRoomCode,
  initialName,
  busy,
  error,
  onHost,
  onJoin,
  onSolo,
}: HomeScreenProps) {
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [rooms, setRooms] = useState<LobbyListing[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomsError, setRoomsError] = useState(false);
  const [joinPromptRoom, setJoinPromptRoom] = useState<{
    code: string;
    hostName: string;
  } | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [liveInvite, setLiveInvite] = useState<{ code: string; hasPassword: boolean } | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordTitleId = useId();
  const rulesTitleId = useId();

  const cleanName = name.trim() || 'Player';
  const invitedCode = initialRoomCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  const clearRoomParam = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('room')) {
        url.searchParams.delete('room');
        window.history.replaceState({}, '', url.pathname);
      }
    } catch {
      // ignore
    }
  }, []);

  // Validate any ?room=XXXX invite link; explain if stale/closed before clearing URL
  useEffect(() => {
    if (invitedCode.length !== 4) return;
    let cancelled = false;
    void fetch(`/api/room/${invitedCode}/status`)
      .then((res) => (res.ok ? (res.json() as Promise<{ hasHost?: boolean; hasPassword?: boolean }>) : null))
      .then((status) => {
        if (cancelled) return;
        if (status?.hasHost) {
          setLiveInvite({ code: invitedCode, hasPassword: Boolean(status.hasPassword) });
          setInviteNotice(null);
          if (!initialName.trim()) {
            nameInputRef.current?.focus();
          }
        } else {
          setInviteNotice(`Table ${invitedCode} has ended or is no longer open.`);
          clearRoomParam();
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInviteNotice(`Could not verify invite for table ${invitedCode}.`);
          clearRoomParam();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [invitedCode, clearRoomParam, initialName]);

  const loadRooms = useCallback(async (showSpin = false) => {
    if (showSpin) setLoadingRooms(true);
    const { rooms: list, ok } = await fetchOpenRoomsResult();
    setRooms(list);
    setRoomsError(!ok);
    setLoadingRooms(false);
  }, []);

  useEffect(() => {
    void loadRooms(true);
    const id = window.setInterval(() => void loadRooms(false), 5000);
    return () => window.clearInterval(id);
  }, [loadRooms]);

  const handleSelectRoom = (room: LobbyListing) => {
    const canJoinLobby = room.gameState === 'lobby' && room.playerCount < room.maxPlayers;
    const canRejoin = room.gameState !== 'lobby' && (room.rejoinableCount ?? 0) > 0;
    if (busy || (!canJoinLobby && !canRejoin)) return;
    if (room.hasPassword) {
      setJoinPromptRoom({ code: room.code, hostName: room.hostName });
      setJoinPassword('');
      return;
    }
    onJoin(room.code, cleanName);
  };

  const handleAcceptInvite = () => {
    if (!liveInvite || busy) return;
    if (liveInvite.hasPassword) {
      setJoinPromptRoom({ code: liveInvite.code, hostName: `Table ${liveInvite.code}` });
      setJoinPassword('');
      return;
    }
    onJoin(liveInvite.code, cleanName);
  };

  return (
    <div className="screen">
      <div className="home">
        <div className="home-card">
          <div className="hero-fan" aria-hidden="true">
            {HERO_CARDS.map((card, i) => (
              <div key={card.id} className="hero-card" style={{ '--off': i - 2 } as CSSProperties}>
                <PlayingCard card={card} size="lg" />
              </div>
            ))}
          </div>

          <h1 className="brand">
            Capsa <span>Banting</span>
          </h1>
          <p className="tagline">Host a table or hop right into an open lobby.</p>

          {inviteNotice && (
            <div className="invite-notice" role="status">
              <span>{inviteNotice}</span>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label="Dismiss notice"
                onClick={() => setInviteNotice(null)}
              >
                <X size={13} />
              </button>
            </div>
          )}

          {liveInvite && (
            <div className="invite-banner invite-banner--featured">
              <span>
                You're invited to table <strong>{liveInvite.code}</strong>
                {liveInvite.hasPassword && <Lock size={12} style={{ marginLeft: 5, verticalAlign: '-1px' }} />}
              </span>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                aria-label="Dismiss invite"
                onClick={() => {
                  setLiveInvite(null);
                  clearRoomParam();
                }}
              >
                <X size={13} />
              </button>
            </div>
          )}

          <div className="home-inputs">
            <label className="field">
              <span className="field-label">Your name</span>
              <input
                ref={nameInputRef}
                className="input"
                type="text"
                maxLength={20}
                placeholder="Enter name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">
                <Lock size={11} /> Host password <span className="opt-tag">optional</span>
              </span>
              <input
                className="input"
                type="password"
                maxLength={32}
                placeholder="Leave blank for open room"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>

          {liveInvite ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={busy}
                onClick={handleAcceptInvite}
              >
                Join table {liveInvite.code}
                <ArrowRight size={18} />
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => onHost(cleanName, password)}
              >
                <Users size={16} />
                {busy ? 'Creating table…' : 'Host your own table instead'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={() => onHost(cleanName, password)}
            >
              <Users size={18} />
              {busy ? 'Creating table…' : 'Host game'}
            </button>
          )}

          <button type="button" className="link-btn" disabled={busy} onClick={() => onSolo(cleanName)}>
            <Bot size={16} />
            Or practice offline vs bots
          </button>

          {error && <div className="alert">{error}</div>}
        </div>

        {/* Live Lobby Browser */}
        <section className="lobbies-card" aria-label="Open Lobbies">
          <div className="lobbies-head">
            <div className="lobbies-title">
              <span className="live-dot" />
              <strong>Open Lobbies</strong>
              <span className="lobbies-count">{rooms.length}</span>
            </div>
            <button
              type="button"
              className={`icon-btn icon-btn--sm${loadingRooms ? ' is-spin' : ''}`}
              aria-label="Refresh lobbies"
              onClick={() => void loadRooms(true)}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {rooms.length === 0 ? (
            <div className="lobbies-empty">
              {loadingRooms ? (
                'Checking for active tables…'
              ) : roomsError ? (
                <div className="lobbies-empty-stack">
                  <span>Couldn't reach the lobby server.</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void loadRooms(true)}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="lobbies-empty-stack">
                  <span>No open tables right now — host one above!</span>
                  <button
                    type="button"
                    className="link-btn link-btn--sm"
                    disabled={busy}
                    onClick={() => onSolo(cleanName)}
                  >
                    <Bot size={14} />
                    Quick solo practice vs bots
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="lobbies-list">
              {rooms.map((room) => {
                const isOpen = room.gameState === 'lobby' && room.playerCount < room.maxPlayers;
                const canRejoin = room.gameState !== 'lobby' && (room.rejoinableCount ?? 0) > 0;
                const clickable = isOpen || canRejoin;
                return (
                  <div key={room.code} className={`lobby-item${clickable ? '' : ' is-busy'}`}>
                    <Avatar name={room.hostName} size="sm" />
                    <div className="lobby-item-main">
                      <div className="lobby-item-top">
                        <strong>{room.hostName}'s Table</strong>
                        <span className="lobby-code-chip">{room.code}</span>
                        {room.hasPassword && (
                          <span className="lock-chip" title="Password protected">
                            <Lock size={11} />
                          </span>
                        )}
                      </div>
                      <div className="lobby-item-sub">
                        <span>
                          {room.playerCount}/{room.maxPlayers} players
                        </span>
                        {canRejoin && (
                          <span className="rejoin-hint">
                            · {room.rejoinableCount} seat{room.rejoinableCount > 1 ? 's' : ''} open to rejoin
                          </span>
                        )}
                        {room.rulesSummary && <span>· {room.rulesSummary}</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`btn btn-sm ${isOpen ? 'btn-primary' : canRejoin ? 'btn-rejoin' : 'btn-ghost'}`}
                      disabled={!clickable || busy}
                      onClick={() => handleSelectRoom(room)}
                    >
                      {isOpen
                        ? 'Join'
                        : canRejoin
                          ? 'Rejoin'
                          : room.gameState !== 'lobby'
                            ? 'In game'
                            : 'Full'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="home-foot">
          <span>Instant tables · no sign-up</span>
          <button type="button" className="link-btn link-btn--sm" onClick={() => setShowRules(true)}>
            <HelpCircle size={14} />
            How to play
          </button>
        </div>
      </div>

      {/* Password Prompt Modal for locked rooms */}
      {joinPromptRoom && (
        <Modal labelledBy={passwordTitleId} onClose={() => setJoinPromptRoom(null)}>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={() => setJoinPromptRoom(null)}
          >
            <X size={16} />
          </button>
          <div className="eyebrow">
            <Lock size={12} /> Locked table · {joinPromptRoom.code}
          </div>
          <h2 id={passwordTitleId} className="modal-title">
            Join {joinPromptRoom.hostName}
          </h2>
          <p className="modal-sub">Enter the room password to take a seat.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!joinPassword.trim()) return;
              const target = joinPromptRoom;
              setJoinPromptRoom(null);
              onJoin(target.code, cleanName, joinPassword);
            }}
          >
            <input
              className="input"
              type="password"
              autoFocus
              placeholder="Room password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setJoinPromptRoom(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!joinPassword.trim()}>
                Join table
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showRules && (
        <Modal labelledBy={rulesTitleId} onClose={() => setShowRules(false)}>
          <button type="button" className="modal-close" aria-label="Close" onClick={() => setShowRules(false)}>
            <X size={16} />
          </button>
          <div className="eyebrow">Quick rules</div>
          <h2 id={rulesTitleId} className="modal-title">
            How Capsa Banting works
          </h2>
          <ul className="rules-list">
            <li>
              <b>Goal:</b> be the first to empty your hand. 4 players, 13 cards each (or 26 in Double Deck 26).
            </li>
            <li>
              <b>Order:</b> 3 is lowest, 2 is highest. Suits go ♦ &lt; ♣ &lt; ♥ &lt; ♠.
            </li>
            <li>
              <b>Opening:</b> whoever holds 3♦ leads, and has to play it.
            </li>
            <li>
              <b>Combos:</b> singles, pairs, triples, or five-card hands — Straight &lt; Flush &lt; Full House &lt;
              Bomber &lt; Straight Flush. Flushes compare by suit first.
            </li>
            <li>
              <b>Bombs:</b> a Bomber or Straight Flush can slam a single 2 or a pair of 2s.
            </li>
            <li>
              <b>Hibah:</b> win a trick with your last card and the lead passes to the next player.
            </li>
            <li>
              <b>Scoring:</b> 1st +3, 2nd +2, 3rd +1, last 0. First to the target wins.
            </li>
          </ul>
        </Modal>
      )}
    </div>
  );
}
